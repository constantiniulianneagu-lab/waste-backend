// src/controllers/userController.js
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';

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
    const total = parseInt(countResult.rows[0].count);

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
        COUNT(*) FILTER (WHERE role = 'INSTITUTION_ADMIN') as institution_admins,
        COUNT(*) FILTER (WHERE role = 'INSTITUTION_EDITOR') as editors,
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