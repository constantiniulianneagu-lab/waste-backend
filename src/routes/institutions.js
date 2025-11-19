// src/routes/institutions.js
import express from 'express';
import { 
  getAllInstitutions, 
  getInstitutionById, 
  createInstitution, 
  updateInstitution, 
  deleteInstitution,
  getInstitutionStats
} from '../controllers/institutionController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// GET routes
router.get('/', getAllInstitutions);
router.get('/stats', getInstitutionStats);
router.get('/:id', getInstitutionById);

// POST routes
router.post('/', createInstitution);

// PUT routes
router.put('/:id', updateInstitution);

// DELETE routes
router.delete('/:id', deleteInstitution);

export default router;