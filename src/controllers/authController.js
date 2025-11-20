// src/controllers/authController.js
import bcrypt from 'bcryptjs';  // ✅ Nou
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

    console.log('🔐 Login attempt:', { email, password: '***' });

    // Validare input
    if (!email || !password) {
      console.log('❌ Missing email or password');
      return res.status(400).json({
        success: false,
        message: 'Email și parola sunt obligatorii'
      });
    }

    console.log('🔍 Searching for user in database...');

    // Găsește user în DB
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );

    console.log('📊 Database query result:', {
      rowCount: result.rows.length,
      userFound: result.rows.length > 0
    });

    if (result.rows.length === 0) {
      console.log('❌ User not found with email:', email);
      return res.status(401).json({
        success: false,
        message: 'Email sau parolă greșită'
      });
    }

    const user = result.rows[0];
    console.log('✅ User found:', {
      id: user.id,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
      hash_preview: user.password_hash?.substring(0, 20)
    });

    // Verifică dacă user e activ
    if (!user.is_active) {
      console.log('❌ User is not active');
      return res.status(403).json({
        success: false,
        message: 'Contul este dezactivat. Contactați administratorul.'
      });
    }

    console.log('🔒 Comparing passwords...');
    console.log('  Password from request:', password);
    console.log('  Hash from database:', user.password_hash?.substring(0, 30));

    // Verifică parola
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    console.log('🔑 Password comparison result:', isPasswordValid);

    if (!isPasswordValid) {
      console.log('❌ Password does not match');
      return res.status(401).json({
        success: false,
        message: 'Email sau parolă greșită'
      });
    }

    console.log('✅ Password matches! Generating tokens...');

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

    console.log('🎉 Login successful for user:', user.email);

    console.log('📚 Fetching user institutions...');

    // Găsește instituțiile userului
    const institutionsResult = await pool.query(
      `SELECT i.id, i.name, i.type, i.short_name, i.sector
       FROM institutions i
       JOIN user_institutions ui ON i.id = ui.institution_id
       WHERE ui.user_id = $1 
         AND ui.deleted_at IS NULL 
         AND i.deleted_at IS NULL 
         AND i.is_active = true
       ORDER BY i.name`,
      [user.id]
    );
    
    console.log('✅ Found institutions:', institutionsResult.rows.length);
    
    // Returnează user info + tokens + institutions
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          institutions: institutionsResult.rows
        },
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: '15m'
        }
      }
    });

  } catch (error) {
    console.error('💥 Login error:', error);
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