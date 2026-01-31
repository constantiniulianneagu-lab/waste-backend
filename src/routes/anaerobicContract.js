// src/routes/anaerobicContract.js
/**
 * ============================================================================
 * ANAEROBIC CONTRACT ROUTES (TAN-)
 * ============================================================================
 */

import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import {
  getAnaerobicContracts,
  getAnaerobicContract,
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

// ============================================================================
// CONTRACT ROUTES
// ============================================================================

// Get all anaerobic contracts
router.get('/', getAnaerobicContracts);

// Get single anaerobic contract
router.get('/:contractId', getAnaerobicContract);

// Create anaerobic contract (PLATFORM_ADMIN only)
router.post('/', authorizeRoles(ROLES.PLATFORM_ADMIN), createAnaerobicContract);

// Update anaerobic contract (PLATFORM_ADMIN only)
router.put('/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateAnaerobicContract);

// Delete anaerobic contract (PLATFORM_ADMIN only)
router.delete('/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteAnaerobicContract);

// ============================================================================
// AMENDMENT ROUTES
// ============================================================================

// Get all amendments for a contract
router.get('/:contractId/amendments', getAnaerobicContractAmendments);

// Create amendment (PLATFORM_ADMIN only)
router.post('/:contractId/amendments', authorizeRoles(ROLES.PLATFORM_ADMIN), createAnaerobicContractAmendment);

// Update amendment (PLATFORM_ADMIN only)
router.put('/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateAnaerobicContractAmendment);

// Delete amendment (PLATFORM_ADMIN only)
router.delete('/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteAnaerobicContractAmendment);

export default router;