#!/usr/bin/env node
// scripts/proof/draft-harness.mjs
//
// Draft perf harness — first honest Mandate measurements
// (chunk 11g.10 sub-step 10c-2). Spins up M heartbeat-compliant WS
// clients, drives picks in snake-draft order via submit_pick_v2 direct
// pg, and records submit→client-receive latencies on a SINGLE CLOCK
// (harness host).
//
// Methodology laws (from the 10c-2 spec):
//   1. SINGLE-CLOCK: every latency = two timestamps from the harness
//      host's own clock. Engine-internal splits (applyMs, broadcastMs,
//      notifyToBroadcastMs from `external_event.applied` log lines,
//      joined on seq) reported SEPARATELY — cross-clock, informational.
//   2. Percentiles only: p50/p90/p95/p99/max + N. Minimum 200 samples
//      per scenario before quoting. No means, no single-shot.
//   3. Every output labeled MANDATE-CANDIDATE until Garrett ratifies
//      the methodology against the first results.
//   4. Drop rate + per-client seq ordering violations = first-class
//      metrics, always reported, target 0.
//   5. Cold/warm tagged separately (first pick after lobby
//      construction = cold bootstrap sample).
//
// Usage:
//   node scripts/proof/draft-harness.mjs --scenario=S1
//   node scripts/proof/draft-harness.mjs --scenario=S2 --clients=12 --rounds=3
//   node scripts/proof/draft-harness.mjs --scenario=S3 --burst
//   node scripts/proof/draft-harness.mjs --scenario=S4 --idle-minutes=30
//
// Env:
//   SUPABASE_DB_URL       direct primary URL (NOT pooled)
//   SUPABASE_JWT_SECRET   HS256 signing secret for draft-token JWTs
//   HOST                  engine host (default 35.203.89.236)
//   WS_PORT               uWS port (default 3002)
//
// Prereq: fixture-12 applied. Harness verifies league_size, draft_state,
// and draft_order matches expectation before starting; aborts with
// remediation guidance if not.

import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, createWriteStream, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  WHITELISTED_LEAGUE_ID as LEGACY_LEAGUE_ID,
  HARNESS_TEAM_IDS,
  HARNESS_USER_IDS,
  HARNESS_PLAYER_IDS,
  HARNESS_SESSION_ID,
  TEAM_COUNT,
  harnessUserId,
} from './fixture-12.mjs';
import { connectDraftClient } from './lib/ws-client.mjs';
import { formatSummary } from './lib/percentiles.mjs';

// F27 (2026-08-07): 993c9219 is RETIRED PERMANENTLY per architect ruling.
// Rig runs use fresh F27-native leagues via env override; legacy S1-S4 perf
// runs against 993c9219 emit a loud warning + still work for now (backward
// compat window). Follow-up task: retire the legacy fallback entirely once
// perf scenarios are re-run against F27-native leagues.
const F27_NATIVE_LEAGUE_ID = process.env.F27_NATIVE_LEAGUE_ID;
const WHITELISTED_LEAGUE_ID = F27_NATIVE_LEAGUE_ID ?? LEGACY_LEAGUE_ID;
if (!F27_NATIVE_LEAGUE_ID) {
  console.warn(
    `⚠ draft-harness: F27_NATIVE_LEAGUE_ID not set; falling back to LEGACY league ${LEGACY_LEAGUE_ID} — this league is RETIRED per architect ruling 2026-08-07 00:05. Set F27_NATIVE_LEAGUE_ID env for F27-native rigs.`,
  );
}

// Silence lint on unused HARNESS_SESSION_ID / harnessUserId — they're
// re-exported for external callers even if this file doesn't use them.
void HARNESS_SESSION_ID;
void harnessUserId;

// ── CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const SCENARIO = opt('scenario', 'S1');
const CLIENTS = parseInt(opt('clients', SCENARIO === 'S1' ? '1' : '12'), 10);
const ROUNDS = parseInt(opt('rounds', '3'), 10);
const BURST = flag('burst') || SCENARIO === 'S3';
const IDLE_MINUTES = parseInt(opt('idle-minutes', SCENARIO === 'S4' ? '30' : '0'), 10);
// After this many picks, S4 pauses for IDLE_MINUTES then resumes.
const IDLE_AFTER_PICKS = parseInt(opt('idle-after-picks', '6'), 10);
const PACE_MIN_MS = parseInt(opt('pace-min-ms', '2000'), 10);
const PACE_MAX_MS = parseInt(opt('pace-max-ms', '5000'), 10);
const RECEIVE_TIMEOUT_MS = parseInt(opt('receive-timeout-ms', '15000'), 10);
const OUT_DIR = opt('out-dir', join(dirname(fileURLToPath(import.meta.url)), 'results'));
const RUN_ID = opt('run-id', new Date().toISOString().replace(/[:.]/g, '-'));

// Chunk 11g.10 sub-step 10c-2 batch 1 (item 4): S5 scenario — autopick
// timing verification. Submit k manual picks, then STOP the pick driver
// and wait for the engine's autopick to fire at t ≈ pickTimeLimit+1 s
// (the RPC's +1 s pad; see pick-clock audit Q1). The next `pick` event
// frame we receive is the autopick; measure its receive_ts relative to
// the last-submit's returned `pick_deadline` from the RPC.
//
// Order matters: EXPECTED_PICK_CLOCK_SEC must be parsed BEFORE
// AUTOPICK_TIMEOUT_MS so the default timeout can be computed as
// (expectedPickClock + 30) * 1000. Prior default was a fixed 60000 ms
// which under-provisions the wait for a 90-s pick clock (the tolerance
// upper bound is (90+10) = 100 s, but we'd only wait 60 s and time
// out with a false-negative). The startup assert below fails fast if
// the effective timeout is <= the tolerance upper bound.
const EXPECTED_PICK_CLOCK_SEC = opt('expected-pick-clock', null);
const AUTOPICK_TIMEOUT_MS = (() => {
  const explicit = opt('autopick-timeout-ms', null);
  if (explicit !== null) return parseInt(explicit, 10);
  // Default derivation: 30 s of headroom past the tolerance upper
  // bound gives real network + broadcast-fanout latency a safe budget.
  // Only meaningful for S5; for other scenarios the value is unused.
  if (EXPECTED_PICK_CLOCK_SEC !== null && EXPECTED_PICK_CLOCK_SEC !== undefined) {
    const clock = parseInt(EXPECTED_PICK_CLOCK_SEC, 10);
    if (Number.isFinite(clock) && clock > 0) {
      return (clock + 30) * 1000;
    }
  }
  // Fallback for scenarios that don't use this value (S1..S4).
  return 60_000;
})();
const S5_PRE_AUTOPICK_PICKS = parseInt(opt('s5-pre-autopick-picks', '3'), 10);

