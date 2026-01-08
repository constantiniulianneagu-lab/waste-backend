// src/routes/sectors.js
/**
 * ============================================================================
 * SECTORS ROUTES
 * ============================================================================
 * Policy:
 * - AUTH required
 * - resolveUserAccess required (scope)
 * - REGULATOR_VIEWER NU are acces la pagina Sectoare (per cerinte)
 * - PLATFORM_ADMIN / ADMIN_INSTITUTION / EDITOR_INSTITUTION:
 *    - PMB => vede toate sectoarele
 *    - S1..S6 => vede doar sectorul/sectoarele asociate
 * ============================================================================
 */

import express from 'express';
import { getAllSectors, getSectorById } from '../controllers/sectorController.js';
import { 
  getAllSectorsOverview, 
  getSectorWasteManagementStats 
} from '../controllers/sectorWasteManagementController.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { resolveUserAccess } from '../middleware/resolveUserAccess.js';
import { ROLES } from '../constants/roles.js';

const router = express.Router();

router.use(authenticateToken);
router.use(resolveUserAccess);

// Blocăm REGULATOR_VIEWER
router.use(authorizeRoles(ROLES.PLATFORM_ADMIN, ROLES.ADMIN_INSTITUTION, ROLES.EDITOR_INSTITUTION));

// GET all sectors (filtrat în controller după req.userAccess)
router.get('/', getAllSectors);

// GET waste management overview for all sectors
// Query params: ?year=2025
router.get('/waste-management/overview', getAllSectorsOverview);

// GET waste management stats for specific sector
// Query params: ?year=2025&month=1 (month optional)
router.get('/:sector_number/waste-management', getSectorWasteManagementStats);

// GET sector by ID (verificare scope în controller)
router.get('/:id', getSectorById);

export default router;