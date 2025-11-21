// src/routes/tickets/recovery.js
import express from 'express';
import { 
  getAllRecoveryTickets,
  getRecoveryTicketById,
  createRecoveryTicket,
  updateRecoveryTicket,
  deleteRecoveryTicket,
  getRecoveryStats
} from '../../controllers/wasteTicketsRecoveryController.js';
import { authenticateToken, authorizeRoles } from '../../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/stats', getRecoveryStats);
router.get('/', getAllRecoveryTickets);
router.get('/:id', getRecoveryTicketById);
router.post('/', authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), createRecoveryTicket);
router.put('/:id', authorizeRoles('PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_EDITOR', 'OPERATOR_USER'), updateRecoveryTicket);
router.delete('/:id', authorizeRoles('PLATFORM_ADMIN'), deleteRecoveryTicket);

export default router;