// src/routes/notifications.js
import express from 'express';
import { getNotifications } from '../controllers/notificationController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// GET /api/notifications
router.get('/', getNotifications);

export default router;