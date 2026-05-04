/**
 * RAG API Routes
 * 
 * Endpoints for:
 * - Chat with RAG (retrieval + generation)
 * - Document management (CRUD)
 * - Knowledge base stats
 */

import express from 'express';
import multer from 'multer';
import { queryRAG, streamRAG, RAGConfig, getCacheStats, clearEmbeddingCache } from '../services/rag.js';
import {
    storeDocument,
    storeDocumentsBatch,
    listDocuments,
    getDocumentWithChunks,
    deleteDocument,
    getStats,
    seedFAQs,
    isValidUserId
} from '../services/documents.js';
import { createJob, getJob, processUploadAsync } from '../services/ingestion.js';
import { supabase } from '../config/database.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// userId middleware
//
// Priority order (highest → lowest):
//   1. Supabase JWT (Authorization: Bearer <token>) — full auth, most secure
//   2. X-User-Id header / body.userId — legacy anonymous UUID (still supported)
//
// This means:
//   - Logged-in users: JWT is verified server-side, user.id used as userId
//   - Anonymous users: their localStorage UUID is used as before
//   - Both work simultaneously — no breaking change
// ---------------------------------------------------------------------------
router.use(async (req, _res, next) => {
    // Try JWT first
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
            // Verify the JWT using the Supabase client (service role can verify any token)
            const { data: { user }, error } = await supabase.auth.getUser(token);
            if (!error && user?.id) {
                req.userId = user.id;   // Supabase Auth UUID
                req.authMethod = 'jwt';
                return next();
            }
        } catch {
            // Invalid token — fall through to legacy method
        }
    }

    // Fall back to legacy anonymous UUID
    const fromBody   = req.body?.userId;
    const fromHeader = req.headers['x-user-id'];
    const raw = fromBody || fromHeader || null;
    req.userId = (raw && isValidUserId(raw)) ? raw : null;
    req.authMethod = req.userId ? 'anonymous' : 'none';
    next();
});

