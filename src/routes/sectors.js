// src/routes/sectors.js
/**
 * ============================================================================
 * SECTORS ROUTES
 * ============================================================================
 * Routes pentru obținere sectoare (pentru dropdown-uri)
 * ============================================================================
 */

import express from 'express';
import { getAllSectors, getSectorById } from '../controllers/sectorController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// GET all sectors
router.get('/', getAllSectors);

// GET sector by ID
router.get('/:id', getSectorById);

export default router;