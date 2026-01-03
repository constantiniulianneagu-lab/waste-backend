// ============================================================================
// src/routes/tickets/recycling.js  (COMPLET)
// ============================================================================
// Base: /api/tickets/recycling
// ============================================================================

import express from 'express';

import {
  getAllRecyclingTickets,
  getRecyclingTicketById,
  createRecyclingTicket,
  updateRecyclingTicket,
  deleteRecyclingTicket,
  getRecyclingStats,
} from '../../controllers/wasteTicketsRecyclingController.js';

import { authenticateToken, authorizeAdminOnly } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import { enforceSectorAccess } from '../../middleware/enforceSectorAccess.js';

const router = express.Router();

router.use(authenticateToken);
router.use(resolveUserAccess);
router.use(enforceSectorAccess);

// READ
router.get('/stats', getRecyclingStats);
router.get('/', getAllRecyclingTickets);
router.get('/:id', getRecyclingTicketById);

// WRITE
router.post('/', authorizeAdminOnly, createRecyclingTicket);
router.put('/:id', authorizeAdminOnly, updateRecyclingTicket);
router.delete('/:id', authorizeAdminOnly, deleteRecyclingTicket);

export default router;
