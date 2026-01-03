// ============================================================================
// src/routes/tickets/landfill.js  (COMPLET)
// ============================================================================
// Base: /api/tickets/landfill
// Policy:
// - auth + resolveUserAccess always
// - enforceSectorAccess if sector_id provided
// - WRITE blocked to PLATFORM_ADMIN only (authorizeAdminOnly)
// ============================================================================

import express from 'express';

import {
  getAllLandfillTickets,
  getLandfillTicketById,
  createLandfillTicket,
  updateLandfillTicket,
  deleteLandfillTicket,
  getLandfillStats,
} from '../../controllers/wasteTicketsLandfillController.js';

import { authenticateToken, authorizeAdminOnly } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import { enforceSectorAccess } from '../../middleware/enforceSectorAccess.js';

const router = express.Router();

router.use(authenticateToken);
router.use(resolveUserAccess);
router.use(enforceSectorAccess);

// READ
router.get('/stats', getLandfillStats);
router.get('/', getAllLandfillTickets);
router.get('/:id', getLandfillTicketById);

// WRITE (blocked globally)
router.post('/', authorizeAdminOnly, createLandfillTicket);
router.put('/:id', authorizeAdminOnly, updateLandfillTicket);
router.delete('/:id', authorizeAdminOnly, deleteLandfillTicket);

export default router;
