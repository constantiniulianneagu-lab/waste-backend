// src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import institutionRoutes from './routes/institutions.js';  // ← Adaugă import
import landfillTicketRoutes from './routes/tickets/landfill.js';
import tmbTicketRoutes from './routes/tickets/tmb.js';
import recyclingTicketRoutes from './routes/tickets/recycling.js';
import recoveryTicketRoutes from './routes/tickets/recovery.js';
import disposalTicketRoutes from './routes/tickets/disposal.js';
import rejectedTicketRoutes from './routes/tickets/rejected.js';
// Dashboard Routes
import dashboardLandfillRoutes from './routes/dashboard/landfill.js'; // 🆕 NOU

const app = express();
const PORT = process.env.PORT || 3000;


// CORS - permite origin-uri specifice
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://waste-frontend-lp77kl82h.vercel.app',
    /\.webcontainer\.io$/,  // ✅ Permite toate subdomeniile .webcontainer.io
    /\.local-credentialless\.webcontainer\.io$/  // ✅ Specific pentru local credentialless
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
      institutions: '/api/institutions/*'  // ← Adaugă
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

// Dashboard Routes
console.log('📍 Mounting dashboard landfill routes at /api/dashboard/landfill');
app.use('/api/dashboard/landfill', dashboardLandfillRoutes);

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