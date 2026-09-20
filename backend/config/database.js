import pg from 'pg';
import pgvector from 'pgvector/pg';

const { Pool } = pg;

/**
 * Neon PostgreSQL configuration
 *
 * Environment variables needed:
 * - DATABASE_URL: Neon connection string (postgresql://...)
 *
 * Neon free tier:
 * - 0.5 GB storage
 * - Scales to zero after 5 min idle (wakes automatically on connection)
 * - pgvector extension included
 */

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Register pgvector type on each new connection (after vector extension exists)
pool.on('connect', async (client) => {
    try {
        await pgvector.registerTypes(client);
    } catch {
        // Vector type not yet created — will be set up in ensureSchema()
    }
});

/**
 * Test database connection
 */
export async function testConnection() {
    try {
        const result = await pool.query('SELECT 1 as ok');
        console.log('✅ Neon connected successfully');
        return true;
    } catch (err) {
        console.error('❌ Neon connection failed:', err.message);
        return false;
    }
}

/**
 * Ensure pgvector extension and tables exist
 */
export async function ensureSchema() {
    const client = await pool.connect();
    try {
        // Enable vector extension first
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');

        // Now register pgvector types on this client
        await pgvector.registerTypes(client);

        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT,
                metadata JSONB DEFAULT '{}',
                file_type TEXT,
                file_size INTEGER,
                user_id TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS document_chunks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding VECTOR(768),
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON document_chunks(document_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_documents_user_created ON documents(user_id, created_at DESC)
        `);

        // IVFFlat index for similarity search (create only if not exists)
        try {
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON document_chunks
                USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 100)
            `);
        } catch {
            // IVFFlat index can't be created on empty table — that's fine
            console.warn('⚠️ IVFFlat index skipped (table may be empty — will be created after first inserts)');
        }

        // Search function
        await client.query(`
            CREATE OR REPLACE FUNCTION search_similar_chunks(
                query_embedding VECTOR(768),
                match_threshold FLOAT,
                match_count INT,
                filter_doc_ids UUID[] DEFAULT NULL,
                filter_user_id TEXT DEFAULT NULL
            )
            RETURNS TABLE(
                id UUID,
                document_id UUID,
                chunk_index INTEGER,
                content TEXT,
                similarity FLOAT
            )
            LANGUAGE plpgsql AS $func$
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
        `);

        console.log('✅ Schema verified');
    } finally {
        client.release();
    }
}

export { pool };
export default pool;
