// src/controllers/userController.js
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { ROLES } from '../constants/roles.js';

// ============================================================================
// HELPERS (AUTHZ)
// ============================================================================

const isPlatformAdmin = (req) => req.user?.role === ROLES.PLATFORM_ADMIN;
const isInstitutionAdmin = (req) => req.user?.role === ROLES.ADMIN_INSTITUTION;

const getRequesterInstitutionId = async (req) => {
  // resolveUserAccess should set this, but we keep a safe fallback
  if (req.userAccess?.institutionId) return req.userAccess.institutionId;

  const q = await pool.query(
    `SELECT institution_id FROM user_institutions WHERE user_id = $1 LIMIT 1`,
    [req.user.id]
  );
  return q.rows[0]?.institution_id || null;
};

const getTargetUserInstitutionAndRole = async (targetUserId) => {
  const q = await pool.query(
    `
    SELECT
      u.id,
      u.role,
      ui.institution_id
    FROM users u
    LEFT JOIN user_institutions ui ON ui.user_id = u.id
    WHERE u.id = $1 AND u.deleted_at IS NULL
    LIMIT 1
    `,
    [targetUserId]
  );

  return q.rows[0] || null; // { id, role, institution_id }
};

const assertInstitutionAdminCanManageTarget = async (req, targetUserId) => {
  // ADMIN_INSTITUTION can manage ONLY EDITOR_INSTITUTION in SAME institution
  const requesterInstitutionId = await getRequesterInstitutionId(req);
  if (!requesterInstitutionId) {
    return {
      ok: false,
      status: 403,
      message: 'ADMIN_INSTITUTION nu are instituție asociată (user_institutions lipsă).',
    };
  }

  const target = await getTargetUserInstitutionAndRole(targetUserId);
  if (!target) {
    return { ok: false, status: 404, message: 'Utilizator negăsit.' };
  }

  if (Number(target.institution_id) !== Number(requesterInstitutionId)) {
    return {
      ok: false,
      status: 403,
      message: 'Nu ai voie să gestionezi utilizatori din altă instituție.',
    };
  }

  if (target.role !== ROLES.EDITOR_INSTITUTION) {
    return {
      ok: false,
      status: 403,
      message: 'ADMIN_INSTITUTION poate gestiona doar utilizatori cu rol EDITOR_INSTITUTION.',
    };
  }

  return { ok: true, requesterInstitutionId, target };
};

// ============================================================================
// USER MANAGEMENT (PLATFORM_ADMIN + ADMIN_INSTITUTION)
// ============================================================================

// GET ALL USERS
export const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 500, role, search, institutionId, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const whereConditions = ['u.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    // If ADMIN_INSTITUTION -> force institution scope to their institution
    if (isInstitutionAdmin(req)) {
      const myInstitutionId = await getRequesterInstitutionId(req);
      if (!myInstitutionId) {
        return res.status(403).json({
          success: false,
          message: 'ADMIN_INSTITUTION nu are instituție asociată (user_institutions lipsă).',
        });
      }
      whereConditions.push(`ui.institution_id = $${paramCount}`);
      params.push(myInstitutionId);
      paramCount++;
    } else {
      // PLATFORM_ADMIN can filter by institutionId (optional)
      if (institutionId) {
        whereConditions.push(`ui.institution_id = $${paramCount}`);
        params.push(institutionId);
        paramCount++;
      }
    }

    // Filter by role
    if (role) {
      whereConditions.push(`u.role = $${paramCount}`);
      params.push(role);
      paramCount++;
    }

    // Search by name or email
    if (search) {
      whereConditions.push(
        `(u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`
      );
      params.push(`%${search}%`);
      paramCount++;
    }

    // Filter by status
    if (status === 'active') whereConditions.push('u.is_active = true');
    if (status === 'inactive') whereConditions.push('u.is_active = false');

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.position,
        u.department,
        u.role,
        u.is_active,
        u.created_at,
        u.updated_at,
        
        jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'short_name', i.short_name,
          'type', i.type
        ) as institution,
        
        jsonb_build_object(
          'can_edit_data', COALESCE(up.can_edit_data, false),
          'access_type', up.access_type,
          'sector_id', up.sector_id,
          'operator_institution_id', up.operator_institution_id
        ) as permissions,
        
        (
          SELECT json_agg(
            jsonb_build_object(
              'id', s.id,
              'sector_number', s.sector_number,
              'sector_name', s.sector_name
            )
          )
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = i.id
        ) as sectors
        
      FROM users u
      LEFT JOIN user_institutions ui ON u.id = ui.user_id
      LEFT JOIN institutions i ON ui.institution_id = i.id AND i.deleted_at IS NULL
      LEFT JOIN user_permissions up ON u.id = up.user_id
      WHERE ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    params.push(Number(limit), Number(offset));

    const countQuery = `
      SELECT COUNT(DISTINCT u.id) as count
      FROM users u
      LEFT JOIN user_institutions ui ON u.id = ui.user_id
      WHERE ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, params.slice(0, paramCount - 1)),
    ]);

    const total = parseInt(countResult.rows[0].count, 10) || 0;

    res.json({
      success: true,
      data: {
        users: result.rows,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Eroare la obținerea utilizatorilor' });
  }
};

// GET USER BY ID
export const getUserById = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    // If ADMIN_INSTITUTION -> only within own institution
    if (isInstitutionAdmin(req)) {
      const myInstitutionId = await getRequesterInstitutionId(req);
      if (!myInstitutionId) {
        return res.status(403).json({
          success: false,
          message: 'ADMIN_INSTITUTION nu are instituție asociată (user_institutions lipsă).',
        });
      }

      const scopeCheck = await pool.query(
        `SELECT 1 FROM user_institutions WHERE user_id = $1 AND institution_id = $2 LIMIT 1`,
        [userId, myInstitutionId]
      );
      if (scopeCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Nu ai acces la acest utilizator (altă instituție).',
        });
      }
    }

    const query = `
      SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.position,
        u.department,
        u.role,
        u.is_active,
        u.created_at,
        u.updated_at,
        
        jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'short_name', i.short_name,
          'type', i.type
        ) as institution,
        
        jsonb_build_object(
          'can_edit_data', COALESCE(up.can_edit_data, false),
          'access_type', up.access_type,
          'sector_id', up.sector_id,
          'operator_institution_id', up.operator_institution_id
        ) as permissions,
        
        (
          SELECT json_agg(
            jsonb_build_object(
              'id', s.id,
              'sector_number', s.sector_number,
              'sector_name', s.sector_name
            )
          )
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = i.id
        ) as sectors
        
      FROM users u
      LEFT JOIN user_institutions ui ON u.id = ui.user_id
      LEFT JOIN institutions i ON ui.institution_id = i.id AND i.deleted_at IS NULL
      LEFT JOIN user_permissions up ON u.id = up.user_id
      WHERE u.id = $1 AND u.deleted_at IS NULL
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Utilizator negăsit' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Eroare la obținerea utilizatorului' });
  }
};

