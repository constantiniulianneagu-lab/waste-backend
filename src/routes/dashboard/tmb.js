// ============================================================================
// TMB DASHBOARD ROUTES
// ============================================================================
// Routes for TMB (Mechanical-Biological Treatment) dashboard statistics
// ============================================================================

import express from 'express';
import { getTmbStats, getOutputDetails } from '../controllers/dashboardTmbController.js';
import { authenticateToken, requireRoles } from '../middleware/auth.js';

const router = express.Router();

// ============================================================================
// APPLY AUTHENTICATION TO ALL ROUTES
// ============================================================================
router.use(authenticateToken);

// ============================================================================
// TMB DASHBOARD ROUTES
// ============================================================================

/**
 * @route   GET /api/dashboard/tmb/stats
 * @desc    Get comprehensive TMB statistics
 * @access  Private (All authenticated users)
 * @query   start_date (optional) - Filter from date (YYYY-MM-DD)
 * @query   end_date (optional) - Filter to date (YYYY-MM-DD)
 * @query   sector_id (optional) - Filter by sector UUID
 * @query   tmb_association_id (optional) - Filter by TMB association
 */
router.get('/stats', getTmbStats);

/**
 * @route   GET /api/dashboard/tmb/output-details
 * @desc    Get detailed breakdown of output streams
 * @access  Private (All authenticated users)
 * @query   output_type (required) - 'recycling', 'recovery', or 'disposal'
 * @query   start_date (optional) - Filter from date (YYYY-MM-DD)
 * @query   end_date (optional) - Filter to date (YYYY-MM-DD)
 * @query   sector_id (optional) - Filter by sector UUID
 */
router.get('/output-details', getOutputDetails);

export default router;