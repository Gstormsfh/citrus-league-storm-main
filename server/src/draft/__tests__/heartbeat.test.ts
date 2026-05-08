// Phase 4.5 chunk 11g.7 sub-step 7d — heartbeat helper unit tests.
//
// Pure-function tests for `findTimedOutConnections`, `recordPong`,
// and `initializeHeartbeat`. No uWS dependency; test fixtures supply
// a minimal `HeartbeatWebSocket` mock with `getUserData()` + `end()`.
// uWS integration is intentionally out of scope (per the 7d recon
// decision — uWS test infrastructure investment doesn't pencil for
// the marginal coverage value over pure-function tests).
//
// Coverage:
//   - findTimedOutConnections: empty input, no timeouts, single
//     timeout, multi-timeout, exactly-at-boundary, multi-lobby,
//     disable-via-zero-timeout
//   - recordPong: updates lastPongAt
//   - initializeHeartbeat: stamps lastPongAt to provided `now`
//   - HEARTBEAT_PONG_TIMEOUT_CLOSE_CODE constant value

import { describe, it, expect } from 'vitest';
import {
  HEARTBEAT_PONG_TIMEOUT_CLOSE_CODE,
  findTimedOutConnections,
  initializeHeartbeat,
  recordPong,
  type HeartbeatWebSocket,
} from '../heartbeat';
import type { DraftSocketUserData } from '../types';

function makeUserData(overrides: Partial<DraftSocketUserData> = {}): DraftSocketUserData {
  return {
    lobbyId: 'lobby-1',
    userId: 'user-1',
    leagueId: 'league-1',
    draftId: 'draft-1',
    expiresAt: 9_999_999_999,
    lastPongAt: 0,
    ...overrides,
  };
}

function makeMockWs(userData: DraftSocketUserData): HeartbeatWebSocket {
  return {
    getUserData: () => userData,
    end: () => {
      // not called by these pure-function tests; included for
      // type-shape completeness so the mock satisfies the interface.
    },
  };
}

describe('initializeHeartbeat (chunk 11g.7 sub-step 7d)', () => {
  it('stamps lastPongAt to the provided now timestamp', () => {
    const userData = makeUserData({ lastPongAt: 0 });
    const ws = makeMockWs(userData);
    initializeHeartbeat(ws, 1_700_000_000_000);
    expect(userData.lastPongAt).toBe(1_700_000_000_000);
  });

  it('overwrites a previous lastPongAt value', () => {
    const userData = makeUserData({ lastPongAt: 1_000_000_000_000 });
    const ws = makeMockWs(userData);
    initializeHeartbeat(ws, 1_700_000_000_000);
    expect(userData.lastPongAt).toBe(1_700_000_000_000);
  });
});

describe('recordPong (chunk 11g.7 sub-step 7d)', () => {
  it('updates lastPongAt to the provided now timestamp', () => {
    const userData = makeUserData({ lastPongAt: 1_000_000_000_000 });
    const ws = makeMockWs(userData);
    recordPong(ws, 1_700_000_000_000);
    expect(userData.lastPongAt).toBe(1_700_000_000_000);
  });
});

