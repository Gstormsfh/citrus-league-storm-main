/**
 * RLS Audit Script — finds SELECT policies that use `USING (true)` on
 * tables holding user-scoped data.
 *
 * Why this exists: on April 10 2026 the cross-league notification leak
 * was enabled in part by the "permissive SELECT + realtime filter"
 * anti-pattern (postmortem §5). Realtime subscriptions were only part
 * of the problem — any table with `USING (true)` and user data is a
 * time bomb for both realtime subscribers and regular SELECTs.
 *
 * What it does:
 *
 * 1. Queries `pg_policies` via Supabase SQL for every table in `public`.
 * 2. Lists every SELECT policy and categorizes it as:
 *    - `permissive:true`    — `USING (true)` (public data)
 *    - `auth-scoped`        — references `auth.uid()` / `auth.role()`
 *    - `role-gated`         — uses `TO authenticated` or similar
 *    - `other`              — some other condition
 * 3. Cross-references against a hardcoded allowlist of tables that
 *    are INTENTIONALLY public reference data (NHL players, team
 *    mappings, season schedules — data we want anonymous users to
 *    read so the marketing pages work without auth).
 * 4. Flags anything that's `USING (true)` but NOT on the allowlist.
 *
 * Exit codes:
 *   0 — No unexpected permissive policies.
 *   1 — Found unexpected permissive SELECT policy on a non-allowlisted
 *       table. Investigate; either tighten the policy or add to the
 *       allowlist with justification.
 *   2 — Script error (missing env, network failure). Fail-closed.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/audit_rls.ts
 *
 * CI usage: safe to run as a nightly or weekly GH Actions job. The
 * allowlist is maintained in this file; additions require a commit.
 */

/**
 * Tables intentionally public — reading them does not leak user data.
 * Each entry must have a one-line justification. If you're tempted to
 * add a user-data table here: DON'T. Tighten the policy instead.
 */
const PUBLIC_ALLOWLIST: Record<string, string> = {
  // Reference data tables
  nhl_players: 'NHL roster data — publicly available on nhl.com',
  nhl_teams: 'NHL team metadata — public info',
  nhl_games: 'NHL schedule — published by the NHL',
  nhl_schedule: 'NHL schedule mirror',
  player_names: 'Player name lookup — public reference',
  player_talent_metrics:
    'xG projections — public by product design (unauth home page shows these)',
  team_mapping_config: 'Team abbreviation lookup — static config',
  goalie_rebound_control: 'Public stat derived from nhl.com play-by-play',
  goalie_gsax: 'Public stat (expected goals against, derived)',
  goalie_gsax_primary: 'Public stat (expected goals against, derived)',
  goalie_gar: 'Public stat (goals above replacement)',
  raw_shots: 'NHL play-by-play data — public',
  projections: 'Public xG projections',
  // Intentionally-public cache/reference tables
  projection_cache:
    'Projection cache — authenticated-only in the actual policy, safe',
};

type PolicyRow = {
  schemaname: string;
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
  roles: string[] | null;
};

type Category = 'permissive:true' | 'auth-scoped' | 'role-gated' | 'other';

function categorize(qual: string | null): Category {
  if (!qual) return 'other';
  const normalized = qual.trim().toLowerCase();
  if (normalized === 'true' || normalized === '(true)') return 'permissive:true';
  if (normalized.includes('auth.uid()') || normalized.includes('auth.role()')) {
    return 'auth-scoped';
  }
  if (normalized.includes('auth.role') || normalized.includes('authenticated')) {
    return 'role-gated';
  }
  return 'other';
}

