// ============================================================================
// RAPORTARE TMB ROUTES
// ============================================================================

import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { getTmbTickets } from '../../controllers/reportTmbController.js';
import { getRecyclingTickets } from '../../controllers/reportRecyclingController.js';
import { getRecoveryTickets } from '../../controllers/reportRecoveryController.js';
import { getDisposalTickets } from '../../controllers/reportDisposalController.js';
import { getRejectedTickets } from '../../controllers/reportRejectedController.js';

const router = express.Router();

// GET routes pentru fiecare tab
router.get('/tmb', authenticateToken, getTmbTickets);
router.get('/recycling', authenticateToken, getRecyclingTickets);
router.get('/recovery', authenticateToken, getRecoveryTickets);
router.get('/disposal', authenticateToken, getDisposalTickets);
router.get('/rejected', authenticateToken, getRejectedTickets);

export default router;