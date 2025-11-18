// src/controllers/authController.js
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

// Generate JWT tokens
const generateTokens = (userId, email, role) => {
  const accessToken = jwt.sign(
    { userId, email, role },
    process.env.JWT_SECRET,
    { expiresIn: '15m' } // 15 minute
  );

  const refreshToken = jwt.sign(
    { userId, email },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' } // 7 zile
  );

  return { accessToken, refreshToken };
};

// LOGIN
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validare input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email și parola sunt obligatorii'
      });
    }

    // Găsește user în DB
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Email sau parolă greșită'
      });
    }

    const user = result.rows[0];

    // Verifică dacă user e activ
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Contul este dezactivat. Contactați administratorul.'
      });
    }

    // Verifică parola
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Email sau parolă greșită'
      });
    }

    // Generează tokens
    const { accessToken, refreshToken } = generateTokens(
      user.id,
      user.email,
      user.role
    );

    // Salvează refresh token în DB
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshToken]
    );

    // Returnează user info + tokens
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role
        },
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la autentificare'
    });
  }
};

// LOGOUT
export const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Șterge refresh token din DB
      await pool.query(
        'DELETE FROM refresh_tokens WHERE token = $1',
        [refreshToken]
      );
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la logout'
    });
  }
};

// REFRESH TOKEN
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token lipsește'
      });
    }

    // Verifică dacă token există în DB
    const result = await pool.query(
      `SELECT rt.*, u.email, u.role 
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token = $1 AND rt.expires_at > NOW()`,
      [refreshToken]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token invalid sau expirat'
      });
    }

    const tokenData = result.rows[0];

    // Verifică JWT signature
    try {
      jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      // Token invalid, șterge din DB
      await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
      return res.status(401).json({
        success: false,
        message: 'Refresh token invalid'
      });
    }

    // Generează nou access token
    const newAccessToken = jwt.sign(
      {
        userId: tokenData.user_id,
        email: tokenData.email,
        role: tokenData.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken
      }
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la refresh token'
    });
  }
};

// GET CURRENT USER
export const getCurrentUser = async (req, res) => {
  try {
    // req.user vine din auth middleware
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT id, email, first_name, last_name, role, is_active, created_at
       FROM users 
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    // Găsește instituțiile userului
    const institutionsResult = await pool.query(
      `SELECT i.id, i.name, i.type, i.sector
       FROM institutions i
       JOIN user_institutions ui ON i.id = ui.institution_id
       WHERE ui.user_id = $1 AND ui.deleted_at IS NULL AND i.deleted_at IS NULL`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active,
        createdAt: user.created_at,
        institutions: institutionsResult.rows
      }
    });

  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea datelor user'
    });
  }
};