// src/routes/tickets/tmb.js
import express from 'express';
import { 
  getAllTmbTickets,
  getTmbTicketById,
  createTmbTicket,
  updateTmbTicket,
  deleteTmbTicket,
  getTmbStats
} from '../../controllers/wasteTicketsTmbController.js';
import { authenticateToken, authorizeRoles } from '../../middleware/auth.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// ============================================================================
// GET ROUTES
// ============================================================================

// GET stats - toți utilizatorii autentificați pot vedea stats
router.get('/stats', getTmbStats);

// GET all tickets - toți utilizatorii autentificați
router.get('/', getAllTmbTickets);

// GET single ticket by ID - toți utilizatorii autentificați
router.get('/:id', getTmbTicketById);

// ============================================================================
// POST ROUTES
// ============================================================================

// CREATE ticket - doar PLATFORM_ADMIN și OPERATOR_USER
// CRITICAL: Backend validează automat waste_code = '20 03 01' DOAR!
router.post('/', 
  authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), 
  createTmbTicket
);

// ============================================================================
// PUT ROUTES
// ============================================================================

// UPDATE ticket - doar PLATFORM_ADMIN și OPERATOR_USER
router.put('/:id', 
  authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), 
  updateTmbTicket
);

// ============================================================================
// DELETE ROUTES
// ============================================================================

// DELETE ticket (soft delete) - doar PLATFORM_ADMIN
router.delete('/:id', 
  authorizeRoles('PLATFORM_ADMIN'), 
  deleteTmbTicket
);

export default router;