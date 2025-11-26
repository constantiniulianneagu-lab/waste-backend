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
import { authenticateToken } from '../../../middleware/authMiddleware.js';

const router = express.Router();

// IMPORTANT: Route-uri specifice ÎNAINTE de root "/"
// Export reports (toate datele filtrate, fără paginare)
router.get('/export', authenticateToken, exportLandfillReports);

// Get auxiliary data (dropdowns)
router.get('/auxiliary', authenticateToken, getAuxiliaryData);

// Get reports (cu paginare) - ULTIMUL!
router.get('/', authenticateToken, getLandfillReports);

export default router;