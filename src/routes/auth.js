// src/routes/auth.js
import express from 'express';
import { login, logout, refreshToken, getCurrentUser } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/login', login);
router.post('/logout', logout);
router.post('/refresh', refreshToken);

// Protected routes
router.get('/me', authenticateToken, getCurrentUser);

export default router;