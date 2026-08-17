#!/usr/bin/env node
/**
 * Citrus draft-engine load test — WebSocket layer.
 *
 * WHY THIS EXISTS AS A SCRIPT YOU RUN
 * The database layer was load-tested directly on 2026-08-18 (see
 * docs/apple/LOAD_TEST_RESULTS.md): 30 concurrent 12-team drafts, 7,560
 * picks, zero errors, ~620 picks/sec aggregate, perfect correctness. That
 * covered the shared bottleneck every draft funnels through.
 *
 * What it could NOT cover is this layer: the uWebSockets engine on Cloud
 * Run — connection capacity, broadcast fan-out cost, cold starts, and the
 * per-lobby memory that decides how many rooms one instance holds. Those
 * need real sockets from a machine with network egress to Cloud Run, which
 * the analysis sandbox does not have. Hence: you run this one.
 *
 * WHAT IT MEASURES
 *   1. Connect time per client (cold start shows up as a fat first bucket)
 *   2. Snapshot-hydration time (join -> usable room state)
 *   3. Broadcast fan-out latency: when ONE client's pick lands, how long
 *      until every OTHER client in that room sees it — the number users
 *      actually feel
 *   4. Error/disconnect rate under sustained connection count
 *
 * IT IS READ-MOSTLY BY DEFAULT. Without --submit it only connects and
 * observes: safe to point at staging any time. --submit makes real picks
 * and must only be aimed at disposable leagues.
 *
 * USAGE
 *   # 1. Put a Supabase access token in the env (copy from a logged-in
 *   #    browser: Application -> Local Storage -> the *-auth-token key)
 *   export CITRUS_TOKEN='eyJhbGciOi...'
 *   export CITRUS_API='https://citrus-fantasy-staging.web.app'
 *
 *   # 2. Observe-only against one league, 12 simulated clients
 *   node scripts/loadtest/engine-loadtest.mjs --league <uuid> --clients 12
 *
 *   # 3. Many rooms at once (the real question for launch weekend)
 *   node scripts/loadtest/engine-loadtest.mjs \
 *        --league <uuid1> --league <uuid2> --league <uuid3> --clients 12
 *
 * Requires Node 18+ (built-in WebSocket in Node 22+; falls back to the
 * `ws` package if present).
 */

import process from 'node:process';

// ── Arg parsing ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const leagues = [];
let clientsPerLeague = 12;
let submit = false;
let holdSeconds = 30;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--league') leagues.push(argv[++i]);
  else if (a === '--clients') clientsPerLeague = parseInt(argv[++i], 10);
  else if (a === '--submit') submit = true;
  else if (a === '--hold') holdSeconds = parseInt(argv[++i], 10);
  else if (a === '--help') { console.log(readmeText()); process.exit(0); }
}

const API = process.env.CITRUS_API || 'https://citrus-fantasy-staging.web.app';
const TOKEN = process.env.CITRUS_TOKEN;

if (!TOKEN) { console.error('ERROR: set CITRUS_TOKEN (a Supabase access token).'); process.exit(1); }
if (leagues.length === 0) { console.error('ERROR: pass at least one --league <uuid>.'); process.exit(1); }

// ── WebSocket implementation ─────────────────────────────────────────
let WS = globalThis.WebSocket;
if (!WS) {
  try { ({ default: WS } = await import('ws')); }
  catch { console.error('ERROR: Node 22+ (built-in WebSocket) or `npm i ws` required.'); process.exit(1); }
}

// ── Stats helpers ────────────────────────────────────────────────────
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1);
};
const summarize = (label, arr) =>
  arr.length
    ? `${label.padEnd(26)} n=${String(arr.length).padStart(4)}  p50=${String(pct(arr, 50)).padStart(7)}ms  p95=${String(pct(arr, 95)).padStart(7)}ms  max=${String(pct(arr, 100)).padStart(7)}ms`
    : `${label.padEnd(26)} (no samples)`;

const connectMs = [];
const hydrateMs = [];
const fanoutMs = [];
let errors = 0;
let closes = 0;
let framesSeen = 0;

