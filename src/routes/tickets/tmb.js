// ============================================================================
// src/routes/tickets/tmb.js  (COMPLET)
// ============================================================================
// Base: /api/tickets/tmb
// ============================================================================

import express from 'express';

import {
  getAllTmbTickets,
  getTmbTicketById,
  createTmbTicket,
  updateTmbTicket,
  deleteTmbTicket,
  getTmbStats,
} from '../../controllers/wasteTicketsTmbController.js';

import { authenticateToken, authorizeAdminOnly } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import { enforceSectorAccess } from '../../middleware/enforceSectorAccess.js';

const router = express.Router();

router.use(authenticateToken);
router.use(resolveUserAccess);
router.use(enforceSectorAccess);

// READ
router.get('/stats', getTmbStats);
router.get('/', getAllTmbTickets);
router.get('/:id', getTmbTicketById);

// WRITE
router.post('/', authorizeAdminOnly, createTmbTicket);
router.put('/:id', authorizeAdminOnly, updateTmbTicket);
router.delete('/:id', authorizeAdminOnly, deleteTmbTicket);

export default router;
