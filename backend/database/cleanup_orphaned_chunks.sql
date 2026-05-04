-- ============================================================
-- Cleanup: Remove orphaned document_chunks
-- Run this once in Supabase SQL Editor if deleted docs
-- still appear in search results
-- ============================================================

-- Delete any chunks whose parent document no longer exists
DELETE FROM document_chunks
WHERE document_id NOT IN (SELECT id FROM documents);

-- Verify: should return 0 after cleanup
SELECT COUNT(*) as orphaned_chunks
FROM document_chunks
WHERE document_id NOT IN (SELECT id FROM documents);
