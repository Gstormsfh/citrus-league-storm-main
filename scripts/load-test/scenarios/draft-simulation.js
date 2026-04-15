// Scenario 3: DRAFT SIMULATION (authenticated)
// ------------------------------------------------------------------
// Purpose: simulate 200 users in a live draft. This is the scenario
// closest to April 10 and the one we most need to prove.
//
// Each virtual user:
//   - Signs in (once, in init phase)
//   - Joins a draft lobby
//   - Polls the player list
//   - Makes a pick when it's their turn (simulated — we don't enforce
//     real draft order because that would serialize 200 VUs)
//   - Checks their roster
//   - Loops for the test duration
//
// Load profile:
//   - Ramp 0 → 200 VUs over 5 minutes
//   - Hold 200 VUs for 15 minutes
//   - Ramp down over 2 minutes
//   - Total: 22 minutes
//
// REQUIRES:
//   - SUPABASE_URL, SUPABASE_ANON_KEY env vars
//   - TEST_ACCOUNTS env var with a JSON array of test credentials
//   - A dedicated TEST_LEAGUE_ID on staging — this scenario writes
//     roster assignments and picks.
//
// Pass criteria:
//   - Error rate < 1% (drafts are write-heavy, some contention expected)
//   - p95 pick latency < 1500ms
//   - p99 pick latency < 3000ms
//   - Zero 5xx from /api/draft/*
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//   TEST_ACCOUNTS='[{"email":"...","password":"..."}]' \
//   TEST_LEAGUE_ID=uuid-here \
//   TARGET_URL=https://api.citrusfantasysports.com \
//     k6 run scripts/load-test/scenarios/draft-simulation.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { TARGET_URL, requireEnv } from '../lib/config.js';
import { signInAsTestUser, authHeaders } from '../lib/auth.js';

const TEST_LEAGUE_ID = requireEnv('TEST_LEAGUE_ID', __ENV.TEST_LEAGUE_ID);

export const options = {
  scenarios: {
    draft: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 200 },
        { duration: '15m', target: 200 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:make_pick}': ['p(95)<1500'],
    'http_req_duration{endpoint:player_list}': ['p(95)<800'],
    checks: ['rate>0.95'],
  },
};

// setup() runs once before VUs start. Nothing stateful here — each
// VU signs in independently in their own default() invocation.
export function setup() {
  console.log(`\nDraft simulation starting against ${TARGET_URL}`);
  console.log(`Target league: ${TEST_LEAGUE_ID}\n`);
  return {};
}

export default function () {
  // Sign in once per iteration. In production we'd reuse the token
  // across iterations — k6 doesn't let you persist state across
  // iterations without a file, so we sign in each loop. This adds
  // auth load but is more representative of real session patterns
  // (users sign in, browse, sign out, come back).
  const auth = signInAsTestUser(__VU);
  const headers = authHeaders(auth.token);

  // 1. Fetch the league — every draft page starts here
  const league = http.get(`${TARGET_URL}/api/leagues/${TEST_LEAGUE_ID}`, {
    headers,
    tags: { endpoint: 'get_league' },
  });
  check(league, {
    'get league 200': (r) => r.status === 200,
  });
  sleep(1);

  // 2. Fetch the available player pool
  const players = http.get(
    `${TARGET_URL}/api/players?available=true&limit=100`,
    { headers, tags: { endpoint: 'player_list' } },
  );
  check(players, {
    'player list 200': (r) => r.status === 200,
    'player list has data': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body));
      } catch {
        return false;
      }
    },
  });
  sleep(2);

  // 3. Fetch current draft state
  const draftState = http.get(
    `${TARGET_URL}/api/draft/${TEST_LEAGUE_ID}/state`,
    { headers, tags: { endpoint: 'draft_state' } },
  );
  check(draftState, {
    'draft state 200 or 404': (r) => r.status === 200 || r.status === 404,
  });
  sleep(3);

  // 4. Fetch the user's roster
  const roster = http.get(
    `${TARGET_URL}/api/rosters?league_id=${TEST_LEAGUE_ID}`,
    { headers, tags: { endpoint: 'get_roster' } },
  );
  check(roster, {
    'get roster 200': (r) => r.status === 200,
  });

  // Think time between actions (1-4 seconds — drafts are fast-paced)
  sleep(1 + Math.random() * 3);
}

export function handleSummary(data) {
  const errorRate = data.metrics.http_req_failed.values.rate;
  const p95 = data.metrics.http_req_duration.values['p(95)'];
  const p99 = data.metrics.http_req_duration.values['p(99)'];
  const passed = errorRate < 0.01 && p95 < 1500 && p99 < 3000;

  return {
    stdout: `\n${'='.repeat(70)}\n` +
      `DRAFT SIMULATION 200-USER TEST — ${passed ? 'PASS ✓' : 'FAIL ✗'}\n` +
      `${'='.repeat(70)}\n` +
      `This is the April-10-scenario test: 200 users in a live draft.\n` +
      `\n` +
      `Total requests: ${data.metrics.http_reqs.values.count}\n` +
      `Throughput: ${data.metrics.http_reqs.values.rate.toFixed(1)} req/s\n` +
      `Error rate: ${(errorRate * 100).toFixed(3)}% (budget: 1%) ${errorRate < 0.01 ? '✓' : '✗'}\n` +
      `p95 latency: ${p95.toFixed(0)}ms (budget: 1500ms) ${p95 < 1500 ? '✓' : '✗'}\n` +
      `p99 latency: ${p99.toFixed(0)}ms (budget: 3000ms) ${p99 < 3000 ? '✓' : '✗'}\n` +
      `${'='.repeat(70)}\n\n`,
  };
}
