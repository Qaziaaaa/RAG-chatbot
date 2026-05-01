/**
 * Document Chunking Service
 *
 * Handles two distinct chunking strategies:
 *
 * 1. TEXT chunking  — sentence-aware sliding window (prose, markdown, PDFs)
 * 2. CODE chunking  — structure-aware splitting that respects function/class
 *                     boundaries and preserves fenced code blocks intact
 *
 * ── Why different strategies for code vs text? ──────────────────────────────
 *
 * Plain text:
 *   Meaning is carried in sentences and paragraphs. Splitting at sentence
 *   boundaries preserves semantic units. A 350-char window (~88 tokens) is
 *   the sweet spot for embedding models.
 *
 * Code:
 *   Meaning is carried in functions, classes, and blocks. Splitting mid-
 *   function destroys context — the embedding model sees an incomplete
 *   function and can't understand what it does. We instead:
 *     1. Try to split at top-level function/class boundaries (blank line
 *        before a `function`, `class`, `def`, `const X =`, `export` etc.)
 *     2. Use larger chunks (600 chars) because code is denser than prose
 *     3. Keep more overlap (120 chars) to preserve import/context lines
 *     4. Never split inside a fenced code block (``` ... ```)
 *
 * Markdown:
 *   Treated as text but with heading-aware splitting — we prefer to split
 *   at `##` / `###` headings so each chunk covers one topic section.
 */

// ── Configuration ────────────────────────────────────────────────────────────

const TEXT_CONFIG = {
    chunkSize: 350,
    chunkOverlap: 70,
    separators: ['\n\n', '\n', '. ', '? ', '! ', ' ']
};

const MARKDOWN_CONFIG = {
    chunkSize: 400,
    chunkOverlap: 80,
    // Prefer heading boundaries, then paragraphs, then sentences
    separators: ['\n## ', '\n### ', '\n#### ', '\n\n', '\n', '. ', ' ']
};

const CODE_CONFIG = {
    chunkSize: 600,    // code is denser — larger window needed
    chunkOverlap: 120, // keep imports/context visible in adjacent chunks
    // Prefer blank-line-before-definition boundaries
    separators: ['\n\n', '\n}', '\n  }', '\n    }', '\n']
};

// File extensions that should use code chunking
const CODE_EXTENSIONS = new Set([
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
    'py', 'go', 'rs', 'java', 'c', 'cpp', 'cs',
    'rb', 'php', 'swift', 'kt', 'scala',
    'sh', 'bash', 'zsh',
    'sql', 'graphql', 'gql'
]);

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect content type from filename extension.
 * @param {string} filename
 * @returns {'code' | 'markdown' | 'text'}
 */
export function detectContentType(filename = '') {
    const ext = filename.split('.').pop().toLowerCase();
    if (CODE_EXTENSIONS.has(ext)) return 'code';
    if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
    return 'text';
}

/**
 * Process a document into chunks, choosing the right strategy automatically.
 * @param {Object} document - { title, content, source, metadata }
 * @returns {Array} - Chunks with document reference and contentType metadata
 */
export function processDocument(document) {
    const { title, content, source = '', metadata = {} } = document;
    const contentType = detectContentType(source || title || '');

    let chunks;
    if (contentType === 'code') {
        chunks = chunkCode(content);
    } else if (contentType === 'markdown') {
        chunks = chunkDocument(content, getOptimalChunkingConfig(content, MARKDOWN_CONFIG));
    } else {
        chunks = chunkDocument(content, getOptimalChunkingConfig(content));
    }

    return chunks.map(chunk => ({
        ...chunk,
        documentTitle: title,
        documentSource: source,
        documentMetadata: metadata,
        contentType  // stored in chunk metadata for prompt building
    }));
}

/**
 * Split plain text / markdown into chunks using sliding window.
 * @param {string} text
 * @param {Object} config
 * @returns {Array<{content, index, metadata}>}
 */
