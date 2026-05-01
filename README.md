# AI Knowledge Assistant — RAG Chatbot

A full-stack AI chatbot that lets you upload your own documents and ask questions about them. Built with **Retrieval-Augmented Generation (RAG)** — the AI only answers from your uploaded files, not from general knowledge.

![Tech Stack](https://img.shields.io/badge/Node.js-Express-green) ![Supabase](https://img.shields.io/badge/Supabase-pgvector-blue) ![Groq](https://img.shields.io/badge/Groq-LLM-orange) ![React](https://img.shields.io/badge/React-Vite-cyan)

---

## What It Does

- **Upload documents** — PDF, TXT, Markdown, JSON, and code files (JS, TS, Python, Go, etc.)
- **Ask questions** — The AI searches your documents and answers based only on what's in them
- **See sources** — Every answer shows which document it came from and how relevant it was
- **Streaming responses** — Answers appear word-by-word like ChatGPT
- **User accounts** — Sign up with email to keep your documents across devices and sessions
- **Three answer modes** — Normal, Simple (beginner-friendly), or Detailed (in-depth)
- **Conversation memory** — The AI remembers the last few messages in your session

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Database | Supabase (PostgreSQL + pgvector) |
| LLM | Groq API (llama-3.1-8b-instant) |
| Embeddings | Jina AI (jina-embeddings-v2-base-en, 768-dim) |
| Auth | Supabase Auth (email/password) |
| Streaming | Server-Sent Events (SSE) |

---

## Project Structure

```
RAG/
├── backend/
│   ├── server.js                  # Express server entry point
│   ├── package.json
│   ├── .env.example               # Environment variable template
│   ├── config/
│   │   └── database.js            # Supabase client setup
│   ├── database/
│   │   ├── schema.sql             # Initial database schema
│   │   ├── schema_v2_migration.sql  # Adds file_type, upload_jobs, doc filtering
│   │   └── schema_v3_migration.sql  # Adds user_id for per-user data isolation
│   ├── routes/
│   │   └── rag.js                 # All API endpoints
│   └── services/
│       ├── rag.js                 # RAG pipeline (embed → search → answer)
│       ├── embeddings.js          # Jina AI embedding generation
│       ├── chunker.js             # Document chunking (text + code-aware)
│       ├── documents.js           # Document CRUD operations
│       ├── ingestion.js           # Async file upload processing
│       └── llm.js                 # Groq LLM client
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                # Main React app
│   │   ├── App.css                # Sovereign Intelligence design system
│   │   ├── supabase.js            # Supabase auth client
│   │   └── main.jsx
│   ├── .env                       # Frontend env (Supabase public keys)
│   ├── .env.example
│   └── vite.config.js
│
├── package.json                   # Root — runs both servers with concurrently
└── README.md
```

---

## Getting Started

### Prerequisites

You need free accounts on:
- [Supabase](https://supabase.com) — database and auth
- [Groq](https://console.groq.com/keys) — LLM API
- [Jina AI](https://jina.ai/api-dashboard/key-manager) — embeddings API

### 1. Clone the repository

```bash
git clone https://github.com/Qaziaaaa/RAG-chatbot.git
cd RAG-chatbot
```

### 2. Set up the database

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase dashboard
3. Run the migrations in order:
   - `backend/database/schema.sql` — creates base tables
   - `backend/database/schema_v2_migration.sql` — adds file upload support
   - `backend/database/schema_v3_migration.sql` — adds per-user data isolation

### 3. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
# Groq — get free key at https://console.groq.com/keys
GROQ_API_KEY=your_groq_key_here
LLM_MODEL=llama-3.1-8b-instant

# Supabase — from your project Settings → API
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Jina AI — get free key at https://jina.ai/api-dashboard/key-manager
JINA_API_KEY=your_jina_key_here
```

### 4. Configure the frontend

```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env`:

```env
# Supabase public keys (safe to expose in frontend)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### 5. Install dependencies

```bash
# From the root folder
npm install          # installs concurrently
npm run install:all  # installs backend + frontend dependencies
```

### 6. Run the app

```bash
# From the root folder — starts both backend and frontend
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

---

## How It Works

### RAG Pipeline

```
User asks a question
        ↓
Generate embedding for the question (Jina AI, 768-dim vector)
        ↓
Search Supabase pgvector for similar document chunks
        ↓
Retrieve top-5 most relevant chunks
        ↓
Build a prompt: system instructions + retrieved context + question
        ↓
Stream the answer from Groq LLM token by token
        ↓
Display answer + source documents with relevance scores
```

### Why RAG instead of just sending all documents?

| | Without RAG | With RAG |
|---|---|---|
| Documents supported | ~10 (token limit) | Thousands |
| Response speed | Slow (huge context) | Fast (small context) |
| API cost | High | Low |
| Accuracy | Lower (noise) | Higher (focused) |

### Document Chunking Strategy

**Plain text / Markdown** — sentence-aware sliding window (350 chars, 70 char overlap)

**Code files** — structure-aware splitting at function/class boundaries so each chunk contains a complete, meaningful unit of code

**PDFs** — text extraction with 3-pass cleanup: normalize whitespace → strip page numbers → collapse horizontal spacing

### User Data Isolation

Each user's documents are stored with their `user_id` in the database. When logged in, the search RPC filters results to only that user's documents. When logged out, an anonymous UUID from `localStorage` is used instead.

---

## API Reference

### Chat (streaming)
```
POST /api/rag/chat/stream
Body: { message, sessionId, userId, mode, documentIds? }
Response: Server-Sent Events stream
  data: {"type":"sources", "sources":[...]}
  data: {"type":"token", "token":"..."}
  data: {"type":"done"}
```

### Upload a file
```
POST /api/rag/upload
Body: multipart/form-data with field "file"
Response: { jobId, filename, fileSize }
```

### Poll upload status
```
GET /api/rag/upload/:jobId
Response: { status: "pending|processing|done|failed", chunksCreated, documentId }
```

### List documents
```
GET /api/rag/documents
Headers: X-User-Id or Authorization: Bearer <token>
Response: { documents: [...], count }
```

### Delete document
```
DELETE /api/rag/documents/:id
Headers: X-User-Id or Authorization: Bearer <token>
```

### Health check
```
GET /api/health
Response: { status, llm, database }
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq LLM API key |
| `LLM_MODEL` | No | Model name (default: `llama-3.1-8b-instant`) |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only) |
| `JINA_API_KEY` | Yes | Jina AI embeddings API key |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Same as backend SUPABASE_URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Same as backend SUPABASE_ANON_KEY |

---

## Free Tier Limits

| Service | Free Tier |
|---|---|
| Groq | 14,400 requests/day, 1M tokens/day |
| Supabase | 500MB database, 50MB file storage |
| Jina AI | 1M tokens free (then pay-as-you-go) |

> **Note:** Supabase free projects pause after 7 days of inactivity. To prevent this, set up a free cron job at [cron-job.org](https://cron-job.org) to ping your `/api/health` endpoint every 3 days.

---

## Deployment

The app is designed to be deployed with:
- **Backend** → [Railway](https://railway.app), [Render](https://render.com), or [Fly.io](https://fly.io)
- **Frontend** → [Vercel](https://vercel.com) or [Netlify](https://netlify.com)

Set `NODE_ENV=production` on the backend. The frontend automatically uses relative API paths in production.

---

## License

MIT
