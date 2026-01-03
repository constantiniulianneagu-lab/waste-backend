// src/routes/users.js
import express from 'express';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getUserStats,
  getUserProfile,
  updateUserProfile,
  getProfileOperators,
} from '../controllers/userController.js';

import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { resolveUserAccess } from '../middleware/resolveUserAccess.js';
import { ROLES } from '../constants/roles.js';

const router = express.Router();

// ----------------------------------------------------------------------------
// PROFILE (any authenticated user)
// ----------------------------------------------------------------------------
router.get('/profile', authenticateToken, getUserProfile);
router.put('/profile', authenticateToken, updateUserProfile);
router.get('/profile/operators', authenticateToken, getProfileOperators);

// ----------------------------------------------------------------------------
// USER MANAGEMENT (PLATFORM_ADMIN + ADMIN_INSTITUTION)
// IMPORTANT: resolveUserAccess is needed to know req.userAccess.institutionId
// ----------------------------------------------------------------------------
router.use(authenticateToken);
router.use(resolveUserAccess);

router.get(
  '/',
  authorizeRoles(ROLES.PLATFORM_ADMIN, ROLES.ADMIN_INSTITUTION),
  getAllUsers
);

router.get(
  '/stats',
  authorizeRoles(ROLES.PLATFORM_ADMIN),
  getUserStats
);

router.get(
  '/:id',
  authorizeRoles(ROLES.PLATFORM_ADMIN, ROLES.ADMIN_INSTITUTION),
  getUserById
);

router.post(
  '/',
  authorizeRoles(ROLES.PLATFORM_ADMIN, ROLES.ADMIN_INSTITUTION),
  createUser
);

router.put(
  '/:id',
  authorizeRoles(ROLES.PLATFORM_ADMIN, ROLES.ADMIN_INSTITUTION),
  updateUser
);

router.delete(
  '/:id',
  authorizeRoles(ROLES.PLATFORM_ADMIN, ROLES.ADMIN_INSTITUTION),
  deleteUser
);

export default router;
