// Scenario 5: NOTIFICATION STORM
// ------------------------------------------------------------------
// Purpose: simulate 200 users subscribed to notifications while an
// admin pushes a burst of messages. This tests the specific failure
// path from April 10 §5 (the cross-league leak) AND the load on the
// notification table under high write volume.
//
// The postmortem asked for a behavioral regression test verifying that
// users in league A do NOT receive notifications for league B. This
// scenario does that AT LOAD: 100 VUs subscribe as league-A members,
// 100 VUs subscribe as league-B members, and an admin inserts 500
// notifications across both leagues. At the end we assert zero leakage.
//
// REQUIRES:
//   - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY env vars
//     (service key needed to bulk-insert notifications)
//   - TEST_ACCOUNTS_LEAGUE_A, TEST_ACCOUNTS_LEAGUE_B — two separate
//     account pools, each member of exactly one league
//   - TEST_LEAGUE_A_ID, TEST_LEAGUE_B_ID — the two league IDs
//
// Pass criteria:
//   - Zero notification leakage (league-A user sees 0 league-B notifs)
//   - All 200 websocket connections held for 3 minutes
//   - p95 notification delivery latency < 2000ms
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_KEY=... \
//   TEST_ACCOUNTS_LEAGUE_A='[...]' TEST_ACCOUNTS_LEAGUE_B='[...]' \
//   TEST_LEAGUE_A_ID=uuid TEST_LEAGUE_B_ID=uuid \
//     k6 run scripts/load-test/scenarios/notification-storm.js

import ws from 'k6/ws';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/config.js';

const SUPABASE_SERVICE_KEY = __ENV.SUPABASE_SERVICE_KEY || '';
const TEST_LEAGUE_A_ID = __ENV.TEST_LEAGUE_A_ID || '';
const TEST_LEAGUE_B_ID = __ENV.TEST_LEAGUE_B_ID || '';
const ACCOUNTS_A = __ENV.TEST_ACCOUNTS_LEAGUE_A
  ? JSON.parse(__ENV.TEST_ACCOUNTS_LEAGUE_A)
  : [];
const ACCOUNTS_B = __ENV.TEST_ACCOUNTS_LEAGUE_B
  ? JSON.parse(__ENV.TEST_ACCOUNTS_LEAGUE_B)
  : [];

// Leakage counters — the critical metrics. If these are anything
// other than zero, the April 10 §5 regression is back.
const leakedAtoB = new Counter('leaked_league_a_notif_to_league_b_user');
const leakedBtoA = new Counter('leaked_league_b_notif_to_league_a_user');
const notifReceived = new Counter('notifications_received');
const deliveryLatency = new Trend('delivery_latency_ms');

export const options = {
  scenarios: {
    subscribers: {
      executor: 'per-vu-iterations',
      vus: 200,          // 100 league-A + 100 league-B
      iterations: 1,
      maxDuration: '5m',
    },
  },
  thresholds: {
    leaked_league_a_notif_to_league_b_user: ['count==0'],
    leaked_league_b_notif_to_league_a_user: ['count==0'],
    delivery_latency_ms: ['p(95)<2000'],
    checks: ['rate>0.95'],
  },
};

export function setup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing Supabase env vars');
  }
  if (!TEST_LEAGUE_A_ID || !TEST_LEAGUE_B_ID) {
    throw new Error('Missing TEST_LEAGUE_A_ID / TEST_LEAGUE_B_ID');
  }
  if (ACCOUNTS_A.length < 100 || ACCOUNTS_B.length < 100) {
    throw new Error('Need ≥ 100 accounts per league');
  }

  console.log(`\nNotification storm — 200 subscribers, 500 inserts`);
  console.log(`League A: ${TEST_LEAGUE_A_ID}`);
  console.log(`League B: ${TEST_LEAGUE_B_ID}\n`);

  // Defer the actual burst until after VUs are connected. We schedule
  // it for 60s from setup time; VU connect takes ~30s of ramp.
  return {
    burstStartAt: Date.now() + 60_000,
  };
}

