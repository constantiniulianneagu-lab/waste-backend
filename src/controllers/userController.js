// src/controllers/userController.js
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';

// ============================================================================
// USER MANAGEMENT (PLATFORM_ADMIN)
// ============================================================================

// GET ALL USERS (with pagination & filters)
export const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, role, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT id, email, first_name, last_name, role, is_active, 
             created_at, updated_at
      FROM users 
      WHERE deleted_at IS NULL
    `;
    const params = [];
    let paramCount = 1;

    // Filter by role
    if (role) {
      query += ` AND role = $${paramCount}`;
      params.push(role);
      paramCount++;
    }

    // Search by email or name
    if (search) {
      query += ` AND (email ILIKE $${paramCount} OR first_name ILIKE $${paramCount} OR last_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Get total count
    const countResult = await pool.query(
      query.replace('SELECT id, email, first_name, last_name, role, is_active, created_at, updated_at', 'SELECT COUNT(*)'),
      params
    );
    const total = parseInt(countResult.rows[0].count) || 0;
    
    // Add pagination
    query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

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

// CREATE USER
export const createUser = async (req, res) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;

    // Validare
    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({
        success: false,
        message: 'Toate câmpurile sunt obligatorii'
      });
    }

    // Verifică dacă email-ul există
    const existingUser = await pool.query(
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

    // Inserează user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, email, first_name, last_name, role, is_active, created_at`,
      [email.toLowerCase(), passwordHash, firstName, lastName, role]
    );

    res.status(201).json({
      success: true,
      message: 'Utilizator creat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea utilizatorului'
    });
  }
};

// UPDATE USER
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, firstName, lastName, role, isActive, password } = req.body;

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

    // Verifică dacă noul email e deja folosit de alt user
    if (email) {
      const emailCheck = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2 AND deleted_at IS NULL',
        [email.toLowerCase(), id]
      );

      if (emailCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email-ul este deja utilizat'
        });
      }
    }

    // Construiește query dinamic
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

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Utilizator actualizat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea utilizatorului'
    });
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

