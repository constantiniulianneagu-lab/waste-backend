// src/routes/stats.js
/**
 * ============================================================================
 * STATS ROUTES - General Statistics Endpoints
 * ============================================================================
 */

import express from 'express';
import { 
  getGeneralStats,
  getContractStats,
  getTicketStats,
  getInstitutionStats
} from '../controllers/statsController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All stats routes require authentication
router.use(authenticateToken);

// ============================================================================
// STATS ENDPOINTS
// ============================================================================

// General overview stats
router.get('/general', getGeneralStats);

// Contract statistics
router.get('/contracts', getContractStats);

// Ticket statistics
router.get('/tickets', getTicketStats);

// Institution statistics
router.get('/institutions', getInstitutionStats);

export default router;