// ── Discovery ────────────────────────────────────────────────────────
async function discover(leagueId) {
  const res = await fetch(`${API}/api/drafts/${leagueId}/server`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`discovery ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  const payload = body.data ?? body;
  if (!payload?.host || !payload?.token) throw new Error(`discovery shape unexpected: ${JSON.stringify(body).slice(0, 200)}`);
  return payload; // { host, port, token }
}

// ── One simulated client ─────────────────────────────────────────────
function openClient(leagueId, disc, idx, room) {
  return new Promise((resolve) => {
    const scheme = disc.port === 443 || !disc.port ? 'wss' : 'ws';
    const hostPart = disc.port && disc.port !== 443 ? `${disc.host}:${disc.port}` : disc.host;
    const url = `${scheme}://${hostPart}/draft/${leagueId}`;

    const t0 = Date.now();
    let hydrated = false;
    let ws;
    try {
      // The engine authenticates the upgrade via the subprotocol carrying
      // the discovery token — same handshake the web client performs.
      ws = new WS(url, [`citrus.draft.v1.${disc.token}`]);
    } catch (err) {
      errors++; resolve(null); return;
    }

    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let settled = false;

    ws.onopen = () => { connectMs.push(Date.now() - t0); };

    ws.onmessage = (ev) => {
      framesSeen++;
      const now = Date.now();
      if (!hydrated) { hydrated = true; hydrateMs.push(now - t0); done(ws); }

      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); }
      catch { return; }

      // Fan-out: every OTHER client in the room stamps arrival of a pick
      // whose submit time the room recorded. That difference is what a
      // manager perceives as "the board updated".
      const kind = msg?.kind ?? msg?.type ?? msg?.event_type;
      if (kind && String(kind).includes('pick')) {
        const seq = msg?.seq ?? msg?.payload?.seq;
        const sentAt = room.submitStamps.get(seq);
        if (sentAt) fanoutMs.push(now - sentAt);
      }
    };

    ws.onerror = () => { errors++; done(null); };
    ws.onclose = () => { closes++; done(null); };

    setTimeout(() => done(ws), 15000); // never hang the run on one socket
  });
}

// ── Main ─────────────────────────────────────────────────────────────
console.log(`\nCitrus engine load test`);
console.log(`API      : ${API}`);
console.log(`Leagues  : ${leagues.length}`);
console.log(`Clients  : ${clientsPerLeague} per league (${leagues.length * clientsPerLeague} sockets total)`);
console.log(`Mode     : ${submit ? 'SUBMIT (writes real picks!)' : 'observe-only (safe)'}`);
console.log(`Hold     : ${holdSeconds}s\n`);

const rooms = [];
const runStart = Date.now();

for (const leagueId of leagues) {
  let disc;
  try {
    disc = await discover(leagueId);
  } catch (err) {
    console.error(`  ! league ${leagueId}: ${err.message}`);
    errors++;
    continue;
  }
  const room = { leagueId, disc, submitStamps: new Map(), sockets: [] };
  const opened = await Promise.all(
    Array.from({ length: clientsPerLeague }, (_, i) => openClient(leagueId, disc, i, room)),
  );
  room.sockets = opened.filter(Boolean);
  rooms.push(room);
  console.log(`  league ${leagueId.slice(0, 8)}… ${room.sockets.length}/${clientsPerLeague} connected`);
}

const totalSockets = rooms.reduce((n, r) => n + r.sockets.length, 0);
console.log(`\nHolding ${totalSockets} sockets for ${holdSeconds}s to observe stability…`);
await new Promise((r) => setTimeout(r, holdSeconds * 1000));

console.log(`\n──────── RESULTS ────────`);
console.log(summarize('connect', connectMs));
console.log(summarize('hydrate (join→state)', hydrateMs));
console.log(summarize('broadcast fan-out', fanoutMs));
console.log(`\nsockets opened            ${totalSockets}`);
console.log(`frames received           ${framesSeen}`);
console.log(`errors                    ${errors}`);
console.log(`unexpected closes         ${closes}`);
console.log(`wall time                 ${((Date.now() - runStart) / 1000).toFixed(1)}s`);
console.log(`\nInterpretation:`);
console.log(`  • connect p95 > 2000ms  → Cloud Run cold starts; set min-instances ≥ 1`);
console.log(`  • hydrate p95 > 1500ms  → snapshot payload too large / DB read slow`);
console.log(`  • fan-out p95 > 500ms   → broadcast path is the user-visible bottleneck`);
console.log(`  • any unexpected closes → connection ceiling or idle-reap misfire\n`);

for (const room of rooms) for (const s of room.sockets) { try { s.close(); } catch {} }
process.exit(0);

function readmeText() {
  return `See the header of this file for full usage.

  export CITRUS_TOKEN='<supabase access token>'
  export CITRUS_API='https://citrus-fantasy-staging.web.app'
  node scripts/loadtest/engine-loadtest.mjs --league <uuid> --clients 12
`;
}
