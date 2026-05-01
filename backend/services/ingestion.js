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
 *
 * WHY async?
 *   A 50-page PDF can produce 200+ chunks. Each Jina batch call takes ~1s.
 *   Blocking the HTTP request for 30-60s would time out most clients.
 *   Returning a jobId immediately keeps the API responsive.
 *
 * Chunking strategy for PDFs:
 *   PDFs often have inconsistent whitespace, headers, footers, and page
 *   numbers baked into the text stream. We:
 *     1. Collapse runs of whitespace / newlines
 *     2. Strip common noise patterns (page numbers, headers)
 *     3. Apply the same sentence-aware chunker used for plain text
 *   This is simpler and more robust than trying to parse PDF structure.
 *   For structured PDFs (tables, columns) a layout-aware parser like
 *   pdfplumber would be better, but that requires Python — overkill here.
 */

import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/database.js';
import { processDocument } from './chunker.js';
import { prepareChunksBatch } from './embeddings.js';

// In-memory job store — good enough for a single-server deployment.
// For multi-instance, move this to the upload_jobs Supabase table.
const jobs = new Map();

// ── Job management ──────────────────────────────────────────────────────────

export function createJob(filename, fileType, userId = null) {
    const jobId = uuidv4();
    jobs.set(jobId, {
        jobId,
        filename,
        fileType,
        userId,
        status: 'pending',
        documentId: null,
        chunksCreated: 0,
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

// Evict completed/failed jobs older than 1 hour to prevent memory leak
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
 * Extract plain text from a file buffer.
 * Supports: .txt, .md, .json, .pdf
 *
 * @param {Buffer} buffer   - Raw file bytes
 * @param {string} mimeType - MIME type from multer
 * @param {string} filename - Original filename (used for fallback detection)
 * @returns {Promise<string>} - Extracted text
 */
export async function extractText(buffer, mimeType, filename) {
    const ext = filename.split('.').pop().toLowerCase();

    if (mimeType === 'application/pdf' || ext === 'pdf') {
        return extractPdfText(buffer);
    }

    if (mimeType === 'application/json' || ext === 'json') {
        return extractJsonText(buffer);
    }

    // Plain text, markdown, CSV, etc.
    return buffer.toString('utf-8');
}

/**
 * Extract text from a PDF buffer using pdf-parse.
 *
 * PDF chunking strategy:
 *   Raw PDF text streams contain page breaks, headers, footers, and
 *   inconsistent spacing. We clean it up in three passes:
 *     1. Collapse 3+ consecutive newlines → double newline (paragraph break)
 *     2. Remove lines that are purely numeric (page numbers)
 *     3. Collapse runs of spaces/tabs to a single space
 *   The result is clean prose that the sentence-aware chunker handles well.
 */
async function extractPdfText(buffer) {
    // Dynamic import avoids the test-file side-effect on module load
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const data = await pdfParse(buffer);

    let text = data.text;

    // Pass 1: normalise paragraph breaks
    text = text.replace(/\n{3,}/g, '\n\n');

    // Pass 2: drop pure page-number lines (e.g. "  42  " or "- 42 -")
    text = text.replace(/^[\s\-–—]*\d+[\s\-–—]*$/gm, '');

    // Pass 3: collapse horizontal whitespace
    text = text.replace(/[ \t]+/g, ' ');

    return text.trim();
}

/**
 * Flatten a JSON object/array into readable key: value lines.
 * Useful for ingesting structured data (FAQs, configs, etc.)
 */
function extractJsonText(buffer) {
    try {
        const obj = JSON.parse(buffer.toString('utf-8'));
        return flattenJson(obj);
    } catch {
        // If it's not valid JSON, treat as plain text
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

/**
 * Process an uploaded file asynchronously.
 * Returns immediately — caller polls getJob(jobId) for status.
 *
 * @param {string} jobId    - Job ID created by createJob()
 * @param {Buffer} buffer   - File bytes
 * @param {string} filename - Original filename
 * @param {string} mimeType - MIME type
 */
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

    const { error: docErr } = await supabase.from('documents').insert({
        id: documentId,
        title,
        content: text,
        source: filename,
        user_id: userId,   // ← scoped to this user
        metadata: {
            originalFilename: filename,
            mimeType,
            fileType,
            fileSize: buffer.length,
            uploadedAt: new Date().toISOString()
        }
    });
    if (docErr) throw new Error(`DB insert failed: ${docErr.message}`);
    console.log(`  ✓ Document record: ${documentId}`);

    console.log('  2. Chunking...');
    const chunks = processDocument({ title, content: text, source: filename });
    console.log(`  ✓ ${chunks.length} chunks`);
    if (chunks.length === 0) throw new Error('No chunks produced — document may be empty');

    console.log('  3. Embedding and storing...');
    const BATCH_SIZE = 20;
    let stored = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const withEmbeddings = await prepareChunksBatch(batch, documentId);
        const { error: chunkErr } = await supabase.from('document_chunks').insert(withEmbeddings);
        if (chunkErr) throw new Error(`Chunk insert failed: ${chunkErr.message}`);
        stored += withEmbeddings.length;
        console.log(`  ✓ Stored batch ${Math.floor(i / BATCH_SIZE) + 1} (${stored}/${chunks.length} chunks)`);
    }

    updateJob(jobId, { status: 'done', documentId, chunksCreated: stored });
    console.log(`✅ Ingestion job ${jobId} complete: ${stored} chunks stored`);
}
