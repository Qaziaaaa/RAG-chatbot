/**
 * RAG (Retrieval Augmented Generation) Service
 *
 * Pipeline:
 *   1. Embed user query
 *   2. Search similar chunks in Supabase (pgvector)
 *   3. Retrieve top-k most relevant chunks
 *   4. Format context for LLM
 *   5. Generate answer using Groq with conversational memory
 */

import { generateEmbeddings } from './embeddings.js';
import { getChatResponse } from './llm.js';
import { supabase } from '../config/database.js';

// ---------------------------------------------------------------------------
// Embedding cache
// WHY: Same questions repeat; Jina API adds ~500ms latency per call
// ---------------------------------------------------------------------------
const embeddingCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getEmbeddingWithCache(text) {
    const key = text.toLowerCase().trim();
    const cached = embeddingCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('  📦 Using cached embedding');
        return cached.embedding;
    }
    const embedding = await generateEmbeddings(text);
    embeddingCache.set(key, { embedding, timestamp: Date.now() });
    if (embeddingCache.size > 100) {
        embeddingCache.delete(embeddingCache.keys().next().value);
    }
    return embedding;
}

// ---------------------------------------------------------------------------
// Conversational Memory
// ---------------------------------------------------------------------------
// TOKEN BUDGET (Groq llama-3.1-8b-instant, ~8192 token window):
//   System prompt:     ~300 tokens
//   Retrieved context: ~800 tokens  (MAX_CONTEXT_TOKENS)
//   Chat history:      ~600 tokens  (HISTORY_TOKEN_BUDGET)
//   User query:        ~100 tokens
//   Answer headroom:   ~300 tokens
//   Total:            ~2100 tokens  — well within 8192
//
// BEST PRACTICES:
//   1. Sliding window — keep last N turns, not all history
//   2. Cheap token estimation (~4 chars/token) before sending
//   3. Drop oldest pairs first when over budget
//   4. Context always wins — never let history crowd out retrieved facts
//   5. Evict idle sessions to prevent memory leaks
// ---------------------------------------------------------------------------
const sessionStore = new Map();
const MAX_HISTORY_TURNS   = 6;               // 3 user + 3 assistant messages
const HISTORY_TOKEN_BUDGET = 600;
const SESSION_TTL          = 30 * 60 * 1000; // 30 min inactivity

function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}

function getSession(sessionId) {
    const s = sessionStore.get(sessionId);
    if (s) { s.lastActive = Date.now(); return s; }
    const ns = { history: [], lastActive: Date.now() };
    sessionStore.set(sessionId, ns);
    return ns;
}

function appendAndTrimHistory(sessionId, userMsg, assistantMsg) {
    const session = getSession(sessionId);
    session.history.push({ role: 'user',      content: userMsg });
    session.history.push({ role: 'assistant', content: assistantMsg });

    // Hard cap: keep last MAX_HISTORY_TURNS pairs
    if (session.history.length > MAX_HISTORY_TURNS * 2) {
        session.history = session.history.slice(-MAX_HISTORY_TURNS * 2);
    }

    // Token budget: drop oldest pairs until under budget
    while (session.history.length > 0) {
        const total = session.history.reduce((s, m) => s + estimateTokens(m.content), 0);
        if (total <= HISTORY_TOKEN_BUDGET) break;
        session.history.splice(0, 2); // drop oldest user+assistant pair
    }
}

function getHistory(sessionId) {
    if (!sessionId) return [];
    const s = sessionStore.get(sessionId);
    return s ? s.history : [];
}

