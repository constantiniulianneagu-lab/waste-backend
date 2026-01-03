// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { ROLES } from '../constants/roles.js';

// ----------------------------------------------------------------------------
// JWT auth
// ----------------------------------------------------------------------------
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers?.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token lipsește' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Standardize user object
    req.user = {
      id: decoded.userId ?? decoded.id, // suportă ambele forme
      email: decoded.email,
      role: decoded.role,
    };

    if (!req.user.id || !req.user.role) {
      return res.status(401).json({ success: false, message: 'Token invalid (payload incomplet)' });
    }

    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expirat', expired: true });
    }
    return res.status(403).json({ success: false, message: 'Token invalid' });
  }
};

// ----------------------------------------------------------------------------
// Role gating
// ----------------------------------------------------------------------------
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Nu aveți permisiuni pentru această acțiune' });
    }
    return next();
  };
};

// ----------------------------------------------------------------------------
// FIX #5: CRUD global block => ONLY PLATFORM_ADMIN
// ----------------------------------------------------------------------------
export const authorizeAdminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Neautentificat' });
  }

  if (req.user.role !== ROLES.PLATFORM_ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Acces interzis. Doar PLATFORM_ADMIN (ADIGIDMB) poate modifica date.',
    });
  }

  return next();
};

// ----------------------------------------------------------------------------
// Optional: institution access check (for “institutions/:institutionId/*” routes)
// IMPORTANT: user_institutions NU are deleted_at în schema ta.
// ----------------------------------------------------------------------------
export const authorizeInstitutionAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Neautentificat' });
    }

    const { institutionId } = req.params;
    if (!institutionId) {
      return res.status(400).json({ success: false, message: 'Lipsește institutionId' });
    }

    // PLATFORM_ADMIN sees everything
    if (req.user.role === ROLES.PLATFORM_ADMIN) return next();

    // Otherwise: must be associated with that institution
    const q = await pool.query(
      `SELECT 1
       FROM user_institutions
       WHERE user_id = $1 AND institution_id = $2
       LIMIT 1`,
      [req.user.id, institutionId]
    );

    if (q.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Nu aveți acces la această instituție' });
    }

    return next();
  } catch (err) {
    console.error('authorizeInstitutionAccess error:', err);
    return res.status(500).json({ success: false, message: 'Eroare la verificarea accesului la instituție' });
  }
};

export default {
  authenticateToken,
  authorizeRoles,
  authorizeAdminOnly,
  authorizeInstitutionAccess,
};