// DR-2 (2026-07-29) — --human-slot=N tells the driver to SKIP driving
// the pick whose snake team is slot N, and instead WAIT (generous
// timeout via --human-wait-ms; default = pickClock*1000 + 15000) for
// the seq to advance externally (a real user submitting via the
// browser). On arrival, the driver resumes. The waited pick is a
// full sample in delivery stats; it counts toward the 12/12 acceptance
// criterion. Soft-skip: if the human times out, the driver continues
// with the next pick's harness driver — but the summary prints a
// first-class "HUMAN PICK: TIMED OUT" line per architect Q6 amendment.
const humanSlotArg = opt('human-slot', null);
const HUMAN_SLOT = humanSlotArg !== null ? parseInt(humanSlotArg, 10) : null;
const humanWaitArg = opt('human-wait-ms', null);
const HUMAN_WAIT_MS = humanWaitArg !== null
  ? parseInt(humanWaitArg, 10)
  : (EXPECTED_PICK_CLOCK_SEC !== null && EXPECTED_PICK_CLOCK_SEC !== undefined
      ? (parseInt(EXPECTED_PICK_CLOCK_SEC, 10) * 1000 + 15_000)
      : 45_000);
if (HUMAN_SLOT !== null) {
  if (!Number.isFinite(HUMAN_SLOT) || HUMAN_SLOT < 1 || HUMAN_SLOT > 12) {
    console.error(`FATAL: invalid --human-slot value ${HUMAN_SLOT} (expected 1..12).`);
    process.exit(2);
  }
}

if (flag('help') || flag('h')) {
  console.log(`Usage: node scripts/proof/draft-harness.mjs --scenario=<S1|S2|S3|S4|S5> [options]

Scenarios (each expects a fresh fixture-12 setup):
  S1  single-client 36-pick paced
  S2  12-client paced
  S3  12-client burst
  S4  12-client paced with mid-draft ${IDLE_MINUTES}-min idle then resume
  S5  12-client autopick timing verification (batch 1 item 4)
      Submits N pre-autopick picks then stops the driver. Waits up to
      --autopick-timeout-ms (default 60000) for the engine's autopick
      event frame. Asserts the received deadline delta is within a
      (N-2..N+10) window around --expected-pick-clock. Run twice:
      once with fixture-12 --pick-clock=30 and --expected-pick-clock=30,
      once with --pick-clock=90 and --expected-pick-clock=90.

Options (env-tunable defaults):
  --clients=N                (default: 1 for S1, 12 for S2-S5)
  --rounds=N                 (default: 3 → 36 picks)
  --burst                    (skip inter-pick pacing; implied by S3)
  --idle-minutes=N           (S4 only; default 30)
  --idle-after-picks=N       (S4 only; default 6)
  --autopick-timeout-ms=N    (S5 only; default (expectedPickClock + 30) * 1000 ms — must exceed the tolerance upper bound)
  --s5-pre-autopick-picks=N  (S5 only; default 3 — how many picks before letting timer expire)
  --expected-pick-clock=N    (S5 only; expected pickTimeLimit — used for tolerance window assertion)
  --pace-min-ms=N            (default 2000)
  --pace-max-ms=N            (default 5000)
  --receive-timeout-ms=N     (default 15000)
  --out-dir=PATH             (default scripts/proof/results)
  --run-id=STR               (default timestamp)

Env: SUPABASE_DB_URL, SUPABASE_JWT_SECRET, HOST, WS_PORT.
Fixture prereq: scripts/proof/fixture-12.mjs --execute --rounds=N
S5 additionally requires: --pick-clock=N on fixture (writes settings.pickTimeLimit)
Between scenarios: --reset then --execute the fixture.
`);
  process.exit(0);
}

if (!['S1', 'S2', 'S3', 'S4', 'S5'].includes(SCENARIO)) {
  console.error(`FATAL: unknown scenario ${SCENARIO} (expected S1..S5).`);
  process.exit(2);
}
if (SCENARIO === 'S5' && (EXPECTED_PICK_CLOCK_SEC === null || EXPECTED_PICK_CLOCK_SEC === undefined)) {
  console.error('FATAL: S5 requires --expected-pick-clock=<N> to be set.');
  console.error('       Run fixture-12 with --pick-clock=N first, then pass the same N here.');
  process.exit(2);
}
// S5 autopick-timeout must exceed the tolerance window's upper bound
// or every S5 sample will time out as a false-negative drop.
// Tolerance upper = (expectedPickClock + 10) * 1000. Autopick timeout
// MUST be strictly greater; the default derivation gives 20 s of
// headroom past that so the default always passes. A user-provided
// --autopick-timeout-ms that trips this assert is almost certainly
// the 60 s left-over from a 30-s clock run being reused on a 90-s
// clock (the 2026-07-27 miscalibration this assert is here to prevent).
if (SCENARIO === 'S5') {
  const clock = parseInt(EXPECTED_PICK_CLOCK_SEC, 10);
  const toleranceUpperMs = (clock + 10) * 1000;
  if (!(AUTOPICK_TIMEOUT_MS > toleranceUpperMs)) {
    console.error('FATAL: --autopick-timeout-ms is too small for --expected-pick-clock.');
    console.error(`       autopickTimeoutMs=${AUTOPICK_TIMEOUT_MS} ms`);
    console.error(`       expectedPickClock=${clock} s → tolerance upper bound=${toleranceUpperMs} ms`);
    console.error('       The wait MUST exceed the tolerance upper bound; otherwise every S5');
    console.error('       sample times out as a false-negative drop before the autopick can');
    console.error(`       arrive. Recommended minimum: ${(clock + 10) * 1000 + 1000} ms; default is`);
    console.error(`       ${(clock + 30) * 1000} ms (30 s of network + fanout headroom past the`);
    console.error('       tolerance upper). Omit --autopick-timeout-ms to accept the default.');
    process.exit(2);
  }
}
if (CLIENTS < 1 || CLIENTS > TEAM_COUNT) {
  console.error(`FATAL: --clients must be in 1..${TEAM_COUNT} (got ${CLIENTS}).`);
  process.exit(2);
}

const DB_URL = process.env.SUPABASE_DB_URL;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const HOST = process.env.HOST || '35.203.89.236';
const WS_PORT = Number(process.env.WS_PORT || 3002);
// F1 chunk (2026-07-28): scheme override for WSS acceptance against
// the TLS-terminating Caddy sidecar. Plain ws stays default during
// the tooling transition. Example env for wss acceptance:
//   HOST=draft-staging.citrusfantasysports.com WS_PORT=443 SCHEME=wss node draft-harness.mjs ...
const SCHEME = process.env.SCHEME || 'ws';
if (!DB_URL) { console.error('FATAL: SUPABASE_DB_URL not set.'); process.exit(2); }
if (!JWT_SECRET) { console.error('FATAL: SUPABASE_JWT_SECRET not set.'); process.exit(2); }
for (const pat of ['pooler.supabase.com', 'pgbouncer', ':6543']) {
  if (DB_URL.includes(pat)) {
    console.error(`FATAL: SUPABASE_DB_URL contains pooled pattern "${pat}" (KI-E010).`);
    process.exit(2);
  }
}

// S5 submits only the pre-autopick picks and then waits for the engine's
// autopick timer to fire — see the S5 autopick-wait phase in main().
const TOTAL_PICKS =
  SCENARIO === 'S5'
    ? S5_PRE_AUTOPICK_PICKS
    : TEAM_COUNT * ROUNDS;

