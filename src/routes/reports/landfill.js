/**
 * ============================================================================
 * LANDFILL REPORTS ROUTES
 * ============================================================================
 */

import express from 'express';
import { 
  getLandfillReports, 
  getAuxiliaryData,
  exportLandfillReports 
} from '../../controllers/reportsLandfillController.js';
import { authenticateToken } from '../../middleware/authMiddleware.js';

const router = express.Router();

// Get reports (cu paginare)
router.get('/', authenticateToken, getLandfillReports);

// Get auxiliary data (dropdowns)
router.get('/auxiliary', authenticateToken, getAuxiliaryData);

// Export reports (toate datele filtrate, fără paginare)
router.get('/export', authenticateToken, exportLandfillReports);

export default router;