// CREATE USER
export const createUser = async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, position, department, role, isActive, institutionIds } = req.body;

    // ADMIN_INSTITUTION: can create ONLY EDITOR_INSTITUTION and ONLY in own institution
    if (isInstitutionAdmin(req)) {
      const myInstitutionId = await getRequesterInstitutionId(req);
      if (!myInstitutionId) {
        return res.status(403).json({
          success: false,
          message: 'ADMIN_INSTITUTION nu are instituție asociată (user_institutions lipsă).',
        });
      }

      if (role !== ROLES.EDITOR_INSTITUTION) {
        return res.status(403).json({
          success: false,
          message: 'ADMIN_INSTITUTION poate crea doar utilizatori cu rol EDITOR_INSTITUTION.',
        });
      }

      // Ignore incoming institutionIds and force to own institution
      return await _createUserInternal(req, res, {
        email,
        password,
        firstName,
        lastName,
        phone,
        position,
        department,
        role,
        isActive,
        institutionIds: [myInstitutionId],
      });
    }

    // PLATFORM_ADMIN: full create
    return await _createUserInternal(req, res, {
      email,
      password,
      firstName,
      lastName,
      phone,
      position,
      department,
      role,
      isActive,
      institutionIds,
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, message: 'Eroare la crearea utilizatorului' });
  }
};

const _createUserInternal = async (req, res, data) => {
  const { email, password, firstName, lastName, phone, position, department, role, isActive, institutionIds } = data;

  // Validate required
  if (!email || !password || !firstName || !lastName || !role || !Array.isArray(institutionIds) || institutionIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Câmpuri lipsă: email, password, firstName, lastName, role, institutionIds[]',
    });
  }

  // Check if email exists
  const existing = await pool.query(`SELECT 1 FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`, [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ success: false, message: 'Email deja existent' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `
      INSERT INTO users (email, password_hash, first_name, last_name, phone, position, department, role, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, email, first_name, last_name, role, is_active
      `,
      [email, passwordHash, firstName, lastName, phone || null, position || null, department || null, role, isActive !== false]
    );

    const newUser = userResult.rows[0];

    // Link to first institution (your schema has UNIQUE user_id in user_institutions)
    await client.query(
      `INSERT INTO user_institutions (user_id, institution_id) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET institution_id = EXCLUDED.institution_id, updated_at = CURRENT_TIMESTAMP`,
      [newUser.id, institutionIds[0]]
    );

    // Ensure permissions row exists (optional default)
    await client.query(
      `INSERT INTO user_permissions (user_id, can_edit_data, access_type, sector_id, operator_institution_id)
       VALUES ($1,false,NULL,NULL,NULL)
       ON CONFLICT (user_id) DO NOTHING`,
      [newUser.id]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Utilizator creat cu succes',
      data: { user: newUser },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

// UPDATE USER
export const updateUser = async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);

    if (isInstitutionAdmin(req)) {
      const check = await assertInstitutionAdminCanManageTarget(req, targetUserId);
      if (!check.ok) {
        return res.status(check.status).json({ success: false, message: check.message });
      }

      // Force constraints for ADMIN_INSTITUTION:
      // - role must remain EDITOR_INSTITUTION
      // - institution must remain their institution
      const body = req.body || {};
      if (body.role && body.role !== ROLES.EDITOR_INSTITUTION) {
        return res.status(403).json({
          success: false,
          message: 'ADMIN_INSTITUTION nu poate schimba rolul (doar EDITOR_INSTITUTION).',
        });
      }

      const payload = {
        ...body,
        role: ROLES.EDITOR_INSTITUTION,
        institutionIds: [check.requesterInstitutionId],
      };

      return await _updateUserInternal(req, res, targetUserId, payload);
    }

    // PLATFORM_ADMIN
    return await _updateUserInternal(req, res, targetUserId, req.body || {});
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: 'Eroare la actualizarea utilizatorului' });
  }
};

