// Supabase client — optimized for Pro plan
// import { supabase } from "@/integrations/supabase/client";
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file. ' +
    'See .env.example for details.'
  );
}

// Get the current origin for redirect URLs
const getSiteUrl = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://citrusfantasysports.com';
};

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Pro: Token auto-refresh runs before expiry to avoid mid-session interruptions
    detectSessionInUrl: true,
    flowType: 'pkce', // Pro: More secure auth flow (PKCE)
  },
  realtime: {
    params: {
      // Pro: 500 concurrent connections (vs 200 free)
      // Longer heartbeat reduces overhead while staying under Pro limits
      eventsPerSecond: 40, // Pro allows higher throughput
    },
  },
  global: {
    headers: {
      // Helps identify client requests in Supabase Dashboard > Logs
      'x-client-info': 'citrus-fantasy-sports',
    },
  },
  db: {
    schema: 'public',
  },
});