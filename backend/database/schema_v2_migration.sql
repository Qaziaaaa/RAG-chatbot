-- ============================================================
-- Schema v2 Migration — Dynamic Document Ingestion
-- Run this in Supabase SQL Editor (safe to run on existing DB)
-- ============================================================

-- 1. Add file_type column to documents (tracks txt / pdf / json)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS file_size INTEGER DEFAULT 0;

-- 2. Upload jobs table — tracks async processing status
--    States: pending → processing → done | failed
CREATE TABLE IF NOT EXISTS upload_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename    TEXT NOT NULL,
    file_type   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | processing | done | failed
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    chunks_created INTEGER DEFAULT 0,
    error_message  TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_jobs_status ON upload_jobs(status);

-- 3. Updated search function that supports optional document_id filtering
--    Drop and recreate to add the filter parameter
CREATE OR REPLACE FUNCTION search_similar_chunks(
    query_embedding  VECTOR(768),
    match_threshold  FLOAT,
    match_count      INT,
    filter_doc_ids   UUID[] DEFAULT NULL   -- NULL = search all documents
)
RETURNS TABLE(
    id          UUID,
    document_id UUID,
    chunk_index INTEGER,
    content     TEXT,
    similarity  FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        dc.id,
        dc.document_id,
        dc.chunk_index,
        dc.content,
        1 - (dc.embedding <=> query_embedding) AS similarity
    FROM document_chunks dc
    WHERE
        1 - (dc.embedding <=> query_embedding) > match_threshold
        AND (filter_doc_ids IS NULL OR dc.document_id = ANY(filter_doc_ids))
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
