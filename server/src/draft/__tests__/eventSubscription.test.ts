// Phase 4.5 chunk 11g.7 sub-step 7e — eventSubscription unit tests.
//
// Pure-function coverage for `parseNotificationPayload`,
// `shouldApplyEvent`, `computeReconnectDelayMs`. No real pg client;
// the lifecycle path (`startEventSubscription`) is exercised with a
// mock client factory so reconnect + dispatch + stop semantics are
// verifiable without a live database.
//
// Real-DB integration (cross-process E2E across actual Postgres
// instances) is out of scope here — that belongs to the chunk
// 11g.10/11g.11 staging tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Client as PgClient } from 'pg';
import {
  parseNotificationPayload,
  shouldApplyEvent,
  computeReconnectDelayMs,
  startEventSubscription,
} from '../eventSubscription';

describe('parseNotificationPayload (chunk 11g.7 sub-step 7e)', () => {
  it('parses a valid {league_id, seq} payload', () => {
    const result = parseNotificationPayload('{"league_id":"abc","seq":42}');
    expect(result).toEqual({ leagueId: 'abc', seq: 42 });
  });

  it('returns null for malformed JSON', () => {
    expect(parseNotificationPayload('not json')).toBeNull();
    expect(parseNotificationPayload('{')).toBeNull();
  });

  it('returns null when league_id is missing or wrong type', () => {
    expect(parseNotificationPayload('{"seq":42}')).toBeNull();
    expect(parseNotificationPayload('{"league_id":123,"seq":42}')).toBeNull();
  });

  it('returns null when seq is missing or non-finite', () => {
    expect(parseNotificationPayload('{"league_id":"abc"}')).toBeNull();
    expect(parseNotificationPayload('{"league_id":"abc","seq":"42"}')).toBeNull();
    // JSON cannot directly encode NaN/Infinity, but a guard against
    // typed-but-non-finite-numeric inputs is still load-bearing if a
    // future producer changes payload shape.
  });

  it('filters out the self-test sentinel payload ({"_test": true})', () => {
    // The self-test mechanism uses a separate raw-text match for
    // receipt detection; parseNotificationPayload returns null so the
    // dispatch callback never sees it as a real event.
    expect(parseNotificationPayload('{"_test":true}')).toBeNull();
    expect(parseNotificationPayload('{"_test": true}')).toBeNull();
  });
});

describe('shouldApplyEvent (chunk 11g.7 sub-step 7e)', () => {
  it('returns true for seq strictly greater than lastAppliedSeq', () => {
    expect(shouldApplyEvent(10, 5)).toBe(true);
    expect(shouldApplyEvent(1, 0)).toBe(true);
  });

  it('returns false for seq equal to lastAppliedSeq (own-engine bounce dedup)', () => {
    expect(shouldApplyEvent(5, 5)).toBe(false);
  });

  it('returns false for seq less than lastAppliedSeq (late-arrival NOTIFY)', () => {
    expect(shouldApplyEvent(3, 5)).toBe(false);
  });
});

describe('computeReconnectDelayMs (chunk 11g.7 sub-step 7e)', () => {
  it('starts at 3 seconds for attempt 1', () => {
    expect(computeReconnectDelayMs(1)).toBe(3_000);
  });

  it('doubles each attempt: 3s → 6s → 12s → 24s → 48s', () => {
    expect(computeReconnectDelayMs(2)).toBe(6_000);
    expect(computeReconnectDelayMs(3)).toBe(12_000);
    expect(computeReconnectDelayMs(4)).toBe(24_000);
    expect(computeReconnectDelayMs(5)).toBe(48_000);
  });

  it('caps at 60 seconds for attempt 6 and beyond', () => {
    expect(computeReconnectDelayMs(6)).toBe(60_000);
    expect(computeReconnectDelayMs(7)).toBe(60_000);
    expect(computeReconnectDelayMs(20)).toBe(60_000);
  });

  it('defends against zero or negative attempt counters', () => {
    expect(computeReconnectDelayMs(0)).toBe(3_000);
    expect(computeReconnectDelayMs(-1)).toBe(3_000);
  });
});

// ── startEventSubscription lifecycle tests ────────────────────────────
//
// Use a minimal pg.Client-shaped EventEmitter mock. Verifies the
// happy-path dispatch flow + reconnect handling + clean shutdown.

interface MockPgClient extends EventEmitter {
  connect: () => Promise<void>;
  query: ReturnType<typeof vi.fn>;
  end: () => Promise<void>;
}

function makeMockClient(): MockPgClient {
  const client = new EventEmitter() as MockPgClient;
  client.connect = vi.fn(async () => {});
  client.query = vi.fn(async () => ({ rows: [] }));
  client.end = vi.fn(async () => {});
  return client;
}