// ── Banner ──────────────────────────────────────────────────────────
console.log('');
console.log('╔═══════════════════════════════════════════════════════════════════════╗');
console.log(`║          10c-2 draft perf harness — MANDATE-CANDIDATE          ${SCENARIO.padStart(4)}   ║`);
console.log('╠═══════════════════════════════════════════════════════════════════════╣');
console.log(`║  scenario:            ${SCENARIO.padEnd(48)}║`);
console.log(`║  WS clients:          ${String(CLIENTS).padEnd(48)}║`);
console.log(`║  rounds:              ${String(ROUNDS).padEnd(48)}║`);
console.log(`║  total picks:         ${String(TOTAL_PICKS).padEnd(48)}║`);
console.log(`║  pacing:              ${(BURST ? 'burst (0 ms)' : `paced ${PACE_MIN_MS}-${PACE_MAX_MS} ms jitter`).padEnd(48)}║`);
if (SCENARIO === 'S4') {
  console.log(`║  idle after picks:    ${String(IDLE_AFTER_PICKS).padEnd(48)}║`);
  console.log(`║  idle duration:       ${(IDLE_MINUTES + ' minutes').padEnd(48)}║`);
}
console.log(`║  WS target:           ${`${SCHEME}://${HOST}:${WS_PORT}`.padEnd(48)}║`);
console.log(`║  league:              ${WHITELISTED_LEAGUE_ID.padEnd(48)}║`);
console.log(`║  run id:              ${RUN_ID.padEnd(48)}║`);
console.log('╚═══════════════════════════════════════════════════════════════════════╝');
console.log('');

// ── Helpers ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function randomPace() {
  return PACE_MIN_MS + Math.floor(Math.random() * (PACE_MAX_MS - PACE_MIN_MS + 1));
}
// Snake draft order (matches fixture-12's snakeTeamOrder).
function snakeTeamForPick(pickNumber) {
  const round = Math.ceil(pickNumber / TEAM_COUNT);
  const pickInRound = ((pickNumber - 1) % TEAM_COUNT) + 1;
  const order = round % 2 === 1
    ? HARNESS_TEAM_IDS
    : HARNESS_TEAM_IDS.slice().reverse();
  return { round, pickInRound, teamId: order[pickInRound - 1] };
}
function computePayloadHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// ── Fixture preflight ───────────────────────────────────────────────
async function verifyFixture(client) {
  console.log('── FIXTURE PREFLIGHT ──');
  const league = await client.query(
    `SELECT draft_state, league_size, draft_event_counter,
            settings->>'pickTimeLimit' AS pick_time_limit
       FROM public.leagues WHERE id = $1`,
    [WHITELISTED_LEAGUE_ID],
  );
  if (league.rows.length === 0) {
    throw new Error('league row missing — run fixture-12 --execute first');
  }
  const l = league.rows[0];
  console.log(`  leagues: draft_state=${l.draft_state} league_size=${l.league_size} draft_event_counter=${l.draft_event_counter}`);
  if (l.draft_state !== 'active') throw new Error(`draft_state=${l.draft_state} (expected active)`);
  if (l.league_size !== TEAM_COUNT) throw new Error(`league_size=${l.league_size} (expected ${TEAM_COUNT})`);
  if (l.draft_event_counter !== 0 && l.draft_event_counter !== '0') {
    throw new Error(`draft_event_counter=${l.draft_event_counter} (expected 0 — reset before running)`);
  }

  const eventsCount = (await client.query(
    `SELECT count(*)::int AS c FROM public.draft_events WHERE league_id = $1`,
    [WHITELISTED_LEAGUE_ID],
  )).rows[0].c;
  const picksCount = (await client.query(
    `SELECT count(*)::int AS c FROM public.draft_picks_v2 WHERE league_id = $1`,
    [WHITELISTED_LEAGUE_ID],
  )).rows[0].c;
  console.log(`  draft_events count=${eventsCount}   draft_picks_v2 count=${picksCount}`);
  if (eventsCount > 0 || picksCount > 0) {
    throw new Error(`league has existing events (${eventsCount}) or picks (${picksCount}); reset first`);
  }

  const teams = (await client.query(
    `SELECT count(*)::int AS c FROM public.teams WHERE id::text LIKE '77777777-%'`,
  )).rows[0].c;
  console.log(`  harness teams present: ${teams}/${TEAM_COUNT}`);
  if (teams !== TEAM_COUNT) throw new Error(`expected ${TEAM_COUNT} harness teams, found ${teams}`);

  const rounds = (await client.query(
    `SELECT count(*)::int AS c FROM public.draft_order WHERE league_id = $1`,
    [WHITELISTED_LEAGUE_ID],
  )).rows[0].c;
  console.log(`  draft_order rounds present: ${rounds}`);
  if (rounds < ROUNDS) throw new Error(`draft_order has ${rounds} rounds, need at least ${ROUNDS}`);

  console.log('  ✓ preflight passed.');
}

// ── Pick driver ─────────────────────────────────────────────────────
//
// For each pick, records:
//   submitCallTs         — Date.now() immediately before pg RPC
//   rpcMs                — Date.now() diff around pg RPC
//   seq                  — returned by RPC
//   receiveTs[client]    — Date.now() when THIS client's WS receives
//                          the matching `event` frame; null on timeout
//
// Timeout for receive is 15 s per client per pick (configurable). If
// a client doesn't receive within timeout, it's a drop for that
// (pick, client) sample; the harness continues.
//
// Per-client last-received-seq tracks ordering violations (a seq
// arriving out of monotonic order).

