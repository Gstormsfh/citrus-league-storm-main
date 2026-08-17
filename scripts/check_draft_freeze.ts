// CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
// CATEGORY: ACTIVE
// Purpose:     Change-freeze gate. HARD-FAIL step in production-deploy.yml.
// Last active: 2026-08-11
// Invoked:     every push to master, before any deploy job runs
// Reads:       public.draft_freeze_blockers() RPC
// Writes:      stdout / GitHub annotations
// ────────────────────────────────────────────────────────────
/**
 * Change Freeze Guard — blocks deploys within 24 hours of any scheduled draft.
 *
 * Why this exists: On April 10 2026 the inaugural live draft failed in part
 * because ten production deploys landed in the 2.5 hours before puck drop.
 * Several of those deploys introduced the bugs that caused the outage.
 * See `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md` §4.
 *
 * This script queries Supabase for any league whose `scheduled_draft_time`
 * falls within the next 24 hours. If it finds one, it exits non-zero so the
 * CI deploy job fails.
 *
 * Bypass (emergency only): set OVERRIDE_DRAFT_FREEZE=1 in the workflow env.
 * The bypass must be manually approved and logged in the commit message.
 *
 * Usage (CI):
 *   npx tsx scripts/check_draft_freeze.ts
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read-only access is sufficient,
 *   but CI typically has service role for other steps already).
 *
 * Exit codes:
 *   0 — no drafts in freeze window, safe to deploy
 *   1 — draft scheduled within 24h, DO NOT DEPLOY
 *   2 — script error (missing env, network failure) — fail-closed
 */

const OVERRIDE_ENV = 'OVERRIDE_DRAFT_FREEZE';
const FREEZE_HOURS = 24;
// A draft counts as LIVE if it moved within this many hours. Evidence-based on
// purpose: three leagues have sat draft_status='in_progress' since April 2026,
// and blocking on that status alone would block every deploy forever.
const LIVE_HOURS = 6;

async function main(): Promise<number> {
  // Manual override — emergency bypass. Must be logged in commit message.
  if (process.env[OVERRIDE_ENV] === '1') {
    console.log(
      `::warning::Change freeze OVERRIDE is active (${OVERRIDE_ENV}=1). ` +
        'This bypass MUST be justified in the commit message and reviewed by an engineer.',
    );
    return 0;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(
      '::error::check_draft_freeze: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
    // Fail-closed: without DB access we can't verify — better to block than risk.
    return 2;
  }

  // Ask the database, via public.draft_freeze_blockers(). Two reasons that
  // logic lives in SQL rather than here:
  //
  //   1. It needs a join between leagues and the most recent non-deleted pick,
  //      which PostgREST cannot express in one call.
  //   2. It is behaviourally testable there. This script cannot be exercised in
  //      CI without a real database, so the part that decides gets proven by
  //      fault injection in SQL instead.
  //
  // It blocks on a draft scheduled inside the window AND on a draft that is
  // actually running now, which the previous version missed entirely --
  // scheduled_draft_time is in the past once a draft has started.
  const url = `${supabaseUrl}/rest/v1/rpc/draft_freeze_blockers`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_upcoming_hours: FREEZE_HOURS, p_live_hours: LIVE_HOURS }),
    });
  } catch (err) {
    console.error(
      `::error::check_draft_freeze: network error reaching Supabase: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }

  if (!res.ok) {
    console.error(
      `::error::check_draft_freeze: Supabase returned ${res.status} ${res.statusText}`,
    );
    console.error(await res.text());
    return 2;
  }

  const leagues = (await res.json()) as Array<{
    league_id: string;
    league_name: string | null;
    reason: string;
    at_time: string | null;
  }>;

  if (leagues.length === 0) {
    console.log(
      `check_draft_freeze: OK — no draft running now, and none scheduled in the next ${FREEZE_HOURS} hours.`,
    );
    return 0;
  }

  // Found at least one — block the deploy.
  console.error(
    `::error::Change freeze active: ${leagues.length} league(s) are drafting now or within ${FREEZE_HOURS} hours.`,
  );
  console.error('');
  for (const league of leagues) {
    const label = league.league_name
      ? `${league.league_name} (${league.league_id})`
      : league.league_id;
    const when = league.at_time ? new Date(league.at_time).toISOString() : 'unknown time';
    console.error(`  - ${label} — ${league.reason} (${when})`);
  }
  console.error('');
  console.error(
    'Production deploys are blocked during a live draft and in the 24h window before a scheduled one.',
  );
  console.error(
    'If this deploy is required to UNBLOCK a broken draft (not introduce new code),',
  );
  console.error(
    `set env var ${OVERRIDE_ENV}=1 in the workflow and justify in the commit message.`,
  );
  console.error('');
  console.error('See docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md §4 for why this exists.');

  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(
      `::error::check_draft_freeze: unexpected error: ${err instanceof Error ? err.stack : String(err)}`,
    );
    process.exit(2);
  });
