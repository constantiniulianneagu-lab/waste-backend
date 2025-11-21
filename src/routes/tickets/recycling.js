// src/routes/tickets/recycling.js
import express from 'express';
import { 
  getAllRecyclingTickets,
  getRecyclingTicketById,
  createRecyclingTicket,
  updateRecyclingTicket,
  deleteRecyclingTicket,
  getRecyclingStats
} from '../../controllers/wasteTicketsRecyclingController.js';
import { authenticateToken, authorizeRoles } from '../../middleware/auth.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// ============================================================================
// GET ROUTES
// ============================================================================

// GET stats - toți utilizatorii autentificați pot vedea stats
router.get('/stats', getRecyclingStats);

// GET all tickets - toți utilizatorii autentificați
router.get('/', getAllRecyclingTickets);

// GET single ticket by ID - toți utilizatorii autentificați
router.get('/:id', getRecyclingTicketById);

// ============================================================================
// POST ROUTES
// ============================================================================

// CREATE ticket - doar PLATFORM_ADMIN și TMB operators
// Supplier MUST be TMB_OPERATOR, Recipient MUST be RECYCLING_CLIENT
router.post('/', 
  authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), 
  createRecyclingTicket
);

// ============================================================================
// PUT ROUTES
// ============================================================================

// UPDATE ticket - doar PLATFORM_ADMIN și operators
router.put('/:id', 
  authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), 
  updateRecyclingTicket
);

// ============================================================================
// DELETE ROUTES
// ============================================================================

// DELETE ticket (soft delete) - doar PLATFORM_ADMIN
router.delete('/:id', 
  authorizeRoles('PLATFORM_ADMIN'), 
  deleteRecyclingTicket
);

export default router;