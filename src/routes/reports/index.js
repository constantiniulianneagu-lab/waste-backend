// ============================================================================
// src/routes/reports/index.js  (COMPLET)
// ============================================================================
// Base: /api/reports
// ============================================================================

import express from 'express';
import landfillRoutes from './landfill.js';
import tmbRoutes from './tmb.js';

const router = express.Router();

router.use('/landfill', landfillRoutes);
router.use('/tmb', tmbRoutes);

export default router;
