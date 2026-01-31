// src/routes/aerobicContract.js
/**
 * ============================================================================
 * AEROBIC CONTRACT ROUTES (TA-)
 * ============================================================================
 */

import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import {
  getAerobicContracts,
  getAerobicContract,
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

// ============================================================================
// CONTRACT ROUTES
// ============================================================================

// Get all aerobic contracts
router.get('/', getAerobicContracts);

// Get single aerobic contract
router.get('/:contractId', getAerobicContract);

// Create aerobic contract (PLATFORM_ADMIN only)
router.post('/', authorizeRoles(ROLES.PLATFORM_ADMIN), createAerobicContract);

// Update aerobic contract (PLATFORM_ADMIN only)
router.put('/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateAerobicContract);

// Delete aerobic contract (PLATFORM_ADMIN only)
router.delete('/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteAerobicContract);

// ============================================================================
// AMENDMENT ROUTES
// ============================================================================

// Get all amendments for a contract
router.get('/:contractId/amendments', getAerobicContractAmendments);

// Create amendment (PLATFORM_ADMIN only)
router.post('/:contractId/amendments', authorizeRoles(ROLES.PLATFORM_ADMIN), createAerobicContractAmendment);

// Update amendment (PLATFORM_ADMIN only)
router.put('/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateAerobicContractAmendment);

// Delete amendment (PLATFORM_ADMIN only)
router.delete('/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteAerobicContractAmendment);

export default router;