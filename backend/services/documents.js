/**
 * Document Management Service
 *
 * All operations are scoped by userId — a client-generated UUID stored in
 * localStorage. This gives each browser session its own isolated document
 * space without requiring login/signup.
 */

import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database.js';
import { processDocument } from './chunker.js';
import { prepareChunksBatch } from './embeddings.js';

export function isValidUserId(userId) {
    return typeof userId === 'string' && userId.trim().length >= 8 && userId.length <= 128;
}

export async function storeDocument(document) {
    const { title, content, source = null, metadata = {}, userId = null } = document;

    console.log(`📄 Storing document: "${title}" (user: ${userId || 'anonymous'})...`);

    try {
        const documentId = uuidv4();
        const { error: docError } = await pool.query(
            `INSERT INTO documents (id, title, content, source, metadata, user_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [documentId, title, content, source, JSON.stringify(metadata), userId]
        );

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
        for (const chunk of chunksWithEmbeddings) {
            const { error: chunkError } = await pool.query(
                `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [chunk.id, chunk.document_id, chunk.chunk_index, chunk.content,
                 JSON.stringify(chunk.embedding), JSON.stringify(chunk.metadata)]
            );
            if (chunkError) throw chunkError;
        }

        console.log(`  ✓ Stored ${chunksWithEmbeddings.length} chunks`);

        return {
            documentId, title,
            chunksInserted: chunksWithEmbeddings.length,
            totalChars: content.length,
            message: 'Document stored successfully'
        };

    } catch (error) {
        console.error('❌ Failed to store document:', error.message);
        throw error;
    }
}

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

export async function listDocuments(userId = null) {
    let result;

    if (userId) {
        result = await pool.query(
            `SELECT id, title, source, metadata, created_at
             FROM documents
             WHERE user_id = $1 OR user_id IS NULL
             ORDER BY created_at DESC`,
            [userId]
        );
    } else {
        result = await pool.query(
            `SELECT id, title, source, metadata, created_at
             FROM documents
             ORDER BY created_at DESC`
        );
    }

    const docs = result.rows;
    if (docs.length === 0) return [];

    return _attachChunkCounts(docs);
}

async function _attachChunkCounts(docs) {
    const ids = docs.map(d => d.id);
    const { rows: chunkCounts } = await pool.query(
        `SELECT document_id, COUNT(*) as count
         FROM document_chunks
         WHERE document_id = ANY($1)
         GROUP BY document_id`,
        [ids]
    );

    const countMap = {};
    chunkCounts.forEach(r => { countMap[r.document_id] = parseInt(r.count); });

    return docs.map(doc => ({
        ...doc,
        file_type: doc.metadata?.mimeType?.includes('pdf') ? 'pdf' : 'text',
        file_size: null,
        chunkCount: countMap[doc.id] || 0
    }));
}

export async function getDocumentWithChunks(documentId, userId = null) {
    let docResult;

    if (userId) {
        docResult = await pool.query(
            `SELECT * FROM documents WHERE id = $1 AND user_id = $2`,
            [documentId, userId]
        );
    } else {
        docResult = await pool.query(
            `SELECT * FROM documents WHERE id = $1`,
            [documentId]
        );
    }

    if (docResult.rows.length === 0) throw new Error('Document not found');
    const document = docResult.rows[0];

    const { rows: chunks } = await pool.query(
        `SELECT id, chunk_index, content, metadata
         FROM document_chunks
         WHERE document_id = $1
         ORDER BY chunk_index`,
        [documentId]
    );

    return { ...document, chunks };
}

export async function deleteDocument(documentId, userId = null) {
    console.log(`🗑️ Deleting document: ${documentId} (user: ${userId || 'anonymous'})`);

    let docResult;
    if (userId) {
        docResult = await pool.query(
            `SELECT id, user_id FROM documents WHERE id = $1`,
            [documentId]
        );
    } else {
        docResult = await pool.query(
            `SELECT id, user_id FROM documents WHERE id = $1`,
            [documentId]
        );
    }

    if (docResult.rows.length === 0) throw new Error('Document not found');
    const doc = docResult.rows[0];

    const canDelete = !userId || !doc.user_id || doc.user_id === userId;
    if (!canDelete) throw new Error('Not authorized to delete this document');

    await pool.query(`DELETE FROM document_chunks WHERE document_id = $1`, [documentId]);
    await pool.query(`DELETE FROM documents WHERE id = $1`, [documentId]);

    console.log('  ✓ Document and chunks deleted');
    return { deleted: true, documentId };
}

export async function getStats(userId = null) {
    if (!userId) {
        const { rows } = await pool.query(`SELECT COUNT(*) as count FROM documents`);
        const { rows: chunkRows } = await pool.query(`SELECT COUNT(*) as count FROM document_chunks`);
        const docCount = parseInt(rows[0].count);
        const chunkCount = parseInt(chunkRows[0].count);
        return {
            documents: docCount,
            chunks: chunkCount,
            avgChunksPerDoc: docCount ? Math.round(chunkCount / docCount) : 0
        };
    }

    try {
        const { rows } = await pool.query(
            `SELECT COUNT(*) as count FROM documents WHERE user_id = $1`,
            [userId]
        );
        const docCount = parseInt(rows[0].count);

        let chunkCount = 0;
        if (docCount > 0) {
            const { rows: userDocs } = await pool.query(
                `SELECT id FROM documents WHERE user_id = $1`,
                [userId]
            );
            const { rows: chunkRows } = await pool.query(
                `SELECT COUNT(*) as count FROM document_chunks
                 WHERE document_id = ANY($1)`,
                [userDocs.map(d => d.id)]
            );
            chunkCount = parseInt(chunkRows[0].count);
        }

        return {
            documents: docCount,
            chunks: chunkCount,
            avgChunksPerDoc: docCount ? Math.round(chunkCount / docCount) : 0
        };
    } catch (err) {
        console.warn('⚠️  getStats failed:', err.message);
        const { rows } = await pool.query(`SELECT COUNT(*) as count FROM documents`);
        const { rows: chunkRows } = await pool.query(`SELECT COUNT(*) as count FROM document_chunks`);
        return {
            documents: parseInt(rows[0].count),
            chunks: parseInt(chunkRows[0].count),
            avgChunksPerDoc: 0
        };
    }
}

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
