// src/routes/users.js
import express from 'express';
import { 
  getAllUsers, 
  getUserById, 
  createUser, 
  updateUser, 
  deleteUser,
  getUserStats
} from '../controllers/userController.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// GET routes
// Doar PLATFORM_ADMIN poate vedea lista de users
router.get('/', authorizeRoles('PLATFORM_ADMIN'), getAllUsers);

// Doar PLATFORM_ADMIN poate vedea stats
router.get('/stats', authorizeRoles('PLATFORM_ADMIN'), getUserStats);

// Doar PLATFORM_ADMIN poate vedea detalii user
router.get('/:id', authorizeRoles('PLATFORM_ADMIN'), getUserById);

// POST routes
// Doar PLATFORM_ADMIN poate crea users
router.post('/', authorizeRoles('PLATFORM_ADMIN'), createUser);

// PUT routes
// Doar PLATFORM_ADMIN poate edita users
router.put('/:id', authorizeRoles('PLATFORM_ADMIN'), updateUser);

// DELETE routes
// Doar PLATFORM_ADMIN poate șterge users
router.delete('/:id', authorizeRoles('PLATFORM_ADMIN'), deleteUser);

export default router;