import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pool, { testConnection, ensureSchema } from './config/database.js';
import ragRoutes from './routes/rag.js';

process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled rejection:', err.message || err);
});

const app = express();

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id']
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: false }));

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

const REQUIRED_ENV = ['GROQ_API_KEY', 'DATABASE_URL', 'JINA_API_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

let schemaReady = false;
const initDb = async () => {
  try {
    await testConnection();
    await ensureSchema();
    schemaReady = true;
  } catch (err) {
    console.warn('⚠️ DB not ready yet (Neon cold start) — will retry on first request');
  }
};
await initDb();

app.use(async (req, res, next) => {
  if (!schemaReady) {
    try {
      await ensureSchema();
      schemaReady = true;
    } catch {
      return res.status(503).json({ error: 'Database is waking up — try again in a few seconds' });
    }
  }
  next();
});

app.get('/api/health', async (req, res) => {
  const dbConnected = await testConnection();
  res.json({
    status: dbConnected ? 'ok' : 'degraded',
    llm: process.env.GROQ_API_KEY ? 'configured' : 'not configured',
    database: dbConnected ? 'connected' : 'disconnected',
    databaseMessage: dbConnected ? 'Neon is reachable' : 'Neon unreachable — check DATABASE_URL',
    mode: 'RAG (Retrieval Augmented Generation)',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/rag', ragRoutes);

export default app;