const _updateUserInternal = async (req, res, userId, data) => {
  const { email, firstName, lastName, phone, position, department, role, isActive, password, institutionIds } = data;

  // Check user exists
  const existing = await pool.query(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Utilizator negăsit' });
  }

  // Email uniqueness if changed
  if (email) {
    const emailCheck = await pool.query(
      `SELECT 1 FROM users WHERE email = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
      [email, userId]
    );
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Email deja folosit de alt utilizator' });
    }
  }

  const fields = [];
  const params = [];
  let p = 1;

  if (email !== undefined) { fields.push(`email = $${p++}`); params.push(email); }
  if (firstName !== undefined) { fields.push(`first_name = $${p++}`); params.push(firstName); }
  if (lastName !== undefined) { fields.push(`last_name = $${p++}`); params.push(lastName); }
  if (phone !== undefined) { fields.push(`phone = $${p++}`); params.push(phone || null); }
  if (position !== undefined) { fields.push(`position = $${p++}`); params.push(position || null); }
  if (department !== undefined) { fields.push(`department = $${p++}`); params.push(department || null); }
  if (role !== undefined) { fields.push(`role = $${p++}`); params.push(role); }
  if (isActive !== undefined) { fields.push(`is_active = $${p++}`); params.push(!!isActive); }

  if (password && String(password).trim()) {
    const passwordHash = await bcrypt.hash(password, 10);
    fields.push(`password_hash = $${p++}`);
    params.push(passwordHash);
  }

  if (fields.length === 0 && !institutionIds) {
    return res.status(400).json({ success: false, message: 'Nu există câmpuri de actualizat' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (fields.length > 0) {
      params.push(userId);
      await client.query(
        `UPDATE users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${p}`,
        params
      );
    }

    // Update institution link if provided
    if (Array.isArray(institutionIds) && institutionIds.length > 0) {
      await client.query(
        `INSERT INTO user_institutions (user_id, institution_id)
         VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET institution_id = EXCLUDED.institution_id, updated_at = CURRENT_TIMESTAMP`,
        [userId, institutionIds[0]]
      );
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Utilizator actualizat cu succes',
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

// DELETE USER
export const deleteUser = async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);

    if (isInstitutionAdmin(req)) {
      const check = await assertInstitutionAdminCanManageTarget(req, targetUserId);
      if (!check.ok) {
        return res.status(check.status).json({ success: false, message: check.message });
      }
    }

    const result = await pool.query(
      `UPDATE users SET deleted_at = CURRENT_TIMESTAMP, is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL`,
      [targetUserId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Utilizator negăsit' });
    }

    res.json({ success: true, message: 'Utilizator șters cu succes' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, message: 'Eroare la ștergerea utilizatorului' });
  }
};

// USER STATS (only PLATFORM_ADMIN route-level, still safe)
export const getUserStats = async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) as total_users,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_active = true) as active_users,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_active = false) as inactive_users,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND role = 'PLATFORM_ADMIN') as platform_admins,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND role = 'ADMIN_INSTITUTION') as institution_admins,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND role = 'EDITOR_INSTITUTION') as institution_editors,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND role = 'REGULATOR_VIEWER') as regulators
      FROM users
    `);

    res.json({ success: true, data: stats.rows[0] });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, message: 'Eroare la obținerea statisticilor' });
  }
};


// ============================================================================
// USER PROFILE (ALL AUTHENTICATED USERS)
// ============================================================================

