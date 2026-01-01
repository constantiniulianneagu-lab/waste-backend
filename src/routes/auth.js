// src/routes/auth.js
import rateLimit from 'express-rate-limit';
import express from 'express';
import { login, logout, refreshToken, getCurrentUser } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

// Rate Limiter pentru LOGIN
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minute
    max: 5, // max 5 încercări per IP
    message: {
      success: false,
      message: 'Prea multe încercări de login. Te rugăm să încerci din nou în 15 minute.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    
    handler: (req, res) => {
      console.log(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
      res.status(429).json({
        success: false,
        message: 'Prea multe încercări de login. Te rugăm să încerci din nou în 15 minute.',
        retryAfter: Math.ceil(req.rateLimit.resetTime / 1000 / 60)
      });
    }
  });

const router = express.Router();

// Public routes
router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.post('/refresh', refreshToken);

// Protected routes
router.get('/me', authenticateToken, getCurrentUser);

export default router;