/**
 * ============================================================================
 * REPORTS ROUTES INDEX
 * ============================================================================
 */

import express from 'express';
import landfillRoutes from './landfill.js';

const router = express.Router();

// Reports routes
router.use('/landfill', landfillRoutes);
// router.use('/tmb', tmbRoutes); // TODO: Implement TMB reports

export default router;