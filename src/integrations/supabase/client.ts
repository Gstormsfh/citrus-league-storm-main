// Supabase client — optimized for Pro plan
// import { supabase } from "@/integrations/supabase/client";
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

// Get the current origin for redirect URLs
const getSiteUrl = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://citrus-fantasy-sports.web.app';
};

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Pro: Token auto-refresh runs before expiry to avoid mid-session interruptions
    detectSessionInUrl: true,
    flowType: 'pkce', // Pro: More secure auth flow (PKCE)
    redirectTo: `${getSiteUrl()}/auth/callback`,
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