import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use(cors({
  origin: '*',
  credentials: true
}));

// Body parser
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root
app.get('/', (req, res) => {
  res.json({ message: 'WasteApp Backend API' });
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});