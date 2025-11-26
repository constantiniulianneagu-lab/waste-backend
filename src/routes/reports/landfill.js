/**
 * ============================================================================
 * REPORTS LANDFILL ROUTES
 * ============================================================================
 */

import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { 
  getLandfillReports,
  getAuxiliaryData 
} from '../../controllers/reportsLandfillController.js';

const router = express.Router();

/**
 * GET /api/reports/landfill
 * Get landfill reports with filters and pagination
 * Query params: year, from, to, sector_id, page, per_page
 */
router.get('/', authenticateToken, getLandfillReports);

/**
 * GET /api/reports/landfill/auxiliary
 * Get dropdown data (waste codes, operators, sectors)
 */
router.get('/auxiliary', authenticateToken, getAuxiliaryData);

export default router;