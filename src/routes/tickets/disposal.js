// ============================================================================
// src/routes/tickets/disposal.js  (COMPLET)
// ============================================================================
// Base: /api/tickets/disposal
// ============================================================================

import express from 'express';

import {
  getAllDisposalTickets,
  getDisposalTicketById,
  createDisposalTicket,
  updateDisposalTicket,
  deleteDisposalTicket,
  getDisposalStats,
} from '../../controllers/wasteTicketsDisposalController.js';

import { authenticateToken, authorizeAdminOnly } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import { enforceSectorAccess } from '../../middleware/enforceSectorAccess.js';

const router = express.Router();

router.use(authenticateToken);
router.use(resolveUserAccess);
router.use(enforceSectorAccess);

// READ
router.get('/stats', getDisposalStats);
router.get('/', getAllDisposalTickets);
router.get('/:id', getDisposalTicketById);

// WRITE
router.post('/', authorizeAdminOnly, createDisposalTicket);
router.put('/:id', authorizeAdminOnly, updateDisposalTicket);
router.delete('/:id', authorizeAdminOnly, deleteDisposalTicket);

export default router;
