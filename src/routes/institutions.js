// src/routes/institutions.js
/**
 * ============================================================================
 * INSTITUTION ROUTES - WITH ACCESS CONTROL + SCOPE FILTERING
 * ============================================================================
 * Updated: 2025-01-24
 * - Added amendment routes for disposal contracts
 * ============================================================================
 */

import express from 'express';
import {
  getAllInstitutions,
  getInstitutionById,
  createInstitution,
  updateInstitution,
  deleteInstitution,
  getInstitutionStats,
  getInstitutionContracts
} from '../controllers/institutionController.js';

import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { resolveUserAccess } from '../middleware/resolveUserAccess.js';
import { ROLES } from '../constants/roles.js';

// Import contract controllers
import {
  getTMBContracts,
  getTMBContract,
  createTMBContract,
  updateTMBContract,
  deleteTMBContract
} from '../controllers/tmbContractController.js';

import {
  getWasteOperatorContracts,
  getWasteOperatorContract,
  createWasteOperatorContract,
  updateWasteOperatorContract,
  deleteWasteOperatorContract
} from '../controllers/wasteOperatorContractController.js';

import {
  getSortingContracts,
  getSortingContract,
  createSortingContract,
  updateSortingContract,
  deleteSortingContract
} from '../controllers/sortingContractController.js';

import {
  getDisposalContracts,
  getDisposalContract,
  createDisposalContract,
  updateDisposalContract,
  deleteDisposalContract,
  getContractAmendments,
  createContractAmendment,
  updateContractAmendment,
  deleteContractAmendment
} from '../controllers/disposalContractController.js';

const router = express.Router();

// AUTH + SCOPE
router.use(authenticateToken);
router.use(resolveUserAccess);

// REGULATOR_VIEWER NU are acces la pagina Institutii
router.use(authorizeRoles(ROLES.PLATFORM_ADMIN, ROLES.ADMIN_INSTITUTION, ROLES.EDITOR_INSTITUTION));

// ============================================================================
// INSTITUTION ROUTES
// ============================================================================

router.get('/', getAllInstitutions);
router.get('/stats', authorizeRoles(ROLES.PLATFORM_ADMIN), getInstitutionStats);
router.get('/:id/contracts', getInstitutionContracts);
router.get('/:id', getInstitutionById);

// WRITE: doar PLATFORM_ADMIN
router.post('/', authorizeRoles(ROLES.PLATFORM_ADMIN), createInstitution);
router.put('/:id', authorizeRoles(ROLES.PLATFORM_ADMIN), updateInstitution);
router.delete('/:id', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteInstitution);

// ============================================================================
// TMB CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/tmb-contracts', getTMBContracts);
router.get('/:institutionId/tmb-contracts/:contractId', getTMBContract);
router.post('/:institutionId/tmb-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createTMBContract);
router.put('/:institutionId/tmb-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateTMBContract);
router.delete('/:institutionId/tmb-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteTMBContract);

// ============================================================================
// WASTE OPERATOR CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/waste-contracts', getWasteOperatorContracts);
router.get('/:institutionId/waste-contracts/:contractId', getWasteOperatorContract);
router.post('/:institutionId/waste-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createWasteOperatorContract);
router.put('/:institutionId/waste-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateWasteOperatorContract);
router.delete('/:institutionId/waste-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteWasteOperatorContract);

// ============================================================================
// SORTING CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/sorting-contracts', getSortingContracts);
router.get('/:institutionId/sorting-contracts/:contractId', getSortingContract);
router.post('/:institutionId/sorting-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createSortingContract);
router.put('/:institutionId/sorting-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateSortingContract);
router.delete('/:institutionId/sorting-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteSortingContract);

// ============================================================================
// DISPOSAL CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/disposal-contracts', getDisposalContracts);
router.get('/:institutionId/disposal-contracts/:contractId', getDisposalContract);
router.post('/:institutionId/disposal-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createDisposalContract);
router.put('/:institutionId/disposal-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateDisposalContract);
router.delete('/:institutionId/disposal-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteDisposalContract);

// ============================================================================
// DISPOSAL CONTRACT AMENDMENTS ROUTES (NEW!)
// ============================================================================

// Get all amendments for a contract
router.get('/:institutionId/disposal-contracts/:contractId/amendments', getContractAmendments);

// Create new amendment
router.post(
  '/:institutionId/disposal-contracts/:contractId/amendments',
  authorizeRoles(ROLES.PLATFORM_ADMIN),
  createContractAmendment
);

// Update amendment
router.put(
  '/:institutionId/disposal-contracts/:contractId/amendments/:amendmentId',
  authorizeRoles(ROLES.PLATFORM_ADMIN),
  updateContractAmendment
);

// Delete amendment
router.delete(
  '/:institutionId/disposal-contracts/:contractId/amendments/:amendmentId',
  authorizeRoles(ROLES.PLATFORM_ADMIN),
  deleteContractAmendment
);

export default router;
