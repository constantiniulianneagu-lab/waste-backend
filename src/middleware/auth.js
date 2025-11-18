// src/middleware/auth.js
import jwt from 'jsonwebtoken';

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