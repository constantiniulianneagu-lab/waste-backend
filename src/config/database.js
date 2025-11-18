// src/config/database.js
import pg from 'pg';
const { Pool } = pg;

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necesar pentru Supabase
  }
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Connected to Supabase PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(-1);
});

export default pool;