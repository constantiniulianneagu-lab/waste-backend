// src/routes/sortingContract.js
/**
 * ============================================================================
 * SORTING CONTRACT ROUTES (S-)
 * ============================================================================
 */

import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import {
  getSortingOperatorContracts as getSortingContracts,
  getSortingOperatorContract as getSortingContract,
  createSortingOperatorContract as createSortingContract,
  updateSortingOperatorContract as updateSortingContract,
  deleteSortingOperatorContract as deleteSortingContract,
  getSortingOperatorContractAmendments as getSortingContractAmendments,
  createSortingOperatorContractAmendment as createSortingContractAmendment,
  updateSortingOperatorContractAmendment as updateSortingContractAmendment,
  deleteSortingOperatorContractAmendment as deleteSortingContractAmendment
} from '../controllers/sortingContractController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// ============================================================================
// CONTRACT ROUTES
// ============================================================================

// Get all sorting contracts
router.get('/', getSortingContracts);

// Get single sorting contract
router.get('/:contractId', getSortingContract);

// Create sorting contract (PLATFORM_ADMIN only)
router.post('/', authorizeRoles(ROLES.PLATFORM_ADMIN), createSortingContract);

// Update sorting contract (PLATFORM_ADMIN only)
router.put('/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateSortingContract);

// Delete sorting contract (PLATFORM_ADMIN only)
router.delete('/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteSortingContract);

// ============================================================================
// AMENDMENT ROUTES
// ============================================================================

// Get all amendments for a contract
router.get('/:contractId/amendments', getSortingContractAmendments);

// Create amendment (PLATFORM_ADMIN only)
router.post('/:contractId/amendments', authorizeRoles(ROLES.PLATFORM_ADMIN), createSortingContractAmendment);

// Update amendment (PLATFORM_ADMIN only)
router.put('/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateSortingContractAmendment);

// Delete amendment (PLATFORM_ADMIN only)
router.delete('/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteSortingContractAmendment);

export default router;