// ── File upload middleware ──────────────────────────────────────────────────
// Memory storage: keep file in RAM as a Buffer — no temp files on disk.
// WHY: Simpler, no cleanup needed, fine for files up to ~10MB.
// Limit: 10MB. Reject anything larger with a clear error.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        const ext = file.originalname.split('.').pop().toLowerCase();
        // Text / doc formats
        const allowedExts = [
            'txt', 'pdf', 'json', 'md', 'mdx', 'csv',
            // Code files
            'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
            'py', 'go', 'rs', 'java', 'c', 'cpp', 'cs',
            'rb', 'php', 'swift', 'kt', 'scala',
            'sh', 'bash', 'sql', 'graphql', 'gql',
            'yaml', 'yml', 'toml', 'env'
        ];
        if (allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type ".${ext}". Allowed: PDF, TXT, MD, JSON, CSV, and common code files (JS, TS, PY, GO, RS, etc.)`));
        }
    }
});

/**
 * POST /api/rag/chat
 * Non-streaming chat — kept for compatibility / fallback
 */
router.post('/chat', async (req, res) => {
    try {
        const { message, topK = 5, sessionId, documentIds, mode = 'normal' } = req.body;
        const userId = req.userId;

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Message is required', timestamp: new Date().toISOString() });
        }

        const result = await queryRAG(message, { topK, sessionId, documentIds, mode, userId });

        res.json({
            reply: result.answer,
            sources: result.sources,
            metadata: result.metadata,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('RAG chat error:', error.message);
        res.status(503).json({ error: 'RAG service temporarily unavailable.', details: error.message, timestamp: new Date().toISOString() });
    }
});

/**
 * POST /api/rag/chat/stream
 * Streaming chat via Server-Sent Events (SSE).
 *
 * Event types sent to the client:
 *   data: {"type":"sources", "sources":[...], "metadata":{...}}  — sent after retrieval
 *   data: {"type":"token",   "token":"..."}                       — one per LLM delta
 *   data: {"type":"done"}                                         — stream complete
 *   data: {"type":"error",   "message":"..."}                     — on failure
 *
 * WHY POST instead of GET for SSE:
 *   Standard SSE uses GET, but we need to send a JSON body (message, mode, etc.).
 *   Using POST with SSE response headers is a common pattern and works fine
 *   through Vite's proxy with the config below.
 *
 * WHY SSE over WebSockets:
 *   - No extra server setup (ws library, upgrade handler)
 *   - Works through standard HTTP proxies including Vite's
 *   - Browser's fetch() ReadableStream API handles it cleanly
 *   - One-way (server→client) is all we need for streaming answers
 */
router.post('/chat/stream', async (req, res) => {
    const { message, topK = 5, sessionId, documentIds, mode = 'normal' } = req.body;
    const userId = req.userId;

    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (payload) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
    };

    // Listen on res (not req) for client disconnect.
    // req 'close' fires when the request body is fully read — too early.
    // res 'close' fires when the client actually disconnects.
    let clientGone = false;
    res.on('close', () => { clientGone = true; });

    try {
        await streamRAG(
            message,
            { topK, sessionId, documentIds, mode, userId },
            {
                onSources: (sources, metadata) => { if (!clientGone) send({ type: 'sources', sources, metadata }); },
                onToken:   (token)             => { if (!clientGone) send({ type: 'token', token }); },
                onError:   (err)               => { if (!clientGone) send({ type: 'error', message: err.message }); }
            }
        );
        if (!clientGone) send({ type: 'done' });
    } catch (err) {
        console.error('Stream endpoint error:', err.message);
        if (!clientGone) send({ type: 'error', message: 'Streaming failed. Please try again.' });
    } finally {
        res.end();
    }
});

/**
 * POST /api/rag/documents
 * Store a new document (single)
 */
router.post('/documents', async (req, res) => {
    try {
        const { title, content, source, metadata } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({
                error: 'Title and content are required'
            });
        }

        const result = await storeDocument({ title, content, source, metadata });
        res.status(201).json(result);

    } catch (error) {
        console.error('Document storage error:', error.message);
        res.status(500).json({
            error: 'Failed to store document',
            details: error.message
        });
    }
});

/**
 * POST /api/rag/documents/batch
 * Store multiple documents
 */
router.post('/documents/batch', async (req, res) => {
    try {
        const { documents } = req.body;
        
        if (!Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({
                error: 'Documents array is required'
            });
        }

        const results = await storeDocumentsBatch(documents);
        res.status(201).json({
            processed: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results
        });

    } catch (error) {
        console.error('Batch storage error:', error.message);
        res.status(500).json({
            error: 'Failed to store documents',
            details: error.message
        });
    }
});

/**
 * GET /api/rag/documents
 * List all documents
 */
router.get('/documents', async (req, res) => {
    try {
        const documents = await listDocuments(req.userId);
        res.json({ documents, count: documents.length });
    } catch (error) {
        console.error('List documents error:', error.message);
        res.status(500).json({ error: 'Failed to list documents' });
    }
});

/**
 * GET /api/rag/documents/:id
 * Get single document with chunks
 */
router.get('/documents/:id', async (req, res) => {
    try {
        const document = await getDocumentWithChunks(req.params.id, req.userId);
        res.json(document);
    } catch (error) {
        console.error('Get document error:', error.message);
        res.status(404).json({ error: 'Document not found' });
    }
});

router.delete('/documents/:id', async (req, res) => {
    try {
        const result = await deleteDocument(req.params.id, req.userId);
        // Clear embedding cache so deleted doc content is not returned in future searches
        clearEmbeddingCache();
        res.json(result);
    } catch (error) {
        console.error('Delete document error:', error.message);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

/**
 * POST /api/rag/seed
 * Seed database with initial FAQs
 */
router.post('/seed', async (req, res) => {
    try {
        const results = await seedFAQs();
        res.status(201).json({
            message: 'Database seeded with FAQs',
            seeded: results.filter(r => r.success).length,
            results
        });
    } catch (error) {
        console.error('Seed error:', error.message);
        res.status(500).json({ error: 'Failed to seed database' });
    }
});

/**
 * GET /api/rag/stats
 * Get knowledge base statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await getStats(req.userId);
        res.json(stats);
    } catch (error) {
        console.error('Stats error:', error.message);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

/**
 * GET /api/rag/config
 * Get RAG system configuration (for monitoring)
 */
router.get('/config', (req, res) => {
    res.json({
        chunking: {
            defaultSize: 350,
            defaultOverlap: 70,
            optimalBySize: true
        },
        retrieval: {
            minSimilarity: RAGConfig.MIN_SIMILARITY,
            maxTopK: RAGConfig.MAX_TOP_K,
            targetTopK: RAGConfig.TARGET_TOP_K,
            confidenceThreshold: RAGConfig.CONFIDENCE_THRESHOLD
        },
        llm: {
            maxTokens: 250,
            temperature: 0.2,
            topP: 0.9
        },
        caching: getCacheStats(),
        performance: {
            maxContextTokens: RAGConfig.MAX_CONTEXT_TOKENS
        }
    });
});

/**
 * POST /api/rag/upload
 * Upload a file (PDF or text). Returns a jobId immediately.
 * Poll GET /api/rag/upload/:jobId for status.
 *
 * WHY async / job-based:
 *   Large PDFs can take 30-60s to embed. Returning a jobId lets the
 *   frontend show a progress indicator without holding the connection open.
 */
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded. Send a multipart/form-data request with field "file".' });
        }

        const { originalname, mimetype, buffer, size } = req.file;
        const userId = req.userId;
        console.log(`📤 Upload: "${originalname}" (${(size / 1024).toFixed(1)} KB, user: ${userId || 'anonymous'})`);

        const jobId = createJob(originalname, mimetype, userId);
        processUploadAsync(jobId, buffer, originalname, mimetype);

        res.status(202).json({
            jobId,
            filename: originalname,
            fileSize: size,
            message: 'Upload accepted. Poll /api/rag/upload/:jobId for status.',
            statusUrl: `/api/rag/upload/${jobId}`
        });

    } catch (err) {
        console.error('Upload error:', err.message);
        res.status(400).json({ error: err.message });
    }
});

/**
 * GET /api/rag/upload/:jobId
 * Poll ingestion job status.
 * Returns: { jobId, status, documentId?, chunksCreated?, error? }
 */
router.get('/upload/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found or expired' });
    }
    res.json(job);
});

export default router;
