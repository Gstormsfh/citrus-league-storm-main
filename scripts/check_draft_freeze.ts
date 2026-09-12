// CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
// CATEGORY: ACTIVE
// Purpose:     Change-freeze gate. HARD-FAIL step in production-deploy.yml.
// Last active: 2026-09-12
// Invoked:     every push to master, before any deploy job runs
// Reads:       public.draft_freeze_blockers() RPC
// Writes:      stdout / GitHub annotations
// ────────────────────────────────────────────────────────────
/**
 * Change Freeze Guard — blocks deploys close to any scheduled draft.
 *
 * Why this exists: On April 10 2026 the inaugural live draft failed in part
 * because ten production deploys landed in the 2.5 hours before puck drop.
 * Several of those deploys introduced the bugs that caused the outage.
 * See `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md` §4.
 *
 * TWO WINDOWS, NOT ONE
 * --------------------
 * The postmortem asked for a flat 24-hour freeze (§4 Fix, and the P1 list).
 * That was written when no league had ever carried a `scheduled_draft_time`,
 * so the gate has fired exactly zero times in its life — the column is null
 * for all 69 production leagues as of 2026-09-12. Commissioner-set draft
 * times ship in this release, which arms the gate for the first time, and a
 * flat 24h rule arms it badly: one league drafting at 19:00 blocks every
 * deploy from 19:00 the previous day, and a handful of leagues on
 * consecutive evenings during season open blocks the entire week. A freeze
 * that blocks every deploy for a week is a freeze that gets overridden by
 * reflex, and an override used by reflex protects nothing.
 *
 * So the 24 hours are kept, but split by severity:
 *
 *   - HARD_HOURS  — exit 1, deploy refused. Sized to cover the documented
 *                   disaster window (the ten deploys ran from 2.5h out) with
 *                   margin on both sides.
 *   - WARN_HOURS  — exit 0 plus a ::warning:: annotation naming the league
 *                   and the time. The deploy proceeds; the human sees it and
 *                   decides.
 *
 * A draft that is actually RUNNING is not affected by this split. Reasons 2
 * and 3 inside `draft_freeze_blockers` key off `p_live_hours`, not
 * `p_upcoming_hours`, so they come back from the hard call whatever the
 * upcoming window is set to, and they always block.
 *
 * Because the hard call short-circuits, the advisory call only runs when
 * nothing is blocking — which is why deduplicating the two result sets by
 * league_id alone is sound here.
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
 *   0 — safe to deploy (possibly with a warning about a draft 4-24h out)
 *   1 — draft running now, or one scheduled inside HARD_HOURS. DO NOT DEPLOY
 *   2 — script error (missing env, network failure) — fail-closed
 */

const OVERRIDE_ENV = 'OVERRIDE_DRAFT_FREEZE';

/** Inside this window the deploy is refused. Keep in step with deploy-engine.yml's "Last look". */
const HARD_HOURS = 4;
/** Out to here the deploy proceeds with a warning annotation. */
const WARN_HOURS = 24;
// A draft counts as LIVE if it moved within this many hours. Evidence-based on
// purpose: three leagues have sat draft_status='in_progress' since April 2026,
// and blocking on that status alone would block every deploy forever.
const LIVE_HOURS = 6;

type Blocker = {
  league_id: string;
  league_name: string | null;
  reason: string;
  at_time: string | null;
};

type BlockerResult =
  | { ok: true; blockers: Blocker[] }
  | { ok: false; message: string };

/**
 * Ask the database, via public.draft_freeze_blockers(). Two reasons that
 * logic lives in SQL rather than here:
 *
 *   1. It needs a join between leagues and the most recent non-deleted pick,
 *      which PostgREST cannot express in one call.
 *   2. It is behaviourally testable there. This script cannot be exercised in
 *      CI without a real database, so the part that decides gets proven by
 *      fault injection in SQL instead.
 *
 * It blocks on a draft scheduled inside the window AND on a draft that is
 * actually running now, which the original version missed entirely --
 * scheduled_draft_time is in the past once a draft has started.
 */
async function fetchBlockers(
  supabaseUrl: string,
  serviceKey: string,
  upcomingHours: number,
): Promise<BlockerResult> {
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
      body: JSON.stringify({ p_upcoming_hours: upcomingHours, p_live_hours: LIVE_HOURS }),
    });
  } catch (err) {
    return {
      ok: false,
      message: `network error reaching Supabase: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      message: `Supabase returned ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    };
  }

  return { ok: true, blockers: (await res.json()) as Blocker[] };
}

function describe(league: Blocker): string {
  const label = league.league_name
    ? `${league.league_name} (${league.league_id})`
    : league.league_id;
  const when = league.at_time ? new Date(league.at_time).toISOString() : 'unknown time';
  return `${label} — ${league.reason} (${when})`;
}

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

  // ---- Hard window. This is the one that can refuse the deploy. ----
  const hard = await fetchBlockers(supabaseUrl, serviceKey, HARD_HOURS);
  if (!hard.ok) {
    console.error(`::error::check_draft_freeze: ${hard.message}`);
    return 2;
  }

  if (hard.blockers.length > 0) {
    console.error(
      `::error::Change freeze active: ${hard.blockers.length} league(s) are drafting now or within ${HARD_HOURS} hours.`,
    );
    console.error('');
    for (const league of hard.blockers) console.error(`  - ${describe(league)}`);
    console.error('');
    console.error(
      `Production deploys are blocked during a live draft and in the ${HARD_HOURS}h window before a scheduled one.`,
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

  // ---- Advisory window. Nothing here can refuse the deploy. ----
  //
  // Deliberately NOT fail-closed. The safety property is carried entirely by
  // the hard call above, which already succeeded and came back clean. Turning
  // a hiccup on an informational lookup into a red deploy would block a build
  // we have just proven is safe to ship, and that is how a gate earns a
  // standing override.
  const soon = await fetchBlockers(supabaseUrl, serviceKey, WARN_HOURS);
  if (!soon.ok) {
    console.log(
      `::warning::check_draft_freeze: no draft is blocking, but the ${WARN_HOURS}h advisory lookup failed (${soon.message}). Proceeding.`,
    );
    return 0;
  }

  const hardIds = new Set(hard.blockers.map((b) => b.league_id));
  const upcoming = soon.blockers.filter((b) => !hardIds.has(b.league_id));

  if (upcoming.length === 0) {
    console.log(
      `check_draft_freeze: OK — no draft running now, and none scheduled in the next ${WARN_HOURS} hours.`,
    );
    return 0;
  }

  console.log(
    `::warning::${upcoming.length} league(s) draft within ${WARN_HOURS} hours. Deploy allowed (the hard freeze is ${HARD_HOURS}h) — ship carefully and watch the draft room.`,
  );
  for (const league of upcoming) console.log(`  - ${describe(league)}`);
  console.log(
    `check_draft_freeze: OK — nothing inside the ${HARD_HOURS}h hard freeze.`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(
      `::error::check_draft_freeze: unexpected error: ${err instanceof Error ? err.stack : String(err)}`,
    );
    process.exit(2);
  });
