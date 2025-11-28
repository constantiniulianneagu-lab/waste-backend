// routes/dashboard/tmb.js
import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { getTmbStats, getOutputDetails } from '../../controllers/dashboardTmbController.js';

const router = express.Router();

router.get('/stats', authenticateToken, getTmbStats);
router.get('/output-details', authenticateToken, getOutputDetails);

export default router;