import { createClient } from '@supabase/supabase-js';

// These are PUBLIC keys — safe to expose in frontend code.
// VITE_ prefix makes them available via import.meta.env
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  console.error(
    '❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in frontend/.env'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    // Persist session in localStorage so users stay logged in across tabs
    persistSession: true,
    autoRefreshToken: true,
    // Redirect back here after OAuth (Google) login
    redirectTo: window.location.origin
  }
});
