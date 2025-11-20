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

// GET routes
router.get('/', getAllUsers);
router.get('/stats', getUserStats);
router.get('/:id', getUserById);

// POST routes
router.post('/', createUser);

// PUT routes
router.put('/:id', updateUser);

// DELETE routes
router.delete('/:id', deleteUser);

export default router;