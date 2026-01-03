// ============================================================================
// src/routes/reports/landfill.js  (COMPLET)
// ============================================================================
// Base: /api/reports/landfill
// Policy:
// - AUTH required
// - resolveUserAccess required (scope)
// - enforceSectorAccess optional (if sector_id present in query/body, block if no access)
// - REGULATOR_VIEWER MUST NOT access reports (per requirements)
// - READ-ONLY (no CRUD here)
// ============================================================================

import express from 'express';

import { authenticateToken, authorizeRoles } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import { enforceSectorAccess } from '../../middleware/enforceSectorAccess.js';

import {
  getLandfillReports,
  getAuxiliaryData,
  exportLandfillReports
} from '../../controllers/reportsLandfillController.js';

const router = express.Router();

// Must be authenticated + scoped
router.use(authenticateToken);
router.use(resolveUserAccess);

// Exclude REGULATOR_VIEWER from all reports routes (FIX #6)
router.use(authorizeRoles('PLATFORM_ADMIN', 'ADMIN_INSTITUTION', 'EDITOR_INSTITUTION'));

// If sector_id is provided in query/body, block if not allowed
router.use(enforceSectorAccess);

// Specific routes FIRST
router.get('/auxiliary', getAuxiliaryData);
router.get('/export', exportLandfillReports);

// Root (list)
router.get('/', getLandfillReports);

export default router;
