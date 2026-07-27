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
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  WHITELISTED_LEAGUE_ID,
  HARNESS_TEAM_IDS,
  HARNESS_USER_IDS,
  HARNESS_PLAYER_IDS,
  HARNESS_SESSION_ID,
  TEAM_COUNT,
  harnessUserId,
} from './fixture-12.mjs';
import { connectDraftClient } from './lib/ws-client.mjs';
import { formatSummary } from './lib/percentiles.mjs';

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

if (flag('help') || flag('h')) {
  console.log(`Usage: node scripts/proof/draft-harness.mjs --scenario=<S1|S2|S3|S4> [options]

Scenarios (each expects a fresh fixture-12 setup):
  S1  single-client 36-pick paced
  S2  12-client paced
  S3  12-client burst
  S4  12-client paced with mid-draft ${IDLE_MINUTES}-min idle then resume

Options (env-tunable defaults):
  --clients=N              (default: 1 for S1, 12 for S2-S4)
  --rounds=N               (default: 3 → 36 picks)
  --burst                  (skip inter-pick pacing; implied by S3)
  --idle-minutes=N         (S4 only; default 30)
  --idle-after-picks=N     (S4 only; default 6)
  --pace-min-ms=N          (default 2000)
  --pace-max-ms=N          (default 5000)
  --receive-timeout-ms=N   (default 15000)
  --out-dir=PATH           (default scripts/proof/results)
  --run-id=STR             (default timestamp)

Env: SUPABASE_DB_URL, SUPABASE_JWT_SECRET, HOST, WS_PORT.
Fixture prereq: scripts/proof/fixture-12.mjs --execute --rounds=N
Between scenarios: --reset then --execute the fixture.
`);
  process.exit(0);
}

if (!['S1', 'S2', 'S3', 'S4'].includes(SCENARIO)) {
  console.error(`FATAL: unknown scenario ${SCENARIO} (expected S1..S4).`);
  process.exit(2);
}
if (CLIENTS < 1 || CLIENTS > TEAM_COUNT) {
  console.error(`FATAL: --clients must be in 1..${TEAM_COUNT} (got ${CLIENTS}).`);
  process.exit(2);
}

const DB_URL = process.env.SUPABASE_DB_URL;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const HOST = process.env.HOST || '35.203.89.236';
const WS_PORT = Number(process.env.WS_PORT || 3002);
if (!DB_URL) { console.error('FATAL: SUPABASE_DB_URL not set.'); process.exit(2); }
if (!JWT_SECRET) { console.error('FATAL: SUPABASE_JWT_SECRET not set.'); process.exit(2); }
for (const pat of ['pooler.supabase.com', 'pgbouncer', ':6543']) {
  if (DB_URL.includes(pat)) {
    console.error(`FATAL: SUPABASE_DB_URL contains pooled pattern "${pat}" (KI-E010).`);
    process.exit(2);
  }
}

