import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { getTmbStats, getOutputDetails } from '../../controllers/dashboardTMBController.js';

const router = express.Router();

// Dashboard stats
router.get('/stats', authenticateToken, getTmbStats);
router.get('/output-details', authenticateToken, getOutputDetails);

export default router;
```

---

## 📋 **STRUCTURA FINALĂ CORECTĂ:**

### **1. routes/dashboard/tmb.js** (statistici dashboard)
```
/api/dashboard/tmb/stats           ← Statistici TMB
/api/dashboard/tmb/output-details  ← Detalii ieșiri
```

### **2. routes/tmb/tmb.js** (operatori și asociații)
```
/api/tmb/operators     ← Operatori din asociații
/api/tmb/associations  ← Toate asociațiile