// Evict stale sessions every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessionStore.entries()) {
        if (now - s.lastActive > SESSION_TTL) sessionStore.delete(id);
    }
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Conversational intent detection
// Detects greetings, meta-questions about the app, and simple chitchat
// so they can be answered without going through the RAG pipeline.
// ---------------------------------------------------------------------------
const GREETING_PATTERNS = /^(hi|hello|hey|howdy|greetings|good\s*(morning|afternoon|evening|day)|what'?s\s*up|sup|yo)\b/i;
const META_PATTERNS = /\b(what (can|do)? ?you do|how (do|can) (i|you)|what are you|who are you|help me|what is (this|docchat)|how does (this|docchat) work|what('?s| is) docchat|tell me about (yourself|you)|what('?s| is) your (purpose|function|job|role))\b/i;
const THANKS_PATTERNS = /^(thanks?|thank you|thx|ty|cheers|great|awesome|perfect|nice|cool|ok|okay|got it|understood|sure)\b/i;

function detectConversationalIntent(query) {
    const q = query.trim().toLowerCase();
    if (GREETING_PATTERNS.test(q)) return 'greeting';
    if (META_PATTERNS.test(q)) return 'meta';
    if (THANKS_PATTERNS.test(q)) return 'thanks';
    return null;
}

function getConversationalResponse(intent) {
    if (intent === 'greeting') {
        return "Hello! I'm DocChat, your AI document assistant. Upload any PDF, text file, or code file using the panel on the left, then ask me anything about it — I'll find the answer from your documents and show you exactly where it came from.";
    }
    if (intent === 'meta') {
        return `I'm **DocChat** — an AI assistant that answers questions based on documents you upload.

Here's what I can do:
- **Summarize** any document you upload
- **Answer questions** about the content of your files
- **Explain code** from uploaded source files
- **Find specific information** across multiple documents
- **Cite sources** — every answer shows which document it came from

**To get started:** Upload a file using the panel on the left (PDF, TXT, MD, JSON, or code files), then ask me anything about it.`;
    }
    if (intent === 'thanks') {
        return "You're welcome! Feel free to ask anything else about your documents.";
    }
    return null;
}
const CONFIG = {
    MIN_SIMILARITY:      0.35,
    MAX_TOP_K:           7,
    TARGET_TOP_K:        5,
    MAX_CONTEXT_TOKENS:  800,
    CONFIDENCE_THRESHOLD: 0.6
};

// ---------------------------------------------------------------------------
// Similarity search
// ---------------------------------------------------------------------------
async function searchRelevantChunks(queryEmbedding, options = {}) {
    const {
        topK = CONFIG.MAX_TOP_K,
        threshold = CONFIG.MIN_SIMILARITY,
        documentIds = null,
        userId = null        // scope search to this user's documents
    } = options;
    try {
        const embeddingString = `[${queryEmbedding.join(',')}]`;

        const rpcParams = {
            query_embedding: embeddingString,
            match_threshold: threshold,
            match_count: topK,
            filter_doc_ids: documentIds && documentIds.length > 0 ? documentIds : null,
            filter_user_id: userId || null
        };

        let { data, error } = await supabase.rpc('search_similar_chunks', rpcParams);

        // If the RPC doesn't have filter_user_id yet (pre-migration), retry without it
        if (error && error.message?.includes('filter_user_id')) {
            console.warn('⚠️  search_similar_chunks missing filter_user_id — run schema_v3_migration.sql');
            const fallbackParams = {
                query_embedding: embeddingString,
                match_threshold: threshold,
                match_count: topK,
                filter_doc_ids: documentIds && documentIds.length > 0 ? documentIds : null
            };
            const result = await supabase.rpc('search_similar_chunks', fallbackParams);
            data = result.data;
            error = result.error;
        }

        if (error) throw error;
        if (!data || data.length === 0) return [];

        const deduplicated = deduplicateChunks(data, 0.85);
        const scored = deduplicated.map((chunk, idx) => ({
            ...chunk,
            finalScore: calculateChunkScore(chunk, idx)
        }));
        const ranked = scored.sort((a, b) => b.finalScore - a.finalScore).slice(0, CONFIG.TARGET_TOP_K);

        // Enrich with document titles via a single batch lookup
        const docIds = [...new Set(ranked.map(c => c.document_id).filter(Boolean))];
        if (docIds.length > 0) {
            const { data: docs } = await supabase
                .from('documents')
                .select('id, title')
                .in('id', docIds);
            if (docs) {
                const titleMap = Object.fromEntries(docs.map(d => [d.id, d.title]));
                ranked.forEach(c => { c.document_title = titleMap[c.document_id] || null; });
            }
        }

        return ranked;
    } catch (err) {
        console.error('Similarity search failed:', err.message);
        return [];
    }
}

function deduplicateChunks(chunks, threshold = 0.85) {
    const unique = [];
    for (const chunk of chunks) {
        let isDuplicate = false;
        for (const existing of unique) {
            const sim = calculateTextSimilarity(chunk.content.toLowerCase(), existing.content.toLowerCase());
            if (sim > threshold) {
                isDuplicate = true;
                if (chunk.similarity > existing.similarity) {
                    existing.content = chunk.content;
                    existing.similarity = chunk.similarity;
                }
                break;
            }
        }
        if (!isDuplicate) unique.push(chunk);
    }
    return unique;
}

function calculateTextSimilarity(a, b) {
    const wa = new Set(a.split(/\s+/));
    const wb = new Set(b.split(/\s+/));
    const intersection = new Set([...wa].filter(x => wb.has(x)));
    return intersection.size / new Set([...wa, ...wb]).size;
}

function calculateChunkScore(chunk, position) {
    const positionBoost = Math.max(0, 0.1 - position * 0.02);
    const lengthPenalty = chunk.content.length < 50 ? -0.05 : 0;
    return (chunk.similarity || 0) + positionBoost + lengthPenalty;
}

// ---------------------------------------------------------------------------
// Snippet builder
// Trims chunk content to a clean sentence-aware excerpt for display.
// WHY 160 chars: long enough to be meaningful, short enough not to clutter UI.
// ---------------------------------------------------------------------------
function buildSnippet(text, maxLen = 160) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLen) return clean;
    // Try to break at a sentence boundary within the limit
    const cut = clean.lastIndexOf('. ', maxLen);
    if (cut > maxLen * 0.5) return clean.slice(0, cut + 1);
    // Fall back to word boundary
    const wordCut = clean.lastIndexOf(' ', maxLen);
    return clean.slice(0, wordCut > 0 ? wordCut : maxLen) + '…';
}

