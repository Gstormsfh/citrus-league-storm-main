// Chunk 10c-2 join-path-robustness follow-up (2026-07-28) — un-stubbed
// contract tests for `defaultFetchDiscovery` and `defaultFetchSnapshot`.
//
// F3 findings from the first live-browser walk of the join path
// (Decision Log 2026-07-28 F3): both default fetchers were expecting
// the apiClient `{data: payload}` envelope, but the discovery and
// snapshot endpoints return their payloads at the TOP LEVEL. Every
// 200 threw 'Discovery fetch failed' / 'Snapshot fetch failed' — the
// real browser join path had never worked for any user. The bug was
// invisible because every runner.test.ts case stubs these fetchers
// via `opts.fetchDiscovery` / `opts.fetchSnapshot` overrides.
//
// This suite fills the invisibility gap: the fetchers are invoked
// directly, apiClient's `.get()` is mocked to return each of the two
// production shapes (top-level payload; enveloped {data} — future-
// proof for a hypothetical envelope migration), and both shapes MUST
// resolve to a valid response object. Also covers the error paths.
//
// Approach note: `runner.ts` dynamically imports `@/api/client`
// inside each default fetcher. `vi.mock('@/api/client', ...)` at the
// top of the file replaces the module in Vitest's module graph so
// the dynamic import resolves to the mock.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DraftSnapshot } from '@citrus/shared';

// ── Mock @/api/client BEFORE importing the fetchers ─────────────────
// The runner's `await import('@/api/client')` inside each fetcher
// resolves to this mock. `apiClientGetMock` is exported so each test
// can `mockResolvedValueOnce` the shape it wants for its assertion.
const apiClientGetMock = vi.fn();
vi.mock('@/api/client', () => ({
  apiClient: {
    get: apiClientGetMock,
  },
}));

// Import AFTER the mock is registered.
import {
  defaultFetchDiscovery,
  defaultFetchSnapshot,
} from '../runner';

const VALID_DISCOVERY = {
  host: 'ws.example.com',
  port: 3002,
  token: 'header.payload.sig',
};

const VALID_SNAPSHOT: DraftSnapshot = {
  lobbyId: 'lobby-1',
  format: 'snake',
  recentEvents: [],
  stateSnapshot: {
    currentPickNumber: 1,
    currentRoundNumber: 1,
    onClockTeamId: 'team-1',
    totalPicks: 9,
    picksMade: 0,
    draftStatus: 'in_progress',
    currentPickDeadline: null,
  },
};

beforeEach(() => {
  apiClientGetMock.mockReset();
});

describe('defaultFetchDiscovery — contract (F3 fix, 2026-07-28)', () => {
  it('accepts the TOP-LEVEL payload shape returned by the discovery endpoint today', async () => {
    // What the chunk-11g.1 discovery endpoint actually returns:
    // `c.json({host, port, token})` — payload sits at the top of the
    // response body. apiClient forwards the response as-is without
    // wrapping in a `{data}` envelope.
    apiClientGetMock.mockResolvedValueOnce(VALID_DISCOVERY);
    const result = await defaultFetchDiscovery('draft-1');
    expect(result.host).toBe('ws.example.com');
    expect(result.port).toBe(3002);
    expect(result.token).toBe('header.payload.sig');
    expect(apiClientGetMock).toHaveBeenCalledWith('/api/drafts/draft-1/server');
  });

  it('accepts the ENVELOPED {data: payload} shape for forward-compat with a future envelope migration', async () => {
    apiClientGetMock.mockResolvedValueOnce({ data: VALID_DISCOVERY });
    const result = await defaultFetchDiscovery('draft-1');
    expect(result.host).toBe('ws.example.com');
    expect(result.port).toBe(3002);
    expect(result.token).toBe('header.payload.sig');
  });

  it('throws on error response from apiClient', async () => {
    apiClientGetMock.mockResolvedValueOnce({
      error: 'discovery_endpoint_500',
    });
    await expect(defaultFetchDiscovery('draft-1')).rejects.toThrow(
      /discovery_endpoint_500/,
    );
  });

  it('throws on invalid shape (missing host)', async () => {
    apiClientGetMock.mockResolvedValueOnce({
      port: 3002,
      token: 'sig',
      // no host
    });
    await expect(defaultFetchDiscovery('draft-1')).rejects.toThrow(
      /Discovery fetch failed/,
    );
  });

  it('throws on invalid shape (missing token)', async () => {
    apiClientGetMock.mockResolvedValueOnce({
      host: 'ws.example.com',
      port: 3002,
      // no token
    });
    await expect(defaultFetchDiscovery('draft-1')).rejects.toThrow(
      /Discovery fetch failed/,
    );
  });

  it('URL-encodes the draftId path segment', async () => {
    apiClientGetMock.mockResolvedValueOnce(VALID_DISCOVERY);
    await defaultFetchDiscovery('draft with spaces');
    expect(apiClientGetMock).toHaveBeenCalledWith(
      '/api/drafts/draft%20with%20spaces/server',
    );
  });
});