// ============================================================================
// GET CURRENT USER PROFILE (FIXED - includes operators)
// ============================================================================
export const getUserProfile = async (req, res) => {
  console.log('\n👤 ==================== GET USER PROFILE ====================');
  
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log('📋 User:', { userId, userRole });

    // ========== STEP 1: Get user + institution + permissions + sectors ==========
    const userQuery = `
      SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.position,
        u.department,
        u.role,
        u.is_active,
        u.created_at,
        u.updated_at,
        
        jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'short_name', i.short_name,
          'type', i.type,
          'sector', i.sector,
          'contact_email', i.contact_email,
          'contact_phone', i.contact_phone,
          'address', i.address,
          'website', i.website,
          'fiscal_code', i.fiscal_code
        ) as institution,
        
        jsonb_build_object(
          'can_edit_data', COALESCE(up.can_edit_data, false),
          'access_type', up.access_type,
          'sector_id', up.sector_id,
          'operator_institution_id', up.operator_institution_id
        ) as permissions,
        
        (
          SELECT json_agg(
            jsonb_build_object(
              'id', s.id,
              'sector_number', s.sector_number,
              'sector_name', s.sector_name
            )
          )
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = i.id
        ) as sectors
        
      FROM users u
      LEFT JOIN user_institutions ui ON u.id = ui.user_id
      LEFT JOIN institutions i ON ui.institution_id = i.id AND i.deleted_at IS NULL
      LEFT JOIN user_permissions up ON u.id = up.user_id
      WHERE u.id = $1 AND u.deleted_at IS NULL
    `;

    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilizator negăsit'
      });
    }

    const userData = userResult.rows[0];
    console.log('✅ User data loaded:', userData.email);

    // ========== STEP 2: Get operators (ONLY for roles that need them) ==========
    let operators = [];

    if (['PLATFORM_ADMIN', 'ADMIN_INSTITUTION', 'EDITOR_INSTITUTION', 'REGULATOR_VIEWER'].includes(userRole)) {
      console.log('🔍 Loading operators for role:', userRole);

      // Determine accessible sectors
      let accessibleSectorIds = [];

      if (userRole === 'PLATFORM_ADMIN') {
        const sectorsResult = await pool.query(`
          SELECT id FROM sectors WHERE is_active = true
        `);
        accessibleSectorIds = sectorsResult.rows.map(r => r.id);
      } else if (userData.institution?.id) {
        const sectorsQuery = `
          SELECT DISTINCT sector_id
          FROM institution_sectors
          WHERE institution_id = $1
        `;
        const sectorsResult = await pool.query(sectorsQuery, [userData.institution.id]);
        accessibleSectorIds = sectorsResult.rows.map(r => r.sector_id);
      }

      console.log('📍 Accessible sectors:', accessibleSectorIds.length);

      if (accessibleSectorIds.length > 0) {
        // Get operators with contracts (same logic as getProfileOperators)

        // 1) WASTE COLLECTORS
        const collectorsQuery = `
          SELECT
            i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
            'WASTE_COLLECTOR' as operator_type,
            COALESCE(
              json_agg(
                json_build_object(
                  'contract_id', woc.id,
                  'contract_number', woc.contract_number,
                  'contract_date_start', woc.contract_date_start,
                  'contract_date_end', woc.contract_date_end,
                  'sector_id', woc.sector_id,
                  'sector_name', s.sector_name,
                  'sector_number', s.sector_number,
                  'is_active', woc.is_active,
                  'notes', woc.notes,
                  'has_file', (woc.contract_file_url IS NOT NULL)
                )
                ORDER BY s.sector_number, woc.contract_date_start
              ) FILTER (WHERE woc.id IS NOT NULL),
              '[]'::json
            ) as contracts
          FROM institutions i
          JOIN waste_collector_contracts woc ON i.id = woc.institution_id
          JOIN sectors s ON woc.sector_id = s.id
          WHERE i.deleted_at IS NULL
            AND woc.deleted_at IS NULL
            AND woc.sector_id = ANY($1)
          GROUP BY i.id
        `;

        // 2) SORTING OPERATORS
        const sortingQuery = `
          SELECT
            i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
            'SORTING_OPERATOR' as operator_type,
            COALESCE(
              json_agg(
                json_build_object(
                  'contract_id', soc.id,
                  'contract_number', soc.contract_number,
                  'contract_date_start', soc.contract_date_start,
                  'contract_date_end', soc.contract_date_end,
                  'sector_id', soc.sector_id,
                  'sector_name', s.sector_name,
                  'sector_number', s.sector_number,
                  'tariff_per_ton', soc.tariff_per_ton,
                  'estimated_quantity_tons', soc.estimated_quantity_tons,
                  'currency', soc.currency,
                  'is_active', soc.is_active,
                  'notes', soc.notes,
                  'has_file', (soc.contract_file_url IS NOT NULL)
                )
                ORDER BY s.sector_number, soc.contract_date_start
              ) FILTER (WHERE soc.id IS NOT NULL),
              '[]'::json
            ) as contracts
          FROM institutions i
          JOIN sorting_operator_contracts soc ON i.id = soc.institution_id
          JOIN sectors s ON soc.sector_id = s.id
          WHERE i.deleted_at IS NULL
            AND soc.deleted_at IS NULL
            AND soc.sector_id = ANY($1)
          GROUP BY i.id
        `;

        // 3) TMB OPERATORS
        const tmbQuery = `
          SELECT
            i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
            'TMB_OPERATOR' as operator_type,
            COALESCE(
              json_agg(
                json_build_object(
                  'contract_id', tc.id,
                  'contract_number', tc.contract_number,
                  'contract_date_start', tc.contract_date_start,
                  'contract_date_end', tc.contract_date_end,
                  'sector_id', tc.sector_id,
                  'sector_name', s.sector_name,
                  'sector_number', s.sector_number,
                  'tariff_per_ton', tc.tariff_per_ton,
                  'estimated_quantity_tons', tc.estimated_quantity_tons,
                  'contract_value', tc.contract_value,
                  'currency', tc.currency,
                  'is_active', tc.is_active,
                  'notes', tc.notes,
                  'has_file', (tc.contract_file_url IS NOT NULL),
                  'association_role',
                    CASE 
                      WHEN ta.primary_operator_id = i.id THEN 'PRIMARY'
                      WHEN ta.secondary_operator_id = i.id THEN 'SECONDARY'
                      ELSE NULL
                    END
                )
                ORDER BY s.sector_number, tc.contract_date_start
              ) FILTER (WHERE tc.id IS NOT NULL),
              '[]'::json
            ) as contracts
          FROM tmb_associations ta
          JOIN tmb_contracts tc ON ta.sector_id = tc.sector_id
          JOIN sectors s ON tc.sector_id = s.id
          JOIN institutions i
            ON i.id = ta.primary_operator_id OR i.id = ta.secondary_operator_id
          WHERE i.deleted_at IS NULL
            AND ta.is_active = true
            AND tc.deleted_at IS NULL
            AND ta.sector_id = ANY($1)
          GROUP BY i.id
        `;

        // 4) DISPOSAL OPERATORS
        const disposalQuery = `
          SELECT
            i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
            'DISPOSAL_OPERATOR' as operator_type,
            COALESCE(
              json_agg(
                json_build_object(
                  'contract_id', dc.id,
                  'contract_number', dc.contract_number,
                  'contract_date_start', dc.contract_date_start,
                  'contract_date_end', dc.contract_date_end,
                  'sector_id', dcs.sector_id,
                  'sector_name', s.sector_name,
                  'sector_number', s.sector_number,
                  'tariff_per_ton', dcs.tariff_per_ton,
                  'cec_tax_per_ton', dcs.cec_tax_per_ton,
                  'total_per_ton', dcs.total_per_ton,
                  'contracted_quantity_tons', dcs.contracted_quantity_tons,
                  'sector_value', dcs.sector_value,
                  'currency', dcs.currency,
                  'is_active', dc.is_active,
                  'notes', dc.notes,
                  'has_file', (dc.contract_file_url IS NOT NULL)
                )
                ORDER BY s.sector_number, dc.contract_date_start
              ) FILTER (WHERE dc.id IS NOT NULL),
              '[]'::json
            ) as contracts
          FROM institutions i
          JOIN disposal_contracts dc ON i.id = dc.institution_id
          JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id
          JOIN sectors s ON dcs.sector_id = s.id
          WHERE i.deleted_at IS NULL
            AND dc.deleted_at IS NULL
            AND dcs.sector_id = ANY($1)
          GROUP BY i.id
        `;

        // Execute all queries
        const [collectorsResult, sortingResult, tmbResult, disposalResult] = await Promise.all([
          pool.query(collectorsQuery, [accessibleSectorIds]),
          pool.query(sortingQuery, [accessibleSectorIds]),
          pool.query(tmbQuery, [accessibleSectorIds]),
          pool.query(disposalQuery, [accessibleSectorIds])
        ]);

        operators.push(...collectorsResult.rows);
        operators.push(...sortingResult.rows);
        operators.push(...tmbResult.rows);
        operators.push(...disposalResult.rows);

        console.log('✅ Operators loaded:', operators.length);

        // Get amendments for each contract
        for (const operator of operators) {
          const contracts = Array.isArray(operator.contracts) ? operator.contracts : [];

          for (const contract of contracts) {
            let amendmentsTable = '';
            switch (operator.operator_type) {
              case 'WASTE_COLLECTOR': amendmentsTable = 'waste_collector_contract_amendments'; break;
              case 'SORTING_OPERATOR': amendmentsTable = 'sorting_operator_contract_amendments'; break;
              case 'TMB_OPERATOR': amendmentsTable = 'tmb_contract_amendments'; break;
              case 'DISPOSAL_OPERATOR': amendmentsTable = 'disposal_contract_amendments'; break;
            }

            if (!amendmentsTable || !contract?.contract_id) {
              contract.amendments = [];
              contract.amendments_count = 0;
              continue;
            }

            let amendmentsQuery = '';

            if (amendmentsTable === 'tmb_contract_amendments') {
              amendmentsQuery = `
                SELECT id, amendment_number, amendment_date, reason, notes,
                       new_tariff_per_ton, new_estimated_quantity_tons, new_contract_date_end,
                       false as has_file
                FROM tmb_contract_amendments
                WHERE contract_id = $1 AND deleted_at IS NULL
                ORDER BY amendment_date DESC
              `;
            } else if (amendmentsTable === 'sorting_operator_contract_amendments') {
              amendmentsQuery = `
                SELECT id, amendment_number, amendment_date, reason, notes,
                       new_tariff_per_ton, new_estimated_quantity_tons, new_contract_date_end,
                       (amendment_file_url IS NOT NULL) as has_file
                FROM sorting_operator_contract_amendments
                WHERE contract_id = $1 AND deleted_at IS NULL
                ORDER BY amendment_date DESC
              `;
            } else if (amendmentsTable === 'disposal_contract_amendments') {
              amendmentsQuery = `
                SELECT id, amendment_number, amendment_date, reason, notes,
                       new_contract_date_end, changes_description,
                       (amendment_file_url IS NOT NULL) as has_file
                FROM disposal_contract_amendments
                WHERE contract_id = $1 AND deleted_at IS NULL
                ORDER BY amendment_date DESC
              `;
            } else if (amendmentsTable === 'waste_collector_contract_amendments') {
              amendmentsQuery = `
                SELECT id, amendment_number, amendment_date, reason, notes,
                       new_contract_date_end, false as has_file
                FROM waste_collector_contract_amendments
                WHERE contract_id = $1 AND deleted_at IS NULL
                ORDER BY amendment_date DESC
              `;
            }

            const amendmentsResult = await pool.query(amendmentsQuery, [contract.contract_id]);
            contract.amendments = amendmentsResult.rows;
            contract.amendments_count = amendmentsResult.rows.length;
          }

          operator.contracts = contracts;
        }

        // Calculate summary
        operators.forEach(operator => {
          const contracts = Array.isArray(operator.contracts) ? operator.contracts : [];
          const uniqueSectors = [...new Set(contracts.map(c => c.sector_number).filter(Boolean))].sort((a, b) => a - b);

          operator.sectors_served = uniqueSectors.join(', ');
          operator.sectors_count = uniqueSectors.length;
          operator.active_contracts_count = contracts.filter(c => c.is_active).length;
          operator.total_contracts_count = contracts.length;
          operator.status = operator.active_contracts_count > 0 ? 'Activ' : 'Inactiv';
        });
      }
    }

    // ========== STEP 3: Return complete profile ==========
    res.json({
      success: true,
      data: {
        user: {
          id: userData.id,
          email: userData.email,
          first_name: userData.first_name,
          last_name: userData.last_name,
          phone: userData.phone,
          position: userData.position,
          department: userData.department,
          role: userData.role,
          is_active: userData.is_active,
          created_at: userData.created_at,
          updated_at: userData.updated_at
        },
        institution: userData.institution,
        permissions: userData.permissions,
        sectors: userData.sectors || [],
        operators: operators
      }
    });

    console.log('✅ Profile response sent with', operators.length, 'operators');

  } catch (error) {
    console.error('❌ getUserProfile error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea profilului'
    });
  }
};

