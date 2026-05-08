/**
 * Document Management Service
 *
 * All operations are scoped by userId — a client-generated UUID stored in
 * localStorage. This gives each browser session its own isolated document
 * space without requiring login/signup.
 *
 * userId is TEXT (not a FK) so it works without Supabase Auth.
 * When upgrading to full auth, replace userId with the JWT sub claim.
 */

import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/database.js';
import { processDocument } from './chunker.js';
import { prepareChunksBatch } from './embeddings.js';

// ---------------------------------------------------------------------------
// userId validation
// A valid userId is a non-empty string of reasonable length.
// We don't enforce UUID format — any stable client identifier works.
// ---------------------------------------------------------------------------
export function isValidUserId(userId) {
    return typeof userId === 'string' && userId.trim().length >= 8 && userId.length <= 128;
}

/**
 * Store a new document with its chunks, scoped to a user.
 * @param {Object} document - { title, content, source?, metadata?, userId }
 */
export async function storeDocument(document) {
    const { title, content, source = null, metadata = {}, userId = null } = document;

    console.log(`📄 Storing document: "${title}" (user: ${userId || 'anonymous'})...`);

    try {
        const documentId = uuidv4();
        const { error: docError } = await supabase
            .from('documents')
            .insert({
                id: documentId,
                title,
                content,
                source,
                metadata,
                user_id: userId   // ← scoped to this user
            });

        if (docError) throw docError;
        console.log(`  ✓ Document record created: ${documentId}`);

        console.log('  1. Chunking document...');
        const chunks = processDocument({ title, content, source, metadata });
        console.log(`  ✓ Created ${chunks.length} chunks`);

        if (chunks.length === 0) {
            return { documentId, chunksInserted: 0, message: 'No chunks created (empty document?)' };
        }

        console.log('  2. Generating embeddings...');
        const chunksWithEmbeddings = await prepareChunksBatch(chunks, documentId);
        console.log(`  ✓ Generated ${chunksWithEmbeddings.length} embeddings`);

        console.log('  3. Storing chunks in database...');
        const { error: chunkError } = await supabase
            .from('document_chunks')
            .insert(chunksWithEmbeddings);

        if (chunkError) throw chunkError;
        console.log(`  ✓ Stored ${chunksWithEmbeddings.length} chunks`);

        return {
            documentId,
            title,
            chunksInserted: chunksWithEmbeddings.length,
            totalChars: content.length,
            message: 'Document stored successfully'
        };

    } catch (error) {
        console.error('❌ Failed to store document:', error.message);
        throw error;
    }
}

/**
 * Store multiple documents in batch, all scoped to the same user.
 */
export async function storeDocumentsBatch(documents, userId = null) {
    console.log(`📚 Storing ${documents.length} documents (user: ${userId || 'anonymous'})...`);

    const results = [];
    for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        console.log(`\n[${i + 1}/${documents.length}] Processing: ${doc.title}`);
        try {
            const result = await storeDocument({ ...doc, userId });
            results.push({ success: true, ...result });
        } catch (error) {
            results.push({ success: false, title: doc.title, error: error.message });
        }
    }

    const successful = results.filter(r => r.success).length;
    console.log(`\n✓ Batch complete: ${successful}/${documents.length} documents stored`);
    return results;
}

/**
 * List documents for a specific user (or all if userId is null).
 * Gracefully handles missing user_id column (pre-migration).
 * @param {string|null} userId
 */
export async function listDocuments(userId = null) {
    let query = supabase
        .from('documents')
        .select('id, title, source, metadata, created_at')
        .order('created_at', { ascending: false });

    if (userId) {
        // Show documents owned by this user OR legacy docs with no owner (user_id IS NULL)
        // WHY: Documents uploaded before the migration have user_id = NULL.
        // Showing them prevents data loss confusion after running the migration.
        query = query.or(`user_id.eq.${userId},user_id.is.null`);
    }

    const { data, error } = await query;

    if (error) {
        console.warn('⚠️  listDocuments failed (user_id column may be missing) — run schema_v3_migration.sql');
        const { data: allData, error: allErr } = await supabase
            .from('documents')
            .select('id, title, source, metadata, created_at')
            .order('created_at', { ascending: false });
        if (allErr) throw allErr;
        if (!allData || allData.length === 0) return [];
        return _attachChunkCounts(allData);
    }

    if (!data || data.length === 0) return [];
    return _attachChunkCounts(data);
}

async function _attachChunkCounts(docs) {
    const ids = docs.map(d => d.id);
    const { data: chunkCounts } = await supabase
        .from('document_chunks')
        .select('document_id')
        .in('document_id', ids);

    const countMap = {};
    (chunkCounts || []).forEach(r => {
        countMap[r.document_id] = (countMap[r.document_id] || 0) + 1;
    });

    return docs.map(doc => ({
        ...doc,
        file_type: doc.file_type || (doc.metadata?.mimeType?.includes('pdf') ? 'pdf' : 'text'),
        file_size: doc.file_size || null,
        chunkCount: countMap[doc.id] || 0
    }));
}

/**
 * Get a document with its chunks — verifies ownership if userId provided.
 * @param {string} documentId
 * @param {string|null} userId
 */