describe('defaultFetchSnapshot — contract (F3 fix, 2026-07-28)', () => {
  it('accepts the TOP-LEVEL payload shape returned by the snapshot endpoint today', async () => {
    // chunk-11g.7-7b snapshot endpoint returns `c.json(snapshot)` — the
    // DraftSnapshot sits at the top of the response body.
    apiClientGetMock.mockResolvedValueOnce(VALID_SNAPSHOT);
    const result = await defaultFetchSnapshot('draft-1');
    expect(result.format).toBe('snake');
    expect(result.lobbyId).toBe('lobby-1');
    expect(apiClientGetMock).toHaveBeenCalledWith('/api/drafts/draft-1/snapshot');
  });

  it('accepts the ENVELOPED {data: payload} shape for forward-compat', async () => {
    apiClientGetMock.mockResolvedValueOnce({ data: VALID_SNAPSHOT });
    const result = await defaultFetchSnapshot('draft-1');
    expect(result.format).toBe('snake');
    expect(result.lobbyId).toBe('lobby-1');
  });

  it('throws on error response from apiClient', async () => {
    apiClientGetMock.mockResolvedValueOnce({
      error: 'snapshot_endpoint_500',
    });
    await expect(defaultFetchSnapshot('draft-1')).rejects.toThrow(
      /snapshot_endpoint_500/,
    );
  });

  it('throws on invalid shape (missing format)', async () => {
    apiClientGetMock.mockResolvedValueOnce({
      lobbyId: 'lobby-1',
      // no format
    });
    await expect(defaultFetchSnapshot('draft-1')).rejects.toThrow(
      /Snapshot fetch failed/,
    );
  });

  it('URL-encodes the draftId path segment', async () => {
    apiClientGetMock.mockResolvedValueOnce(VALID_SNAPSHOT);
    await defaultFetchSnapshot('draft/with/slashes');
    expect(apiClientGetMock).toHaveBeenCalledWith(
      '/api/drafts/draft%2Fwith%2Fslashes/snapshot',
    );
  });
});

// ── TIMER-1 / E121: server-clock stamping ─────────────────────────
//
// Field defect these pin: the clock-offset estimator seeded ONLY from
// `recentEvents[last].timestamp`, and the engine's ring buffer holds
// pick events only — so a freshly-ignited draft (empty buffer) got no
// skew correction at all and the FIRST pick rendered a wrong
// countdown (0:35 on a 30s clock for a device 5s slow). The fetcher
// now stamps the server's `Date` header onto the snapshot so the
// estimator always has a server clock, even at zero events.

describe('defaultFetchSnapshot — server-clock stamp (TIMER-1 / E121)', () => {
  beforeEach(() => {
    apiClientGetMock.mockReset();
  });

  it('stamps serverReceivedAtMs from the Date response header', async () => {
    const serverDate = new Date('2026-08-12T04:00:00.000Z');
    apiClientGetMock.mockResolvedValueOnce({
      ...VALID_SNAPSHOT,
      headers: new Headers({ date: serverDate.toUTCString() }),
    });

    const result = await defaultFetchSnapshot('draft-1');

    expect(typeof result.serverReceivedAtMs).toBe('number');
    // Header granularity is 1s; half-round-trip correction is small
    // in a test. Allow a generous window and assert we are anchored
    // to the SERVER clock, not the local one.
    expect(
      Math.abs((result.serverReceivedAtMs as number) - serverDate.getTime()),
    ).toBeLessThan(5000);
  });

  it('accepts a plain-object headers bag (non-Headers transports)', async () => {
    const serverDate = new Date('2026-08-12T05:30:00.000Z');
    apiClientGetMock.mockResolvedValueOnce({
      ...VALID_SNAPSHOT,
      headers: { date: serverDate.toUTCString() },
    });

    const result = await defaultFetchSnapshot('draft-1');

    expect(typeof result.serverReceivedAtMs).toBe('number');
    expect(
      Math.abs((result.serverReceivedAtMs as number) - serverDate.getTime()),
    ).toBeLessThan(5000);
  });

  it('omits serverReceivedAtMs when no Date header is available', async () => {
    apiClientGetMock.mockResolvedValueOnce({ ...VALID_SNAPSHOT });

    const result = await defaultFetchSnapshot('draft-1');

    // Absent, not zero — the room falls back to event-based seeding,
    // which is the pre-E121 behaviour rather than a wrong offset.
    expect(result.serverReceivedAtMs).toBeUndefined();
    expect(result.format).toBe('snake');
  });

  it('ignores an unparseable Date header rather than poisoning the clock', async () => {
    apiClientGetMock.mockResolvedValueOnce({
      ...VALID_SNAPSHOT,
      headers: new Headers({ date: 'not-a-date' }),
    });

    const result = await defaultFetchSnapshot('draft-1');

    expect(result.serverReceivedAtMs).toBeUndefined();
  });

  it('still returns the snapshot payload intact when stamping', async () => {
    apiClientGetMock.mockResolvedValueOnce({
      ...VALID_SNAPSHOT,
      headers: new Headers({ date: new Date().toUTCString() }),
    });

    const result = await defaultFetchSnapshot('draft-1');

    expect(result.lobbyId).toBe(VALID_SNAPSHOT.lobbyId);
    expect(result.stateSnapshot.totalPicks).toBe(
      VALID_SNAPSHOT.stateSnapshot.totalPicks,
    );
  });
});