// UPDATE CURRENT USER PROFILE
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { firstName, lastName, email, phone, position, department } = req.body;

    // Validare
    if (!firstName || !lastName || !email) {
      return res.status(400).json({
        success: false,
        message: 'Prenume, Nume și Email sunt obligatorii'
      });
    }

    // Verifică dacă email-ul e folosit de alt user
    const emailCheck = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2 AND deleted_at IS NULL',
      [email.toLowerCase(), userId]
    );

    if (emailCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email-ul este deja utilizat'
      });
    }

    // Update user
    const updateQuery = `
      UPDATE users 
      SET 
        first_name = $1,
        last_name = $2,
        email = $3,
        phone = $4,
        position = $5,
        department = $6,
        updated_at = NOW()
      WHERE id = $7 AND deleted_at IS NULL
      RETURNING id, email, first_name, last_name, role, phone, position, department, is_active, updated_at
    `;

    const result = await pool.query(updateQuery, [
      firstName, 
      lastName, 
      email.toLowerCase(), 
      phone || null, 
      position || null, 
      department || null, 
      userId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilizator negăsit'
      });
    }

    res.json({
      success: true,
      message: 'Profil actualizat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('updateProfile error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea profilului'
    });
  }
};
export const updateUserProfile = updateProfile;

