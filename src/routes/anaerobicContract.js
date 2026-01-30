// src/routes/anaerobicContract.js
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getAllAnaerobicContracts,
  getAnaerobicContractById,
  createAnaerobicContract,
  updateAnaerobicContract,
  deleteAnaerobicContract,
  getAnaerobicContractAmendments,
  createAnaerobicContractAmendment,
  updateAnaerobicContractAmendment,
  deleteAnaerobicContractAmendment
} from '../controllers/anaerobicContractController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Contract routes
router.get('/', getAllAnaerobicContracts);
router.get('/:id', getAnaerobicContractById);
router.post('/', createAnaerobicContract);
router.put('/:id', updateAnaerobicContract);
router.delete('/:id', deleteAnaerobicContract);

// Amendment routes
router.get('/:contractId/amendments', getAnaerobicContractAmendments);
router.post('/:contractId/amendments', createAnaerobicContractAmendment);
router.put('/:contractId/amendments/:amendmentId', updateAnaerobicContractAmendment);
router.delete('/:contractId/amendments/:amendmentId', deleteAnaerobicContractAmendment);

export default router;