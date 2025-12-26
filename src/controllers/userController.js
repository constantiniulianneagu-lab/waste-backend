// src/controllers/userController.js
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';

// ============================================================================
// GET ALL USERS (cu instituții, permisiuni, sectoare)
// ============================================================================
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

// ============================================================================
// GET SINGLE USER
// ============================================================================
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

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

    const result = await pool.query(query, [id]);

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

// ============================================================================
// CREATE USER
// ============================================================================
export const createUser = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { 
      email, 
      password, 
      firstName, 
      lastName, 
      phone,
      position,
      department,
      role, 
      isActive = true,
      institutionId,
      permissions = {}
    } = req.body;

    // Validare
    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({
        success: false,
        message: 'Câmpurile email, parolă, prenume, nume și rol sunt obligatorii'
      });
    }

    // Validare instituție (obligatorie pentru toți rolurile)
    if (!institutionId) {
      return res.status(400).json({
        success: false,
        message: 'Instituția este obligatorie'
      });
    }

    // Verifică dacă email există
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

    // Verifică dacă instituția există
    const institutionCheck = await client.query(
      'SELECT id, type FROM institutions WHERE id = $1 AND deleted_at IS NULL',
      [institutionId]
    );

    if (institutionCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Instituția selectată nu există'
      });
    }

    const institutionType = institutionCheck.rows[0].type;

    // Validare role vs institution type
    if (role === 'SUPER_ADMIN' && institutionType !== 'ASSOCIATION') {
      return res.status(400).json({
        success: false,
        message: 'Super Admin poate fi asociat doar cu Asociația ADIGDMB'
      });
    }

    await client.query('BEGIN');

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const userResult = await client.query(
      `INSERT INTO users (
        email, password_hash, first_name, last_name, 
        phone, position, department, role, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [email.toLowerCase(), passwordHash, firstName, lastName, phone, position, department, role, isActive]
    );

    const userId = userResult.rows[0].id;

    // Associate with institution (doar 1 instituție)
    await client.query(
      'INSERT INTO user_institutions (user_id, institution_id) VALUES ($1, $2)',
      [userId, institutionId]
    );

    // Insert permissions (dacă există)
    if (Object.keys(permissions).length > 0) {
      const { can_edit_data, access_type, sector_id, operator_institution_id } = permissions;
      
      await client.query(
        `INSERT INTO user_permissions (
          user_id, can_edit_data, access_type, sector_id, operator_institution_id
        ) VALUES ($1, $2, $3, $4, $5)`,
        [userId, can_edit_data || false, access_type, sector_id, operator_institution_id]
      );
    }

    await client.query('COMMIT');

    // Get created user with full details
    const createdUser = await client.query(
      `SELECT 
        u.*,
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
        ) as permissions
      FROM users u
      LEFT JOIN user_institutions ui ON u.id = ui.user_id
      LEFT JOIN institutions i ON ui.institution_id = i.id
      LEFT JOIN user_permissions up ON u.id = up.user_id
      WHERE u.id = $1`,
      [userId]
    );

    res.status(201).json({
      success: true,
      message: 'Utilizator creat cu succes',
      data: createdUser.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea utilizatorului'
    });
  } finally {
    client.release();
  }
};

// ============================================================================
// UPDATE USER
// ============================================================================
export const updateUser = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { 
      email, 
      firstName, 
      lastName, 
      phone,
      position,
      department,
      role, 
      isActive, 
      password,
      institutionId,
      permissions
    } = req.body;

    // Check user exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilizator negăsit'
      });
    }

    // Check email duplicate
    if (email) {
      const emailCheck = await client.query(
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

    await client.query('BEGIN');

    // Update user
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

    if (updates.length > 1) {
      const query = `
        UPDATE users 
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
      `;
      await client.query(query, params);
    }

    // Update institution (dacă s-a schimbat)
    if (institutionId !== undefined) {
      await client.query('DELETE FROM user_institutions WHERE user_id = $1', [id]);
      await client.query(
        'INSERT INTO user_institutions (user_id, institution_id) VALUES ($1, $2)',
        [id, institutionId]
      );
    }

    // Update permissions (dacă există)
    if (permissions !== undefined) {
      const { can_edit_data, access_type, sector_id, operator_institution_id } = permissions;
      
      // Check if permissions exist
      const permCheck = await client.query(
        'SELECT id FROM user_permissions WHERE user_id = $1',
        [id]
      );

      if (permCheck.rows.length > 0) {
        // Update
        await client.query(
          `UPDATE user_permissions 
           SET can_edit_data = $1, access_type = $2, sector_id = $3, operator_institution_id = $4, updated_at = NOW()
           WHERE user_id = $5`,
          [can_edit_data, access_type, sector_id, operator_institution_id, id]
        );
      } else {
        // Insert
        await client.query(
          `INSERT INTO user_permissions (user_id, can_edit_data, access_type, sector_id, operator_institution_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, can_edit_data, access_type, sector_id, operator_institution_id]
        );
      }
    }

    await client.query('COMMIT');

    // Get updated user
    const updatedUser = await client.query(
      `SELECT 
        u.*,
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
        ) as permissions
      FROM users u
      LEFT JOIN user_institutions ui ON u.id = ui.user_id
      LEFT JOIN institutions i ON ui.institution_id = i.id
      LEFT JOIN user_permissions up ON u.id = up.user_id
      WHERE u.id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: 'Utilizator actualizat cu succes',
      data: updatedUser.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea utilizatorului'
    });
  } finally {
    client.release();
  }
};

// ============================================================================
// DELETE USER (soft delete)
// ============================================================================
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

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

// Export all
export default {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser
};