// ---------------------------------------------------------------------------
// Context formatting
// ---------------------------------------------------------------------------
function formatContext(chunks) {
    if (!chunks || chunks.length === 0) {
        return { context: 'NO_RELEVANT_CONTEXT', tokenCount: 0, confidence: 0 };
    }
    const confidence = chunks[0]?.finalScore || chunks[0]?.similarity || 0;
    const contextParts = [];
    let totalTokens = 0;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const source = chunk.document_title || chunk.document_id || 'Unknown';
        const score  = chunk.finalScore || chunk.similarity || 0;
        const formatted = `[SOURCE ${i + 1}] Document: "${source}" | Relevance: ${(score * 100).toFixed(0)}%\n${chunk.content.trim()}`;
        const tokens = Math.ceil(formatted.length / 4);
        if (totalTokens + tokens > CONFIG.MAX_CONTEXT_TOKENS) {
            contextParts.push(`[${chunks.length - i} more sources omitted]`);
            break;
        }
        contextParts.push(formatted);
        totalTokens += tokens;
    }
    return { context: contextParts.join('\n\n---\n\n'), tokenCount: totalTokens, confidence };
}

// ---------------------------------------------------------------------------
// Prompt builder — developer-focused, mode-aware
//
// Three modes:
//   normal   — balanced technical answer with code examples when relevant
//   beginner — plain language, analogies, step-by-step, no assumed knowledge
//   detailed — deep dive: internals, edge cases, trade-offs, full examples
//
// Priority order sent to the model:
//   [system]  ← RAG context + rules + mode instructions
//   [history] ← prior turns (pronoun/reference resolution)
//   [user]    ← current query
//
// WHY context before history:
//   LLMs weight earlier tokens more. Anchoring with retrieved facts first
//   prevents the model from drifting toward conversational guesses.
// ---------------------------------------------------------------------------