// GET CURRENT USER PROFILE
export const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user data
    const userQuery = `
      SELECT 
        id, email, first_name, last_name, role, 
        phone, position, department, is_active,
        created_at
      FROM users 
      WHERE id = $1 AND deleted_at IS NULL
    `;
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilizator negăsit'
      });
    }

    const user = userResult.rows[0];

    // Get institution data (primary institution)
    const institutionQuery = `
      SELECT 
        i.id, i.name, i.type, i.sector,
        i.contact_email, i.contact_phone, i.address,
        i.website, i.short_name, i.fiscal_code
      FROM institutions i
      INNER JOIN user_institutions ui ON i.id = ui.institution_id
      WHERE ui.user_id = $1 AND ui.is_primary = true
      AND i.deleted_at IS NULL
      LIMIT 1
    `;
    const institutionResult = await pool.query(institutionQuery, [userId]);

    res.json({
      success: true,
      data: {
        user: user,
        institution: institutionResult.rows[0] || null
      }
    });
  } catch (error) {
    console.error('getUserProfile error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la încărcarea profilului'
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
// GET PROFILE OPERATORS (✅ NOU - ADĂUGAT)
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
    
    // 1. WASTE COLLECTORS (linia ~540)
const collectorsQuery = `
SELECT DISTINCT
  i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
  'WASTE_COLLECTOR' as operator_type,
  json_agg(
    json_build_object(
      'contract_id', woc.id, 'contract_number', woc.contract_number,
      'contract_date_start', woc.contract_date_start, 'contract_date_end', woc.contract_date_end,
      'sector_id', woc.sector_id, 'sector_name', s.sector_name, 'sector_number', s.sector_number,
      'is_active', woc.is_active, 'notes', woc.notes,
      'has_file', (woc.contract_file_url IS NOT NULL)
    )
  ) as contracts
FROM institutions i
JOIN waste_operator_contracts woc ON i.id = woc.institution_id
JOIN sectors s ON woc.sector_id = s.id
WHERE i.type = 'WASTE_COLLECTOR' AND i.deleted_at IS NULL AND woc.deleted_at IS NULL
  AND woc.sector_id = ANY($1)
GROUP BY i.id
`;

// 2. SORTING OPERATORS (linia ~560)
const sortingQuery = `
SELECT DISTINCT
  i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
  'SORTING_OPERATOR' as operator_type,
  json_agg(
    json_build_object(
      'contract_id', soc.id, 'contract_number', soc.contract_number,
      'contract_date_start', soc.contract_date_start, 'contract_date_end', soc.contract_date_end,
      'sector_id', soc.sector_id, 'sector_name', s.sector_name, 'sector_number', s.sector_number,
      'tariff_per_ton', soc.tariff_per_ton, 'estimated_quantity_tons', soc.estimated_quantity_tons,
      'currency', soc.currency, 'is_active', soc.is_active, 'notes', soc.notes,
      'has_file', (soc.contract_file_url IS NOT NULL)
    )
  ) as contracts
FROM institutions i
JOIN sorting_operator_contracts soc ON i.id = soc.institution_id
JOIN sectors s ON soc.sector_id = s.id
WHERE i.type = 'SORTING_OPERATOR' AND i.deleted_at IS NULL AND soc.deleted_at IS NULL
  AND soc.sector_id = ANY($1)
GROUP BY i.id
`;

// 3. TMB OPERATORS (linia ~580)
const tmbQuery = `
SELECT DISTINCT
  i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
  'TMB_OPERATOR' as operator_type,
  json_agg(
    json_build_object(
      'contract_id', tc.id, 'contract_number', tc.contract_number,
      'contract_date_start', tc.contract_date_start, 'contract_date_end', tc.contract_date_end,
      'sector_id', tc.sector_id, 'sector_name', s.sector_name, 'sector_number', s.sector_number,
      'tariff_per_ton', tc.tariff_per_ton, 'estimated_quantity_tons', tc.estimated_quantity_tons,
      'contract_value', tc.contract_value, 'currency', tc.currency,
      'is_active', tc.is_active, 'notes', tc.notes,
      'has_file', (tc.contract_file_url IS NOT NULL)
    )
  ) as contracts
FROM institutions i
JOIN institution_sectors ins ON i.id = ins.institution_id
JOIN tmb_contracts tc ON ins.sector_id = tc.sector_id
JOIN sectors s ON tc.sector_id = s.id
WHERE i.type = 'TMB_OPERATOR' AND i.deleted_at IS NULL AND tc.deleted_at IS NULL
  AND tc.sector_id = ANY($1)
GROUP BY i.id
`;

// 4. DISPOSAL OPERATORS (linia ~600)
const disposalQuery = `
SELECT DISTINCT
  i.id, i.name, i.type, i.contact_email, i.contact_phone, i.address, i.website,
  'DISPOSAL_OPERATOR' as operator_type,
  json_agg(
    json_build_object(
      'contract_id', dc.id, 'contract_number', dc.contract_number,
      'contract_date_start', dc.contract_date_start, 'contract_date_end', dc.contract_date_end,
      'sector_id', dcs.sector_id, 'sector_name', s.sector_name, 'sector_number', s.sector_number,
      'tariff_per_ton', dcs.tariff_per_ton, 'cec_tax_per_ton', dcs.cec_tax_per_ton,
      'total_per_ton', dcs.total_per_ton, 'contracted_quantity_tons', dcs.contracted_quantity_tons,
      'sector_value', dcs.sector_value, 'currency', dcs.currency,
      'is_active', dc.is_active, 'notes', dc.notes,
      'has_file', (dc.contract_file_url IS NOT NULL)
    )
  ) as contracts
FROM institutions i
JOIN disposal_contracts dc ON i.id = dc.institution_id
JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id
JOIN sectors s ON dcs.sector_id = s.id
WHERE i.type = 'DISPOSAL_OPERATOR' AND i.deleted_at IS NULL AND dc.deleted_at IS NULL
  AND dcs.sector_id = ANY($1)
GROUP BY i.id
`;
    const disposalResult = await pool.query(disposalQuery, [accessibleSectorIds]);
    operators.push(...disposalResult.rows);
    console.log('🗑️ Disposal:', disposalResult.rows.length);

    // ========== STEP 3: Get amendments ==========
    for (const operator of operators) {
      for (const contract of operator.contracts) {
        let amendmentsTable = '';
        switch (operator.operator_type) {
          case 'WASTE_COLLECTOR': amendmentsTable = 'waste_operator_contract_amendments'; break;
          case 'SORTING_OPERATOR': amendmentsTable = 'sorting_operator_contract_amendments'; break;
          case 'TMB_OPERATOR': amendmentsTable = 'tmb_contract_amendments'; break;
          case 'DISPOSAL_OPERATOR': amendmentsTable = 'disposal_contract_amendments'; break;
        }
        
        if (amendmentsTable) {
          const amendmentsResult = await pool.query(`
            SELECT id, amendment_number, amendment_date, reason, notes,
                   new_tariff_per_ton, new_estimated_quantity_tons, new_contract_date_end, changes_description,
                   amendment_file_url IS NOT NULL as has_file
            FROM ${amendmentsTable}
            WHERE contract_id = $1 AND deleted_at IS NULL
            ORDER BY amendment_date DESC
          `, [contract.contract_id]);
          
          contract.amendments = amendmentsResult.rows;
          contract.amendments_count = amendmentsResult.rows.length;
        } else {
          contract.amendments = [];
          contract.amendments_count = 0;
        }
      }
    }

    // ========== STEP 4: Calculate summary ==========
    operators.forEach(operator => {
      const uniqueSectors = [...new Set(operator.contracts.map(c => c.sector_number))].sort();
      operator.sectors_served = uniqueSectors.join(', ');
      operator.sectors_count = uniqueSectors.length;
      operator.active_contracts_count = operator.contracts.filter(c => c.is_active).length;
      operator.total_contracts_count = operator.contracts.length;
      operator.status = operator.active_contracts_count > 0 ? 'Activ' : 'Inactiv';
    });

    console.log('✅ Total operators:', operators.length);

    res.json({
      success: true,
      data: {
        operators: operators,
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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch operators',
      error: error.message
    });
  }
};