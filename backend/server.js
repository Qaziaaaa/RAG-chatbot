import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getChatResponse } from './services/llm.js';
import { supabase, testConnection } from './config/database.js';
import ragRoutes from './routes/rag.js';

const app = express();
const PORT = process.env.PORT || 3000;

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

// HTTPS redirect in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// Validate required env vars on startup
const REQUIRED_ENV = ['GROQ_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JINA_API_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// Test database connection on startup
testConnection();

// Health check
app.get('/api/health', async (req, res) => {
  const dbConnected = await testConnection();
  res.json({ 
    status: 'ok', 
    llm: process.env.GROQ_API_KEY ? 'configured' : 'not configured',
    database: dbConnected ? 'connected' : 'disconnected',
    mode: 'RAG (Retrieval Augmented Generation)'
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const reply = await getChatResponse(message);

    res.json({
      reply,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Chat error:', error.message);

    // Return user-friendly error
    const statusCode = error.status === 401 ? 401 : 503;
    const errorMessage = error.status === 401
      ? 'Invalid API key. Check your .env file.'
      : 'AI service temporarily unavailable. Please try again.';

    res.status(statusCode).json({
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

// RAG routes (new)
app.use('/api/rag', ragRoutes);

// ── Supabase keep-alive ──────────────────────────────────────────────────────
// Supabase free tier pauses projects after 7 days of inactivity.
// This pings the DB every 3 days to keep it active.
// Only runs when the server is deployed (not in local dev).
if (process.env.NODE_ENV === 'production') {
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await supabase.from('documents').select('count', { count: 'exact', head: true });
      console.log('✅ Supabase keep-alive ping sent');
    } catch (err) {
      console.warn('⚠️ Keep-alive ping failed:', err.message);
    }
  }, THREE_DAYS_MS);
}

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`🤖 LLM: Groq (${process.env.LLM_MODEL || 'llama-3.1-8b-instant'})`);
  console.log(`💾 Database: Supabase (pgvector)`);
  console.log(`📚 Mode: RAG (Retrieval Augmented Generation)`);
  console.log(`\n📖 API Endpoints:`);
  console.log(`   POST /api/rag/chat      - RAG chat with retrieval`);
  console.log(`   POST /api/rag/documents  - Upload documents`);
  console.log(`   POST /api/rag/seed       - Seed with sample FAQs`);
  console.log(`   GET  /api/rag/stats      - Knowledge base stats\n`);
});
