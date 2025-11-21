// src/routes/tickets/rejected.js
import express from 'express';
import { 
  getAllRejectedTickets,
  getRejectedTicketById,
  createRejectedTicket,
  updateRejectedTicket,
  deleteRejectedTicket,
  getRejectedStats
} from '../../controllers/wasteTicketsRejectedController.js';
import { authenticateToken, authorizeRoles } from '../../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/stats', getRejectedStats);
router.get('/', getAllRejectedTickets);
router.get('/:id', getRejectedTicketById);
router.post('/', authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), createRejectedTicket);
router.put('/:id', authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), updateRejectedTicket);
router.delete('/:id', authorizeRoles('PLATFORM_ADMIN'), deleteRejectedTicket);

export default router;