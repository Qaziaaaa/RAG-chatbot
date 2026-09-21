/**
 * Document Ingestion Service
 *
 * Handles the full pipeline for user-uploaded files:
 *   1. Extract text  (plain text or PDF)
 *   2. Chunk text    (sentence-aware, size-adaptive)
 *   3. Embed chunks  (Jina AI, batched)
 *   4. Store in DB   (documents + document_chunks tables)
 *
 * Processing is async — the upload endpoint returns a jobId immediately,
 * and the caller polls GET /api/rag/upload/:jobId for status.
 */

import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database.js';
import { processDocument } from './chunker.js';
import { prepareChunksBatch } from './embeddings.js';

// In-memory job store
const jobs = new Map();

// ── Job management ──────────────────────────────────────────────────────────

export function createJob(filename, fileType, userId = null) {
    const jobId = uuidv4();
    jobs.set(jobId, {
        jobId, filename, fileType, userId,
        status: 'pending', documentId: null, chunksCreated: 0,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    return jobId;
}

export function getJob(jobId) {
    return jobs.get(jobId) || null;
}

function updateJob(jobId, patch) {
    const job = jobs.get(jobId);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

// Evict completed/failed jobs older than 1 hour
setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, job] of jobs.entries()) {
        if (['done', 'failed'].includes(job.status) && new Date(job.createdAt).getTime() < cutoff) {
            jobs.delete(id);
        }
    }
}, 15 * 60 * 1000);

// ── Text extraction ─────────────────────────────────────────────────────────

/**
 * Sanitize text by removing/replacing control characters that cause
 * "unsupported Unicode escape sequence" errors in PostgreSQL JSON parsing.
 * Removes: null bytes, BOM, Unicode control chars (U+0000-U+001F, U+007F-U+009F)
 * Preserves: newlines, tabs, and printable characters.
 */
function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    // Remove BOM
    let clean = text.replace(/^\uFEFF/, '');
    // Replace null bytes and other control chars with space (preserve \n, \t, \r)
    clean = clean.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');
    // Collapse multiple spaces but preserve intentional newlines
    clean = clean.replace(/[ \t]+/g, ' ');
    return clean.trim();
}

export async function extractText(buffer, mimeType, filename) {
    const ext = filename.split('.').pop().toLowerCase();

    if (mimeType === 'application/pdf' || ext === 'pdf') {
        return extractPdfText(buffer);
    }

    if (mimeType === 'application/json' || ext === 'json') {
        return extractJsonText(buffer);
    }

    return sanitizeText(buffer.toString('utf-8'));
}

async function extractPdfText(buffer) {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const data = await pdfParse(buffer);

    let text = data.text;
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/^[\s\-–—]*\d+[\s\-–—]*$/gm, '');
    text = text.replace(/[ \t]+/g, ' ');

    return sanitizeText(text.trim());
}

function extractJsonText(buffer) {
    try {
        const obj = JSON.parse(buffer.toString('utf-8'));
        return flattenJson(obj);
    } catch {
        return buffer.toString('utf-8');
    }
}

function flattenJson(obj, prefix = '') {
    if (typeof obj !== 'object' || obj === null) {
        return prefix ? `${prefix}: ${obj}` : String(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map((item, i) => flattenJson(item, prefix ? `${prefix}[${i}]` : `[${i}]`)).join('\n');
    }
    return Object.entries(obj)
        .map(([k, v]) => flattenJson(v, prefix ? `${prefix}.${k}` : k))
        .join('\n');
}

// ── Main ingestion pipeline ─────────────────────────────────────────────────

export function processUploadAsync(jobId, buffer, filename, mimeType) {
    const job = jobs.get(jobId);
    const userId = job?.userId || null;
    _runIngestion(jobId, buffer, filename, mimeType, userId).catch(err => {
        console.error(`❌ Ingestion job ${jobId} crashed:`, err.message);
        updateJob(jobId, { status: 'failed', error: err.message });
    });
}

async function _runIngestion(jobId, buffer, filename, mimeType, userId = null) {
    updateJob(jobId, { status: 'processing' });
    console.log(`📥 Ingestion job ${jobId}: "${filename}" (user: ${userId || 'anonymous'})`);

    console.log('  1. Extracting text...');
    const text = await extractText(buffer, mimeType, filename);
    if (!text || text.trim().length < 10) {
        throw new Error('Could not extract meaningful text from file');
    }
    console.log(`  ✓ Extracted ${text.length} chars`);

    const documentId = uuidv4();
    const title = filename.replace(/\.[^.]+$/, '');
    const fileType = mimeType === 'application/pdf' ? 'pdf' : 'text';

    const { error: docErr } = await pool.query(
        `INSERT INTO documents (id, title, content, source, user_id, file_type, file_size, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [documentId, title, text, filename, userId, fileType, buffer.length,
         JSON.stringify({ originalFilename: filename, mimeType, fileType, fileSize: buffer.length, uploadedAt: new Date().toISOString() })]
    );
    if (docErr) throw new Error(`DB insert failed: ${docErr.message}`);
    console.log(`  ✓ Document record: ${documentId}`);

    console.log('  2. Chunking...');
    const chunks = processDocument({ title, content: sanitizeText(text), source: filename });
    console.log(`  ✓ ${chunks.length} chunks`);
    if (chunks.length === 0) throw new Error('No chunks produced — document may be empty');

    console.log('  3. Embedding and storing...');
    const BATCH_SIZE = 20;
    let stored = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const withEmbeddings = await prepareChunksBatch(batch, documentId);

        for (const chunk of withEmbeddings) {
            const safeContent = sanitizeText(chunk.content);
            const { error: chunkErr } = await pool.query(
                `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [chunk.id, chunk.document_id, chunk.chunk_index, safeContent,
                 JSON.stringify(chunk.embedding), JSON.stringify(chunk.metadata)]
            );
            if (chunkErr) throw new Error(`Chunk insert failed: ${chunkErr.message}`);
        }

        stored += withEmbeddings.length;
        console.log(`  ✓ Stored batch ${Math.floor(i / BATCH_SIZE) + 1} (${stored}/${chunks.length} chunks)`);
    }

    updateJob(jobId, { status: 'done', documentId, chunksCreated: stored });
    console.log(`✅ Ingestion job ${jobId} complete: ${stored} chunks stored`);
}
