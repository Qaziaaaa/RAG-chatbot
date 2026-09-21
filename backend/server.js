import app from './app.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`🤖 LLM: Groq (${process.env.LLM_MODEL || 'qwen/qwen3.8-27b'})`);
  console.log(`💾 Database: Neon (PostgreSQL + pgvector)`);
  console.log(`📚 Mode: RAG (Retrieval Augmented Generation)`);
  console.log(`\n📖 API Endpoints:`);
  console.log(`   POST /api/rag/chat      - RAG chat with retrieval`);
  console.log(`   POST /api/rag/documents  - Upload documents`);
  console.log(`   POST /api/rag/seed       - Seed with sample FAQs`);
  console.log(`   GET  /api/rag/stats      - Knowledge base stats\n`);
});
