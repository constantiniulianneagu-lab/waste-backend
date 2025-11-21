// src/routes/tickets/disposal.js
import express from 'express';
import { 
  getAllDisposalTickets,
  getDisposalTicketById,
  createDisposalTicket,
  updateDisposalTicket,
  deleteDisposalTicket,
  getDisposalStats
} from '../../controllers/wasteTicketsDisposalController.js';
import { authenticateToken, authorizeRoles } from '../../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/stats', getDisposalStats);
router.get('/', getAllDisposalTickets);
router.get('/:id', getDisposalTicketById);
router.post('/', authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), createDisposalTicket);
router.put('/:id', authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), updateDisposalTicket);
router.delete('/:id', authorizeRoles('PLATFORM_ADMIN'), deleteDisposalTicket);

export default router;