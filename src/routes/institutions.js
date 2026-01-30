// src/routes/institutions.js
/**
 * ============================================================================
 * INSTITUTION ROUTES - WITH ALL 6 CONTRACT TYPES
 * ============================================================================
 * Order: Colectare → Sortare → Aerobă → Anaerobă → TMB → Depozitare
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

// WASTE COLLECTOR (Colectare)
import {
  getWasteOperatorContracts,
  getWasteOperatorContract,
  createWasteOperatorContract,
  updateWasteOperatorContract,
  deleteWasteOperatorContract
} from '../controllers/wasteOperatorContractController.js';

// SORTING (Sortare)
import {
  getSortingContracts,
  getSortingContract,
  createSortingContract,
  updateSortingContract,
  deleteSortingContract,
  getSortingContractAmendments,
  createSortingContractAmendment,
  updateSortingContractAmendment,
  deleteSortingContractAmendment
} from '../controllers/sortingContractController.js';

// AEROBIC (Aerobă)
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

// ANAEROBIC (Anaerobă)
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

// TMB
import {
  validateTMBContract,
  getTMBContracts,
  getTMBContract,
  createTMBContract,
  updateTMBContract,
  deleteTMBContract,
  getTMBContractAmendments,
  createTMBContractAmendment,
  updateTMBContractAmendment,
  deleteTMBContractAmendment,
} from '../controllers/tmbContractController.js';

// DISPOSAL (Depozitare)
import {
  getDisposalContracts,
  getDisposalContract,
  createDisposalContract,
  updateDisposalContract,
  deleteDisposalContract,
  getContractAmendments,
  createContractAmendment,
  updateContractAmendment,
  validateDisposalContract,
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
// WASTE COLLECTOR (COLECTARE) CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/waste-contracts', getWasteOperatorContracts);
router.get('/:institutionId/waste-contracts/:contractId', getWasteOperatorContract);
router.post('/:institutionId/waste-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createWasteOperatorContract);
router.put('/:institutionId/waste-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateWasteOperatorContract);
router.delete('/:institutionId/waste-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteWasteOperatorContract);

// ============================================================================
// SORTING (SORTARE) CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/sorting-contracts', getSortingContracts);
router.get('/:institutionId/sorting-contracts/:contractId', getSortingContract);
router.post('/:institutionId/sorting-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createSortingContract);
router.put('/:institutionId/sorting-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateSortingContract);
router.delete('/:institutionId/sorting-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteSortingContract);

// Sorting Amendments
router.get('/:institutionId/sorting-contracts/:contractId/amendments', getSortingContractAmendments);
router.post('/:institutionId/sorting-contracts/:contractId/amendments', authorizeRoles(ROLES.PLATFORM_ADMIN), createSortingContractAmendment);
router.put('/:institutionId/sorting-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateSortingContractAmendment);
router.delete('/:institutionId/sorting-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteSortingContractAmendment);

// ============================================================================
// AEROBIC (AEROBĂ) CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/aerobic-contracts', getAerobicContracts);
router.get('/:institutionId/aerobic-contracts/:contractId', getAerobicContract);
router.post('/:institutionId/aerobic-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createAerobicContract);
router.put('/:institutionId/aerobic-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateAerobicContract);
router.delete('/:institutionId/aerobic-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteAerobicContract);

// Aerobic Amendments
router.get('/:institutionId/aerobic-contracts/:contractId/amendments', getAerobicContractAmendments);
router.post('/:institutionId/aerobic-contracts/:contractId/amendments', authorizeRoles(ROLES.PLATFORM_ADMIN), createAerobicContractAmendment);
router.put('/:institutionId/aerobic-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateAerobicContractAmendment);
router.delete('/:institutionId/aerobic-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteAerobicContractAmendment);

// ============================================================================
// ANAEROBIC (ANAEROBĂ) CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/anaerobic-contracts', getAnaerobicContracts);
router.get('/:institutionId/anaerobic-contracts/:contractId', getAnaerobicContract);
router.post('/:institutionId/anaerobic-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createAnaerobicContract);
router.put('/:institutionId/anaerobic-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateAnaerobicContract);
router.delete('/:institutionId/anaerobic-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteAnaerobicContract);

// Anaerobic Amendments
router.get('/:institutionId/anaerobic-contracts/:contractId/amendments', getAnaerobicContractAmendments);
router.post('/:institutionId/anaerobic-contracts/:contractId/amendments', authorizeRoles(ROLES.PLATFORM_ADMIN), createAnaerobicContractAmendment);
router.put('/:institutionId/anaerobic-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateAnaerobicContractAmendment);
router.delete('/:institutionId/anaerobic-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteAnaerobicContractAmendment);

// ============================================================================
// TMB CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/tmb-contracts', getTMBContracts);
router.get('/:institutionId/tmb-contracts/:contractId', getTMBContract);
router.post('/:institutionId/tmb-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createTMBContract);
router.put('/:institutionId/tmb-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateTMBContract);
router.delete('/:institutionId/tmb-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteTMBContract);
router.post('/contracts/validate/tmb', validateTMBContract);

// TMB Amendments
router.get('/:institutionId/tmb-contracts/:contractId/amendments', getTMBContractAmendments);
router.post('/:institutionId/tmb-contracts/:contractId/amendments', authorizeRoles(ROLES.PLATFORM_ADMIN), createTMBContractAmendment);
router.put('/:institutionId/tmb-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateTMBContractAmendment);
router.delete('/:institutionId/tmb-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteTMBContractAmendment);

// ============================================================================
// DISPOSAL (DEPOZITARE) CONTRACT ROUTES
// ============================================================================

router.get('/:institutionId/disposal-contracts', getDisposalContracts);
router.get('/:institutionId/disposal-contracts/:contractId', getDisposalContract);
router.post('/:institutionId/disposal-contracts', authorizeRoles(ROLES.PLATFORM_ADMIN), createDisposalContract);
router.put('/:institutionId/disposal-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateDisposalContract);
router.delete('/:institutionId/disposal-contracts/:contractId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteDisposalContract);
router.post('/contracts/validate/disposal', validateDisposalContract);

// Disposal Amendments
router.get('/:institutionId/disposal-contracts/:contractId/amendments', getContractAmendments);
router.post('/:institutionId/disposal-contracts/:contractId/amendments', authorizeRoles(ROLES.PLATFORM_ADMIN), createContractAmendment);
router.put('/:institutionId/disposal-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), updateContractAmendment);
router.delete('/:institutionId/disposal-contracts/:contractId/amendments/:amendmentId', authorizeRoles(ROLES.PLATFORM_ADMIN), deleteContractAmendment);

export default router;