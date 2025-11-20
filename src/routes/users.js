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
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Toate route-urile necesită autentificare
router.use(authenticateToken);

// GET - orice user autentificat poate vedea
router.get('/', getAllUsers);
router.get('/stats', getUserStats);
router.get('/:id', getUserById);

// POST/PUT/DELETE - doar PLATFORM_ADMIN
router.post('/', authorizeRoles('PLATFORM_ADMIN'), createUser);
router.put('/:id', authorizeRoles('PLATFORM_ADMIN'), updateUser);
router.delete('/:id', authorizeRoles('PLATFORM_ADMIN'), deleteUser);

export default router;