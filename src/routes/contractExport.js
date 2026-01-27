// src/routes/contractExport.js
/**
 * ============================================================================
 * CONTRACT EXPORT ROUTES
 * ============================================================================
 */

import express from 'express';
import { authenticateToken, checkUserAccess } from '../middleware/auth.js';
import {
  exportContractsPDF,
  exportContractsExcel,
  exportContractsCSV,
} from '../controllers/contractExportController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);
router.use(checkUserAccess);

// Export routes
router.get('/export/pdf', exportContractsPDF);
router.get('/export/xlsx', exportContractsExcel);
router.get('/export/csv', exportContractsCSV);

export default router;