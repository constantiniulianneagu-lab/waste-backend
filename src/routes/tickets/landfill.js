// src/routes/tickets/landfill.js
import express from 'express';
import { 
  getAllLandfillTickets,
  getLandfillTicketById,
  createLandfillTicket,
  updateLandfillTicket,
  deleteLandfillTicket,
  getLandfillStats
} from '../../controllers/wasteTicketsLandfillController.js';
import { authenticateToken, authorizeRoles } from '../../middleware/auth.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// ============================================================================
// GET ROUTES
// ============================================================================

// GET stats - toți utilizatorii autentificați pot vedea stats
router.get('/stats', getLandfillStats);

// GET all tickets - toți utilizatorii autentificați
router.get('/', getAllLandfillTickets);

// GET single ticket by ID - toți utilizatorii autentificați
router.get('/:id', getLandfillTicketById);

// ============================================================================
// POST ROUTES
// ============================================================================

// CREATE ticket - doar PLATFORM_ADMIN și OPERATOR_USER
router.post('/', 
  authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), 
  createLandfillTicket
);

// ============================================================================
// PUT ROUTES
// ============================================================================

// UPDATE ticket - doar PLATFORM_ADMIN și OPERATOR_USER
router.put('/:id', 
  authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), 
  updateLandfillTicket
);

// ============================================================================
// DELETE ROUTES
// ============================================================================

// DELETE ticket (soft delete) - doar PLATFORM_ADMIN
router.delete('/:id', 
  authorizeRoles('PLATFORM_ADMIN'), 
  deleteLandfillTicket
);

export default router;