const TOTAL_PICKS = CLIENTS === 1 ? TEAM_COUNT * ROUNDS : TEAM_COUNT * ROUNDS;

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
console.log(`║  WS target:           ${`ws://${HOST}:${WS_PORT}`.padEnd(48)}║`);
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

async function runPickDriver(pgClient, wsClients) {
  const samples = [];
  const perClientLastSeq = new Map(wsClients.map((c) => [c.clientLabel, -1]));

  // Attach per-pick receive resolvers. Each client's onEvent callback
  // resolves the corresponding waiter map entry, keyed by seq.
  const receiveWaiters = new Map(wsClients.map((c) => [
    c.clientLabel,
    new Map(), // seq -> {resolve, receivedAt (set on fire)}
  ]));

  for (const c of wsClients) {
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
  }

  // Set request.jwt.claims once per pg connection so the RPC's
  // auth.role() returns 'service_role' (per live-proof pattern).
  await pgClient.query(`SET SESSION "request.jwt.claims" TO '{"role":"service_role"}'`);

  for (let pickNumber = 1; pickNumber <= TOTAL_PICKS; pickNumber++) {
    const { round, teamId } = snakeTeamForPick(pickNumber);
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
        samples.push({
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

    // Record one sample per client.
    for (let i = 0; i < wsClients.length; i++) {
      const c = wsClients[i];
      const receiveTs = receiveTimes[i];
      const endToEndMs = receiveTs === null ? null : receiveTs - submitCallTs;
      const perClient = perClientLastSeq.get(c.clientLabel) ?? -1;
      samples.push({
        scenario: SCENARIO,
        bootstrapClass: pickNumber === 1 ? 'cold' : 'warm',
        clientLabel: c.clientLabel,
        pickNumber,
        seq,
        submitCallTs,
        receiveTs,
        rpcMs,
        endToEndMs,
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
      // S4 idle window.
      if (SCENARIO === 'S4' && pickNumber === IDLE_AFTER_PICKS) {
        console.log('');
        console.log(`── S4 IDLE WINDOW — ${IDLE_MINUTES} minutes with clients heartbeating ──`);
        const idleStart = Date.now();
        const idleEnd = idleStart + IDLE_MINUTES * 60 * 1000;
        while (Date.now() < idleEnd) {
          await sleep(60_000);
          const elapsed = Math.floor((Date.now() - idleStart) / 1000);
          const remaining = Math.max(0, idleEnd - Date.now());
          console.log(`  idle: ${elapsed}s elapsed, ${Math.ceil(remaining / 1000)}s remaining, ${wsClients.filter((c) => c.ws.readyState === 1).length}/${wsClients.length} clients still open`);
        }
        console.log('── idle window complete, resuming picks ──');
        console.log('');
      }
    }
  }

  return samples;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const pgClient = new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30_000,
  });
  await pgClient.connect();

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

    // Run the pick driver.
    console.log('');
    console.log('── PICK DRIVER ──');
    const samples = await runPickDriver(pgClient, wsClients);

    // Write NDJSON.
    if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
    const ndjsonPath = join(OUT_DIR, `${SCENARIO}-${RUN_ID}.ndjson`);
    const ndjson = samples.map((s) => JSON.stringify(s)).join('\n') + '\n';
    await writeFile(ndjsonPath, ndjson);
    console.log('');
    console.log(`  ndjson written: ${ndjsonPath}  (${samples.length} rows)`);

    // Print summary.
    const summary = formatSummary(samples, {
      scenario: SCENARIO,
      clientCount: CLIENTS,
      paced: BURST ? 'burst' : `${PACE_MIN_MS}-${PACE_MAX_MS} ms jitter`,
      runId: RUN_ID,
    });
    console.log(summary);
    const summaryPath = join(OUT_DIR, `${SCENARIO}-${RUN_ID}.summary.txt`);
    await writeFile(summaryPath, summary + '\n');
    console.log(`  summary written: ${summaryPath}`);
    console.log('');
    console.log('── DONE. Reset before next scenario:  node scripts/proof/fixture-12.mjs --reset --execute ──');
    console.log('');

    // Clean shutdown of clients.
    for (const c of wsClients) c.close();
  } finally {
    await pgClient.end();
  }
}

// Ctrl-C handling: allow abort, print reset guidance, exit nonzero.
let shuttingDown = false;
function abort(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error('');
  console.error(`── ABORTED (${signal}) ──`);
  console.error('   Partial results NOT written. To recover:');
  console.error('     node scripts/proof/fixture-12.mjs --reset --execute');
  console.error('     node scripts/proof/fixture-12.mjs --execute');
  console.error('');
  process.exit(130);
}
process.on('SIGINT', () => abort('SIGINT'));
process.on('SIGTERM', () => abort('SIGTERM'));

main().catch((err) => {
  console.error('');
  console.error('FATAL:', err.message);
  if (err.stack) console.error(err.stack);
  console.error('');
  console.error('  Recovery: node scripts/proof/fixture-12.mjs --reset --execute');
  console.error('');
  process.exit(1);
});
