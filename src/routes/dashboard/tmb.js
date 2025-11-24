// ============================================================================
// TMB DASHBOARD ROUTES
// ============================================================================

import express from 'express';
import { getTmbStats, getOutputDetails } from '../../controllers/dashboardTmbController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/stats', getTmbStats);
router.get('/output-details', getOutputDetails);

export default router;