describe('startEventSubscription (chunk 11g.7 sub-step 7e)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts up, registers LISTEN, dispatches received notifications', async () => {
    const client = makeMockClient();
    const dispatch = vi.fn(async () => {});
    const handle = startEventSubscription({
      connectionString: 'postgres://test',
      dispatch,
      clientFactory: () => client as unknown as PgClient,
      selfTestTimeoutMs: 0, // disable self-test (timer)
      watchdogIntervalMs: 0, // 10c-1d: disable the periodic watchdog probe
    });

    // Allow the async connect() chain to settle.
    await vi.runAllTimersAsync();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith('LISTEN draft_events');

    // Simulate a NOTIFY arriving.
    client.emit('notification', {
      channel: 'draft_events',
      payload: '{"league_id":"lobby-1","seq":7}',
    });
    await vi.runAllTimersAsync();

    // Chunk 11g.10 sub-step 10c-1b: dispatch signature grew a second
    // arg `notificationReceivedAtMs` (timestamp captured in the
    // notification handler for downstream fanout-metric decomposition).
    expect(dispatch).toHaveBeenCalledWith(
      { leagueId: 'lobby-1', seq: 7 },
      expect.any(Number),
    );

    await handle.stop();
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('ignores notifications on other channels', async () => {
    const client = makeMockClient();
    const dispatch = vi.fn(async () => {});
    const handle = startEventSubscription({
      connectionString: 'postgres://test',
      dispatch,
      clientFactory: () => client as unknown as PgClient,
      selfTestTimeoutMs: 0,
      watchdogIntervalMs: 0, // 10c-1d: disable the periodic watchdog probe
    });
    await vi.runAllTimersAsync();

    client.emit('notification', {
      channel: 'other_channel',
      payload: '{"league_id":"x","seq":1}',
    });
    await vi.runAllTimersAsync();

    expect(dispatch).not.toHaveBeenCalled();
    await handle.stop();
  });

  it('treats _test payload as self-test ack (does NOT dispatch)', async () => {
    const client = makeMockClient();
    const dispatch = vi.fn(async () => {});
    const handle = startEventSubscription({
      connectionString: 'postgres://test',
      dispatch,
      clientFactory: () => client as unknown as PgClient,
      selfTestTimeoutMs: 0,
      watchdogIntervalMs: 0, // 10c-1d: disable the periodic watchdog probe
    });
    await vi.runAllTimersAsync();

    client.emit('notification', {
      channel: 'draft_events',
      payload: '{"_test":true}',
    });
    await vi.runAllTimersAsync();

    expect(dispatch).not.toHaveBeenCalled();
    await handle.stop();
  });

  it('schedules reconnect on client error event', async () => {
    let factoryCalls = 0;
    const clientA = makeMockClient();
    const clientB = makeMockClient();
    const dispatch = vi.fn(async () => {});

    const handle = startEventSubscription({
      connectionString: 'postgres://test',
      dispatch,
      clientFactory: () => {
        factoryCalls++;
        return (factoryCalls === 1 ? clientA : clientB) as unknown as PgClient;
      },
      selfTestTimeoutMs: 0,
      watchdogIntervalMs: 0, // 10c-1d: disable the periodic watchdog probe
    });
    await vi.runAllTimersAsync();
    expect(factoryCalls).toBe(1);

    // Simulate connection drop.
    clientA.emit('error', new Error('connection terminated'));
    // First reconnect fires at 3s; advance just past it.
    await vi.advanceTimersByTimeAsync(3_500);

    expect(factoryCalls).toBe(2);
    expect(clientB.connect).toHaveBeenCalledTimes(1);
    expect(clientB.query).toHaveBeenCalledWith('LISTEN draft_events');

    await handle.stop();
  });

  it('stop() cancels a pending reconnect timer + ends the client', async () => {
    const clientA = makeMockClient();
    const factory = vi.fn(() => clientA as unknown as PgClient);
    const handle = startEventSubscription({
      connectionString: 'postgres://test',
      dispatch: vi.fn(async () => {}),
      clientFactory: factory,
      selfTestTimeoutMs: 0,
      watchdogIntervalMs: 0, // 10c-1d: disable the periodic watchdog probe
    });
    await vi.runAllTimersAsync();
    expect(factory).toHaveBeenCalledTimes(1);

    // Disconnect, then immediately stop — reconnect timer should be
    // cancelled before it fires.
    clientA.emit('error', new Error('connection terminated'));
    await handle.stop();

    // Advance past the would-be 3s reconnect window; factory should
    // NOT be called again.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
