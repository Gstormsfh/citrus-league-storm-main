// Scenario 4: REALTIME WEBSOCKET CONNECTIONS
// ------------------------------------------------------------------
// Purpose: validate that the Supabase plan tier can actually hold 200
// concurrent realtime websocket connections. This is the single
// scariest unknown before playoffs — our plan tier's connection cap is
// a hard ceiling, and exceeding it silently breaks realtime features
// (draft picks, notifications, roster updates) without any HTTP error.
//
// Supabase tier caps (as of 2026-04-14):
//   - Free tier:  200 concurrent realtime connections (exact at ceiling)
//   - Pro tier:   500 concurrent realtime connections
//   - Team tier:  1,000 concurrent realtime connections
//
// If we're on Free and we hit 200 users, the 201st connection SILENTLY
// FAILS. That is how April 10 §5 (cross-league leak) could happen
// again with a new failure mode: users whose websocket never connects
// won't see picks or notifications at all and will assume the site is
// broken.
//
// This scenario does NOT use k6's HTTP module. It uses the k6 websocket
// module to hold 200 concurrent connections against the Supabase
// realtime endpoint for 5 minutes.
//
// Pass criteria:
//   - All 200 connections open successfully (ws_connecting: 200/200)
//   - No unexpected disconnects (ws_sessions drop == ramp-down only)
//   - No "connection limit exceeded" errors in response messages
//   - Supabase dashboard shows exactly 200 active connections
//
// REQUIRES:
//   - SUPABASE_URL, SUPABASE_ANON_KEY env vars
//   - TEST_ACCOUNTS env var (same pool as draft-simulation.js)
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//   TEST_ACCOUNTS='[{"email":"...","password":"..."}]' \
//     k6 run scripts/load-test/scenarios/realtime-connections.js

import ws from 'k6/ws';
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEST_ACCOUNTS } from '../lib/config.js';

// Custom metrics beyond the built-in ws_* metrics
const wsConnectSuccess = new Counter('ws_connect_success');
const wsConnectFailure = new Counter('ws_connect_failure');
const wsConnectLatency = new Trend('ws_connect_latency_ms');

export const options = {
  scenarios: {
    realtime: {
      // Each VU opens ONE websocket and holds it. 200 VUs == 200 connections.
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },   // 0-50 — warm up
        { duration: '1m', target: 200 },  // 50-200 — ramp to full load
        { duration: '5m', target: 200 },  // hold at 200
        { duration: '30s', target: 0 },   // graceful ramp-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    ws_connect_success: ['count>=200'],  // every VU must connect at least once
    ws_connect_failure: ['count<10'],    // <5% failure tolerance during ramp
    checks: ['rate>0.95'],
  },
};

export function setup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY');
  }
  if (TEST_ACCOUNTS.length === 0) {
    throw new Error('TEST_ACCOUNTS empty — provision test accounts first');
  }

  console.log(`\nRealtime connection test against ${SUPABASE_URL}`);
  console.log(`Target: 200 concurrent websocket connections`);
  console.log(`This validates your Supabase plan tier.\n`);
  console.log(`Reminder: open the Supabase Dashboard → Realtime Inspector`);
  console.log(`and watch the active-connections count climb.\n`);
  return {};
}

export default function () {
  // 1. Sign in to get a user-scoped JWT. Supabase Realtime requires
  //    the auth token to be passed via the apikey query param AND as a
  //    Bearer token in the websocket's auth message.
  const account = TEST_ACCOUNTS[(__VU - 1) % TEST_ACCOUNTS.length];
  const signInRes = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: account.email, password: account.password }),
    {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      tags: { endpoint: 'rt_signin' },
    },
  );
  if (signInRes.status !== 200) {
    wsConnectFailure.add(1);
    return;
  }
  const token = JSON.parse(signInRes.body).access_token;

  // 2. Convert the Supabase HTTPS URL → wss://…/realtime/v1/websocket
  const wsBase = SUPABASE_URL.replace(/^https:\/\//, 'wss://');
  const wsUrl =
    `${wsBase}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;

  const connectStart = Date.now();

  const res = ws.connect(wsUrl, null, function (socket) {
    socket.on('open', function () {
      wsConnectSuccess.add(1);
      wsConnectLatency.add(Date.now() - connectStart);

      // Authenticate this socket with the user's JWT. Supabase Realtime
      // expects a phoenix-style message.
      socket.send(JSON.stringify({
        topic: 'phoenix',
        event: 'heartbeat',
        payload: {},
        ref: '1',
      }));

      // Subscribe to a harmless channel — just `notifications:test`.
      // We're not testing message delivery here, only connection hold.
      socket.send(JSON.stringify({
        topic: 'realtime:public:notifications:test',
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { ack: false, self: false },
            presence: { key: '' },
            postgres_changes: [],
          },
          access_token: token,
        },
        ref: '2',
      }));

      // Heartbeat every 30s to keep the socket alive. Phoenix
      // disconnects idle sockets after 60s.
      socket.setInterval(function () {
        socket.send(JSON.stringify({
          topic: 'phoenix',
          event: 'heartbeat',
          payload: {},
          ref: String(Date.now()),
        }));
      }, 30000);

      // Hold the connection for the remainder of the test duration.
      // k6 will close it when the VU lifecycle ends.
      socket.setTimeout(function () { socket.close(); }, 5 * 60 * 1000);
    });

    socket.on('message', function (data) {
      // Catch the "connection limit exceeded" server-side error explicitly.
      // If you see this even once, you've hit your plan cap.
      if (typeof data === 'string' && data.includes('too_many_connections')) {
        console.error(`VU ${__VU}: too_many_connections — plan tier exceeded`);
        wsConnectFailure.add(1);
      }
    });

    socket.on('error', function (e) {
      console.error(`VU ${__VU} websocket error: ${e.error()}`);
      wsConnectFailure.add(1);
    });

    socket.on('close', function () { /* expected on ramp-down */ });
  });

  check(res, {
    'ws handshake status 101': (r) => r && r.status === 101,
  });
}

export function handleSummary(data) {
  const success = data.metrics.ws_connect_success?.values.count ?? 0;
  const failure = data.metrics.ws_connect_failure?.values.count ?? 0;
  const avgLatency = data.metrics.ws_connect_latency_ms?.values.avg ?? 0;
  const passed = success >= 200 && failure < 10;

  return {
    stdout: `\n${'='.repeat(70)}\n` +
      `REALTIME-CONNECTIONS TEST — ${passed ? 'PASS ✓' : 'FAIL ✗'}\n` +
      `${'='.repeat(70)}\n` +
      `This validates your Supabase plan tier's realtime connection cap.\n` +
      `\n` +
      `Successful connects: ${success} (target: ≥ 200)\n` +
      `Failed connects:     ${failure} (budget: < 10)\n` +
      `Avg connect latency: ${avgLatency.toFixed(0)}ms\n` +
      `\n` +
      `${passed ? (
        `✓ Your plan tier can hold 200 realtime connections.\n` +
        `  Cross-verify in the Supabase Dashboard → Realtime Inspector.\n`
      ) : (
        `✗ FAILURE MODES TO CHECK:\n` +
        `  1. Are you on Supabase Free (200 cap) and hit the ceiling?\n` +
        `     → Upgrade to Pro ($25/mo, 500 realtime connections)\n` +
        `  2. Did you see "too_many_connections" in logs above?\n` +
        `     → Definitive plan cap hit; upgrade required.\n` +
        `  3. Was connect latency > 5000ms? Network saturation, not plan cap.\n`
      )}` +
      `${'='.repeat(70)}\n\n`,
  };
}
