-- ============================================================
-- Schema v3 Migration — Lightweight User Persistence
-- Run this in Supabase SQL Editor (safe to run on existing DB)
-- ============================================================

-- 1. Add user_id to documents table
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS user_id TEXT;

-- 2. Indexes for fast per-user lookups
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_created ON documents(user_id, created_at DESC);

-- 3. Replace search_similar_chunks with user-scoped version
--    filter_user_id = NULL  → search all documents (no filter)
--    filter_user_id = 'xyz' → search that user's docs + legacy docs (user_id IS NULL)
CREATE OR REPLACE FUNCTION search_similar_chunks(
    query_embedding  VECTOR(768),
    match_threshold  FLOAT,
    match_count      INT,
    filter_doc_ids   UUID[]  DEFAULT NULL,
    filter_user_id   TEXT    DEFAULT NULL
)
RETURNS TABLE(
    id          UUID,
    document_id UUID,
    chunk_index INTEGER,
    content     TEXT,
    similarity  FLOAT
)
LANGUAGE plpgsql
AS $func$
BEGIN
    RETURN QUERY
    SELECT
        dc.id,
        dc.document_id,
        dc.chunk_index,
        dc.content,
        1 - (dc.embedding <=> query_embedding) AS similarity
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE
        1 - (dc.embedding <=> query_embedding) > match_threshold
        AND (filter_doc_ids IS NULL OR dc.document_id = ANY(filter_doc_ids))
        AND (filter_user_id IS NULL OR d.user_id = filter_user_id OR d.user_id IS NULL)
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$func$;
 