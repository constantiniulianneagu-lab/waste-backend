// src/routes/auth.js
import rateLimit from 'express-rate-limit';
import express from 'express';
import { login, logout, refreshToken, getCurrentUser } from '../controllers/authController.js';
import { forgotPassword, resetPassword, forceChangePassword, validateResetToken } from '../controllers/passwordController.js';
import { authenticateToken } from '../middleware/auth.js';

// ============================================================
// RATE LIMITER — Login
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
    console.warn(`[RateLimit] Login blocat pentru IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Prea multe încercări de login. Te rugăm să încerci din nou în 15 minute.',
    });
  },
});

// ============================================================
// RATE LIMITER — Refresh Token
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

// ============================================================
// RATE LIMITER — Forgot Password
// Strict: max 5 cereri per IP per 15 minute
// Previne enumerarea de emailuri prin timing attacks
// ============================================================
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Prea multe cereri de resetare. Te rugăm să aștepți 15 minute.',
  },
});

const router = express.Router();

// ============================================================
// PUBLIC ROUTES
// ============================================================
router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.post('/refresh', refreshLimiter, refreshToken);

// Forgot / Reset parolă — fără autentificare
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.get('/reset-password/validate', validateResetToken);
router.post('/reset-password', resetPassword);

// ============================================================
// PROTECTED ROUTES — necesită autentificare
// ============================================================
router.get('/me', authenticateToken, getCurrentUser);

// Schimbare parolă forțată la primul login
router.post('/change-password', authenticateToken, forceChangePassword);

export default router;