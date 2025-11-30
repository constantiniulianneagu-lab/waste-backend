// ============================================================================
// RAPORTARE TMB ROUTES
// ============================================================================

import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import {
  getTmbTickets,
  getRecyclingTickets,
  getRecoveryTickets,
  getDisposalTickets,
  getRejectedTickets
} from '../../controllers/reportTmbController.js';

const router = express.Router();

// GET routes pentru fiecare tab
router.get('/tmb', authenticateToken, getTmbTickets);
router.get('/recycling', authenticateToken, getRecyclingTickets);
router.get('/recovery', authenticateToken, getRecoveryTickets);
router.get('/disposal', authenticateToken, getDisposalTickets);
router.get('/rejected', authenticateToken, getRejectedTickets);

export default router;