async function runPickDriver(initialPgClient, wsClients, onSample = () => {}) {
  // Chunk 11g.10 sub-step 10c-2 (R3 review fix): pgClient is mutable
  // so the S4 idle loop can swap it if the connection dies mid-idle.
  // All uses inside this function go through the local; the outer
  // caller retains the initial handle only for cleanup at end().
  //
  // F13 (2026-07-31): `onSample(sample)` is invoked after every
  // `samples.push(sample)` so an NDJSON append stream can capture the
  // sample immediately. Crash-safety: if the process dies mid-run,
  // every sample up to the last successful push is already on disk.
  let pgClient = initialPgClient;
  const samples = [];
  const pushSample = (s) => {
    samples.push(s);
    try {
      onSample(s);
    } catch {
      // Never let the sample-write path abort the driver — the
      // fault-flush path will handle recovery.
    }
  };
  const perClientLastSeq = new Map(wsClients.map((c) => [c.clientLabel, -1]));

  // Attach per-pick receive resolvers. Each client's onEvent callback
  // resolves the corresponding waiter map entry, keyed by seq.
  const receiveWaiters = new Map(wsClients.map((c) => [
    c.clientLabel,
    new Map(), // seq -> {resolve, receivedAt (set on fire)}
  ]));

  // F7 (2026-07-29) — ws-client.mjs:260 `onEvent(cb)` is a SETTER, not
  // add-listener; each call overwrites the previous callback. The
  // --human-slot wait branch (below) installs its own onEvent to filter
  // by pickNumber. Without restoration, subsequent picks arrive but hit
  // the human-slot filter and are silently dropped, freezing delivery
  // accounting at 0/N for all post-wait picks. Extract the default
  // receive-waiter callback so it can be re-installed after each
  // human-slot resolution branch.
  const installDefaultReceiveHandler = (c) => {
    c.onEvent(({ seq, receivedAt }) => {
      // Ordering violation check.
      const last = perClientLastSeq.get(c.clientLabel) ?? -1;
      if (seq <= last) {
        console.warn(`  ⚠ ordering violation: ${c.clientLabel} received seq=${seq} after last=${last}`);
      }
      perClientLastSeq.set(c.clientLabel, seq);
      const waiters = receiveWaiters.get(c.clientLabel);
      const w = waiters.get(seq);
      if (w) {
        w.receivedAt = receivedAt;
        w.resolve(receivedAt);
        waiters.delete(seq);
      }
    });
  };

  for (const c of wsClients) {
    installDefaultReceiveHandler(c);
  }

  // Set request.jwt.claims once per pg connection so the RPC's
  // auth.role() returns 'service_role' (per live-proof pattern).
  await pgClient.query(`SET SESSION "request.jwt.claims" TO '{"role":"service_role"}'`);

  // DR-2 (2026-07-29): human-slot outcome tracker. Populated by the
  // human-wait path; consumed by the summary block for the mandatory
  // first-class outcome line (architect Q6 amendment).
  const humanOutcomes = [];

  for (let pickNumber = 1; pickNumber <= TOTAL_PICKS; pickNumber++) {
    const { round, teamId } = snakeTeamForPick(pickNumber);

    // DR-2 (2026-07-29): if this pick's team is the --human-slot team,
    // SKIP the RPC and WAIT for the seq to advance externally via any
    // client's WS event stream. Soft-skip on timeout so post-human
    // picks continue driving (matches architect Q6 ratification).
    if (
      HUMAN_SLOT !== null &&
      teamId === HARNESS_TEAM_IDS[HUMAN_SLOT - 1]
    ) {
      console.log(
        `  pick ${String(pickNumber).padStart(3)}  team=${teamId.slice(0, 8)}  ` +
          `HUMAN SLOT (skip harness driver; wait up to ${HUMAN_WAIT_MS} ms)`,
      );
      // DR-2 (2026-07-29) EVIDENCE FIX: match ANY event with the
      // human's expected pickNumber (whether human OR autopick), then
      // inspect the payload to determine actor. isAutopick is a
      // top-level field on the pick_submitted wire event
      // (BufferedDraftEvent per @citrus/shared): present + true means
      // engine-authored autopick, absent/false means user-submitted.
      // Also capture playerId so the outcome line prints unambiguous
      // evidence a human can cross-check ("the player Garrett actually
      // typed vs the player the engine's projections chose").
      const humanWaitStart = Date.now();
      const perClientEventReceived = new Map(
        wsClients.map((c) => [c.clientLabel, null]),
      );
      const perClientPickDeadline = new Map(
        wsClients.map((c) => [c.clientLabel, null]),
      );
      const perClientIsAutopick = new Map(
        wsClients.map((c) => [c.clientLabel, null]),
      );
      const perClientPlayerId = new Map(
        wsClients.map((c) => [c.clientLabel, null]),
      );
      let observedSeq = null;
      for (const c of wsClients) {
        c.onEvent(({ frame, receivedAt, seq }) => {
          const parsed = frame.parsed;
          if (!parsed || parsed.type !== 'event') return;
          const p = parsed.payload;
          if (!p || p.pickNumber !== pickNumber) return;
          if (perClientEventReceived.get(c.clientLabel) !== null) return;
          perClientEventReceived.set(c.clientLabel, receivedAt);
          perClientIsAutopick.set(c.clientLabel, p.isAutopick === true);
          perClientPlayerId.set(c.clientLabel, p.playerId ?? null);
          if (typeof p.pickDeadline === 'string' && p.pickDeadline.length > 0) {
            perClientPickDeadline.set(c.clientLabel, p.pickDeadline);
          }
          if (observedSeq === null && Number.isFinite(seq)) observedSeq = seq;
        });
      }
      // Poll every 500 ms.
      while (Date.now() - humanWaitStart < HUMAN_WAIT_MS) {
        const allReceived = [...perClientEventReceived.values()].every(
          (v) => v !== null,
        );
        if (allReceived) break;
        await sleep(500);
      }
      const delivered = [...perClientEventReceived.values()].filter(
        (v) => v !== null,
      ).length;
      const elapsedMs = Date.now() - humanWaitStart;

      // DR-2 EVIDENCE FIX (2026-07-29): the pick 3 broadcast event
      // matches the wait's pickNumber filter WHETHER it was human OR
      // engine-authored autopick. isAutopick on the wire event
      // discriminates. All 12 clients see the SAME broadcast so the
      // flag is consistent across clients. Print actor + player_id in
      // the outcome line so the evidence is spoof-resistant.
      const isAutopickAcross = [...perClientIsAutopick.values()].filter(
        (v) => v !== null,
      );
      const isAutopickPickEvent =
        isAutopickAcross.length > 0 && isAutopickAcross[0] === true;
      const playerIdAcross = [...perClientPlayerId.values()].filter(
        (v) => v !== null,
      );
      const observedPlayerId = playerIdAcross.length > 0 ? playerIdAcross[0] : null;
      const actorLabel = isAutopickPickEvent ? 'autopick' : 'user';

      if (delivered === wsClients.length && !isAutopickPickEvent) {
        // Real human pick: all delivered AND event is NOT autopick.
        console.log(
          `  ✓ HUMAN PICK: RECEIVED at pick ${pickNumber} ` +
            `(actor=${actorLabel}, player_id=${observedPlayerId}, ` +
            `delivered ${delivered}/${wsClients.length}, ` +
            `elapsed=${elapsedMs} ms, seq=${observedSeq ?? '?'})`,
        );
        humanOutcomes.push({
          pickNumber,
          outcome: 'received',
          actor: actorLabel,
          playerId: observedPlayerId,
          delivered,
          expected: wsClients.length,
          elapsedMs,
          seq: observedSeq,
        });
        // Push per-client samples so the S5 autopick-wait phase can
        // find `lastPickSample` and compute deltas normally.
        const earliestReceive = Math.min(
          ...[...perClientEventReceived.values()].filter((v) => v !== null),
        );
        for (const c of wsClients) {
          const receiveTs = perClientEventReceived.get(c.clientLabel);
          const pickDeadline = perClientPickDeadline.get(c.clientLabel);
          pushSample({
            scenario: SCENARIO,
            bootstrapClass: pickNumber === 1 ? 'cold' : 'warm',
            clientLabel: c.clientLabel,
            pickNumber,
            seq: observedSeq,
            submitCallTs: earliestReceive,
            receiveTs,
            rpcMs: 0,
            endToEndMs: receiveTs - earliestReceive,
            engineApplyMs: null,
            engineBroadcastMs: null,
            engineNotifyToBroadcastMs: null,
            seqOrderingViolation: false,
            rpcPickDeadlineIso: pickDeadline,
            isHumanPick: true,
          });
        }
      } else if (delivered === wsClients.length && isAutopickPickEvent) {
        // The 30s clock expired mid-wait and engine autopick covered
        // pick N. Every client received the autopick's broadcast. The
        // acceptance criterion is NOT met — a human pick was expected.
        console.log(
          `  ✗ HUMAN PICK: TIMED OUT — engine autopick covered pick ${pickNumber} ` +
            `(actor=${actorLabel}, player_id=${observedPlayerId}, ` +
            `delivered ${delivered}/${wsClients.length}, ` +
            `elapsed=${elapsedMs} ms, seq=${observedSeq ?? '?'}) — ` +
            `Garrett did not submit within the clock window OR the control did not render.`,
        );
        humanOutcomes.push({
          pickNumber,
          outcome: 'timeout_autopick_covered',
          actor: actorLabel,
          playerId: observedPlayerId,
          delivered,
          expected: wsClients.length,
          elapsedMs,
          seq: observedSeq,
        });
      } else {
        // Not even the autopick landed on all clients — event delivery
        // partial or nonexistent. Rare but possible under connection
        // trouble; distinct from the autopick-covered timeout.
        console.log(
          `  ✗ HUMAN PICK: TIMED OUT — pick ${pickNumber} event partial or absent ` +
            `(delivered ${delivered}/${wsClients.length}, elapsed=${elapsedMs} ms).`,
        );
        humanOutcomes.push({
          pickNumber,
          outcome: 'timeout_no_event',
          actor: actorLabel,
          playerId: observedPlayerId,
          delivered,
          expected: wsClients.length,
          elapsedMs,
          seq: observedSeq,
        });
      }
      // F7 (2026-07-29) — restore the default receive-waiter handler
      // on every client. Without this, the human-slot filter callback
      // (installed line ~425) remains active and silently drops all
      // subsequent picks' broadcasts, freezing delivery accounting at
      // 0/N for picks (HUMAN_SLOT+1)..TOTAL_PICKS. Root cause: the
      // ws-client.mjs onEvent SETS (not appends) the callback.
      for (const c of wsClients) {
        installDefaultReceiveHandler(c);
      }

      // Regardless of outcome, continue driving. Next pick's snake
      // team is computed from pickNumber+1 on the next loop iter.
      continue;
    }

    const playerId = HARNESS_PLAYER_IDS[pickNumber - 1];
    const idempotencyKey = randomUUID();
    const sessionId = randomUUID();
    const correlationId = randomUUID();
    const pickedAt = new Date().toISOString();
    const canonicalPayload = {
      pick_number: pickNumber,
      round,
      team_id: teamId,
      player_id: playerId,
      picked_at: pickedAt,
      is_autopick: true,
    };
    const payloadHash = computePayloadHash(canonicalPayload);

    // Arm receive waiters for this seq (we don't know seq yet; arm
    // by "next event" per client and correlate by returned seq after RPC).
    // Simpler: arm after we know the seq (post-RPC).
    const submitCallTs = Date.now();
    let rpcRow;
    let rpcMs = 0;
    try {
      const rpcStart = Date.now();
      const res = await pgClient.query(
        `SELECT * FROM public.submit_pick_v2(
          $1::uuid, $2::uuid, $3::int, $4::int, $5::int,
          $6::uuid, $7::uuid, $8::text, $9::jsonb, $10::uuid
        ) AS result`,
        [
          WHITELISTED_LEAGUE_ID,
          teamId,
          playerId,
          round,
          pickNumber,
          sessionId,
          idempotencyKey,
          payloadHash,
          JSON.stringify({ kind: 'autopick', id: 'harness' }),
          correlationId,
        ],
      );
      rpcMs = Date.now() - rpcStart;
      rpcRow = res.rows[0].result;
    } catch (err) {
      console.error(`  ✗ pick ${pickNumber} RPC failed:`, err.message);
      // Record RPC failure as a drop for every client.
      for (const c of wsClients) {
        pushSample({
          scenario: SCENARIO,
          bootstrapClass: pickNumber === 1 ? 'cold' : 'warm',
          clientLabel: c.clientLabel,
          pickNumber,
          seq: null,
          submitCallTs,
          receiveTs: null,
          rpcMs,
          endToEndMs: null,
          engineApplyMs: null,
          engineBroadcastMs: null,
          engineNotifyToBroadcastMs: null,
          seqOrderingViolation: false,
          rpcError: err.message,
        });
      }
      // Break: subsequent picks would fail with pick_out_of_order since
      // this pick_number wasn't consumed.
      break;
    }

    const seq = Number(rpcRow.seq);

    // Arm the receive waiters keyed by seq for every client.
    const perClientPromises = wsClients.map((c) => {
      return new Promise((resolve) => {
        const waiters = receiveWaiters.get(c.clientLabel);
        // If we already received it (race), resolve immediately.
        // (Shouldn't happen because seq is only known after RPC returns,
        // but defensive.)
        waiters.set(seq, { resolve });
        setTimeout(() => {
          if (waiters.has(seq)) {
            waiters.delete(seq);
            resolve(null); // drop
          }
        }, RECEIVE_TIMEOUT_MS).unref?.();
      });
    });

    const receiveTimes = await Promise.all(perClientPromises);

    // Chunk 11g.10 sub-step 10c-2 batch 1 (item 4): capture the RPC-
    // returned pick_deadline for downstream S5 autopick-timing analysis.
    // Every pick sample carries it — cheap to include; only the LAST
    // pre-autopick sample's value is used for S5's fire-time delta.
    const rpcPickDeadlineIso = rpcRow.pick_deadline ?? null;

    // Record one sample per client.
    for (let i = 0; i < wsClients.length; i++) {
      const c = wsClients[i];
      const receiveTs = receiveTimes[i];
      const endToEndMs = receiveTs === null ? null : receiveTs - submitCallTs;
      const perClient = perClientLastSeq.get(c.clientLabel) ?? -1;
      pushSample({
        scenario: SCENARIO,
        bootstrapClass: pickNumber === 1 ? 'cold' : 'warm',
        clientLabel: c.clientLabel,
        pickNumber,
        seq,
        submitCallTs,
        receiveTs,
        rpcMs,
        endToEndMs,
        rpcPickDeadlineIso, // batch 1 item 4
        engineApplyMs: null, // filled by post-run log join if enabled
        engineBroadcastMs: null,
        engineNotifyToBroadcastMs: null,
        seqOrderingViolation: false, // recorded via the ordering warn above
        rpcError: null,
      });
      // Ordering violation flag (last update wins per pick — mark if
      // the received seq is not monotonically greater across picks).
      if (i === 0 && seq <= perClient - 1) {
        samples[samples.length - 1].seqOrderingViolation = true;
      }
    }

    console.log(
      `  pick ${String(pickNumber).padStart(3)}  team=${teamId.slice(0, 8)}  ` +
      `player=${playerId}  seq=${seq}  rpc=${rpcMs}ms  ` +
      `delivered=${receiveTimes.filter((t) => t !== null).length}/${wsClients.length}  ` +
      `dropped=${receiveTimes.filter((t) => t === null).length}`,
    );

    // Inter-pick pace, unless we're at the last pick.
    if (pickNumber < TOTAL_PICKS) {
      if (!BURST) {
        await sleep(randomPace());
      }
      // S4 idle window. Chunk 11g.10 sub-step 10c-2 (R3 review fix):
      // heartbeat the pg client with a per-minute `SELECT 1` alongside
      // the client-side WS heartbeats. keepAlive:true on the client
      // (createPgClient) is the primary defense; SELECT 1 is a
      // second observability layer that ALSO triggers a full
      // destroy+reconnect if the underlying TCP is silently dead
      // — ensuring minute-31's real submit doesn't die and take the
      // whole run with it under fault-atomic output.
      if (SCENARIO === 'S4' && pickNumber === IDLE_AFTER_PICKS) {
        console.log('');
        console.log(`── S4 IDLE WINDOW — ${IDLE_MINUTES} minutes with clients + pg heartbeating ──`);
        const idleStart = Date.now();
        const idleEnd = idleStart + IDLE_MINUTES * 60 * 1000;
        while (Date.now() < idleEnd) {
          await sleep(60_000);
          const elapsed = Math.floor((Date.now() - idleStart) / 1000);
          const remaining = Math.max(0, idleEnd - Date.now());
          const openClients = wsClients.filter((c) => c.ws.readyState === 1).length;

          // pg SELECT 1 keepalive + auto-reconnect on failure.
          let pgStatus;
          try {
            const t0 = Date.now();
            await pgClient.query('SELECT 1');
            pgStatus = `pg ok (${Date.now() - t0}ms)`;
          } catch (err) {
            console.warn(`  ⚠ pg SELECT 1 failed during idle: ${err.message} — reconnecting`);
            try { await pgClient.end(); } catch (endErr) { void endErr; }
            try {
              pgClient = createPgClient();
              await pgClient.connect();
              // Restore the JWT-claims session var so the RPC's
              // autopick actor branch keeps passing after reconnect.
              await pgClient.query(
                `SET SESSION "request.jwt.claims" TO '{"role":"service_role"}'`,
              );
              pgStatus = 'pg reconnected + jwt-claims restored';
            } catch (reconnErr) {
              // Reconnect itself failed. Log and keep polling — the
              // next minute-tick will retry. If this persists into
              // the resume window, the next real RPC will fail and
              // fault-atomic will discard the run cleanly.
              pgStatus = `pg RECONNECT FAILED: ${reconnErr.message}`;
              console.error(`  ✗ ${pgStatus}`);
            }
          }
          console.log(
            `  idle: ${elapsed}s elapsed, ${Math.ceil(remaining / 1000)}s remaining, ` +
            `${openClients}/${wsClients.length} clients open, ${pgStatus}`,
          );
        }
        console.log('── idle window complete, resuming picks ──');
        console.log('');
      }
    }
  }

  return { samples, humanOutcomes };
}

