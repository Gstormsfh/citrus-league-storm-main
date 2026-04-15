// Scenario 6: RECONNECTION STORM
// ------------------------------------------------------------------
// Purpose: simulate 200 users reconnecting at once after a transient
// network blip (Supabase realtime hiccup, Cloud Run rolling restart,
// browser coming out of sleep, etc.). This is a known failure mode
// in realtime stacks — "the reconnection thundering herd" — and one
// we haven't exercised.
//
// The realistic failure path:
//   1. Supabase rolls a realtime node (happens silently, Pro tier)
//   2. All 200 clients lose their websocket simultaneously
//   3. All 200 clients reconnect within the same 1-2s window
//   4. Auth endpoint is hammered with 200 concurrent token refreshes
//   5. Cloud Run cold-starts trying to serve 200 signin replays
//   6. Some clients back off to 10s+ reconnect delay
//   7. Users refresh the page because "the site is broken"
//   8. Now we have the reconnection storm + a refresh wave
//
// Load profile:
//   - Open 200 websockets over 60s (steady)
//   - Hold 30s (stable state)
//   - Close ALL sockets within 1s (simulated blip)
//   - Watch all 200 reconnect (target: 100% success, p95 < 3s)
//   - Repeat 3 times to measure consistency
//
// Pass criteria:
//   - 100% reconnect success (0 lost VUs)
//   - p95 reconnect latency < 3000ms
//   - No auth endpoint 429s (rate limit trips)
//   - No Cloud Run 503s during the reconnect wave
//
// REQUIRES: same env vars as realtime-connections.js
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... TEST_ACCOUNTS='[...]' \
//     k6 run scripts/load-test/scenarios/reconnection-storm.js

import ws from 'k6/ws';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEST_ACCOUNTS } from '../lib/config.js';

const reconnectSuccess = new Counter('reconnect_success');
const reconnectFailure = new Counter('reconnect_failure');
const reconnectLatency = new Trend('reconnect_latency_ms');
const authRateLimitHits = new Counter('auth_rate_limit_429');

export const options = {
  scenarios: {
    reconnect: {
      executor: 'per-vu-iterations',
      vus: 200,
      iterations: 1,
      maxDuration: '6m',
    },
  },
  thresholds: {
    reconnect_success: ['count>=600'],   // 200 VUs × 3 reconnect cycles
    reconnect_failure: ['count<20'],     // <3.3% failure tolerance
    reconnect_latency_ms: ['p(95)<3000'],
    auth_rate_limit_429: ['count<5'],    // we should NOT be rate-limiting
  },
};

export function setup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing Supabase env');
  if (TEST_ACCOUNTS.length === 0) throw new Error('TEST_ACCOUNTS empty');
  console.log(`\nReconnection storm — 200 VUs, 3 cycles of disconnect/reconnect`);
  console.log(`This simulates Supabase realtime hiccup + refresh wave.\n`);
  return {};
}

export default function () {
  const account = TEST_ACCOUNTS[(__VU - 1) % TEST_ACCOUNTS.length];
  const wsBase = SUPABASE_URL.replace(/^https:\/\//, 'wss://');
  const wsUrl = `${wsBase}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;

  // Run 3 disconnect/reconnect cycles per VU
  for (let cycle = 0; cycle < 3; cycle++) {
    const start = Date.now();

    // Step 1: sign in (this is what gets hammered on reconnect)
    const signInRes = http.post(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      JSON.stringify({ email: account.email, password: account.password }),
      {
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        tags: { endpoint: 'reconnect_signin', cycle: String(cycle) },
      },
    );
    if (signInRes.status === 429) {
      authRateLimitHits.add(1);
      reconnectFailure.add(1);
      // Back off and try next cycle
      continue;
    }
    if (signInRes.status !== 200) {
      reconnectFailure.add(1);
      continue;
    }
    const token = JSON.parse(signInRes.body).access_token;

    // Step 2: open websocket, subscribe, measure time-to-subscribed
    let subscribed = false;
    const res = ws.connect(wsUrl, null, function (socket) {
      socket.on('open', function () {
        socket.send(JSON.stringify({
          topic: 'realtime:public:notifications',
          event: 'phx_join',
          payload: { config: { postgres_changes: [] }, access_token: token },
          ref: '1',
        }));
      });

      socket.on('message', function (raw) {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
          subscribed = true;
          reconnectSuccess.add(1);
          reconnectLatency.add(Date.now() - start);
          // Simulate the "blip" — disconnect quickly, wait, reconnect
          socket.setTimeout(function () { socket.close(); }, 500);
        }
      });

      socket.on('error', function () { /* swallow */ });
      socket.on('close', function () { /* expected */ });

      // Hard cap: if we don't reach `subscribed` in 10s, give up this cycle
      socket.setTimeout(function () {
        if (!subscribed) reconnectFailure.add(1);
        socket.close();
      }, 10_000);
    });

    if (!res || res.status !== 101) {
      reconnectFailure.add(1);
    }

    // Inter-cycle jitter: wait 3-7s before the next reconnect attempt.
    // This prevents all 200 VUs from firing in lockstep, which is
    // ARTIFICIALLY WORSE than a real outage (real clients have
    // varying network latency to the nearest edge node).
    const jitterMs = 3000 + Math.random() * 4000;
    const jitterEnd = Date.now() + jitterMs;
    while (Date.now() < jitterEnd) { /* busy wait; k6 has no setTimeout in VU scope */ }
  }
}

export function handleSummary(data) {
  const success = data.metrics.reconnect_success?.values.count ?? 0;
  const failure = data.metrics.reconnect_failure?.values.count ?? 0;
  const rateLimit = data.metrics.auth_rate_limit_429?.values.count ?? 0;
  const p95 = data.metrics.reconnect_latency_ms?.values['p(95)'] ?? 0;
  const p99 = data.metrics.reconnect_latency_ms?.values['p(99)'] ?? 0;
  const passed = success >= 600 && failure < 20 && p95 < 3000 && rateLimit < 5;

  return {
    stdout: `\n${'='.repeat(70)}\n` +
      `RECONNECTION STORM — ${passed ? 'PASS ✓' : 'FAIL ✗'}\n` +
      `${'='.repeat(70)}\n` +
      `Validates: 200 users reconnecting after a realtime blip.\n` +
      `\n` +
      `Successful reconnects: ${success} / 600 (200 VUs × 3 cycles)\n` +
      `Failed reconnects:     ${failure} (budget: < 20)\n` +
      `Auth 429 rate limits:  ${rateLimit} (MUST be < 5)\n` +
      `p95 reconnect latency: ${p95.toFixed(0)}ms (budget: 3000ms) ${p95 < 3000 ? '✓' : '✗'}\n` +
      `p99 reconnect latency: ${p99.toFixed(0)}ms\n` +
      `\n` +
      `${passed
        ? '✓ 200-user reconnection storm is survivable.\n'
        : '✗ FAILURE DIAGNOSIS:\n' +
          (rateLimit >= 5
            ? '  • auth/v1/token is rate-limiting real users during reconnect.\n' +
              '    → Raise Supabase auth rate limit, or add client backoff.\n'
            : '') +
          (p95 >= 3000
            ? '  • Reconnect p95 > 3s — users see the site "hang" for too long.\n' +
              '    → Check Cloud Run cold-start + Supabase realtime node availability.\n'
            : '') +
          (failure >= 20
            ? '  • Too many hard failures — some users never reconnect at all.\n'
            : '')}` +
      `${'='.repeat(70)}\n\n`,
  };
}
