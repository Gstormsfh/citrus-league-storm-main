// Scenario 7: HOT AUTHENTICATED READS
// ------------------------------------------------------------------
// Purpose: measure the endpoints that actually cost something.
//
// Why this scenario exists (2026-09-02 scale audit,
// docs/PERFORMANCE_AND_SCALE_2026-09-02.md). `steady-state.js` proves
// 200 users can browse safely, but 40% of its traffic is `/api/health`
// and every one of its four endpoints is unauthenticated and public.
// None of them reads a season-scoped player table, runs a five-table
// merge, or serialises a megabyte. The heaviest reads in the product
// have never been under load:
//
//   /api/players/dashboard-index   five paged table reads + a four-Map
//                                  merge; measured at 1,294 KiB raw /
//                                  165 KiB gzipped for 1,900 players,
//                                  and 5.2 ms of synchronous
//                                  JSON.stringify per response
//                                  (server/scripts/bench-hot-paths.ts)
//   /api/players                   the draft-pool / free-agents read
//   /api/players/ros-projections   projection board, sorted
//   /api/leagues/:id/matchups      per-league matchup read
//   /api/leagues/:id/standings     per-league standings
//
// Both player endpoints sit behind a 2-minute in-process cache, so the
// number this scenario is really after is what happens at the TTL
// boundary, when every in-flight request misses at once. Run it for
// longer than 2 minutes or the cache hides the thing you came to see.
//
// LOAD PROFILE
//   Ramp 0 → 200 VUs over 2 minutes, hold 10 minutes, ramp down 1
//   minute. The hold spans five cache expiries.
//
// PASS CRITERIA
//   Derived from the browse budget in lib/config.js, NOT from CLAUDE.md's
//   draft mandate — those targets belong to the WebSocket engine and are
//   measured by the engine harness, not here.
//     - p95 < 1000ms, p99 < 2000ms across all reads
//     - error rate < 0.5%
//     - dashboard-index p95 < 2000ms on its own (it is the fat one; a
//       separate, looser threshold so it cannot hide behind the others
//       and cannot fail the run on their behalf)
//
// WHAT THIS DOES NOT DO
//   No writes. Nothing here mutates a league, a roster or a draft, so it
//   is safe against a staging project with real fixtures. It is NOT safe
//   to point at production: 200 VUs of authenticated reads is real load
//   on the real database, and `TARGET_URL` defaults to production.
//   Set TARGET_URL explicitly, every time.
//
// REQUIRES
//   SUPABASE_URL, SUPABASE_ANON_KEY, TEST_ACCOUNTS (see README §Setup),
//   and TEST_LEAGUE_ID for the two league-scoped reads. Without
//   TEST_LEAGUE_ID the league flows are skipped and the player flows
//   still run.
//
// USAGE
//   source .env.load-test.local
//   TARGET_URL=https://api-staging.citrusfantasysports.com \
//     k6 run scripts/load-test/scenarios/hot-reads.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { TARGET_URL, requireEnv, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/config.js';
import { signInAsTestUser, authHeaders } from '../lib/auth.js';

const TEST_LEAGUE_ID = __ENV.TEST_LEAGUE_ID || '';

// Per-endpoint response size, in bytes. The whole point of the
// dashboard-index finding is the payload, so measure it from the real
// server rather than trusting the offline estimate.
const bytesReceived = new Trend('citrus_response_bytes', false);
const truncatedReads = new Counter('citrus_suspicious_row_counts');

export const options = {
  scenarios: {
    hot_reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '10m', target: 200 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.005'],
    checks: ['rate>0.95'],
    // The fat endpoint gets its own budget so it neither hides in the
    // aggregate nor fails the run for the cheap reads.
    'http_req_duration{endpoint:dashboard_index}': ['p(95)<2000'],
  },
};

export function setup() {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  requireEnv('SUPABASE_ANON_KEY', SUPABASE_ANON_KEY);
  if (!TEST_LEAGUE_ID) {
    console.warn(
      'TEST_LEAGUE_ID not set — league-scoped reads (matchups, standings) will be skipped.',
    );
  }
  return { leagueId: TEST_LEAGUE_ID };
}