// ── pg client factory ───────────────────────────────────────────────
//
// Chunk 11g.10 sub-step 10c-2 (R3 review fix): pg client MUST survive
// S4's 30-min idle window. Without TCP keepalive, a NAT-idle-reap or
// LB session cull silently kills the connection; minute-31's submit
// throws, the driver aborts, and fault-atomic discards the entire run.
// Fix (mirrors the 10c-1d listener hardening pattern): enable keepAlive
// on this pg.Client with a short initial delay so a silent break
// surfaces as a proper error within one keepalive probe, plus the
// runPickDriver idle loop below issues a periodic `SELECT 1` and
// reconnects on failure BEFORE resuming picks.
function createPgClient() {
  return new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
}

// ── F13 (2026-07-31): fault-flush state ─────────────────────────────
//
// Motivation: the harness measures resilience, and the harness itself
// must survive the disruptions it stages. Prior state (bug): all
// samples accumulated in memory; NDJSON + summary written once at the
// end of `main()`; SIGINT / crash / pg 'error' silently discarded the
// entire run. F13 broke this in the field when a transient network
// blip fired an unhandled pg `'error'` and killed Node before writing.
//
// Fix (architect ruling): open NDJSON as an APPEND STREAM at run start,
// write one line per sample as it's recorded — every sample up to the
// last successful push survives any crash. Register pg 'error' handler,
// uncaughtException / unhandledRejection / SIGINT / SIGTERM handlers
// that flush the summary from whatever the module-level state captured.
//
// Module-level so process-wide fault handlers can access it. The
// contents are strictly WRITE-ONCE from `main()` — the fault handlers
// only READ (and write the summary + close the stream).
const faultState = {
  ndjsonStream: null,
  ndjsonPath: null,
  summaryPath: null,
  samples: [],
  humanOutcomes: [],
  pgClient: null,
  wsClients: [],
  flushed: false,
};