// UPDATE CURRENT USER PASSWORD
export const updatePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    // Validare
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Parola curentă și parola nouă sunt obligatorii'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Parola nouă trebuie să aibă minim 8 caractere'
      });
    }

    // Get current password hash
    const userQuery = 'SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL';
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilizator negăsit'
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Parola curentă este incorectă'
      });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    const updateQuery = `
      UPDATE users 
      SET password_hash = $1, updated_at = NOW()
      WHERE id = $2
    `;

    await pool.query(updateQuery, [newPasswordHash, userId]);

    res.json({
      success: true,
      message: 'Parola schimbată cu succes'
    });
  } catch (error) {
    console.error('updatePassword error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la schimbarea parolei'
    });
  }
};

// ============================================================================
// GET PROFILE OPERATORS (FIXED - no DISTINCT on JSON + executes all queries)
// ============================================================================
export const getProfileOperators = async (req, res) => {
  console.log('\n👥 ==================== GET PROFILE OPERATORS ====================');

  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log('📋 User:', { userId, userRole });

    // ========== STEP 1: Determine accessible sectors ==========
    let accessibleSectorIds = [];

    if (userRole === 'PLATFORM_ADMIN') {
      console.log('✅ PLATFORM_ADMIN - full access to all operators');
      const sectorsResult = await pool.query(`
        SELECT id FROM sectors WHERE is_active = true
      `);
      accessibleSectorIds = sectorsResult.rows.map(r => r.id);

    } else if (userRole === 'INSTITUTION_ADMIN' || userRole === 'OPERATOR_USER') {
      const userInstitutionQuery = `
        SELECT ui.institution_id, i.name as institution_name
        FROM user_institutions ui
        JOIN institutions i ON ui.institution_id = i.id
        WHERE ui.user_id = $1
        LIMIT 1
      `;
      const userInstResult = await pool.query(userInstitutionQuery, [userId]);

      if (userInstResult.rows.length === 0) {
        return res.json({
          success: true,
          data: { operators: [], accessible_sectors: [] },
          message: 'No institution assigned'
        });
      }

      const institutionId = userInstResult.rows[0].institution_id;
      const institutionName = userInstResult.rows[0].institution_name;

      console.log('🏢 Institution:', { institutionId, institutionName });

      const sectorsQuery = `
        SELECT DISTINCT sector_id
        FROM institution_sectors
        WHERE institution_id = $1
      `;
      const sectorsResult = await pool.query(sectorsQuery, [institutionId]);
      accessibleSectorIds = sectorsResult.rows.map(r => r.sector_id);

      console.log('📍 Accessible sectors:', accessibleSectorIds.length);
    }

    if (accessibleSectorIds.length === 0) {
      return res.json({
        success: true,
        data: { operators: [], accessible_sectors: [] },
        message: 'No sectors assigned'
      });
    }

   // ========== STEP 2: Get operators with contracts ==========
const operators = [];

// IMPORTANT:
// ❌ Nu folosim DISTINCT pentru ca avem json_agg (json nu are equality operator)
// ✅ Folosim GROUP BY i.id si COALESCE(json_agg(...) FILTER(...), '[]'::json)

// 1) WASTE COLLECTORS
const collectorsQuery = `
  SELECT
    i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
    'WASTE_COLLECTOR' as operator_type,
    COALESCE(
      json_agg(
        json_build_object(
          'contract_id', woc.id,
          'contract_number', woc.contract_number,
          'contract_date_start', woc.contract_date_start,
          'contract_date_end', woc.contract_date_end,
          'sector_id', woc.sector_id,
          'sector_name', s.sector_name,
          'sector_number', s.sector_number,
          'is_active', woc.is_active,
          'notes', woc.notes,
          'has_file', (woc.contract_file_url IS NOT NULL)
        )
        ORDER BY s.sector_number, woc.contract_date_start
      ) FILTER (WHERE woc.id IS NOT NULL),
      '[]'::json
    ) as contracts
  FROM institutions i
  JOIN waste_collector_contracts woc ON i.id = woc.institution_id
  JOIN sectors s ON woc.sector_id = s.id
  WHERE i.deleted_at IS NULL
    AND woc.deleted_at IS NULL
    AND woc.sector_id = ANY($1)
  GROUP BY i.id
`;

// 2) SORTING OPERATORS
const sortingQuery = `
  SELECT
    i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
    'SORTING_OPERATOR' as operator_type,
    COALESCE(
      json_agg(
        json_build_object(
          'contract_id', soc.id,
          'contract_number', soc.contract_number,
          'contract_date_start', soc.contract_date_start,
          'contract_date_end', soc.contract_date_end,
          'sector_id', soc.sector_id,
          'sector_name', s.sector_name,
          'sector_number', s.sector_number,
          'tariff_per_ton', soc.tariff_per_ton,
          'estimated_quantity_tons', soc.estimated_quantity_tons,
          'currency', soc.currency,
          'is_active', soc.is_active,
          'notes', soc.notes,
          'has_file', (soc.contract_file_url IS NOT NULL)
        )
        ORDER BY s.sector_number, soc.contract_date_start
      ) FILTER (WHERE soc.id IS NOT NULL),
      '[]'::json
    ) as contracts
  FROM institutions i
  JOIN sorting_operator_contracts soc ON i.id = soc.institution_id
  JOIN sectors s ON soc.sector_id = s.id
  WHERE i.deleted_at IS NULL
    AND soc.deleted_at IS NULL
    AND soc.sector_id = ANY($1)
  GROUP BY i.id
`;

// 3) TMB OPERATORS  ✅ FIX: legatura reala este tmb_associations + tmb_contracts
const tmbQuery = `
  SELECT
    i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
    'TMB_OPERATOR' as operator_type,
    COALESCE(
      json_agg(
        json_build_object(
          'contract_id', tc.id,
          'contract_number', tc.contract_number,
          'contract_date_start', tc.contract_date_start,
          'contract_date_end', tc.contract_date_end,
          'sector_id', tc.sector_id,
          'sector_name', s.sector_name,
          'sector_number', s.sector_number,
          'tariff_per_ton', tc.tariff_per_ton,
          'estimated_quantity_tons', tc.estimated_quantity_tons,
          'contract_value', tc.contract_value,
          'currency', tc.currency,
          'is_active', tc.is_active,
          'notes', tc.notes,
          'has_file', (tc.contract_file_url IS NOT NULL),
          'association_role',
            CASE 
              WHEN ta.primary_operator_id = i.id THEN 'PRIMARY'
              WHEN ta.secondary_operator_id = i.id THEN 'SECONDARY'
              ELSE NULL
            END
        )
        ORDER BY s.sector_number, tc.contract_date_start
      ) FILTER (WHERE tc.id IS NOT NULL),
      '[]'::json
    ) as contracts
  FROM tmb_associations ta
  JOIN tmb_contracts tc ON ta.sector_id = tc.sector_id
  JOIN sectors s ON tc.sector_id = s.id
  JOIN institutions i
    ON i.id = ta.primary_operator_id OR i.id = ta.secondary_operator_id
  WHERE i.deleted_at IS NULL
    AND ta.is_active = true
    AND tc.deleted_at IS NULL
    AND ta.sector_id = ANY($1)
  GROUP BY i.id
`;

// 4) DISPOSAL OPERATORS
const disposalQuery = `
  SELECT
    i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
    'DISPOSAL_OPERATOR' as operator_type,
    COALESCE(
      json_agg(
        json_build_object(
          'contract_id', dc.id,
          'contract_number', dc.contract_number,
          'contract_date_start', dc.contract_date_start,
          'contract_date_end', dc.contract_date_end,
          'sector_id', dcs.sector_id,
          'sector_name', s.sector_name,
          'sector_number', s.sector_number,
          'tariff_per_ton', dcs.tariff_per_ton,
          'cec_tax_per_ton', dcs.cec_tax_per_ton,
          'total_per_ton', dcs.total_per_ton,
          'contracted_quantity_tons', dcs.contracted_quantity_tons,
          'sector_value', dcs.sector_value,
          'currency', dcs.currency,
          'is_active', dc.is_active,
          'notes', dc.notes,
          'has_file', (dc.contract_file_url IS NOT NULL)
        )
        ORDER BY s.sector_number, dc.contract_date_start
      ) FILTER (WHERE dc.id IS NOT NULL),
      '[]'::json
    ) as contracts
  FROM institutions i
  JOIN disposal_contracts dc ON i.id = dc.institution_id
  JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id
  JOIN sectors s ON dcs.sector_id = s.id
  WHERE i.deleted_at IS NULL
    AND dc.deleted_at IS NULL
    AND dcs.sector_id = ANY($1)
  GROUP BY i.id
`;

    // ✅ EXECUTĂ toate query-urile
    const collectorsResult = await pool.query(collectorsQuery, [accessibleSectorIds]);
    operators.push(...collectorsResult.rows);
    console.log('🚛 Collectors:', collectorsResult.rows.length);

    const sortingResult = await pool.query(sortingQuery, [accessibleSectorIds]);
    operators.push(...sortingResult.rows);
    console.log('🧺 Sorting:', sortingResult.rows.length);

    const tmbResult = await pool.query(tmbQuery, [accessibleSectorIds]);
    operators.push(...tmbResult.rows);
    console.log('🏭 TMB:', tmbResult.rows.length);

    const disposalResult = await pool.query(disposalQuery, [accessibleSectorIds]);
    operators.push(...disposalResult.rows);
    console.log('🗑️ Disposal:', disposalResult.rows.length);

    // ========== STEP 3: Get amendments (FIXED per-table schema) ==========
for (const operator of operators) {
  const contracts = Array.isArray(operator.contracts) ? operator.contracts : [];

  for (const contract of contracts) {
    let amendmentsTable = '';
    switch (operator.operator_type) {
      case 'WASTE_COLLECTOR': amendmentsTable = 'waste_collector_contract_amendments'; break;
      case 'SORTING_OPERATOR': amendmentsTable = 'sorting_operator_contract_amendments'; break;
      case 'TMB_OPERATOR': amendmentsTable = 'tmb_contract_amendments'; break;
      case 'DISPOSAL_OPERATOR': amendmentsTable = 'disposal_contract_amendments'; break;
      default: amendmentsTable = ''; break;
    }

    if (!amendmentsTable || !contract?.contract_id) {
      contract.amendments = [];
      contract.amendments_count = 0;
      continue;
    }

    let amendmentsQuery = '';

    // ✅ TMB amendments: NU are amendment_file_url, NU are changes_description
    if (amendmentsTable === 'tmb_contract_amendments') {
      amendmentsQuery = `
        SELECT
          id,
          amendment_number,
          amendment_date,
          reason,
          notes,
          new_tariff_per_ton,
          new_estimated_quantity_tons,
          new_contract_date_end,
          false as has_file
        FROM tmb_contract_amendments
        WHERE contract_id = $1 AND deleted_at IS NULL
        ORDER BY amendment_date DESC
      `;
    }

    // ✅ Sorting amendments: ARE amendment_file_url
    else if (amendmentsTable === 'sorting_operator_contract_amendments') {
      amendmentsQuery = `
        SELECT
          id,
          amendment_number,
          amendment_date,
          reason,
          notes,
          new_tariff_per_ton,
          new_estimated_quantity_tons,
          new_contract_date_end,
          (amendment_file_url IS NOT NULL) as has_file
        FROM sorting_operator_contract_amendments
        WHERE contract_id = $1 AND deleted_at IS NULL
        ORDER BY amendment_date DESC
      `;
    }

    // ✅ Disposal amendments: ARE amendment_file_url + changes_description
    else if (amendmentsTable === 'disposal_contract_amendments') {
      amendmentsQuery = `
        SELECT
          id,
          amendment_number,
          amendment_date,
          reason,
          notes,
          new_contract_date_end,
          changes_description,
          (amendment_file_url IS NOT NULL) as has_file
        FROM disposal_contract_amendments
        WHERE contract_id = $1 AND deleted_at IS NULL
        ORDER BY amendment_date DESC
      `;
    }

    // ✅ Waste operator amendments: în fișierul tău nu apare structura tabelului completă,
    // deci mergem safe (nu folosim amendment_file_url ca să nu crape).
    else if (amendmentsTable === 'waste_collector_contract_amendments') {
      amendmentsQuery = `
        SELECT
          id,
          amendment_number,
          amendment_date,
          reason,
          notes,
          new_contract_date_end,
          false as has_file
        FROM waste_collector_contract_amendments
        WHERE contract_id = $1 AND deleted_at IS NULL
        ORDER BY amendment_date DESC
      `;
    }

    const amendmentsResult = await pool.query(amendmentsQuery, [contract.contract_id]);

    contract.amendments = amendmentsResult.rows;
    contract.amendments_count = amendmentsResult.rows.length;
  }

  operator.contracts = contracts;
}


    // ========== STEP 4: Calculate summary ==========
    operators.forEach(operator => {
      const contracts = Array.isArray(operator.contracts) ? operator.contracts : [];
      const uniqueSectors = [...new Set(contracts.map(c => c.sector_number).filter(Boolean))].sort((a, b) => a - b);

      operator.sectors_served = uniqueSectors.join(', ');
      operator.sectors_count = uniqueSectors.length;
      operator.active_contracts_count = contracts.filter(c => c.is_active).length;
      operator.total_contracts_count = contracts.length;
      operator.status = operator.active_contracts_count > 0 ? 'Activ' : 'Inactiv';
    });

    console.log('✅ Total operators:', operators.length);

    return res.json({
      success: true,
      data: {
        operators,
        accessible_sectors: accessibleSectorIds,
        total_count: operators.length,
        by_type: {
          collectors: operators.filter(o => o.operator_type === 'WASTE_COLLECTOR').length,
          sorting: operators.filter(o => o.operator_type === 'SORTING_OPERATOR').length,
          tmb: operators.filter(o => o.operator_type === 'TMB_OPERATOR').length,
          disposal: operators.filter(o => o.operator_type === 'DISPOSAL_OPERATOR').length
        }
      }
    });

  } catch (error) {
    console.error('❌ getProfileOperators error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch operators',
      error: error.message
    });
  }
};