export async function getDocumentWithChunks(documentId, userId = null) {
    let query = supabase.from('documents').select('*').eq('id', documentId);
    // Only add user_id filter if column likely exists (post-migration)
    // We attempt it and fall back if the column is missing
    if (userId) query = query.eq('user_id', userId);

    const { data: document, error: docError } = await query.single();

    if (docError) {
        // If user_id column missing, retry without it
        if (docError.message?.includes('user_id') || docError.code === '42703') {
            const { data: doc2, error: e2 } = await supabase
                .from('documents').select('*').eq('id', documentId).single();
            if (e2) throw e2;
            const { data: chunks } = await supabase
                .from('document_chunks').select('id, chunk_index, content, metadata')
                .eq('document_id', documentId).order('chunk_index');
            return { ...doc2, chunks: chunks || [] };
        }
        throw docError;
    }

    const { data: chunks, error: chunkError } = await supabase
        .from('document_chunks')
        .select('id, chunk_index, content, metadata')
        .eq('document_id', documentId)
        .order('chunk_index');

    if (chunkError) throw chunkError;
    return { ...document, chunks: chunks || [] };
}

/**
 * Delete a document — verifies ownership if userId provided.
 * @param {string} documentId
 * @param {string|null} userId
 */
export async function deleteDocument(documentId, userId = null) {
    console.log(`🗑️ Deleting document: ${documentId} (user: ${userId || 'anonymous'})`);

    // First verify the document exists and belongs to this user (or has no owner)
    let query = supabase.from('documents').select('id, user_id').eq('id', documentId);
    const { data: doc, error: fetchErr } = await query.single();

    if (fetchErr || !doc) {
        throw new Error('Document not found');
    }

    // Allow delete if: no userId filter, doc has no owner, or userId matches
    const canDelete = !userId || !doc.user_id || doc.user_id === userId;
    if (!canDelete) {
        throw new Error('Not authorized to delete this document');
    }

    // Explicitly delete chunks first as a safety net
    // (ON DELETE CASCADE should handle this, but belt-and-suspenders)
    const { error: chunkErr } = await supabase
        .from('document_chunks')
        .delete()
        .eq('document_id', documentId);
    if (chunkErr) {
        console.warn('⚠️ Could not delete chunks explicitly:', chunkErr.message);
    }

    const { error } = await supabase.from('documents').delete().eq('id', documentId);
    if (error) throw error;

    console.log('  ✓ Document and chunks deleted');
    return { deleted: true, documentId };
}

/**
 * Get stats scoped to a user (or global if userId is null).
 * Gracefully handles missing user_id column (pre-migration).
 * @param {string|null} userId
 */
export async function getStats(userId = null) {
    // Helper: global stats (no user filter)
    const globalStats = async () => {
        const { count: docCount } = await supabase
            .from('documents').select('*', { count: 'exact', head: true });
        const { count: chunkCount } = await supabase
            .from('document_chunks').select('*', { count: 'exact', head: true });
        return {
            documents: docCount || 0,
            chunks: chunkCount || 0,
            avgChunksPerDoc: docCount ? Math.round((chunkCount || 0) / docCount) : 0
        };
    };

    if (!userId) return globalStats();

    try {
        // Count documents for this user
        const { count: docCount, error: docError } = await supabase
            .from('documents')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (docError) throw docError;

        // Count chunks via user's document IDs
        let chunkCount = 0;
        if (docCount > 0) {
            const { data: userDocs } = await supabase
                .from('documents').select('id').eq('user_id', userId);
            if (userDocs?.length > 0) {
                const { count } = await supabase
                    .from('document_chunks')
                    .select('*', { count: 'exact', head: true })
                    .in('document_id', userDocs.map(d => d.id));
                chunkCount = count || 0;
            }
        }

        return {
            documents: docCount || 0,
            chunks: chunkCount,
            avgChunksPerDoc: docCount ? Math.round(chunkCount / docCount) : 0
        };

    } catch (err) {
        // Supabase returns an empty error object when the column doesn't exist yet.
        // Fall back to global stats in all cases — the migration warning is enough.
        console.warn('⚠️  getStats failed (user_id column may be missing) — run schema_v3_migration.sql');
        return globalStats();
    }
}

/**
 * Seed database with initial FAQ documents (for a specific user or anonymous).
 */
export async function seedFAQs(userId = null) {
    console.log('🌱 Seeding database with FAQs...');

    const faqs = [
        {
            title: 'Business Hours FAQ',
            content: `We are open Monday to Friday, 9 AM to 6 PM EST.
Weekend support is available for enterprise clients only.
Holiday hours may vary - check our website for updates.
Our support team is available during all business hours.
Emergency support is available 24/7 for enterprise customers.`,
            source: 'internal-faq',
            metadata: { category: 'hours', priority: 'high' }
        },
        {
            title: 'Password Reset FAQ',
            content: `How to reset your password:
1. Go to the login page and click 'Forgot Password'
2. Enter your registered email address
3. Check your email for a password reset link
4. Click the link and create a new password
5. The link expires in 1 hour for security
You'll receive the reset link within 5 minutes.
If you don't see it, check your spam folder.`,
            source: 'internal-faq',
            metadata: { category: 'account', priority: 'high' }
        },
        {
            title: 'Refund Policy FAQ',
            content: `Our refund policy is simple and fair:
Full refunds are available within 14 days of purchase.
No refunds are provided after 14 days.
To request a refund:
1. Contact support within 14 days
2. Provide your order number
3. Refunds are processed within 5-7 business days
Enterprise customers may have different terms per contract.`,
            source: 'internal-faq',
            metadata: { category: 'billing', priority: 'high' }
        },
        {
            title: 'Pricing FAQ',
            content: `Our pricing plans:
Basic Plan: $29/month - Up to 3 users, 10GB storage, Email support
Pro Plan: $99/month - Up to 20 users, 100GB storage, Priority support
Enterprise: Custom pricing - Unlimited users, Unlimited storage, 24/7 dedicated support
Annual billing saves 20%.`,
            source: 'internal-faq',
            metadata: { category: 'pricing', priority: 'high' }
        }
    ];

    return await storeDocumentsBatch(faqs, userId);
}
