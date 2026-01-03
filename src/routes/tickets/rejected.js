// ============================================================================
// src/routes/tickets/rejected.js  (COMPLET)
// ============================================================================
// Base: /api/tickets/rejected
// ============================================================================

import express from 'express';

import {
  getAllRejectedTickets,
  getRejectedTicketById,
  createRejectedTicket,
  updateRejectedTicket,
  deleteRejectedTicket,
  getRejectedStats,
} from '../../controllers/wasteTicketsRejectedController.js';

import { authenticateToken, authorizeAdminOnly } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import { enforceSectorAccess } from '../../middleware/enforceSectorAccess.js';

const router = express.Router();

router.use(authenticateToken);
router.use(resolveUserAccess);
router.use(enforceSectorAccess);

// READ
router.get('/stats', getRejectedStats);
router.get('/', getAllRejectedTickets);
router.get('/:id', getRejectedTicketById);

// WRITE
router.post('/', authorizeAdminOnly, createRejectedTicket);
router.put('/:id', authorizeAdminOnly, updateRejectedTicket);
router.delete('/:id', authorizeAdminOnly, deleteRejectedTicket);

export default router;
