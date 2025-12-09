// src/routes/institutions.js
/**
 * ============================================================================
 * INSTITUTION ROUTES - WITH ALL CONTRACT TYPES
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
  getInstitutionContracts  // TMB contracts
} from '../controllers/institutionController.js';

// Waste Operator Contracts
import {
  getWasteOperatorContracts,
  getWasteOperatorContractById,
  createWasteOperatorContract,
  updateWasteOperatorContract,
  deleteWasteOperatorContract,
  createWasteOperatorAmendment,
  deleteWasteOperatorAmendment
} from '../controllers/wasteOperatorContractController.js';

// Sorting Contracts
import {
  getSortingContracts,
  getSortingContractById,
  createSortingContract,
  updateSortingContract,
  deleteSortingContract,
  createSortingAmendment,
  deleteSortingAmendment
} from '../controllers/sortingContractController.js';

// Disposal Contracts
import {
  getDisposalContracts,
  getDisposalContractById,
  createDisposalContract,
  updateDisposalContract,
  deleteDisposalContract,
  createDisposalAmendment,
  deleteDisposalAmendment
} from '../controllers/disposalContractController.js';

import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// ============================================================================
// MIDDLEWARE
// ============================================================================

router.use(authenticateToken);

// ============================================================================
// INSTITUTION ROUTES
// ============================================================================

// GET routes
router.get('/', getAllInstitutions);
router.get('/stats', authorizeRoles('PLATFORM_ADMIN'), getInstitutionStats);
router.get('/:id', getInstitutionById);

// POST routes
router.post('/', authorizeRoles('PLATFORM_ADMIN'), createInstitution);

// PUT routes
router.put('/:id', authorizeRoles('PLATFORM_ADMIN'), updateInstitution);

// DELETE routes
router.delete('/:id', authorizeRoles('PLATFORM_ADMIN'), deleteInstitution);

// ============================================================================
// TMB CONTRACTS ROUTES (existing)
// ============================================================================

router.get('/:id/contracts', getInstitutionContracts);

// ============================================================================
// WASTE OPERATOR CONTRACTS ROUTES
// ============================================================================

// Get all contracts for institution
router.get('/:institutionId/waste-contracts', getWasteOperatorContracts);

// Get single contract
router.get('/:institutionId/waste-contracts/:contractId', getWasteOperatorContractById);

// Create contract
router.post('/:institutionId/waste-contracts', authorizeRoles('PLATFORM_ADMIN'), createWasteOperatorContract);

// Update contract
router.put('/:institutionId/waste-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), updateWasteOperatorContract);

// Delete contract
router.delete('/:institutionId/waste-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), deleteWasteOperatorContract);

// Amendments
router.post('/:institutionId/waste-contracts/:contractId/amendments', authorizeRoles('PLATFORM_ADMIN'), createWasteOperatorAmendment);
router.delete('/:institutionId/waste-contracts/:contractId/amendments/:amendmentId', authorizeRoles('PLATFORM_ADMIN'), deleteWasteOperatorAmendment);

// ============================================================================
// SORTING CONTRACTS ROUTES
// ============================================================================

// Get all contracts for institution
router.get('/:institutionId/sorting-contracts', getSortingContracts);

// Get single contract
router.get('/:institutionId/sorting-contracts/:contractId', getSortingContractById);

// Create contract
router.post('/:institutionId/sorting-contracts', authorizeRoles('PLATFORM_ADMIN'), createSortingContract);

// Update contract
router.put('/:institutionId/sorting-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), updateSortingContract);

// Delete contract
router.delete('/:institutionId/sorting-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), deleteSortingContract);

// Amendments
router.post('/:institutionId/sorting-contracts/:contractId/amendments', authorizeRoles('PLATFORM_ADMIN'), createSortingAmendment);
router.delete('/:institutionId/sorting-contracts/:contractId/amendments/:amendmentId', authorizeRoles('PLATFORM_ADMIN'), deleteSortingAmendment);

// ============================================================================
// DISPOSAL CONTRACTS ROUTES
// ============================================================================

// Get all contracts for institution
router.get('/:institutionId/disposal-contracts', getDisposalContracts);

// Get single contract
router.get('/:institutionId/disposal-contracts/:contractId', getDisposalContractById);

// Create contract
router.post('/:institutionId/disposal-contracts', authorizeRoles('PLATFORM_ADMIN'), createDisposalContract);

// Update contract
router.put('/:institutionId/disposal-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), updateDisposalContract);

// Delete contract
router.delete('/:institutionId/disposal-contracts/:contractId', authorizeRoles('PLATFORM_ADMIN'), deleteDisposalContract);

// Amendments
router.post('/:institutionId/disposal-contracts/:contractId/amendments', authorizeRoles('PLATFORM_ADMIN'), createDisposalAmendment);
router.delete('/:institutionId/disposal-contracts/:contractId/amendments/:amendmentId', authorizeRoles('PLATFORM_ADMIN'), deleteDisposalAmendment);

export default router;