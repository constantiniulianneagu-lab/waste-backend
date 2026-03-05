/**
 * ============================================================================
 * AI ASSISTANT ROUTE
 * POST /api/ai/chat
 * ============================================================================
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { resolveUserAccess } from '../middleware/resolveUserAccess.js';
import { aiChat } from '../controllers/aiAssistantController.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limit specific pentru AI - max 30 cereri/minut per user
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Prea multe cereri. Așteptați un minut.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/chat', authenticateToken, resolveUserAccess, aiLimiter, aiChat);

export default router;