const MODE_INSTRUCTIONS = {
    normal: `You are a knowledgeable technical assistant helping developers understand code and documentation.

RESPONSE STYLE:
- Answer directly and concisely — lead with the key point
- Include a code example when it meaningfully illustrates the answer
- Use \`inline code\` for identifiers, function names, and short snippets
- Use fenced code blocks (\`\`\`language\\n...\\n\`\`\`) for multi-line code
- Use **bold** for key terms on first use
- Keep answers to 3-6 sentences of prose + code if needed
- Cite sources using [Source N] for every factual claim`,

    beginner: `You are a patient technical mentor explaining concepts to someone new to programming.

RESPONSE STYLE:
- Start with a plain-English one-sentence summary of what the thing does
- Use a real-world analogy if it helps (e.g. "think of it like a filing cabinet")
- Break down steps with numbered lists
- Show a minimal, commented code example — keep it short and obvious
- Avoid jargon; if you must use a technical term, define it immediately
- End with one practical tip or common mistake to avoid
- Cite sources using [Source N] for every factual claim`,

    detailed: `You are a senior engineer giving a thorough technical explanation.

RESPONSE STYLE:
- Start with a precise definition or summary
- Explain the internals / how it works under the hood
- Cover edge cases, gotchas, and performance considerations
- Show a complete, realistic code example with comments
- Mention trade-offs or alternatives where relevant
- Use headers (##) to organise if the answer has multiple distinct sections
- Cite sources using [Source N] for every factual claim`
};

function buildRAGSystemPrompt(context, confidence, mode = 'normal') {
    const modeInstructions = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.normal;
    const warning = confidence < CONFIG.CONFIDENCE_THRESHOLD
        ? '\n⚠️ NOTE: Retrieved context may be incomplete. If the context does not fully answer the question, say so clearly rather than guessing.'
        : '';

    return `${modeInstructions}

GROUNDING RULES (non-negotiable):
1. Base your answer STRICTLY on the RETRIEVED CONTEXT below${warning}
2. CONVERSATION HISTORY is for reference only — use it to resolve pronouns like "it", "that", "the function"
3. If the answer is not in the context → say: "I don't have enough information in the provided documents to answer that."
4. NEVER invent API names, function signatures, config values, or behaviour not present in the context
5. If you include a code example, it must be derived from or consistent with the context

RETRIEVED CONTEXT:
${context}

Answer the user's latest message following the style and grounding rules above.`;
}

// ---------------------------------------------------------------------------
// LLM call — history-aware, mode-aware (non-streaming, kept for fallback)
// ---------------------------------------------------------------------------
async function getChatResponseWithPrompt(userMessage, systemPrompt, history = [], mode = 'normal') {
    const { default: OpenAI } = await import('openai');
    const groq = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1'
    });

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage }
    ];

    const maxTokensByMode = { normal: 400, beginner: 500, detailed: 800 };
    const tempByMode = { normal: 0.2, beginner: 0.3, detailed: 0.2 };

    const completion = await groq.chat.completions.create({
        model: process.env.LLM_MODEL || 'llama-3.1-8b-instant',
        messages,
        max_tokens: maxTokensByMode[mode] || 400,
        temperature: tempByMode[mode] || 0.2,
        top_p: 0.9,
        presence_penalty: 0.1
    });

    return completion.choices[0]?.message?.content || 'No response generated';
}

