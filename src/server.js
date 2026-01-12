// src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
import tmbRoutes from './routes/tmb/tmb.js';
import contractFilesRoutes from './routes/contractFiles.js';
import wasteCodesRoutes from './routes/wasteCodes.js';
import sectorsRoutes from './routes/sectors.js'; // ✅ ACTUALIZAT

// Dashboard Routes
import dashboardLandfillRoutes from './routes/dashboard/landfill.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ IMPORTANT (Render / reverse proxy): needed for express-rate-limit + req.ip
app.set('trust proxy', 1);

// CORS
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://waste-frontend-fqxsi7il3.vercel.app',
    /\.webcontainer\.io$/,
    /\.local-credentialless\.webcontainer\.io$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root
app.get('/', (req, res) => {
  res.json({ 
    message: 'WasteApp Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      users: '/api/users/*',
      institutions: '/api/institutions/*',
      tmb: '/api/tmb/*',
      reports: '/api/reports/*',
      contracts: '/api/contracts/*',
      wasteCodes: '/api/waste-codes/*',
      sectors: '/api/sectors/*' // ✅ ACTUALIZAT
    }
  });
});

// API Routes
console.log('📍 Mounting auth routes at /api/auth');
app.use('/api/auth', authRoutes);

console.log('📍 Mounting user routes at /api/users');
app.use('/api/users', userRoutes);

console.log('📍 Mounting institution routes at /api/institutions');
app.use('/api/institutions', institutionRoutes);

console.log('📍 Mounting TMB routes at /api/tmb');
app.use('/api/tmb', tmbRoutes);

console.log('📍 Mounting landfill ticket routes at /api/tickets/landfill');
app.use('/api/tickets/landfill', landfillTicketRoutes);

console.log('📍 Mounting TMB ticket routes at /api/tickets/tmb');
app.use('/api/tickets/tmb', tmbTicketRoutes);

console.log('📍 Mounting recycling ticket routes at /api/tickets/recycling');
app.use('/api/tickets/recycling', recyclingTicketRoutes);

console.log('📍 Mounting recovery ticket routes at /api/tickets/recovery');
app.use('/api/tickets/recovery', recoveryTicketRoutes);

console.log('📍 Mounting disposal ticket routes at /api/tickets/disposal');
app.use('/api/tickets/disposal', disposalTicketRoutes);

console.log('📍 Mounting rejected ticket routes at /api/tickets/rejected');
app.use('/api/tickets/rejected', rejectedTicketRoutes);

console.log('📍 Mounting reports routes at /api/reports');
app.use('/api/reports', reportsRoutes);

console.log('📍 Mounting TMB reports routes at /api/reports/tmb');
app.use('/api/reports/tmb', reportTmbRoutes);

console.log('📍 Mounting contract files routes at /api/contracts');
app.use('/api/contracts', contractFilesRoutes);

console.log('📍 Mounting waste codes routes at /api/waste-codes');
app.use('/api/waste-codes', wasteCodesRoutes);

console.log('📍 Mounting sectors routes at /api/sectors'); // ✅ ACTUALIZAT
app.use('/api/sectors', sectorsRoutes); // ✅ ACTUALIZAT

// Dashboard Routes
console.log('📍 Mounting dashboard landfill routes at /api/dashboard/landfill');
app.use('/api/dashboard/landfill', dashboardLandfillRoutes);

console.log('📍 Mounting TMB dashboard routes at /api/dashboard/tmb');
app.use('/api/dashboard/tmb', tmbDashboardRoutes);

// Debug - list all routes
console.log('📋 Registered routes:');
app._router.stack.forEach((middleware) => {
  if (middleware.route) {
    console.log(`  ${Object.keys(middleware.route.methods)} ${middleware.route.path}`);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});