function writeSampleToStream(sample) {
  if (!faultState.ndjsonStream) return;
  try {
    faultState.ndjsonStream.write(JSON.stringify(sample) + '\n');
  } catch (err) {
    // Best-effort: log to stderr and keep going. Do NOT abort the
    // driver — losing one sample on disk is preferable to losing all.
    console.error(`[F13] ndjson write failed: ${err.message}`);
  }
}

async function flushFaultSummary(exitReason) {
  if (faultState.flushed) return;
  faultState.flushed = true;
  try {
    if (faultState.ndjsonStream) {
      faultState.ndjsonStream.end();
    }
    // Write a summary from whatever samples we captured, tagged with
    // the exitReason so ops can distinguish planned end from fault.
    if (faultState.summaryPath) {
      let body;
      try {
        body = formatSummary(faultState.samples, {
          scenario: SCENARIO,
          clientCount: CLIENTS,
          paced: BURST ? 'burst' : `${PACE_MIN_MS}-${PACE_MAX_MS} ms jitter`,
          runId: RUN_ID,
        });
      } catch (err) {
        body = `formatSummary threw: ${err.message}`;
      }
      const header = `── PARTIAL SUMMARY (${exitReason}) — ${faultState.samples.length} samples captured before exit ──\n\n`;
      try {
        // Sync file write via appendFile fallback would need fs/promises
        // in scope; simplest is to use the raw stream API through Node's
        // writeFileSync equivalent. Use writeFile from fs/promises.
        await writeFile(faultState.summaryPath, header + body + '\n');
        console.error(`[F13] partial summary written: ${faultState.summaryPath}`);
      } catch (err) {
        console.error(`[F13] partial summary write failed: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[F13] flush failed: ${err.message}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const pgClient = createPgClient();
  // F13: register pg 'error' handler BEFORE connect. pg's Client emits
  // 'error' on any unexpected connection termination (network blip,
  // NAT reap, server restart). Without a listener, Node crashes with
  // an uncaught EventEmitter error — the whole reason the run was
  // being measured for resilience gets discarded. We log + let the
  // ongoing operation surface the error naturally (the next query
  // throws with a comparable message and the retry logic in the
  // driver's idle loop reconnects), rather than terminating.
  pgClient.on('error', (err) => {
    console.error(`[F13] pgClient 'error' event: ${err.message}. Continuing; the next query attempt will surface the error and the driver's reconnect logic will handle it.`);
  });
  await pgClient.connect();
  faultState.pgClient = pgClient;

  // F13: open NDJSON as an APPEND STREAM at run start. Every sample
  // is written to disk immediately after being recorded, so a crash
  // (pg error, SIGINT, power loss) still leaves every sample-so-far
  // durably on disk. Path uses the same convention as the prior
  // batched writeFile (see below).
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  faultState.ndjsonPath = join(OUT_DIR, `${SCENARIO}-${RUN_ID}.ndjson`);
  faultState.summaryPath = join(OUT_DIR, `${SCENARIO}-${RUN_ID}.summary.txt`);
  faultState.ndjsonStream = createWriteStream(faultState.ndjsonPath, {
    flags: 'a',
    encoding: 'utf8',
  });
  faultState.ndjsonStream.on('error', (err) => {
    console.error(`[F13] ndjson stream 'error' event: ${err.message}`);
  });

  try {
    await verifyFixture(pgClient);

    // Connect M clients.
    console.log('');
    console.log(`── connecting ${CLIENTS} WS client(s) ──`);
    const wsClients = [];
    for (let i = 0; i < CLIENTS; i++) {
      const userId = HARNESS_USER_IDS[i];
      const label = `c${String(i + 1).padStart(2, '0')}`;
      try {
        const handle = await connectDraftClient({
          host: HOST,
          port: WS_PORT,
          scheme: SCHEME,
          leagueId: WHITELISTED_LEAGUE_ID,
          userId,
          jwtSecret: JWT_SECRET,
          clientLabel: label,
          silentHeartbeat: CLIENTS > 3, // dim ♥ noise with many clients
        });
        wsClients.push(handle);
        console.log(`  ✓ ${label} connected (userId ${userId.slice(0, 8)}, snapshot received)`);
      } catch (err) {
        console.error(`  ✗ ${label} failed: ${err.message}`);
        throw err;
      }
    }
    console.log(`  ${wsClients.length}/${CLIENTS} clients open with heartbeat.`);
    faultState.wsClients = wsClients;

    // Run the pick driver. F13: pass writeSampleToStream so every
    // recorded sample lands on disk immediately — crash-safety.
    console.log('');
    console.log('── PICK DRIVER ──');
    const { samples, humanOutcomes } = await runPickDriver(
      pgClient,
      wsClients,
      writeSampleToStream,
    );
    faultState.samples = samples;
    faultState.humanOutcomes = humanOutcomes;

    // Chunk 11g.10 sub-step 10c-2 batch 1 (item 4): S5 autopick-wait
    // phase. After the pre-autopick picks land, STOP the driver and
    // wait for the engine's autopick timer to fire. The next `event`
    // frame each client receives (pickNumber = last+1) is the autopick;
    // record its receive_ts and compute the delta from the last-pick's
    // RPC-returned pick_deadline. Assert the delta is within a
    // (N-2..N+10) window around --expected-pick-clock (which the
    // operator sets to match fixture-12's --pick-clock=N).
    if (SCENARIO === 'S5') {
      const expectedPickClock = parseInt(EXPECTED_PICK_CLOCK_SEC, 10);
      const lastPickSample = samples
        .filter((s) => s.pickNumber === S5_PRE_AUTOPICK_PICKS && s.rpcPickDeadlineIso)
        [0];
      if (!lastPickSample) {
        throw new Error(
          `S5: could not find sample for last pre-autopick pick #${S5_PRE_AUTOPICK_PICKS}`,
        );
      }
      const rpcDeadlineMs = new Date(lastPickSample.rpcPickDeadlineIso).getTime();
      const expectedAutopickPickNumber = S5_PRE_AUTOPICK_PICKS + 1;
      console.log('');
      console.log('╔═══════════════════════════════════════════════════════════════════════╗');
      console.log(`║  S5 AUTOPICK WAIT — expecting autopick for pick #${expectedAutopickPickNumber}                    ║`);
      console.log(`║  Last-pick RPC pick_deadline: ${lastPickSample.rpcPickDeadlineIso.padEnd(31)}    ║`);
      console.log(`║  Expected pick clock:         ${(expectedPickClock + 's (fixture-12 --pick-clock=N)').padEnd(40)}║`);
      console.log(`║  Timeout budget:              ${(AUTOPICK_TIMEOUT_MS + ' ms').padEnd(40)}║`);
      console.log('╚═══════════════════════════════════════════════════════════════════════╝');
      console.log('');

      // Per-client autopick-wait waiters. Any incoming `event` frame
      // is fair game — the engine's autopick fires ONE `pick` event
      // and broadcasts it, so each client will receive one matching
      // frame at approximately the same wall-clock time.
      const autopickWaitStart = Date.now();
      const perClientAutopickReceived = new Map(
        wsClients.map((c) => [c.clientLabel, null]),
      );
      // Re-register onEvent to capture ANY event (the autopick's seq
      // is not known in advance; the RPC we didn't call didn't return
      // it). Match by pickNumber inside the event payload.
      for (const c of wsClients) {
        c.onEvent(({ frame, receivedAt }) => {
          const parsed = frame.parsed;
          if (!parsed || parsed.type !== 'event') return;
          const p = parsed.payload;
          if (!p || p.pickNumber !== expectedAutopickPickNumber) return;
          if (perClientAutopickReceived.get(c.clientLabel) !== null) return;
          perClientAutopickReceived.set(c.clientLabel, receivedAt);
        });
      }

      // Poll every 500 ms; give up after AUTOPICK_TIMEOUT_MS.
      while (Date.now() - autopickWaitStart < AUTOPICK_TIMEOUT_MS) {
        const allReceived = [...perClientAutopickReceived.values()].every(
          (v) => v !== null,
        );
        if (allReceived) break;
        await sleep(500);
      }

      const toleranceMinMs = (expectedPickClock - 2) * 1000;
      const toleranceMaxMs = (expectedPickClock + 10) * 1000;

      for (const c of wsClients) {
        const receiveTs = perClientAutopickReceived.get(c.clientLabel);
        const deltaFromDeadlineMs = receiveTs === null ? null : receiveTs - rpcDeadlineMs;
        const deltaFromLastSubmitMs = receiveTs === null ? null : receiveTs - lastPickSample.submitCallTs;
        const withinTolerance =
          receiveTs !== null &&
          deltaFromLastSubmitMs >= toleranceMinMs &&
          deltaFromLastSubmitMs <= toleranceMaxMs;
        pushSample({
          scenario: 'S5',
          bootstrapClass: 'autopick_wait',
          clientLabel: c.clientLabel,
          pickNumber: expectedAutopickPickNumber,
          seq: null, // not known — we didn't call the RPC
          submitCallTs: lastPickSample.submitCallTs, // for the delta computation
          receiveTs,
          rpcMs: 0, // no RPC in this phase
          endToEndMs: deltaFromLastSubmitMs,
          rpcPickDeadlineIso: lastPickSample.rpcPickDeadlineIso,
          deltaFromDeadlineMs, // autopick-specific
          expectedPickClockSec: expectedPickClock, // for post-run interpretation
          withinTolerance,
          engineApplyMs: null,
          engineBroadcastMs: null,
          engineNotifyToBroadcastMs: null,
          seqOrderingViolation: false,
          rpcError: null,
        });
        const status = receiveTs === null
          ? 'DROPPED (timeout)'
          : withinTolerance
            ? 'WITHIN TOLERANCE'
            : 'OUT OF TOLERANCE';
        console.log(
          `  ${c.clientLabel}  autopick receive_ts=${receiveTs ? new Date(receiveTs).toISOString() : '(none)'}  ` +
          `Δfrom_last_submit=${deltaFromLastSubmitMs === null ? '—' : `${deltaFromLastSubmitMs}ms`}  ` +
          `Δfrom_deadline=${deltaFromDeadlineMs === null ? '—' : `${deltaFromDeadlineMs}ms`}  ` +
          `[${status}]`,
        );
      }

      const receivedCount = [...perClientAutopickReceived.values()].filter((v) => v !== null).length;
      console.log('');
      console.log(`  S5 result: ${receivedCount}/${wsClients.length} clients received the autopick within ${AUTOPICK_TIMEOUT_MS}ms.`);
      console.log(`  Tolerance window: [${toleranceMinMs}, ${toleranceMaxMs}] ms from last submit call.`);
      console.log(`  NOTE: engine boot log's pickClockSeconds MUST equal ${expectedPickClock + 1} to close the pick-clock audit loop.`);
      console.log(`  Verify via: gcloud ssh ... "docker logs citrus-draft-engine 2>&1 | grep pickClockSeconds | tail -3"`);
    }

    // F13: NDJSON was streamed sample-by-sample already; close the
    // stream to flush the OS buffer. The batched-writeFile approach
    // (prior behavior) is intentionally gone — it was the F13 vector.
    if (faultState.ndjsonStream) {
      await new Promise((resolve) => {
        faultState.ndjsonStream.end(resolve);
      });
      faultState.ndjsonStream = null;
    }
    console.log('');
    console.log(`  ndjson written: ${faultState.ndjsonPath}  (${samples.length} rows, streamed)`);

    // Print summary.
    const summary = formatSummary(samples, {
      scenario: SCENARIO,
      clientCount: CLIENTS,
      paced: BURST ? 'burst' : `${PACE_MIN_MS}-${PACE_MAX_MS} ms jitter`,
      runId: RUN_ID,
    });
    // DR-2 (2026-07-29) — first-class HUMAN PICK outcome block per
    // architect Q6 amendment. Prints RECEIVED at pick N (delivered
    // 12/12) OR TIMED OUT — a WARN buried in scroll is not evidence.
    let humanBlock = '';
    if (HUMAN_SLOT !== null) {
      humanBlock += '\n══ DR-2 HUMAN PICK OUTCOMES ══\n';
      if (humanOutcomes.length === 0) {
        humanBlock +=
          `  (no human-slot picks driven — --human-slot=${HUMAN_SLOT} but the driver did not reach that pick)\n`;
      } else {
        for (const o of humanOutcomes) {
          if (o.outcome === 'received') {
            humanBlock +=
              `  ✓ HUMAN PICK: RECEIVED at pick ${o.pickNumber} ` +
              `(actor=${o.actor}, player_id=${o.playerId ?? '?'}, ` +
              `delivered ${o.delivered}/${o.expected}, ` +
              `elapsed=${o.elapsedMs} ms, seq=${o.seq ?? '?'})\n`;
          } else if (o.outcome === 'timeout_autopick_covered') {
            humanBlock +=
              `  ✗ HUMAN PICK: TIMED OUT at pick ${o.pickNumber} — engine autopick covered ` +
              `(actor=${o.actor}, player_id=${o.playerId ?? '?'}, ` +
              `delivered ${o.delivered}/${o.expected}, ` +
              `elapsed=${o.elapsedMs} ms, seq=${o.seq ?? '?'}) — acceptance criterion NOT met\n`;
          } else {
            humanBlock +=
              `  ✗ HUMAN PICK: TIMED OUT at pick ${o.pickNumber} — event partial or absent ` +
              `(delivered ${o.delivered}/${o.expected}, elapsed=${o.elapsedMs} ms)\n`;
          }
        }
      }
      humanBlock += '\n';
    }
    const fullSummary = summary + humanBlock;
    console.log(fullSummary);
    await writeFile(faultState.summaryPath, fullSummary + '\n');
    console.log(`  summary written: ${faultState.summaryPath}`);
    console.log('');
    console.log('── DONE. Reset before next scenario:  node scripts/proof/fixture-12.mjs --reset --execute ──');
    console.log('');

    // F13: mark the clean-exit flush as done so fault handlers don't
    // overwrite the full summary with a partial one on later teardown.
    faultState.flushed = true;

    // Clean shutdown of clients.
    for (const c of wsClients) c.close();
  } finally {
    try {
      await pgClient.end();
    } catch (err) {
      // pg client may already be in a broken state after a fault;
      // don't let cleanup errors mask the original failure.
      console.error(`[F13] pgClient.end() threw: ${err.message}`);
    }
  }
}

// F13 (2026-07-31): fault handlers flush the append-stream + write a
// partial summary from module state before exit. Prior state: SIGINT
// exited nonzero without writing anything, and no uncaughtException /
// unhandledRejection handlers existed — a pg 'error' event silently
// killed the run mid-flight, discarding the entire NDJSON.
//
// New guarantees:
//   - Every sample recorded before fault is already on disk (append
//     stream writes per-sample).
//   - A `.summary.txt` labeled with the exit reason is written from
//     whatever samples were captured.
//   - Ctrl-C, SIGTERM, uncaught exceptions, and unhandled rejections
//     all route through the same flush path.
let shuttingDown = false;
async function abort(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error('');
  console.error(`── ABORTED (${reason}) ──`);
  console.error(`   Samples captured: ${faultState.samples.length}`);
  await flushFaultSummary(reason);
  console.error('   To recover:');
  console.error('     node scripts/proof/fixture-12.mjs --reset --execute');
  console.error('     node scripts/proof/fixture-12.mjs --execute');
  console.error('');
  process.exit(130);
}
process.on('SIGINT', () => { void abort('SIGINT'); });
process.on('SIGTERM', () => { void abort('SIGTERM'); });
process.on('uncaughtException', (err) => {
  console.error('');
  console.error('UNCAUGHT EXCEPTION:', err && err.message ? err.message : String(err));
  if (err && err.stack) console.error(err.stack);
  void abort('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('');
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('UNHANDLED REJECTION:', msg);
  if (reason instanceof Error && reason.stack) console.error(reason.stack);
  void abort('unhandledRejection');
});

main().catch(async (err) => {
  console.error('');
  console.error('FATAL:', err.message);
  if (err.stack) console.error(err.stack);
  console.error('');
  // F13: flush before exit — even for the main() rejection path, so a
  // fatal thrown mid-driver still preserves the partial NDJSON +
  // partial summary. abort() is idempotent (guarded by `shuttingDown`).
  await flushFaultSummary('main_rejection');
  console.error('  Recovery: node scripts/proof/fixture-12.mjs --reset --execute');
  console.error('');
  process.exit(1);
});
