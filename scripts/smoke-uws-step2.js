#!/usr/bin/env node
// Phase 4.5 chunk 11g.2 step 2 — smoke test runner.
// Runs four WS-upgrade scenarios against a locally-running draft-engine
// and reports pass/fail. Not committed (lives under scripts/, gitignored).
//
// Usage:
//   TOKEN_VALID_A=... TOKEN_VALID_B=... TOKEN_WRONG_SECRET=... \
//     PORT=14002 node scripts/smoke-uws-step2.js

import http from 'node:http';
import WebSocket from 'ws';

const PORT = Number(process.env.PORT || 14002);
const HOST = process.env.HOST || '127.0.0.1';
const { TOKEN_VALID_A, TOKEN_VALID_B, TOKEN_WRONG_SECRET } = process.env;

if (!TOKEN_VALID_A || !TOKEN_VALID_B || !TOKEN_WRONG_SECRET) {
  console.error('missing token envs');
  process.exit(2);
}

let pass = 0;
let fail = 0;

function rawUpgrade({ path, subprotocol, label, expectedStatus }) {
  return new Promise((resolve) => {
    const headers = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': Buffer.from(`${Math.random()}`).toString('base64').slice(0, 24),
      'Sec-WebSocket-Version': '13',
    };
    if (subprotocol) headers['Sec-WebSocket-Protocol'] = subprotocol;

    const req = http.request({ host: HOST, port: PORT, path, method: 'GET', headers });
    let resolved = false;
    const finish = (gotStatus) => {
      if (resolved) return;
      resolved = true;
      const ok = gotStatus === expectedStatus;
      console.log(
        `${ok ? '✓ PASS' : '✗ FAIL'}  ${label}: expected ${expectedStatus}, got ${gotStatus}`,
      );
      if (ok) pass++; else fail++;
      try { req.destroy(); } catch {}
      resolve();
    };
    req.on('response', (res) => finish(res.statusCode));
    req.on('upgrade', (res) => finish(res.statusCode));
    req.on('error', (e) => finish(`error: ${e.message}`));
    req.end();
    setTimeout(() => finish('timeout'), 3000);
  });
}

function wsEchoTest({ path, subprotocol, label }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}${path}`, [subprotocol]);
    let resolved = false;
    const finish = (ok, msg) => {
      if (resolved) return;
      resolved = true;
      console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${label}: ${msg}`);
      if (ok) pass++; else fail++;
      try { ws.close(); } catch {}
      resolve();
    };
    ws.on('open', () => ws.send('hello-from-smoke-c'));
    ws.on('message', (data) => {
      const text = data.toString('utf8');
      finish(text === 'echo: hello-from-smoke-c', `received "${text}"`);
    });
    ws.on('error', (e) => finish(false, `error: ${e.message}`));
    setTimeout(() => finish(false, 'timeout'), 3000);
  });
}

(async () => {
  console.log('=== chunk 11g.2 step 2 smoke tests ===\n');

  await rawUpgrade({
    path: '/ws/draft/lobby-A',
    subprotocol: null,
    label: '(a) no token',
    expectedStatus: 401,
  });

  await rawUpgrade({
    path: '/ws/draft/lobby-A',
    subprotocol: 'not-a-jwt',
    label: '(b1) random non-JWT string',
    expectedStatus: 401,
  });

  await rawUpgrade({
    path: '/ws/draft/lobby-A',
    subprotocol: TOKEN_WRONG_SECRET,
    label: '(b2) JWT signed with wrong secret',
    expectedStatus: 401,
  });

  await rawUpgrade({
    path: '/ws/draft/lobby-A',
    subprotocol: TOKEN_VALID_B,
    label: '(d) valid JWT but wrong lobby (token=lobby-B, URL=lobby-A)',
    expectedStatus: 403,
  });

  await wsEchoTest({
    path: '/ws/draft/lobby-A',
    subprotocol: TOKEN_VALID_A,
    label: '(c) valid JWT for matching lobby + echo round-trip',
  });

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
