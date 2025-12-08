// src/routes/institutions.js
import express from 'express';
import { 
  getAllInstitutions, 
  getInstitutionById, 
  createInstitution, 
  updateInstitution, 
  deleteInstitution,
  getInstitutionStats,
  getInstitutionContracts  // ✅ ADAUGĂ
} from '../controllers/institutionController.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// GET routes
// Toți utilizatorii autentificați pot vedea lista de instituții
router.get('/', getAllInstitutions);

// Doar PLATFORM_ADMIN poate vedea stats
router.get('/stats', authorizeRoles('PLATFORM_ADMIN'), getInstitutionStats);

// Get contracts for institution (ÎNAINTE de /:id)
router.get('/:id/contracts', authenticateToken, getInstitutionContracts);

// Toți utilizatorii autentificați pot vedea detalii instituție
router.get('/:id', getInstitutionById);

// POST routes
// Doar PLATFORM_ADMIN poate crea instituții
router.post('/', authorizeRoles('PLATFORM_ADMIN'), createInstitution);

// PUT routes
// Doar PLATFORM_ADMIN poate edita instituții
router.put('/:id', authorizeRoles('PLATFORM_ADMIN'), updateInstitution);

// DELETE routes
// Doar PLATFORM_ADMIN poate șterge instituții
router.delete('/:id', authorizeRoles('PLATFORM_ADMIN'), deleteInstitution);

export default router;