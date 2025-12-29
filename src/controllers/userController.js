// src/controllers/userController.js
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';

// ============================================================================
// USER MANAGEMENT (PLATFORM_ADMIN)
// ============================================================================

// GET ALL USERS (cu instituții, permisiuni, sectoare)
export const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 500, role, search, institutionId, status } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = ['u.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    // Filter by role
    if (role) {
      whereConditions.push(`u.role = $${paramCount}`);
      params.push(role);
      paramCount++;
    }

    // Search by name or email
    if (search) {
      whereConditions.push(`(u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`);
      params.push(`%${search}%`);
      paramCount++;
    }

    // Filter by institution
    if (institutionId) {
      whereConditions.push(`ui.institution_id = $${paramCount}`);
      params.push(institutionId);
      paramCount++;
    }

    // Filter by status
    if (status === 'active') {
      whereConditions.push('u.is_active = true');
    } else if (status === 'inactive') {
      whereConditions.push('u.is_active = false');
    }

    const whereClause = whereConditions.join(' AND ');

    // Main query with institution, permissions, sectors
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
        
        -- Instituție
        jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'short_name', i.short_name,
          'type', i.type
        ) as institution,
        
        -- Permisiuni
        jsonb_build_object(
          'can_edit_data', COALESCE(up.can_edit_data, false),
          'access_type', up.access_type,
          'sector_id', up.sector_id,
          'operator_institution_id', up.operator_institution_id
        ) as permissions,
        
        -- Sectoare (din institution_sectors)
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

    params.push(limit, offset);

    // Count query
    const countQuery = `
      SELECT COUNT(DISTINCT u.id) as count
      FROM users u
      LEFT JOIN user_institutions ui ON u.id = ui.user_id
      WHERE ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, params.slice(0, paramCount - 1))
    ]);

    const total = parseInt(countResult.rows[0].count) || 0;

    res.json({
      success: true,
      data: {
        users: result.rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea utilizatorilor'
    });
  }
};

// GET SINGLE USER
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, email, first_name, last_name, role, is_active, 
              created_at, updated_at
       FROM users 
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilizator negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea utilizatorului'
    });
  }
};

// ⚠️ FIX BACKEND - Înlocuiește funcția createUser în userController.js ⚠️

// CREATE USER
export const createUser = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { email, password, firstName, lastName, role, isActive = true, institutionIds = [], phone, position, department } = req.body;

    console.log('🔧 CREATE USER - Backend');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Validare
    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({
        success: false,
        message: 'Toate câmpurile sunt obligatorii'
      });
    }

    // Verifică dacă email-ul există
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email-ul este deja utilizat'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');
    console.log('✅ Transaction started');

    // Inserează user cu toate câmpurile
    const result = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, position, department, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, email, first_name, last_name, role, is_active, created_at`,
      [email.toLowerCase(), passwordHash, firstName, lastName, phone || null, position || null, department || null, role, isActive]
    );

    const userId = result.rows[0].id;
    console.log('✅ User created with ID:', userId);

    // ========== FIX: Asociază cu instituțiile FĂRĂ ON CONFLICT ==========
    if (institutionIds && institutionIds.length > 0) {
      console.log('🏢 Adding institutions:', institutionIds);
      
      for (const instId of institutionIds) {
        console.log(`  ➕ Adding institution: ${instId}`);
        
        // Check dacă instituția există
        const instCheck = await client.query(
          'SELECT id FROM institutions WHERE id = $1 AND deleted_at IS NULL',
          [instId]
        );
        
        if (instCheck.rows.length === 0) {
          console.log(`  ⚠️ Institution ${instId} not found, skipping`);
          continue;
        }
        
        // Insert simplu fără ON CONFLICT
        await client.query(
          'INSERT INTO user_institutions (user_id, institution_id) VALUES ($1, $2)',
          [userId, instId]
        );
      }
      console.log('  ✅ Institution associations created');
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed');

    // Get user with institutions
    const userWithInstitutions = await client.query(
      `SELECT 
        u.*,
        json_agg(
          jsonb_build_object(
            'id', i.id,
            'name', i.name,
            'type', i.type
          )
        ) FILTER (WHERE i.id IS NOT NULL) as institutions
      FROM users u
      LEFT JOIN user_institutions ui ON u.id = ui.user_id AND ui.deleted_at IS NULL
      LEFT JOIN institutions i ON ui.institution_id = i.id AND i.deleted_at IS NULL
      WHERE u.id = $1
      GROUP BY u.id`,
      [userId]
    );

    console.log('✅ CREATE SUCCESSFUL');

    res.status(201).json({
      success: true,
      message: 'Utilizator creat cu succes',
      data: userWithInstitutions.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    
    console.error('❌ CREATE ERROR');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: error.message || 'Eroare la crearea utilizatorului',
      error: process.env.NODE_ENV === 'development' ? {
        name: error.name,
        message: error.message,
        code: error.code,
        detail: error.detail
      } : undefined
    });
  } finally {
    client.release();
  }
};

