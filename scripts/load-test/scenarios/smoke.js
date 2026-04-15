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

  // Endpoint 2: public players list (validates DB reachability)
  const players = http.get(`${TARGET_URL}/api/public/players`, {
    tags: { endpoint: 'public_players' },
  });
  check(players, {
    'public players status 200': (r) => r.status === 200,
    'public players has content': (r) => r.body.length > 100,
  });

  sleep(2);
}

// Teardown runs once after all VUs finish. Print a concrete pass/fail.
export function handleSummary(data) {
  const passed =
    data.metrics.http_req_failed.values.rate < 0.001 &&
    data.metrics.http_req_duration.values['p(95)'] < 500;

  const summary = {
    'stdout': `\n${'='.repeat(60)}\nSMOKE TEST — ${passed ? 'PASS' : 'FAIL'}\n${'='.repeat(60)}\n` +
      `Requests: ${data.metrics.http_reqs.values.count}\n` +
      `Error rate: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(3)}%\n` +
      `p50 latency: ${data.metrics.http_req_duration.values.med.toFixed(0)}ms\n` +
      `p95 latency: ${data.metrics.http_req_duration.values['p(95)'].toFixed(0)}ms\n` +
      `p99 latency: ${data.metrics.http_req_duration.values['p(99)'].toFixed(0)}ms\n` +
      `${'='.repeat(60)}\n\n`,
  };
  return summary;
}