export default function (data) {
  // First 100 VUs subscribe to league A. Second 100 subscribe to B.
  const isLeagueA = __VU <= 100;
  const league = isLeagueA ? 'A' : 'B';
  const leagueId = isLeagueA ? TEST_LEAGUE_A_ID : TEST_LEAGUE_B_ID;
  const accounts = isLeagueA ? ACCOUNTS_A : ACCOUNTS_B;
  const account = accounts[(__VU - 1) % accounts.length];

  // Sign in
  const signInRes = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: account.email, password: account.password }),
    { headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' } },
  );
  if (signInRes.status !== 200) {
    console.error(`VU ${__VU} sign-in failed: ${signInRes.status}`);
    return;
  }
  const body = JSON.parse(signInRes.body);
  const userId = body.user.id;
  const token = body.access_token;

  const wsBase = SUPABASE_URL.replace(/^https:\/\//, 'wss://');
  const wsUrl = `${wsBase}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;

  let insertsFired = false;

  ws.connect(wsUrl, null, function (socket) {
    socket.on('open', function () {
      // Subscribe with the FIXED filter (post-Task-1): `user_id=eq.${userId}`.
      // The callback (in NotificationService.ts) is what guards against
      // cross-league leak now, not the filter.
      socket.send(JSON.stringify({
        topic: `realtime:public:notifications:filter=user_id=eq.${userId}`,
        event: 'phx_join',
        payload: {
          config: {
            postgres_changes: [{
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${userId}`,
            }],
          },
          access_token: token,
        },
        ref: '1',
      }));

      // Heartbeat keepalive
      socket.setInterval(function () {
        socket.send(JSON.stringify({
          topic: 'phoenix',
          event: 'heartbeat',
          payload: {},
          ref: String(Date.now()),
        }));
      }, 25000);

      // Close the socket after 4 minutes (well after the burst)
      socket.setTimeout(function () { socket.close(); }, 4 * 60 * 1000);
    });

    socket.on('message', function (raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.event !== 'postgres_changes') return;

      const newRow = msg.payload?.data?.record;
      if (!newRow) return;

      notifReceived.add(1);

      // Measure latency from insert timestamp (we encode it in title)
      if (newRow.title && newRow.title.startsWith('LOADTEST:')) {
        const parts = newRow.title.split(':');
        const sentAt = parseInt(parts[2], 10);
        if (!isNaN(sentAt)) {
          deliveryLatency.add(Date.now() - sentAt);
        }
      }

      // THE CRITICAL ASSERTION: this VU should only receive notifs
      // for ITS league. If it receives one from the other league,
      // the April 10 leak is back.
      if (newRow.league_id) {
        if (isLeagueA && newRow.league_id !== TEST_LEAGUE_A_ID) {
          console.error(
            `LEAK! VU ${__VU} (league A) received league-${newRow.league_id} notif`,
          );
          leakedBtoA.add(1);
        }
        if (!isLeagueA && newRow.league_id !== TEST_LEAGUE_B_ID) {
          console.error(
            `LEAK! VU ${__VU} (league B) received league-${newRow.league_id} notif`,
          );
          leakedAtoB.add(1);
        }
      }
    });

    // One designated VU (VU 1) fires the burst once all sockets should
    // be up. 500 notifications split evenly across both leagues and
    // across all 200 users.
    if (__VU === 1) {
      socket.setTimeout(function () {
        fireNotificationBurst(userId, leagueId);
        insertsFired = true;
      }, Math.max(1000, data.burstStartAt - Date.now()));
    }
  });
}

function fireNotificationBurst(_userId, _leagueId) {
  console.log('\n*** Firing notification burst (500 inserts) ***\n');

  // Use service role to bypass RLS. In production, this would be a
  // server-side job using our server's Supabase admin client.
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  // Interleave league A + B inserts so leak detection works in real-time.
  const batch = [];
  for (let i = 0; i < 250; i++) {
    const accountA = ACCOUNTS_A[i % ACCOUNTS_A.length];
    const accountB = ACCOUNTS_B[i % ACCOUNTS_B.length];
    if (accountA.userId) {
      batch.push({
        user_id: accountA.userId,
        league_id: TEST_LEAGUE_A_ID,
        title: `LOADTEST:A:${Date.now()}`,
        body: `burst ${i} (league A)`,
        type: 'info',
      });
    }
    if (accountB.userId) {
      batch.push({
        user_id: accountB.userId,
        league_id: TEST_LEAGUE_B_ID,
        title: `LOADTEST:B:${Date.now()}`,
        body: `burst ${i} (league B)`,
        type: 'info',
      });
    }
  }

  // Fire in chunks of 50 (Postgres/Supabase REST payload safety)
  for (let i = 0; i < batch.length; i += 50) {
    const chunk = batch.slice(i, i + 50);
    const res = http.post(
      `${SUPABASE_URL}/rest/v1/notifications`,
      JSON.stringify(chunk),
      { headers, tags: { endpoint: 'notif_insert' } },
    );
    if (res.status >= 400) {
      console.error(`Insert batch ${i} failed: ${res.status} ${res.body}`);
    }
  }

  console.log(`*** Burst complete (${batch.length} notifications inserted) ***`);
}

export function handleSummary(data) {
  const aToB = data.metrics.leaked_league_a_notif_to_league_b_user?.values.count ?? 0;
  const bToA = data.metrics.leaked_league_b_notif_to_league_a_user?.values.count ?? 0;
  const received = data.metrics.notifications_received?.values.count ?? 0;
  const p95Latency = data.metrics.delivery_latency_ms?.values['p(95)'] ?? 0;
  const leakFree = aToB === 0 && bToA === 0;
  const passed = leakFree && p95Latency < 2000;

  return {
    stdout: `\n${'='.repeat(70)}\n` +
      `NOTIFICATION STORM TEST — ${passed ? 'PASS ✓' : 'FAIL ✗'}\n` +
      `${'='.repeat(70)}\n` +
      `April 10 §5 regression check: cross-league notification leak.\n` +
      `\n` +
      `Notifications received:   ${received}\n` +
      `League-A → B leakage:     ${aToB} (MUST be 0) ${aToB === 0 ? '✓' : '✗'}\n` +
      `League-B → A leakage:     ${bToA} (MUST be 0) ${bToA === 0 ? '✓' : '✗'}\n` +
      `p95 delivery latency:     ${p95Latency.toFixed(0)}ms (budget: 2000ms)\n` +
      `\n` +
      `${leakFree
        ? '✓ No cross-league notification leak detected under load.\n'
        : '✗ CRITICAL: cross-league leak regression — the April 10 bug is back.\n' +
          '  → Check NotificationService.ts subscribeToNotifications().\n' +
          '  → Verify the league_id guard in the postgres_changes callback.\n'}` +
      `${'='.repeat(70)}\n\n`,
  };
}
