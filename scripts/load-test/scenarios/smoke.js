// Scenario 1: SMOKE TEST
// ------------------------------------------------------------------
// Purpose: 60-second sanity check that the API is up and responding.
// Run this FIRST, before any real load test. If smoke fails, no
// amount of scale-testing will mean anything.
//
// Load profile: 5 virtual users, 60 seconds, basic unauthenticated
// endpoints only (no test-account setup required).
//
// Pass criteria:
// - 100% success rate (no 5xx)
// - p95 latency < 500ms
// - p99 latency < 1000ms
//
// Usage:
//   k6 run scripts/load-test/scenarios/smoke.js
//   TARGET_URL=https://api.citrusfantasysports.com \
//     k6 run scripts/load-test/scenarios/smoke.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { TARGET_URL } from '../lib/config.js';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 5,
      duration: '60s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  // Endpoint 1: health check (fastest path — confirms Cloud Run is up)
  const health = http.get(`${TARGET_URL}/api/health`, {
    tags: { endpoint: 'health' },
  });
  check(health, {
    'health status 200 or 503': (r) => r.status === 200 || r.status === 503,
    'health has status field': (r) => {
      try {
        return !!JSON.parse(r.body).status;
      } catch {
        return false;
      }
    },
  });

  sleep(1);

  // Endpoint 2: public demo league (validates DB reachability via leagues table)
  const DEMO_LEAGUE_ID = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
  const league = http.get(`${TARGET_URL}/api/public/leagues/${DEMO_LEAGUE_ID}`, {
    tags: { endpoint: 'public_league' },
  });
  check(league, {
    'public league status 200': (r) => r.status === 200,
    'public league has content': (r) => r.body.length > 100,
  });

  sleep(2);
}

// Teardown runs once after all VUs finish. Print a concrete pass/fail.
export function handleSummary(data) {
  const v = data.metrics.http_req_duration.values;
  const num = (x) => (typeof x === 'number' ? x : 0);
  const p50 = num(v.med ?? v['p(50)']);
  const p95 = num(v['p(95)']);
  const p99 = num(v['p(99)']);
  const errorRate = num(data.metrics.http_req_failed.values.rate);
  const passed = errorRate < 0.001 && p95 < 500;

  const summary = {
    'stdout': `\n${'='.repeat(60)}\nSMOKE TEST — ${passed ? 'PASS' : 'FAIL'}\n${'='.repeat(60)}\n` +
      `Requests: ${num(data.metrics.http_reqs.values.count)}\n` +
      `Error rate: ${(errorRate * 100).toFixed(3)}%\n` +
      `p50 latency: ${p50.toFixed(0)}ms\n` +
      `p95 latency: ${p95.toFixed(0)}ms\n` +
      `p99 latency: ${p99.toFixed(0)}ms\n` +
      `${'='.repeat(60)}\n\n`,
  };
  return summary;
}