// ---------------------------------------------------------------------------
// LLM streaming — yields text delta chunks as an async generator
//
// WHY SSE + async generator instead of WebSockets:
//   - SSE is unidirectional (server → client) which is exactly what we need
//   - Works through Vite's HTTP proxy without any extra config
//   - No extra packages — the OpenAI SDK supports streaming natively
//   - Simpler error handling than WebSockets for this use case
// ---------------------------------------------------------------------------
async function* streamChatResponse(userMessage, systemPrompt, history = [], mode = 'normal') {
    const { default: OpenAI } = await import('openai');
    const groq = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1'
    });

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage }
    ];

    const maxTokensByMode = { normal: 400, beginner: 500, detailed: 800 };
    const tempByMode = { normal: 0.2, beginner: 0.3, detailed: 0.2 };

    const stream = await groq.chat.completions.create({
        model: process.env.LLM_MODEL || 'llama-3.1-8b-instant',
        messages,
        max_tokens: maxTokensByMode[mode] || 400,
        temperature: tempByMode[mode] || 0.2,
        top_p: 0.9,
        presence_penalty: 0.1,
        stream: true   // ← the only difference from the non-streaming call
    });

    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main RAG query — full pipeline with conversational memory
 * @param {string} userQuery
 * @param {Object} options - { topK, sessionId, documentIds, mode }
 *   mode: 'normal' | 'beginner' | 'detailed'
 */
export async function queryRAG(userQuery, options = {}) {
    const startTime = Date.now();
    const { sessionId = null, mode = 'normal' } = options;

    try {
        console.log(`🔍 RAG Query [${mode}]: "${userQuery.substring(0, 60)}..."`);

        // Step 0: Handle greetings and meta-questions without RAG
        const intent = detectConversationalIntent(userQuery);
        if (intent) {
            const response = getConversationalResponse(intent);
            if (sessionId) appendAndTrimHistory(sessionId, userQuery, response);
            return {
                answer: response,
                sources: [],
                metadata: { retrievalTime: 0, chunksRetrieved: 0, confidence: 1, mode, conversational: true }
            };
        }
        const queryEmbedding = await getEmbeddingWithCache(userQuery);
        if (!queryEmbedding || queryEmbedding.length !== 768) {
            throw new Error('Failed to generate valid query embedding (expected 768-dim)');
        }

        console.log('  2. Searching knowledge base...');
        const relevantChunks = await searchRelevantChunks(queryEmbedding, options);

        console.log('  3. Formatting context...');
        const { context, tokenCount, confidence } = formatContext(relevantChunks);

        if (context === 'NO_RELEVANT_CONTEXT' || confidence < CONFIG.MIN_SIMILARITY) {
            console.log(`  ⚠️ Low confidence (${(confidence * 100).toFixed(0)}%), skipping LLM`);
            return {
                answer: "I don't have enough information in the provided documents to answer that question. Try uploading relevant documentation or source files.",
                sources: [],
                metadata: { retrievalTime: Date.now() - startTime, chunksRetrieved: 0, confidence: 0, mode }
            };
        }
        console.log(`  ✓ ${relevantChunks.length} chunks (confidence: ${(confidence * 100).toFixed(0)}%, tokens: ${tokenCount})`);

        const systemPrompt = buildRAGSystemPrompt(context, confidence, mode);
        const history = getHistory(sessionId);
        if (history.length > 0) {
            console.log(`  📜 ${history.length} history messages (session: ${sessionId})`);
        }

        console.log(`  4. Generating answer [${mode}]...`);
        const answer = await getChatResponseWithPrompt(userQuery, systemPrompt, history, mode);

        if (sessionId) {
            appendAndTrimHistory(sessionId, userQuery, answer);
        }

        const totalTime = Date.now() - startTime;
        console.log(`  ✓ RAG complete in ${totalTime}ms`);

        return {
            answer,
            sources: relevantChunks.map((c, i) => ({
                sourceNumber: i + 1,
                document: c.document_title || c.document_id || 'Unknown document',
                snippet: buildSnippet(c.content, 160),
                relevance: Math.round((c.finalScore || c.similarity || 0) * 100),
            })),
            metadata: {
                retrievalTime: totalTime,
                chunksRetrieved: relevantChunks.length,
                confidence,
                contextTokens: tokenCount,
                historyTurns: Math.floor(history.length / 2),
                mode,
                costEstimate: `${(tokenCount * 0.00001).toFixed(5)}`
            }
        };

    } catch (error) {
        console.error('❌ RAG query failed:', error.message);
        return {
            answer: "I'm experiencing technical difficulties. Please try again in a moment.",
            sources: [],
            metadata: { error: error.message, retrievalTime: Date.now() - startTime, mode }
        };
    }
}

