// src/routes/institutions.js
/**
 * ============================================================================
 * INSTITUTION ROUTES - WITH ACCESS CONTROL + SCOPE FILTERING
 * ============================================================================
 * Policy:
 * - AUTH required
 * - resolveUserAccess required (scope)
 * - REGULATOR_VIEWER MUST NOT access institutions page (per requirements)
 * - READ allowed for PLATFORM_ADMIN / ADMIN_INSTITUTION / EDITOR_INSTITUTION
 * - WRITE (institution + contracts) allowed ONLY for PLATFORM_ADMIN
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
  getInstitutionContracts // Deprecated - kept for backwards compatibility
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
  getWasteOperatorContractById,
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
  deleteDisposalContract
} from '../controllers/disposalContractController.js';

const router = express.Router();

// AUTH + SCOPE
router.use(authenticateToken);
router.use(resolveUserAccess);

// REGULATOR_VIEWER NU are acces la pagina Institutii (per tabel cerinte)
router.use(authorizeRoles(ROLES.PLATFORM_ADMIN, ROLES.ADMIN_INSTITUTION, ROLES.EDITOR_INSTITUTION));

// ============================================================================
// INSTITUTION ROUTES
// ============================================================================

router.get('/', getAllInstitutions);

// Stats = doar PLATFORM_ADMIN (cum era)
router.get('/stats', authorizeRoles(ROLES.PLATFORM_ADMIN), getInstitutionStats);

// Deprecated - kept for backwards compatibility
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
router.get('/:institutionId/waste-contracts/:contractId', getWasteOperatorContractById);
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

export default router;
