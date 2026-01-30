// src/routes/aerobicContract.js
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getAllAerobicContracts,
  getAerobicContractById,
  createAerobicContract,
  updateAerobicContract,
  deleteAerobicContract,
  getAerobicContractAmendments,
  createAerobicContractAmendment,
  updateAerobicContractAmendment,
  deleteAerobicContractAmendment
} from '../controllers/aerobicContractController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Contract routes
router.get('/', getAllAerobicContracts);
router.get('/:id', getAerobicContractById);
router.post('/', createAerobicContract);
router.put('/:id', updateAerobicContract);
router.delete('/:id', deleteAerobicContract);

// Amendment routes
router.get('/:contractId/amendments', getAerobicContractAmendments);
router.post('/:contractId/amendments', createAerobicContractAmendment);
router.put('/:contractId/amendments/:amendmentId', updateAerobicContractAmendment);
router.delete('/:contractId/amendments/:amendmentId', deleteAerobicContractAmendment);

export default router;