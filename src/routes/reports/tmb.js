// ============================================================================
// src/routes/reports/tmb.js  (COMPLET)
// ============================================================================
// Base: /api/reports/tmb
// Policy:
// - AUTH required
// - resolveUserAccess required (scope)
// - enforceSectorAccess optional (if sector_id present, block if no access)
// - REGULATOR_VIEWER MUST NOT access reports
// ============================================================================

import express from 'express';

import { authenticateToken, authorizeRoles } from '../../middleware/auth.js';
import { resolveUserAccess } from '../../middleware/resolveUserAccess.js';
import { enforceSectorAccess } from '../../middleware/enforceSectorAccess.js';

import { getTmbTickets } from '../../controllers/reportTmbController.js';
import { getRecyclingTickets } from '../../controllers/reportRecyclingController.js';
import { getRecoveryTickets } from '../../controllers/reportRecoveryController.js';
import { getDisposalTickets } from '../../controllers/reportDisposalController.js';
import { getRejectedTickets } from '../../controllers/reportRejectedController.js';

const router = express.Router();

router.use(authenticateToken);
router.use(resolveUserAccess);

// Exclude REGULATOR_VIEWER from reports
router.use(authorizeRoles('PLATFORM_ADMIN', 'ADMIN_INSTITUTION', 'EDITOR_INSTITUTION'));

// Enforce sector_id access when present
router.use(enforceSectorAccess);

// Endpoints
router.get('/tmb', getTmbTickets);
router.get('/recycling', getRecyclingTickets);
router.get('/recovery', getRecoveryTickets);
router.get('/disposal', getDisposalTickets);
router.get('/rejected', getRejectedTickets);

export default router;