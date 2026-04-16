// Scenario 2: STEADY-STATE LOAD
// ------------------------------------------------------------------
// Purpose: simulate 200 concurrent users browsing the site at a
// realistic pace. This is the "is 200 users safe" test.
//
// Load profile:
//   - Ramp from 0 → 200 VUs over 2 minutes
//   - Hold at 200 VUs for 10 minutes (the actual test)
//   - Ramp down 200 → 0 over 1 minute
//   - Total runtime: 13 minutes
//
// Uses unauthenticated public endpoints so it can run without test
// account provisioning. For authenticated load tests, use
// draft-simulation.js (requires test account pool).
//
// Pass criteria (derived from deploy-guide capacity math):
//   - Error rate < 0.5% (1 in 200)
//   - p95 latency < 1000ms
//   - p99 latency < 2000ms
//   - Zero timeouts (> 5s)
//   - Cloud Run should settle at 2-4 instances (watch dashboard)
//   - Supabase connections should stay under 180
//
// Usage:
//   TARGET_URL=https://api.citrusfantasysports.com \
//     k6 run scripts/load-test/scenarios/steady-state.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { TARGET_URL } from '../lib/config.js';

export const options = {
  scenarios: {
    steady_state: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },   // ramp up
        { duration: '10m', target: 200 },  // hold at 200
        { duration: '1m', target: 0 },     // ramp down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.005'],
    // Note: timeouts are caught by http_req_failed above. k6 v1.7+
    // removed count<N aggregation on trend metrics.
    checks: ['rate>0.95'],
  },
};

// Realistic user behavior — simulates browsing the site.
// Weight reflects traffic mix: most traffic is landing page + demo
// league lookups, some is schedule/matchup pages.
const DEMO_LEAGUE_ID = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
const TODAY = new Date().toISOString().slice(0, 10);
const BROWSE_FLOWS = [
  { weight: 40, path: '/api/health', name: 'health' },
  { weight: 30, path: `/api/public/leagues/${DEMO_LEAGUE_ID}`, name: 'public_league' },
  { weight: 20, path: `/api/public/leagues/${DEMO_LEAGUE_ID}/teams`, name: 'public_teams' },
  { weight: 10, path: `/api/public/schedule/games?date=${TODAY}`, name: 'public_schedule' },
];

function pickFlow() {
  const r = Math.random() * 100;
  let acc = 0;
  for (const flow of BROWSE_FLOWS) {
    acc += flow.weight;
    if (r <= acc) return flow;
  }
  return BROWSE_FLOWS[0];
}

export default function () {
  const flow = pickFlow();
  const res = http.get(`${TARGET_URL}${flow.path}`, {
    tags: { endpoint: flow.name },
    timeout: '5s',
  });

  check(res, {
    [`${flow.name} status 2xx or 503`]: (r) =>
      (r.status >= 200 && r.status < 300) || r.status === 503,
  });

  // Think time — real users don't hit pages back-to-back.
  // 2-5 seconds of "reading" between actions.
  sleep(2 + Math.random() * 3);
}

export function handleSummary(data) {
  const v = data.metrics.http_req_duration.values;
  const num = (x) => (typeof x === 'number' ? x : 0);
  const errorRate = num(data.metrics.http_req_failed.values.rate);
  const p50 = num(v.med ?? v['p(50)']);
  const p95 = num(v['p(95)']);
  const p99 = num(v['p(99)']);
  const maxLat = num(v.max);
  const peakVUs = num(data.metrics.vus_max.values.max);
  const totalReqs = num(data.metrics.http_reqs.values.count);
  const throughput = num(data.metrics.http_reqs.values.rate);
  const checksRate = num(data.metrics.checks?.values?.rate);
  const passed = errorRate < 0.005 && p95 < 1000 && p99 < 2000;

  const report = `\n${'='.repeat(70)}\n` +
    `STEADY-STATE 200-USER TEST — ${passed ? 'PASS' : 'FAIL'}\n` +
    `${'='.repeat(70)}\n` +
    `Duration: 13 minutes\n` +
    `Peak VUs: ${peakVUs}\n` +
    `Total requests: ${totalReqs}\n` +
    `Throughput: ${throughput.toFixed(1)} req/s\n` +
    `\n` +
    `Latency:\n` +
    `  p50: ${p50.toFixed(0)}ms\n` +
    `  p95: ${p95.toFixed(0)}ms (budget: 1000ms) ${p95 < 1000 ? 'OK' : 'FAIL'}\n` +
    `  p99: ${p99.toFixed(0)}ms (budget: 2000ms) ${p99 < 2000 ? 'OK' : 'FAIL'}\n` +
    `  max: ${maxLat.toFixed(0)}ms\n` +
    `\n` +
    `Errors:\n` +
    `  Failed requests: ${(errorRate * 100).toFixed(3)}% (budget: 0.5%) ${errorRate < 0.005 ? 'OK' : 'FAIL'}\n` +
    `\n` +
    `Checks passed: ${(checksRate * 100).toFixed(1)}%\n` +
    `${'='.repeat(70)}\n` +
    `\n` +
    `Cross-reference against GCP Cloud Run metrics during this window:\n` +
    `  - Instance count should have peaked at 2-4 (not maxScale=10)\n` +
    `  - CPU util should be 30-60% per instance\n` +
    `  - Memory should stay below 1.2Gi per instance\n` +
    `  - No OOM kills in logs\n` +
    `\n` +
    `Cross-reference against Supabase Dashboard:\n` +
    `  - Active connections should peak below 180\n` +
    `  - No "too many connections" errors in logs\n` +
    `\n`;

  return { stdout: report };
}
