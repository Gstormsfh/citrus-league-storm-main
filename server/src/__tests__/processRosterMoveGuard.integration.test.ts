/**
 * Integration test for 0D-SEC-2g — process_roster_move authorization guard.
 *
 * Validates the three contexts introduced by migration
 *   supabase/migrations/20260802000000_fix_process_roster_move_guard.sql
 * against a real database. This is NOT a unit test — it opens a raw
 * connection and executes the RPC with different values of
 * `request.jwt.claims`, so it needs a Postgres direct URL and the `pg`
 * package.
 *
 * How to run against staging:
 *   1. Apply the migration first: `supabase db push` linked to staging.
 *   2. Install pg locally:        `npm i -D pg @types/pg` (server workspace).
 *   3. Export the direct URL:     `set TEST_DB_URL=postgres://…` (staging).
 *   4. `npx vitest run server/src/__tests__/processRosterMoveGuard.integration.test.ts`
 *
 * If either the env var or the `pg` module is missing, all three tests
 * are skipped cleanly — the file is safe to check in without either
 * dependency in CI.
 *
 * Every test opens a transaction and ROLLS BACK, so the DB state is
 * untouched. Non-existent league/user UUIDs are used so the tests
 * exercise the guard's fall-through behavior without needing seeded
 * data — the guard runs BEFORE any table lookup.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TEST_DB_URL = process.env.TEST_DB_URL;
const SKIP_REASON =
  !TEST_DB_URL
    ? 'skipped — set TEST_DB_URL=postgres://… to run'
    : null;

type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
};

let Client: (new (config: { connectionString: string }) => PgClient) | null = null;
let pgLoadError: string | null = null;

beforeAll(async () => {
  if (!TEST_DB_URL) return;
  try {
    const pg = await import('pg');
    Client = (pg as any).Client;
  } catch (e) {
    pgLoadError = (e as Error).message;
  }
});

// A UUID that will never match a real user/league (deterministic, obviously fake).
const FAKE_LEAGUE = '00000000-0000-0000-0000-00000000dead';
const USER_A      = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B      = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Wrap each scenario in a transaction that ROLLBACKs so the DB is unchanged.
async function runInGuardContext(
  claims: string | null,      // null → simulate pg_cron (no JWT); string → set request.jwt.claims
  pUserId: string,
): Promise<{ success: boolean; error?: string } | null> {
  if (!Client || !TEST_DB_URL) return null;
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (claims === null) {
      // Ensure the setting is empty for this txn — mimics pg_cron
      await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    } else {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
    }
    const { rows } = await client.query(
      `SELECT public.process_roster_move($1::uuid, $2::uuid, NULL, NULL, 'guard-test'::text) AS result`,
      [FAKE_LEAGUE, pUserId],
    );
    return rows[0]?.result ?? null;
  } finally {
    // Always rollback — never leave state
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    await client.end();
  }
}

describe.skipIf(SKIP_REASON !== null)('process_roster_move guard (0D-SEC-2g)', () => {
  it('skips cleanly when pg is not installed', () => {
    if (pgLoadError) {
      console.warn(`[processRosterMoveGuard] pg module missing: ${pgLoadError}`);
    }
  });

  it('CRON context (no jwt.claims) — bypasses guard, honors p_user_id', async () => {
    if (!Client) return;
    const result = await runInGuardContext(null, USER_A);
    // Guard was bypassed → fall-through path attempted the "find team" lookup.
    // FAKE_LEAGUE has no team, so we expect the outer RAISE EXCEPTION to be
    // caught by WHEN OTHERS and returned as {success:false, error:'User does not have a team in this league'}.
    // We assert only that we did NOT hit the auth-guard rejections.
    expect(result).not.toBeNull();
    expect(result!.error).not.toBe('Not authenticated');
    expect(result!.error).not.toBe('Unauthorized: user_id mismatch');
  });

  it('SERVICE_ROLE claims — bypasses guard, honors p_user_id', async () => {
    if (!Client) return;
    const result = await runInGuardContext(
      JSON.stringify({ role: 'service_role' }),
      USER_A,
    );
    expect(result).not.toBeNull();
    expect(result!.error).not.toBe('Not authenticated');
    expect(result!.error).not.toBe('Unauthorized: user_id mismatch');
  });

  it('AUTHENTICATED with matching auth.uid() — passes guard', async () => {
    if (!Client) return;
    const result = await runInGuardContext(
      JSON.stringify({ role: 'authenticated', sub: USER_A }),
      USER_A,
    );
    expect(result).not.toBeNull();
    expect(result!.error).not.toBe('Not authenticated');
    expect(result!.error).not.toBe('Unauthorized: user_id mismatch');
  });

  it('AUTHENTICATED with mismatched auth.uid() — returns Unauthorized (not an exception)', async () => {
    if (!Client) return;
    const result = await runInGuardContext(
      JSON.stringify({ role: 'authenticated', sub: USER_A }),
      USER_B, // deliberately different from sub
    );
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toBe('Unauthorized: user_id mismatch');
  });

  it('ANON (claims present with role=anon, no sub) — returns Not authenticated', async () => {
    if (!Client) return;
    const result = await runInGuardContext(
      JSON.stringify({ role: 'anon' }),
      USER_A,
    );
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toBe('Not authenticated');
  });
});
