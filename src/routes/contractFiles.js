// src/routes/contractFiles.js
/**
 * ============================================================================
 * CONTRACT FILE ROUTES - GENERIC FOR ALL CONTRACT TYPES
 * ============================================================================
 * Routes pentru upload/download/delete contracte PDF
 * Suportă: TMB, Waste Operator, Sorting, Disposal
 * 
 * URL Format: /api/contracts/:contractType/:contractId/...
 * 
 * Examples:
 * - POST /api/contracts/tmb/123/upload
 * - DELETE /api/contracts/waste/456/file
 * - GET /api/contracts/sorting/789/file
 * ============================================================================
 */

import express from 'express';
import { 
  authenticateToken, 
  authorizeAdminOnly 
} from '../middleware/auth.js';
import {
  upload,
  uploadContractFile,
  deleteContractFile,
  getContractFileInfo,
} from '../controllers/contractFileController.js';

const router = express.Router();

// ============================================================================
// ROUTES - WITH CONTRACT TYPE PARAMETER
// ============================================================================

// Upload contract file (doar PLATFORM_ADMIN)
// POST /api/contracts/:contractType/:contractId/upload
// contractType: 'tmb' | 'waste' | 'sorting' | 'disposal'
router.post(
  '/:contractType/:contractId/upload',  // ← Adaugă :contractType
  authenticateToken,
  authorizeAdminOnly,  // ← ÎNLOCUIEȘTE requirePlatformAdmin
  upload.single('file'),
  uploadContractFile
);

// Delete contract file (doar PLATFORM_ADMIN)
// DELETE /api/contracts/:contractType/:contractId/file
router.delete(
  '/:contractType/:contractId/file',  // ← Adaugă :contractType
  authenticateToken,
  authorizeAdminOnly,  // ← ÎNLOCUIEȘTE requirePlatformAdmin
  deleteContractFile
);

// Get contract file info (toți utilizatorii autentificați)
// GET /api/contracts/:contractType/:contractId/file
router.get(
  '/:contractType/:contractId/file',  // ← Adaugă :contractType
  authenticateToken,  // ← Fără authorizeAdminOnly (toți pot citi)
  getContractFileInfo
);

export default router;