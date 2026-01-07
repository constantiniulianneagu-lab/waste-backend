/**
 * ============================================================================
 * DASHBOARD LANDFILL ROUTES
 * ============================================================================
 *
 * Base Path: /api/dashboard/landfill
 *
 * Endpoints:
 * - GET /stats
 *
 * Authentication: Required (JWT token)
 * Access scoping: resolveUserAccess (sector-based)
 * ============================================================================
 */

import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import dashboardLandfillController from '../../controllers/dashboardLandfillController.js';
import { exportLandfillDashboard } from '../../controllers/dashboardExportController.js';

const router = express.Router();

/**
 * GET /api/dashboard/landfill/stats
 */
router.get('/stats', authenticateToken, resolveUserAccess, dashboardLandfillController.getStats);

/**
 * GET /api/dashboard/landfill/export
 * Export dashboard data as PDF
 */
router.get('/export', authenticateToken, resolveUserAccess, exportLandfillDashboard);

export default router;