// CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
// CATEGORY: ACTIVE
// Purpose: Shared env loading + validation for TS scripts
// Invoked: imported by every TS script in scripts/
// Reads:   (.env files)
// Writes:  (returns validated config)
// ────────────────────────────────────────────────────────────
/**
 * Shared Supabase environment configuration for scripts.
 *
 * Usage:
 *   import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';
 *
 * Reads from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (or their
 * non-prefixed variants) in the environment.  Copy .env.example to .env
 * and fill in the values before running any script.
 */

import { config } from 'dotenv';
config();

export const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;

export const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_ANON_KEY. Copy .env.example to .env and fill in values.'
  );
  process.exit(1);
}
