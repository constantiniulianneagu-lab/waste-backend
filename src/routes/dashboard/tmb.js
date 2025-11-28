import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { getTmbStats, getOutputDetails } from '../../controllers/dashboardTMBController.js';

const router = express.Router();

// Dashboard stats
router.get('/stats', authenticateToken, getTmbStats);
router.get('/output-details', authenticateToken, getOutputDetails);

export default router;
