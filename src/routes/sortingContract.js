// src/routes/sortingContract.js
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getAllSortingContracts,
  getSortingContractById,
  createSortingContract,
  updateSortingContract,
  deleteSortingContract,
  getSortingContractAmendments,
  createSortingContractAmendment,
  updateSortingContractAmendment,
  deleteSortingContractAmendment
} from '../controllers/sortingContractController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Contract routes
router.get('/', getAllSortingContracts);
router.get('/:id', getSortingContractById);
router.post('/', createSortingContract);
router.put('/:id', updateSortingContract);
router.delete('/:id', deleteSortingContract);

// Amendment routes
router.get('/:contractId/amendments', getSortingContractAmendments);
router.post('/:contractId/amendments', createSortingContractAmendment);
router.put('/:contractId/amendments/:amendmentId', updateSortingContractAmendment);
router.delete('/:contractId/amendments/:amendmentId', deleteSortingContractAmendment);

export default router;