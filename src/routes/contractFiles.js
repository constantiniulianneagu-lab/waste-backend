// src/routes/contractFiles.js
/**
 * ============================================================================
 * CONTRACT FILE ROUTES - ES6 MODULES
 * ============================================================================
 * Routes pentru upload/download/delete contracte PDF
 * ============================================================================
 */

import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import {
  upload,
  uploadContractFile,
  deleteContractFile,
  getContractFileInfo,
} from '../controllers/contractFileController.js';

const router = express.Router();

// ============================================================================
// ROUTES
// ============================================================================

// Upload contract file (doar PLATFORM_ADMIN)
// POST /api/contracts/:contractId/upload
router.post(
  '/:contractId/upload',
  authenticateToken,
  requireRole(['PLATFORM_ADMIN']),
  upload.single('file'), // Multer middleware
  uploadContractFile
);

// Delete contract file (doar PLATFORM_ADMIN)
// DELETE /api/contracts/:contractId/file
router.delete(
  '/:contractId/file',
  authenticateToken,
  requireRole(['PLATFORM_ADMIN']),
  deleteContractFile
);

// Get contract file info (toți utilizatorii autentificați)
// GET /api/contracts/:contractId/file
router.get(
  '/:contractId/file',
  authenticateToken,
  getContractFileInfo
);

export default router;