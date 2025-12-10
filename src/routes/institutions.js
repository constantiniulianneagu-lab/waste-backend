// src/routes/institutions.js
/**
 * ============================================================================
 * INSTITUTION ROUTES - COMPLETE WITH ALL CONTRACT TYPES
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
  getInstitutionContracts  // Deprecated - kept for backwards compatibility
} from '../controllers/institutionController.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

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
  deleteDisposalContract
} from '../controllers/disposalContractController.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// ============================================================================
// INSTITUTION ROUTES
// ============================================================================

// GET routes
router.get('/', getAllInstitutions);
router.get('/stats', authorizeRoles('PLATFORM_ADMIN'), getInstitutionStats);

// Deprecated - kept for backwards compatibility
router.get('/:id/contracts', getInstitutionContracts);

router.get('/:id', getInstitutionById);

// POST routes
router.post('/', authorizeRoles('PLATFORM_ADMIN'), createInstitution);

// PUT routes
router.put('/:id', authorizeRoles('PLATFORM_ADMIN'), updateInstitution);

// DELETE routes
router.delete('/:id', authorizeRoles('PLATFORM_ADMIN'), deleteInstitution);

// ============================================================================
// TMB CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/tmb-contracts', getTMBContracts);
router.get('/:institutionId/tmb-contracts/:contractId', getTMBContract);
router.post('/:institutionId/tmb-contracts', authorizeRoles('PLATFORM_ADMIN'), createTMBContract);
router.put('/:institutionId/tmb-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), updateTMBContract);
router.delete('/:institutionId/tmb-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), deleteTMBContract);

// ============================================================================
// WASTE OPERATOR CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/waste-contracts', getWasteOperatorContracts);
router.get('/:institutionId/waste-contracts/:contractId', getWasteOperatorContract);
router.post('/:institutionId/waste-contracts', authorizeRoles('PLATFORM_ADMIN'), createWasteOperatorContract);
router.put('/:institutionId/waste-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), updateWasteOperatorContract);
router.delete('/:institutionId/waste-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), deleteWasteOperatorContract);

// ============================================================================
// SORTING CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/sorting-contracts', getSortingContracts);
router.get('/:institutionId/sorting-contracts/:contractId', getSortingContract);
router.post('/:institutionId/sorting-contracts', authorizeRoles('PLATFORM_ADMIN'), createSortingContract);
router.put('/:institutionId/sorting-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), updateSortingContract);
router.delete('/:institutionId/sorting-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), deleteSortingContract);

// ============================================================================
// DISPOSAL CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/disposal-contracts', getDisposalContracts);
router.get('/:institutionId/disposal-contracts/:contractId', getDisposalContract);
router.post('/:institutionId/disposal-contracts', authorizeRoles('PLATFORM_ADMIN'), createDisposalContract);
router.put('/:institutionId/disposal-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), updateDisposalContract);
router.delete('/:institutionId/disposal-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), deleteDisposalContract);

export default router;