// UPDATE USER
export const updateUser = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { email, firstName, lastName, role, isActive, password, institutionIds, phone, position, department } = req.body;

    console.log('🔧 UPDATE USER - Backend');
    console.log('User ID:', id);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Verifică dacă user-ul există
    const existingUser = await client.query(
      'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingUser.rows.length === 0) {
      console.log('❌ User not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Utilizator negăsit'
      });
    }

    console.log('✅ User exists');

    // Verifică dacă noul email e deja folosit de alt user
    if (email) {
      const emailCheck = await client.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2 AND deleted_at IS NULL',
        [email.toLowerCase(), id]
      );

      if (emailCheck.rows.length > 0) {
        console.log('❌ Email already in use:', email);
        return res.status(400).json({
          success: false,
          message: 'Email-ul este deja utilizat'
        });
      }
    }

    console.log('✅ Email check passed');

    await client.query('BEGIN');
    console.log('✅ Transaction started');

    // Construiește query dinamic pentru user update
    const updates = [];
    const params = [];
    let paramCount = 1;

    if (email) {
      updates.push(`email = $${paramCount}`);
      params.push(email.toLowerCase());
      paramCount++;
    }
    if (firstName) {
      updates.push(`first_name = $${paramCount}`);
      params.push(firstName);
      paramCount++;
    }
    if (lastName) {
      updates.push(`last_name = $${paramCount}`);
      params.push(lastName);
      paramCount++;
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount}`);
      params.push(phone);
      paramCount++;
    }
    if (position !== undefined) {
      updates.push(`position = $${paramCount}`);
      params.push(position);
      paramCount++;
    }
    if (department !== undefined) {
      updates.push(`department = $${paramCount}`);
      params.push(department);
      paramCount++;
    }
    if (role) {
      updates.push(`role = $${paramCount}`);
      params.push(role);
      paramCount++;
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${paramCount}`);
      params.push(isActive);
      paramCount++;
    }
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${paramCount}`);
      params.push(passwordHash);
      paramCount++;
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const query = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, email, first_name, last_name, role, is_active, updated_at
    `;

    console.log('📝 Executing user update...');
    const updateResult = await client.query(query, params);
    console.log('✅ User updated successfully');

    // ========== FIX: Update institution associations FĂRĂ ON CONFLICT ==========
    if (institutionIds !== undefined) {
      console.log('🏢 Updating institutions:', institutionIds);
      
      // Delete existing associations (inclusiv cele cu deleted_at NOT NULL)
      await client.query(
        'DELETE FROM user_institutions WHERE user_id = $1',
        [id]
      );
      console.log('  ✅ Deleted old associations');

      // Insert new associations - FĂRĂ ON CONFLICT
      if (institutionIds && institutionIds.length > 0) {
        for (const instId of institutionIds) {
          console.log(`  ➕ Adding institution: ${instId}`);
          
          // Check dacă instituția există
          const instCheck = await client.query(
            'SELECT id FROM institutions WHERE id = $1 AND deleted_at IS NULL',
            [instId]
          );
          
          if (instCheck.rows.length === 0) {
            console.log(`  ⚠️ Institution ${instId} not found, skipping`);
            continue;
          }
          
          // Insert simplu fără ON CONFLICT (am șters deja toate asocierile mai sus)
          await client.query(
            'INSERT INTO user_institutions (user_id, institution_id) VALUES ($1, $2)',
            [id, instId]
          );
        }
        console.log('  ✅ New associations created');
      }
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed');

    // Get updated user with institutions
    const userWithInstitutions = await client.query(
      `SELECT 
        u.*,
        json_agg(
          jsonb_build_object(
            'id', i.id,
            'name', i.name,
            'type', i.type
          )
        ) FILTER (WHERE i.id IS NOT NULL) as institutions
      FROM users u
      LEFT JOIN user_institutions ui ON u.id = ui.user_id AND ui.deleted_at IS NULL
      LEFT JOIN institutions i ON ui.institution_id = i.id AND i.deleted_at IS NULL
      WHERE u.id = $1
      GROUP BY u.id`,
      [id]
    );

    console.log('✅ UPDATE SUCCESSFUL');

    res.json({
      success: true,
      message: 'Utilizator actualizat cu succes',
      data: userWithInstitutions.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    
    console.error('❌ UPDATE ERROR');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: error.message || 'Eroare la actualizarea utilizatorului',
      error: process.env.NODE_ENV === 'development' ? {
        name: error.name,
        message: error.message,
        code: error.code,
        detail: error.detail
      } : undefined
    });
  } finally {
    client.release();
  }
};

// DELETE USER (soft delete)
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Verifică dacă user-ul există
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilizator negăsit'
      });
    }

    // Soft delete
    await pool.query(
      'UPDATE users SET deleted_at = NOW() WHERE id = $1',
      [id]
    );

    res.json({
      success: true,
      message: 'Utilizator șters cu succes'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea utilizatorului'
    });
  }
};

// GET USER STATISTICS
export const getUserStats = async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE role = 'PLATFORM_ADMIN') as admins,
        COUNT(*) FILTER (WHERE role = 'ADMIN_INSTITUTION') as institution_admins,
        COUNT(*) FILTER (WHERE role = 'EDITOR_INSTITUTION') as editors,
        COUNT(*) FILTER (WHERE role = 'REGULATOR_VIEWER') as regulators
      FROM users
      WHERE deleted_at IS NULL
    `);

    res.json({
      success: true,
      data: stats.rows[0]
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor'
    });
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
