// ============================================================================
// src/routes/tickets/recovery.js  (COMPLET)
// ============================================================================
// Base: /api/tickets/recovery
// ============================================================================

import express from 'express';

import {
  getAllRecoveryTickets,
  getRecoveryTicketById,
  createRecoveryTicket,
  updateRecoveryTicket,
  deleteRecoveryTicket,
  getRecoveryStats,
} from '../../controllers/wasteTicketsRecoveryController.js';

import { authenticateToken, authorizeAdminOnly } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import { enforceSectorAccess } from '../../middleware/enforceSectorAccess.js';

const router = express.Router();

router.use(authenticateToken);
router.use(resolveUserAccess);
router.use(enforceSectorAccess);

// READ
router.get('/stats', getRecoveryStats);
router.get('/', getAllRecoveryTickets);
router.get('/:id', getRecoveryTicketById);

// WRITE
router.post('/', authorizeAdminOnly, createRecoveryTicket);
router.put('/:id', authorizeAdminOnly, updateRecoveryTicket);
router.delete('/:id', authorizeAdminOnly, deleteRecoveryTicket);

export default router;
