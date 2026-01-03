// src/routes/tickets/index.js
import express from 'express';

import landfillRoutes from './landfill.js';
import tmbRoutes from './tmb.js';
import recyclingRoutes from './recycling.js';
import recoveryRoutes from './recovery.js';
import disposalRoutes from './disposal.js';
import rejectedRoutes from './rejected.js';

const router = express.Router();

router.use('/landfill', landfillRoutes);
router.use('/tmb', tmbRoutes);
router.use('/recycling', recyclingRoutes);
router.use('/recovery', recoveryRoutes);
router.use('/disposal', disposalRoutes);
router.use('/rejected', rejectedRoutes);

export default router;