describe('findTimedOutConnections (chunk 11g.7 sub-step 7d)', () => {
  const config = { pongTimeoutMs: 30_000 };

  it('returns empty array for empty connection list', () => {
    expect(findTimedOutConnections([], 1_700_000_000_000, config)).toEqual([]);
  });

  it('returns empty array when every connection ponged within timeout', () => {
    const now = 1_700_000_000_000;
    const ws1 = makeMockWs(makeUserData({ lastPongAt: now - 1_000 }));
    const ws2 = makeMockWs(makeUserData({ lastPongAt: now - 15_000 }));
    const ws3 = makeMockWs(makeUserData({ lastPongAt: now - 29_999 }));
    expect(findTimedOutConnections([ws1, ws2, ws3], now, config)).toEqual([]);
  });

  it('flags a single timed-out connection with its lobbyId/userId/age', () => {
    const now = 1_700_000_000_000;
    const fresh = makeMockWs(makeUserData({ lastPongAt: now - 1_000 }));
    const stale = makeMockWs(
      makeUserData({
        lobbyId: 'lobby-stale',
        userId: 'user-stale',
        lastPongAt: now - 60_000,
      }),
    );
    const result = findTimedOutConnections([fresh, stale], now, config);
    expect(result).toHaveLength(1);
    expect(result[0].lobbyId).toBe('lobby-stale');
    expect(result[0].userId).toBe('user-stale');
    expect(result[0].lastPongAgeMs).toBe(60_000);
    expect(result[0].ws).toBe(stale);
  });

  it('flags multiple timed-out connections across multiple lobbies', () => {
    const now = 1_700_000_000_000;
    const stale1 = makeMockWs(
      makeUserData({ lobbyId: 'lobby-A', userId: 'user-1', lastPongAt: now - 60_000 }),
    );
    const fresh = makeMockWs(
      makeUserData({ lobbyId: 'lobby-A', userId: 'user-2', lastPongAt: now - 5_000 }),
    );
    const stale2 = makeMockWs(
      makeUserData({ lobbyId: 'lobby-B', userId: 'user-3', lastPongAt: now - 45_000 }),
    );
    const result = findTimedOutConnections([stale1, fresh, stale2], now, config);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.userId).sort()).toEqual(['user-1', 'user-3']);
  });

  it('does NOT flag a connection at exactly pongTimeoutMs (strict inequality)', () => {
    // Boundary: now - lastPongAt === pongTimeoutMs is alive (leniency
    // for clock jitter between Date.now() reads and timer firing).
    // Strictly-greater-than is the timeout condition.
    const now = 1_700_000_000_000;
    const exactlyAtBoundary = makeMockWs(
      makeUserData({ lastPongAt: now - 30_000 }),
    );
    const oneMsOver = makeMockWs(
      makeUserData({ userId: 'user-over', lastPongAt: now - 30_001 }),
    );
    const result = findTimedOutConnections([exactlyAtBoundary, oneMsOver], now, config);
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('user-over');
  });

  it('returns empty array when pongTimeoutMs is 0 (heartbeat disabled)', () => {
    // Test environment / vitest setup default: HEARTBEAT_PONG_TIMEOUT_MS=0
    // disables the scanner so fake-timer tests don't trip on it.
    const now = 1_700_000_000_000;
    const stale = makeMockWs(makeUserData({ lastPongAt: now - 999_999 }));
    expect(findTimedOutConnections([stale], now, { pongTimeoutMs: 0 })).toEqual([]);
  });

  it('returns empty array when pongTimeoutMs is negative (defensive)', () => {
    const now = 1_700_000_000_000;
    const stale = makeMockWs(makeUserData({ lastPongAt: now - 999_999 }));
    expect(findTimedOutConnections([stale], now, { pongTimeoutMs: -5 })).toEqual([]);
  });

  it('preserves the WebSocket reference identity for the caller to force-close', () => {
    // The caller iterates the result and calls `entry.ws.end(4002, ...)`.
    // This regression-locks that the returned `ws` is the SAME reference
    // passed in, not a copy.
    const now = 1_700_000_000_000;
    const stale = makeMockWs(makeUserData({ lastPongAt: now - 60_000 }));
    const result = findTimedOutConnections([stale], now, config);
    expect(result[0].ws).toBe(stale);
  });
});

describe('HEARTBEAT_PONG_TIMEOUT_CLOSE_CODE constant (chunk 11g.7 sub-step 7d)', () => {
  it('is 4002 — the value the client closeCodes.ts classifier carves out as transient', () => {
    // Cross-package contract: this constant MUST match the carve-out
    // in `apps/web/src/lib/draftClient/closeCodes.ts` so heartbeat
    // disconnects classify as `transient` (reconnect with backoff)
    // rather than falling into the 4001-4099 → permanent_auth range.
    expect(HEARTBEAT_PONG_TIMEOUT_CLOSE_CODE).toBe(4002);
  });
});
