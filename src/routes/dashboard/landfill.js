/**
 * ============================================================================
 * DASHBOARD LANDFILL ROUTES
 * ============================================================================
 * 
 * Routes for landfill dashboard statistics
 * 
 * Base Path: /api/dashboard/landfill
 * 
 * Endpoints:
 * - GET /stats - Get comprehensive landfill statistics
 * 
 * Authentication: Required (JWT token)
 * 
 * RBAC:
 * - PLATFORM_ADMIN: Full access to all sectors
 * - INSTITUTION_ADMIN: Access to their assigned sectors only
 * - OPERATOR_USER: Access to their institution data only
 * 
 * Query Parameters:
 * - year: Filter by year (default: current year)
 * - from: Start date (default: Jan 1 of current year)
 * - to: End date (default: current date)
 * - sector_id: Filter by specific sector (optional)
 * 
 * Created: 2025-11-21
 * ============================================================================
 */

import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import dashboardLandfillController from '../../controllers/dashboardLandfillController.js';

const router = express.Router();

/**
 * ============================================================================
 * ROUTES
 * ============================================================================
 */

/**
 * @route   GET /api/dashboard/landfill/stats
 * @desc    Get comprehensive landfill dashboard statistics
 * @access  Private (PLATFORM_ADMIN, INSTITUTION_ADMIN, OPERATOR_USER)
 * @query   ?year=2025&from=2025-01-01&to=2025-11-21&sector_id=1
 * 
 * @returns {Object} Statistics object containing:
 *   - summary: Total tons, tickets, averages
 *   - waste_categories: Breakdown by waste code (20 03 01, 20 03 03, 19 * *, 17 09 04, ALTELE)
 *   - per_sector: Sector-wise breakdown with YoY variation
 *   - monthly_evolution: Monthly trend data
 *   - monthly_stats: Max, min, average, trending
 *   - top_operators: All operators sorted by volume
 *   - recent_tickets: Latest 50 tickets
 * 
 * @example
 * GET /api/dashboard/landfill/stats?year=2025&sector_id=1
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "summary": {
 *       "total_tons": 435498.22,
 *       "total_tons_formatted": "435,498.22",
 *       "total_tickets": 1247,
 *       ...
 *     },
 *     "waste_categories": [...],
 *     "per_sector": [...],
 *     "monthly_evolution": [...],
 *     "monthly_stats": {...},
 *     "top_operators": [...],
 *     "recent_tickets": [...]
 *   },
 *   "filters_applied": {
 *     "year": 2025,
 *     "from": "2025-01-01",
 *     "to": "2025-11-21",
 *     "sector_id": 1
 *   }
 * }
 */
router.get('/stats', authenticateToken, dashboardLandfillController.getStats);

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

export default router;