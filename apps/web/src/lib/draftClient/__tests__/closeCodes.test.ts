// Phase 4.5 chunk 11g.5a — close-code disposition tests.
// Phase 4.5 chunk 11g.7 sub-step 7d — added 4002 carve-out regression
// lock: heartbeat pong-timeout MUST classify as `transient`, not
// `permanent_auth`, despite living in the 4001-4099 auth range.
//
// 6 tests covering each major code class: standard normal, standard
// transient, custom auth (4001-4099), custom lobby (4100-4199),
// custom server (4200+), and the 4002 carve-out.

import { describe, it, expect } from 'vitest';
import { classifyCloseCode } from '../closeCodes';

describe('classifyCloseCode (chunk 11g.5a)', () => {
  it('1000/1001 are normal closures (caller-initiated or browser navigation)', () => {
    expect(classifyCloseCode(1000, '')).toBe('normal');
    expect(classifyCloseCode(1001, 'going_away')).toBe('normal');
  });

  it('1006/1011/1013 are transient (network drop / server error / backpressure)', () => {
    expect(classifyCloseCode(1006, '')).toBe('transient');
    expect(classifyCloseCode(1011, '')).toBe('transient');
    expect(classifyCloseCode(1013, 'backpressure')).toBe('transient');
  });

  it('4001-4099 are permanent_auth (with 4002 carved out — see next test)', () => {
    expect(classifyCloseCode(4001, 'token_expired')).toBe('permanent_auth');
    expect(classifyCloseCode(4003, '')).toBe('permanent_auth');
    expect(classifyCloseCode(4050, '')).toBe('permanent_auth');
    expect(classifyCloseCode(4099, '')).toBe('permanent_auth');
  });

  it('4002 is transient — heartbeat pong-timeout carve-out (chunk 11g.7 sub-step 7d)', () => {
    // Regression lock: the engine's heartbeat soft-check timer
    // emits close code 4002 when a connection misses its pong
    // window (`server/src/draft/heartbeat.ts`
    // `HEARTBEAT_PONG_TIMEOUT_CLOSE_CODE`). Despite living inside
    // the 4001-4099 auth range, 4002 represents a network /
    // keepalive failure, NOT a token problem — clients reconnect
    // with backoff. The carve-out in classifyCloseCode runs BEFORE
    // the 4001-4099 range check; if a future refactor reorders
    // those checks, this test is the canary.
    expect(classifyCloseCode(4002, 'pong_timeout')).toBe('transient');
    // Empty reason string also classifies as transient — the
    // disposition doesn't depend on the reason today.
    expect(classifyCloseCode(4002, '')).toBe('transient');
  });

  it('4010 is transient — chunk 11g.10 client-watchdog carve-out', () => {
    // Regression lock: 4010 sits numerically inside the 4001-4099
    // "permanent_auth" range but its semantic is "client-side liveness
    // watchdog detected N missed pongs and self-closed" — a network /
    // keepalive failure, NOT an auth problem. Client reconnects with
    // backoff. Mirrors the 4002 carve-out pattern. The carve-out in
    // classifyCloseCode runs BEFORE the 4001-4099 range check; if a
    // future refactor reorders those checks, this test is the canary.
    expect(classifyCloseCode(4010, 'client_watchdog_stale')).toBe('transient');
    // Boundary: 4009 and 4011 stay in permanent_auth.
    expect(classifyCloseCode(4009, '')).toBe('permanent_auth');
    expect(classifyCloseCode(4011, '')).toBe('permanent_auth');
  });

  it('4100-4199 are permanent_lobby', () => {
    expect(classifyCloseCode(4100, 'lobby_not_found')).toBe('permanent_lobby');
    expect(classifyCloseCode(4150, 'draft_completed')).toBe('permanent_lobby');
    expect(classifyCloseCode(4199, '')).toBe('permanent_lobby');
  });

  it('4200+ are permanent_server; codes outside known ranges are transient', () => {
    expect(classifyCloseCode(4200, '')).toBe('permanent_server');
    expect(classifyCloseCode(4500, '')).toBe('permanent_server');
    expect(classifyCloseCode(4999, '')).toBe('permanent_server');
    // 1009 (message too big), 1010 (extension required), etc. — not
    // explicitly classified, fall through to transient.
    expect(classifyCloseCode(1009, '')).toBe('transient');
    expect(classifyCloseCode(1010, '')).toBe('transient');
  });

  it('4300 is permanent_auth — chunk 11g.10 sub-step 10c-2 gate (a) carve-out', () => {
    // Regression lock: 4300 sits numerically inside the 4200-4999
    // "permanent_server" range but its semantic is "bad identity
    // shape" (non-UUIDv4 sub). The only legitimate remediation is
    // fresh auth → fresh discovery token, which is exactly the
    // permanent_auth recovery flow the client already renders. The
    // carve-out in classifyCloseCode runs BEFORE the 4200-4999 range
    // check; if a future refactor reorders those checks, this test
    // is the canary.
    expect(classifyCloseCode(4300, 'unauthorized_bad_shape')).toBe('permanent_auth');
    // Empty reason still classifies the same — disposition doesn't
    // depend on reason today.
    expect(classifyCloseCode(4300, '')).toBe('permanent_auth');
    // Boundary: 4299 (just below the carve-out) stays in the
    // permanent_server range.
    expect(classifyCloseCode(4299, '')).toBe('permanent_server');
    // Boundary: 4301 (just above the carve-out) falls back to
    // permanent_server per the range default.
    expect(classifyCloseCode(4301, '')).toBe('permanent_server');
  });

  it('4400 is permanent_not_initialized — chunk 11g.10 sub-step 10c-2 gate (b) carve-out', () => {
    // Regression lock: 4400 sits numerically inside the 4200-4999
    // "permanent_server" range but has NEW distinct semantics — not
    // auth, not lobby-gone, not server fault. Genuinely new product
    // state ("commissioner hasn't configured the draft yet"). Its
    // own disposition drives a distinct banner + no auto-reconnect
    // per the architect's ruling.
    expect(classifyCloseCode(4400, 'draft_not_initialized')).toBe(
      'permanent_not_initialized',
    );
    expect(classifyCloseCode(4400, '')).toBe('permanent_not_initialized');
    // Boundary: 4399 stays permanent_server (below the carve-out).
    expect(classifyCloseCode(4399, '')).toBe('permanent_server');
    // Boundary: 4401 stays permanent_server (above the carve-out).
    expect(classifyCloseCode(4401, '')).toBe('permanent_server');
  });

  it('gate carve-outs run BEFORE the 4200-4999 range check (ordering canary)', () => {
    // Belt-and-suspenders coverage of the ordering guarantee. If a
    // future refactor moves the range check ahead of the equality
    // carve-outs, 4300 would return permanent_server (wrong — should
    // be permanent_auth) and 4400 would return permanent_server
    // (wrong — should be permanent_not_initialized). This test
    // fails immediately in both cases.
    expect(classifyCloseCode(4300, '')).not.toBe('permanent_server');
    expect(classifyCloseCode(4400, '')).not.toBe('permanent_server');
  });
});