export function chunkDocument(text, config = {}) {
    const { chunkSize, chunkOverlap, separators } = { ...TEXT_CONFIG, ...config };

    if (!text || text.trim().length === 0) return [];

    const chunks = [];
    let remaining = text.trim();
    let idx = 0;

    while (remaining.length > 0) {
        let chunk;

        if (remaining.length <= chunkSize) {
            chunk = remaining;
            remaining = '';
        } else {
            chunk = findBestSplit(remaining, chunkSize, separators);
            const advance = Math.max(1, chunk.length - chunkOverlap);
            remaining = remaining.slice(advance).trim();
        }

        if (chunk.trim().length > 0) {
            chunks.push({
                content: chunk.trim(),
                index: idx++,
                metadata: { charCount: chunk.length, wordCount: chunk.split(/\s+/).length }
            });
        }

        if (chunk.length === 0) break; // safety
    }

    return chunks;
}

/**
 * Split code into structure-aware chunks.
 *
 * Strategy:
 *   1. Split on blank lines that precede a top-level definition keyword
 *      (function, class, const, export, def, etc.)
 *   2. If a resulting segment is still too large, fall back to the generic
 *      sliding window with CODE_CONFIG separators
 *   3. Never split inside a fenced code block (``` ... ```)
 *
 * WHY this matters for RAG:
 *   A chunk containing a complete function is far more useful than half a
 *   function. The embedding captures "what this function does" rather than
 *   "the middle of some unknown function".
 *
 * @param {string} code
 * @returns {Array<{content, index, metadata}>}
 */
export function chunkCode(code) {
    if (!code || code.trim().length === 0) return [];

    // Split into logical segments at top-level definition boundaries
    const segments = splitAtDefinitions(code);
    const chunks = [];
    let idx = 0;

    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        if (trimmed.length <= CODE_CONFIG.chunkSize) {
            chunks.push({
                content: trimmed,
                index: idx++,
                metadata: { charCount: trimmed.length, wordCount: trimmed.split(/\s+/).length, isCode: true }
            });
        } else {
            // Segment too large — sub-chunk it with code separators
            const subChunks = chunkDocument(trimmed, CODE_CONFIG);
            for (const sc of subChunks) {
                chunks.push({
                    ...sc,
                    index: idx++,
                    metadata: { ...sc.metadata, isCode: true }
                });
            }
        }
    }

    return chunks;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Split code at blank lines that precede a top-level definition.
 * Handles JS/TS, Python, Go, Rust, Java, etc.
 */
function splitAtDefinitions(code) {
    // Regex: blank line followed by a line starting with a definition keyword
    // Covers: function, class, const/let/var X =, export, def, type, interface,
    //         impl, struct, enum, public/private/protected, async function, etc.
    const DEFINITION_RE = /\n\n(?=[ \t]*(export\s+)?(default\s+)?(async\s+)?(function|class|const|let|var|def|type|interface|impl|struct|enum|public|private|protected|abstract|static)\b)/g;

    const parts = code.split(DEFINITION_RE);

    // The regex split may produce empty strings or just the captured groups —
    // filter and rejoin any fragments that are too small to be meaningful
    const segments = [];
    let buffer = '';

    for (const part of parts) {
        if (!part) continue;
        buffer += (buffer ? '\n\n' : '') + part;

        // Flush buffer when it's a reasonable size
        if (buffer.length >= 100) {
            segments.push(buffer);
            buffer = '';
        }
    }

    if (buffer.trim()) segments.push(buffer);

    // If no splits happened (e.g. a single large function), return as-is
    return segments.length > 0 ? segments : [code];
}

function findBestSplit(text, maxLength, separators) {
    for (const sep of separators) {
        const idx = text.lastIndexOf(sep, maxLength);
        if (idx !== -1 && idx > maxLength * 0.4) {
            return text.slice(0, idx + sep.length).trim();
        }
    }
    return text.slice(0, maxLength).trim();
}

// ── Size-adaptive config ─────────────────────────────────────────────────────

export function getOptimalChunkingConfig(text, baseConfig = TEXT_CONFIG) {
    const len = text.length;
    if (len < 200) return { ...baseConfig, chunkSize: len + 50, chunkOverlap: 0 };
    if (len < 2000) return baseConfig;
    // Large docs: slightly bigger chunks to reduce total count
    return { ...baseConfig, chunkSize: Math.round(baseConfig.chunkSize * 1.3), chunkOverlap: Math.round(baseConfig.chunkOverlap * 1.3) };
}

export function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}

export function getChunkingStats(text, chunks) {
    return {
        originalLength: text.length,
        totalChunks: chunks.length,
        averageChunkSize: Math.round(text.length / Math.max(chunks.length, 1)),
        estimatedTokens: estimateTokens(text)
    };
}
