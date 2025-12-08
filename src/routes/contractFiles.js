// src/routes/contractFiles.js
/**
 * ============================================================================
 * CONTRACT FILE ROUTES - SIMPLIFIED
 * ============================================================================
 * Routes pentru upload/download/delete contracte PDF
 * Verifică manual rolul în controller în loc de middleware
 * ============================================================================
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  upload,
  uploadContractFile,
  deleteContractFile,
  getContractFileInfo,
} from '../controllers/contractFileController.js';

const router = express.Router();

// ============================================================================
// MIDDLEWARE PENTRU VERIFICARE ROL PLATFORM_ADMIN
// ============================================================================

const requirePlatformAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'PLATFORM_ADMIN') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Access denied. Platform admin only.',
    });
  }
};

// ============================================================================
// ROUTES
// ============================================================================

// Upload contract file (doar PLATFORM_ADMIN)
// POST /api/contracts/:contractId/upload
router.post(
  '/:contractId/upload',
  authenticateToken,
  requirePlatformAdmin,
  upload.single('file'),
  uploadContractFile
);

// Delete contract file (doar PLATFORM_ADMIN)
// DELETE /api/contracts/:contractId/file
router.delete(
  '/:contractId/file',
  authenticateToken,
  requirePlatformAdmin,
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