// src/routes/auth.js
import rateLimit from 'express-rate-limit';
import express from 'express';
import { login, logout, refreshToken, getCurrentUser } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

// ============================================================
// RATE LIMITER — Login
// Max 5 încercări per IP în 15 minute
// ============================================================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Prea multe încercări de login. Te rugăm să încerci din nou în 15 minute.',
  },
  handler: (req, res) => {
    // Log fără date sensibile
    console.warn(`[RateLimit] Login blocat pentru IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Prea multe încercări de login. Te rugăm să încerci din nou în 15 minute.',
    });
  },
});

// ============================================================
// RATE LIMITER — Refresh Token
// Max 30 refresh-uri per IP în 15 minute
// (un user normal face refresh la fiecare 15 min, deci 30 e generos)
// ============================================================
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Prea multe cereri de refresh. Te rugăm să aștepți.',
  },
});

const router = express.Router();

// Public routes
router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.post('/refresh', refreshLimiter, refreshToken);

// Protected routes
router.get('/me', authenticateToken, getCurrentUser);

export default router;