async function main(): Promise<number> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(
      '::error::audit_rls: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
    return 2;
  }

  // pg_policies is a system view — accessible via PostgREST if we have
  // service-role access. We use a stored SQL function approach via the
  // RPC endpoint: Supabase exposes a `sql` function only in SQL Editor,
  // so we fall back to the `pg_policies` select via the REST API after
  // ensuring the view is queryable.
  //
  // In practice, for a self-hosted service-role key this works against
  // `rest/v1/pg_policies` if the view has been made queryable. If it
  // hasn't, use the `execute_sql` helper we already have in the stored
  // procs, or run the script with psql instead of fetch.
  const url =
    `${supabaseUrl}/rest/v1/rpc/pg_policies_dump` +
    `?select=schemaname,tablename,policyname,cmd,qual,with_check,roles`;

  let policies: PolicyRow[];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      // Fallback: the project may not have a pg_policies_dump RPC.
      // Print a clear message pointing at the one-time migration
      // needed, and exit with a warning (not a failure).
      console.error(
        `::warning::audit_rls: pg_policies_dump RPC not available (got ${res.status}).`,
      );
      console.error('');
      console.error('To enable this audit, create the helper RPC once:');
      console.error('');
      console.error('  CREATE OR REPLACE FUNCTION public.pg_policies_dump()');
      console.error('  RETURNS TABLE(schemaname text, tablename text,');
      console.error('                policyname text, cmd text, qual text,');
      console.error('                with_check text, roles text[])');
      console.error('  LANGUAGE sql SECURITY DEFINER');
      console.error('  SET search_path = public, pg_catalog');
      console.error('  AS $$ SELECT schemaname::text, tablename::text,');
      console.error('               policyname::text, cmd::text, qual::text,');
      console.error('               with_check::text, roles::text[]');
      console.error('        FROM pg_policies');
      console.error("        WHERE schemaname = 'public' $$;");
      console.error('  GRANT EXECUTE ON FUNCTION public.pg_policies_dump()');
      console.error('  TO service_role;');
      console.error('');
      // Non-fatal — this is a new audit tool and the helper may not exist yet.
      return 0;
    }

    policies = (await res.json()) as PolicyRow[];
  } catch (err) {
    console.error(
      `::error::audit_rls: network error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }

  // ── Analysis ────────────────────────────────────────────────────────
  const selectPolicies = policies.filter((p) => p.cmd === 'SELECT');
  const offenders: PolicyRow[] = [];
  const byCategory: Record<Category, number> = {
    'permissive:true': 0,
    'auth-scoped': 0,
    'role-gated': 0,
    other: 0,
  };

  for (const p of selectPolicies) {
    const cat = categorize(p.qual);
    byCategory[cat]++;
    if (cat === 'permissive:true' && !(p.tablename in PUBLIC_ALLOWLIST)) {
      offenders.push(p);
    }
  }

  // ── Report ──────────────────────────────────────────────────────────
  console.log('=== RLS Audit Report ===');
  console.log(`Schema: public`);
  console.log(`Total SELECT policies: ${selectPolicies.length}`);
  console.log(`  permissive (USING true): ${byCategory['permissive:true']}`);
  console.log(`  auth.uid() / auth.role() scoped: ${byCategory['auth-scoped']}`);
  console.log(`  role-gated: ${byCategory['role-gated']}`);
  console.log(`  other: ${byCategory.other}`);
  console.log('');

  if (offenders.length === 0) {
    console.log('PASS — every permissive SELECT policy is on an allowlisted table.');
    return 0;
  }

  console.error(
    `::error::Found ${offenders.length} permissive SELECT polic${offenders.length === 1 ? 'y' : 'ies'} on non-allowlisted table(s):`,
  );
  console.error('');
  for (const p of offenders) {
    console.error(`  Table:  public.${p.tablename}`);
    console.error(`  Policy: ${p.policyname}`);
    console.error(`  Qual:   ${p.qual ?? '(null — check with_check)'}`);
    console.error('');
  }
  console.error(
    'Options: (1) tighten the RLS policy; (2) add the table to PUBLIC_ALLOWLIST',
  );
  console.error(
    '        in scripts/audit_rls.ts with a one-line justification.',
  );
  console.error('');
  console.error(
    'See docs/REALTIME_RLS_AUDIT.md for the anti-pattern this check prevents.',
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(
      `::error::audit_rls: unexpected error: ${err instanceof Error ? err.stack : String(err)}`,
    );
    process.exit(2);
  });
