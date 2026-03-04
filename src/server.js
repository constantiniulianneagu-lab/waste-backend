// src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import institutionRoutes from './routes/institutions.js';
import landfillTicketRoutes from './routes/tickets/landfill.js';
import tmbTicketRoutes from './routes/tickets/tmb.js';
import recyclingTicketRoutes from './routes/tickets/recycling.js';
import recoveryTicketRoutes from './routes/tickets/recovery.js';
import disposalTicketRoutes from './routes/tickets/disposal.js';
import rejectedTicketRoutes from './routes/tickets/rejected.js';
import tmbDashboardRoutes from './routes/dashboard/tmb.js';
import reportsRoutes from './routes/reports/index.js';
import reportTmbRoutes from './routes/reports/tmb.js';
import reportLandfillRoutes from './routes/reports/landfill.js';
import tmbRoutes from './routes/tmb/tmb.js';
import contractFilesRoutes from './routes/contractFiles.js';
import wasteCodesRoutes from './routes/wasteCodes.js';
import sectorsRoutes from './routes/sectors.js';
import contractExportRoutes from './routes/contractExport.js';
import statsRoutes from './routes/stats.js';
import notificationRoutes from './routes/notifications.js';
import aiAssistantRoutes from './routes/aiAssistant.js';

// Dashboard Routes
import dashboardLandfillRoutes from './routes/dashboard/landfill.js';

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ✅ IMPORTANT (Render / reverse proxy): needed for express-rate-limit + req.ip
app.set('trust proxy', 1);

// ============================================================
// SECURITY HEADERS — helmet
// ============================================================
app.use(helmet({
  // Permite încărcarea fonturilor și imaginilor din același origin
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  // HSTS — spune browserului să folosească HTTPS minim 1 an
  hsts: IS_PROD ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  // Previne clickjacking
  frameguard: { action: 'deny' },
  // Previne MIME sniffing
  noSniff: true,
  // Referrer policy strictă
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ============================================================
// CORS
// ============================================================
const allowedOrigins = [
  // Producție — URL fix din env var
  process.env.FRONTEND_URL || 'https://waste-frontend-5c3xzpmvc.vercel.app',
  // Development local
  'http://localhost:5173',
  // Vercel preview deployments (waste-frontend-*.vercel.app)
  /^https:\/\/waste-frontend-[a-z0-9-]+\.vercel\.app$/,
  // StackBlitz WebContainer (dev)
  /\.webcontainer\.io$/,
  /\.local-credentialless\.webcontainer\.io$/,
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ============================================================
// BODY PARSER — cu limită explicită
// ============================================================
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ============================================================
// RATE LIMITING GLOBAL — protecție împotriva abuzului
// ============================================================
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minute
  max: 300,                    // 300 request-uri per IP per fereastră
  message: {
    success: false,
    message: 'Prea multe cereri. Te rugăm să încerci din nou în 15 minute.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health', // health check nu e limitat
});
app.use(globalLimiter);

// Rate limiter mai strict pentru endpoint-uri de export (consum mare de resurse)
const exportLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minut
  max: 10,              // max 10 exporturi pe minut per IP
  message: {
    success: false,
    message: 'Prea multe exporturi. Te rugăm să aștepți un minut.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================
// LOGGING — minimal în producție
// ============================================================
app.use((req, res, next) => {
  if (!IS_PROD) {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ============================================================
// ROOT
// ============================================================
app.get('/', (req, res) => {
  res.json({
    message: 'WasteApp Backend API',
    version: '1.0.0',
  });
});

// ============================================================
// API ROUTES
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/tmb', tmbRoutes);
app.use('/api/tickets/landfill', landfillTicketRoutes);
app.use('/api/tickets/tmb', tmbTicketRoutes);
app.use('/api/tickets/recycling', recyclingTicketRoutes);
app.use('/api/tickets/recovery', recoveryTicketRoutes);
app.use('/api/tickets/disposal', disposalTicketRoutes);
app.use('/api/tickets/rejected', rejectedTicketRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/reports/tmb', reportTmbRoutes);
app.use('/api/reports/landfill', reportLandfillRoutes);
app.use('/api/contracts', contractFilesRoutes);
app.use('/api/waste-codes', wasteCodesRoutes);
app.use('/api/sectors', sectorsRoutes);

// Export routes — rate limiter mai strict
app.use('/api/contracts', exportLimiter, contractExportRoutes);

app.use('/api/stats', statsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/ai', aiAssistantRoutes);
app.use('/api/dashboard/landfill', dashboardLandfillRoutes);
app.use('/api/dashboard/tmb', tmbDashboardRoutes);

// ============================================================
// 404 HANDLER
// ============================================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
  });
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  // Nu expunem detalii de eroare în producție
  if (IS_PROD) {
    console.error(`[ERROR] ${req.method} ${req.path} —`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Eroare internă server',
    });
  }
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Eroare internă server',
  });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Server pornit pe portul ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});