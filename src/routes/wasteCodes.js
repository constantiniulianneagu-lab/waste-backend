// src/routes/wasteCodes.js
/**
 * ============================================================================
 * WASTE CODES ROUTES
 * ============================================================================
 * Routes pentru obținere coduri deșeuri (pentru dropdown-uri)
 * ============================================================================
 */

import express from 'express';
import { getAllWasteCodes, getWasteCodeById } from '../controllers/wasteCodesController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// GET all waste codes
router.get('/', getAllWasteCodes);

// GET waste code by ID
router.get('/:id', getWasteCodeById);

export default router;