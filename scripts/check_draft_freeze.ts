// CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
// CATEGORY: UTILITY
// Purpose: Check draft freeze state for a league (debugging tool)
// Invoked: manual run when investigating draft state
// Reads:   leagues, draft_events
// Writes:  stdout
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

  // Query leagues with a scheduled_draft_time in the next 24 hours.
  // PostgREST filter: >= now() AND <= now() + 24h.
  const nowIso = new Date().toISOString();
  const windowEndIso = new Date(
    Date.now() + FREEZE_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const url =
    `${supabaseUrl}/rest/v1/leagues` +
    `?select=id,name,scheduled_draft_time` +
    `&scheduled_draft_time=gte.${encodeURIComponent(nowIso)}` +
    `&scheduled_draft_time=lte.${encodeURIComponent(windowEndIso)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
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
    id: string;
    name: string | null;
    scheduled_draft_time: string;
  }>;

  if (leagues.length === 0) {
    console.log(
      `check_draft_freeze: OK — no drafts scheduled in the next ${FREEZE_HOURS} hours.`,
    );
    return 0;
  }

  // Found at least one — block the deploy.
  console.error(
    `::error::Change freeze active: ${leagues.length} league(s) have a draft scheduled within ${FREEZE_HOURS} hours.`,
  );
  console.error('');
  for (const league of leagues) {
    const when = new Date(league.scheduled_draft_time).toISOString();
    const label = league.name ? `${league.name} (${league.id})` : league.id;
    console.error(`  - ${label} — draft at ${when}`);
  }
  console.error('');
  console.error(
    'Production deploys are blocked in the 24h window before any scheduled draft.',
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
