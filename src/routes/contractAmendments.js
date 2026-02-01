// src/routes/contractAmendments.js
/**
 * ============================================================================
 * CONTRACT AMENDMENTS ROUTES
 * ============================================================================
 */

import express from 'express';
import {
  getContractAmendments,
  createAmendment,
  updateAmendment,
  deleteAmendment
} from '../controllers/contractAmendmentsController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Toate rutele necesită autentificare
router.use(authenticate);

// GET /api/amendments/:contractType/:contractId - Listă acte adiționale
router.get('/:contractType/:contractId', getContractAmendments);

// POST /api/amendments/:contractType/:contractId - Creează act adițional
router.post('/:contractType/:contractId', createAmendment);

// PUT /api/amendments/:contractType/:amendmentId - Actualizează act adițional
router.put('/:contractType/:amendmentId', updateAmendment);

// DELETE /api/amendments/:contractType/:amendmentId - Șterge act adițional
router.delete('/:contractType/:amendmentId', deleteAmendment);

export default router;