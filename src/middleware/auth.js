// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';  // ← ADAUGĂ


// Verifică JWT token din header
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token lipsește'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, email, role }
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expirat',
        expired: true
      });
    }

    return res.status(403).json({
      success: false,
      message: 'Token invalid'
    });
  }
};

// Verifică rol
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Nu aveți permisiuni pentru această acțiune'
      });
    }
    next();
  };
};

// ============================================================================
// 🆕 AUTHORIZE ADMIN ONLY (pentru upload/delete contracte)
// ============================================================================

export const authorizeAdminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Neautentificat'
    });
  }

  const adminRoles = ['PLATFORM_ADMIN', 'INSTITUTION_ADMIN'];
  
  if (!adminRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Acces interzis. Doar administratorii pot upload/șterge contracte.'
    });
  }

  next();
};

// ============================================================================
// 🆕 AUTHORIZE INSTITUTION ACCESS (verifică că user-ul are acces la instituție)
// ============================================================================

export const authorizeInstitutionAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Neautentificat'
      });
    }

    const { institutionId } = req.params;

    // PLATFORM_ADMIN are acces la toate
    if (req.user.role === 'PLATFORM_ADMIN') {
      return next();
    }

    // INSTITUTION_ADMIN și OPERATOR trebuie să fie asociați cu instituția
    const accessCheck = await pool.query(
      `SELECT 1 
       FROM user_institutions 
       WHERE user_id = $1 AND institution_id = $2 AND deleted_at IS NULL`,
      [req.user.userId || req.user.id, institutionId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Nu aveți acces la această instituție'
      });
    }

    next();
  } catch (err) {
    console.error('Institution access check error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la verificarea accesului'
    });
  }
};