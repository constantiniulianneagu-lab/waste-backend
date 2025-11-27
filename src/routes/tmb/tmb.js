import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { 
  getTmbOperatorsBySector, 
  getTmbAssociations 
} from '../../controllers/tmbController.js';

const router = express.Router();

router.get('/operators', authenticateToken, getTmbOperatorsBySector);
router.get('/associations', authenticateToken, getTmbAssociations);

export default router;