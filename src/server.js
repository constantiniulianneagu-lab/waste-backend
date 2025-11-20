// src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import institutionRoutes from './routes/institutions.js';  // ← Adaugă import

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - permite origin-uri specifice
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://waste-frontend-bw2zg5rry.vercel.app',
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