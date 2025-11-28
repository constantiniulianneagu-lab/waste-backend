// routes/dashboard/tmb.js
// TMB DASHBOARD ROUTES - DOAR STATISTICI

import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { getTmbStats, getOutputDetails } from '../../controllers/dashboardTMBController.js';

const router = express.Router();

// GET /api/dashboard/tmb/stats
// Get TMB statistics
router.get('/stats', authenticateToken, getTmbStats);

// GET /api/dashboard/tmb/output-details
// Get detailed output breakdown
router.get('/output-details', authenticateToken, getOutputDetails);

export default router;