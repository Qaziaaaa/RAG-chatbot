import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client configuration
 * 
 * Environment variables needed:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_ANON_KEY: Your Supabase anon/public key
 * - SUPABASE_SERVICE_ROLE_KEY: Service role key (for admin operations)
 * 
 * Free tier limits:
 * - 500MB database storage
 * - 2GB file storage
 * - Unlimited API requests (fair use)
 * - pgvector extension included
 */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env');
    process.exit(1);
}

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false // Server-side doesn't need session persistence
    }
});

/**
 * Test database connection
 */
export async function testConnection() {
    try {
        const { data, error } = await supabase
            .from('documents')
            .select('count', { count: 'exact', head: true });
        
        if (error) throw error;
        
        console.log('✅ Supabase connected successfully');
        return true;
    } catch (err) {
        console.error('❌ Supabase connection failed:', err.message);
        return false;
    }
}

export default supabase;