// One sign-in per VU, reused across iterations — mirrors a real session
// and keeps the auth endpoint out of the latency numbers.
let session = null;

// Traffic mix. Weighted towards the player surfaces because that is
// where a browsing user actually spends requests, and because those are
// the endpoints with no coverage today.
function flows(leagueId) {
  const f = [
    { weight: 30, path: '/api/players/dashboard-index', name: 'dashboard_index' },
    { weight: 25, path: '/api/players', name: 'players_pool' },
    { weight: 20, path: '/api/players/ros-projections?limit=200', name: 'ros_projections' },
  ];
  if (leagueId) {
    f.push({ weight: 15, path: `/api/leagues/${leagueId}/matchups`, name: 'league_matchups' });
    f.push({ weight: 10, path: `/api/leagues/${leagueId}/standings`, name: 'league_standings' });
  }
  return f;
}

function pickFlow(list) {
  const total = list.reduce((acc, f) => acc + f.weight, 0);
  let r = Math.random() * total;
  for (const flow of list) {
    r -= flow.weight;
    if (r <= 0) return flow;
  }
  return list[0];
}

export default function (data) {
  if (!session) {
    session = signInAsTestUser(__VU);
  }

  const flow = pickFlow(flows(data.leagueId));
  const res = http.get(`${TARGET_URL}${flow.path}`, {
    headers: authHeaders(session.token),
    tags: { endpoint: flow.name },
    timeout: '10s',
  });

  bytesReceived.add(res.body ? res.body.length : 0, { endpoint: flow.name });

  check(res, {
    [`${flow.name} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
  });

  // TRUNCATION CANARY. PostgREST clamps every response at db-max-rows
  // (1,000 on this project) and returns HTTP 200 with a short body and
  // no error. A read that comes back with exactly 1,000 rows is either a
  // coincidence or a silently clamped read, and the second is far more
  // likely. This counter is not a pass/fail gate — it is the signal to
  // go and look. See docs/PERFORMANCE_AND_SCALE_2026-09-02.md.
  if (res.status === 200 && (flow.name === 'dashboard_index' || flow.name === 'players_pool')) {
    try {
      const body = JSON.parse(res.body);
      const rows = Array.isArray(body) ? body : body && body.data;
      if (Array.isArray(rows) && rows.length === 1000) {
        truncatedReads.add(1, { endpoint: flow.name });
      }
    } catch {
      // A body we cannot parse is already covered by the status check.
    }
  }

  // Think time. Real users read the page before asking for another.
  sleep(2 + Math.random() * 3);
}

export function handleSummary(data) {
  const num = (x) => (typeof x === 'number' ? x : 0);
  const v = data.metrics.http_req_duration.values;
  const bytes = data.metrics.citrus_response_bytes
    ? data.metrics.citrus_response_bytes.values
    : null;
  const suspicious = data.metrics.citrus_suspicious_row_counts
    ? num(data.metrics.citrus_suspicious_row_counts.values.count)
    : 0;

  const lines = [
    '',
    'HOT AUTHENTICATED READS',
    '───────────────────────────────────────────────',
    `  requests          ${num(data.metrics.http_reqs.values.count)}`,
    `  error rate        ${(num(data.metrics.http_req_failed.values.rate) * 100).toFixed(3)}%`,
    `  p50 / p95 / p99   ${num(v.med ?? v['p(50)']).toFixed(0)} / ${num(v['p(95)']).toFixed(0)} / ${num(v['p(99)']).toFixed(0)} ms`,
    `  max               ${num(v.max).toFixed(0)} ms`,
  ];
  if (bytes) {
    lines.push(
      `  response bytes    avg ${(num(bytes.avg) / 1024).toFixed(1)} KiB, max ${(num(bytes.max) / 1024).toFixed(1)} KiB`,
    );
  }
  lines.push(
    `  exactly-1000-row responses  ${suspicious}` +
      (suspicious > 0 ? '   <-- INVESTIGATE: likely a PostgREST row clamp' : ''),
  );
  lines.push('');

  return { stdout: lines.join('\n') };
}
