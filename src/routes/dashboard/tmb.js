// src/routes/dashboard/tmb.js

import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import { getTmbStats, getOutputDetails } from '../../controllers/dashboardTmbController.js';
import { exportTmbDashboard } from '../../controllers/dashboardExportController.js';

const router = express.Router();

// Toate rutele de dashboard trebuie să fie scoped pe sectoare
router.get('/stats', authenticateToken, resolveUserAccess, getTmbStats);
router.get('/output-details', authenticateToken, resolveUserAccess, getOutputDetails);
router.get('/export', authenticateToken, resolveUserAccess, exportTmbDashboard);

export default router;