export function getCacheStats() {
    return { size: embeddingCache.size, maxSize: 100, sessions: sessionStore.size };
}

export async function querySimple(userQuery) {
    return await getChatResponse(userQuery);
}

/**
 * Streaming RAG pipeline.
 * Runs retrieval synchronously, then streams the LLM answer token-by-token.
 *
 * @param {string} userQuery
 * @param {Object} options - { topK, sessionId, documentIds, mode }
 * @param {Function} onToken   - called with each text delta string
 * @param {Function} onSources - called once with the sources array when retrieval completes
 * @param {Function} onError   - called if anything fails
 * @returns {Promise<void>}    - resolves when streaming is complete
 *
 * WHY streaming improves perceived performance:
 *   Without streaming, the user stares at a spinner for 2-4 seconds then
 *   sees the full answer appear at once. With streaming, the first token
 *   arrives in ~300ms and the user starts reading immediately. The total
 *   time-to-complete is the same, but perceived latency drops dramatically
 *   because the user has something to engage with right away.
 *   This is the same reason ChatGPT, Claude, and Copilot all stream.
 */
export async function streamRAG(userQuery, options = {}, { onToken, onSources, onError }) {
    const startTime = Date.now();
    const { sessionId = null, mode = 'normal' } = options;

    try {
        console.log(`🔍 Stream RAG [${mode}]: "${userQuery.substring(0, 60)}..."`);

        // Step 0: Handle greetings and meta-questions without RAG
        const intent = detectConversationalIntent(userQuery);
        if (intent) {
            const response = getConversationalResponse(intent);
            onSources([], { confidence: 1, contextTokens: 0, mode, conversational: true });
            onToken(response);
            if (sessionId) appendAndTrimHistory(sessionId, userQuery, response);
            return;
        }
        const queryEmbedding = await getEmbeddingWithCache(userQuery);
        if (!queryEmbedding || queryEmbedding.length !== 768) {
            throw new Error('Failed to generate valid query embedding');
        }

        const relevantChunks = await searchRelevantChunks(queryEmbedding, options);
        const { context, tokenCount, confidence } = formatContext(relevantChunks);

        // Only send sources if we actually have useful context
        // (don't show sources when the answer is "I don't have enough info")
        if (context === 'NO_RELEVANT_CONTEXT' || confidence < CONFIG.MIN_SIMILARITY) {
            onSources([], { confidence: 0, contextTokens: 0, mode });
            onToken("I don't have enough information in the provided documents to answer that question. Try uploading a relevant file first.");
            return;
        }

        const sources = relevantChunks.map((c, i) => ({
            sourceNumber: i + 1,
            document: c.document_title || c.document_id || 'Unknown document',
            snippet: buildSnippet(c.content, 160),
            relevance: Math.round((c.finalScore || c.similarity || 0) * 100),
        }));
        onSources(sources, { confidence, contextTokens: tokenCount, mode });

        const systemPrompt = buildRAGSystemPrompt(context, confidence, mode);
        const history = getHistory(sessionId);

        // Stream tokens to the client
        let fullAnswer = '';
        for await (const delta of streamChatResponse(userQuery, systemPrompt, history, mode)) {
            fullAnswer += delta;
            onToken(delta);
        }

        // Persist the complete answer to session history after streaming finishes
        if (sessionId && fullAnswer) {
            appendAndTrimHistory(sessionId, userQuery, fullAnswer);
        }

        console.log(`  ✓ Stream complete in ${Date.now() - startTime}ms`);

    } catch (err) {
        console.error('❌ Stream RAG failed:', err.message);
        onError(err);
    }
}

export { searchRelevantChunks, formatContext, CONFIG as RAGConfig };
