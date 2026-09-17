import { describe, it, expect, vi } from 'vitest';
import {
  runDraftCanaryOnce,
  canaryConfigFromEnv,
  canaryWsUrl,
  startDraftCanary,
  type CanarySocket,
  type DraftCanaryDeps,
  type DraftCanaryConfig,
} from '../draftCanary';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

const cfg: DraftCanaryConfig = {
  leagueId: LEAGUE,
  userId: USER,
  wsHost: 'draft.example.test',
  wsPort: 443,
  timeoutMs: 50,
};

class FakeSocket implements CanarySocket {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  closed: Array<[number | undefined, string | undefined]> = [];
  close(code?: number, reason?: string) {
    this.closed.push([code, reason]);
  }
}

/** issueToken is awaited before the socket opens; let that microtask run. */
const opened = () => new Promise<void>((r) => setTimeout(r, 0));

function deps(overrides: Partial<DraftCanaryDeps> & { socket?: FakeSocket } = {}) {
  const socket = overrides.socket ?? new FakeSocket();
  const d: DraftCanaryDeps = {
    issueToken: overrides.issueToken ?? (async () => 'tok'),
    openSocket: overrides.openSocket ?? (() => socket),
    now: overrides.now ?? (() => Date.now()),
  };
  return { d, socket };
}

describe('draft canary: one round trip', () => {
  it('builds the same wss URL a browser would after discovery', () => {
    expect(canaryWsUrl(cfg)).toBe(`wss://draft.example.test:443/ws/draft/${LEAGUE}`);
  });

  it('hands the token to the socket as the subprotocol, exactly like the client runner', async () => {
    const seen: Array<[string, string]> = [];
    const { d, socket } = deps({
      openSocket: (url, sub) => {
        seen.push([url, sub]);
        const s = new FakeSocket();
        setTimeout(() => s.onmessage?.({ data: JSON.stringify({ type: 'snapshot' }) }), 0);
        return s;
      },
      issueToken: async () => 'signed.jwt.here',
    });
    void socket;
    const r = await runDraftCanaryOnce(cfg, d);
    expect(seen).toEqual([[canaryWsUrl(cfg), 'signed.jwt.here']]);
    expect(r.ok).toBe(true);
  });

  it('is ok when the first frame is a snapshot, then closes the socket', async () => {
    const { d, socket } = deps();
    const p = runDraftCanaryOnce(cfg, d);
    await opened();
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: 'snapshot', payload: {} }) });
    const r = await p;
    expect(r).toMatchObject({ ok: true, firstMessageType: 'snapshot' });
    expect(socket.closed).toEqual([[1000, 'canary_done']]);
  });

  it('reports token_issue_failed when signing throws (the 2026-09-16 state)', async () => {
    const { d } = deps({
      issueToken: async () => {
        throw new Error('issueDraftToken: SUPABASE_JWT_SECRET not configured');
      },
    });
    const r = await runDraftCanaryOnce(cfg, d);
    expect(r).toMatchObject({ ok: false, reason: 'token_issue_failed' });
    expect((r as { detail?: string }).detail).toContain('SUPABASE_JWT_SECRET');
  });

  it('reports closed_before_snapshot with the engine close code (e.g. 4400 draft not initialized)', async () => {
    const { d, socket } = deps();
    const p = runDraftCanaryOnce(cfg, d);
    await opened();
    socket.onclose?.({ code: 4400, reason: 'draft_not_initialized' });
    const r = await p;
    expect(r).toMatchObject({ ok: false, reason: 'closed_before_snapshot', closeCode: 4400 });
  });

  it('reports socket_error when the handshake fails (401 from the engine surfaces as an error event)', async () => {
    const { d, socket } = deps();
    const p = runDraftCanaryOnce(cfg, d);
    await opened();
    socket.onerror?.({ message: 'Received network error or non-101 status code.' });
    const r = await p;
    expect(r).toMatchObject({ ok: false, reason: 'socket_error' });
  });

  it('reports unexpected_first_message when the engine speaks something other than a snapshot first', async () => {
    const { d, socket } = deps();
    const p = runDraftCanaryOnce(cfg, d);
    await opened();
    socket.onmessage?.({ data: JSON.stringify({ type: 'error' }) });
    const r = await p;
    expect(r).toMatchObject({ ok: false, reason: 'unexpected_first_message', detail: 'error' });
  });

  it('times out instead of hanging when the engine never answers', async () => {
    const { d } = deps();
    const r = await runDraftCanaryOnce({ ...cfg, timeoutMs: 20 }, d);
    expect(r).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('settles exactly once even if close follows message', async () => {
    const { d, socket } = deps();
    const p = runDraftCanaryOnce(cfg, d);
    await opened();
    socket.onmessage?.({ data: JSON.stringify({ type: 'snapshot' }) });
    socket.onclose?.({ code: 1000, reason: '' });
    const r = await p;
    expect(r.ok).toBe(true);
  });
});

describe('draft canary: configuration', () => {
  it('is inert unless every variable is set and well-formed', () => {
    expect(canaryConfigFromEnv({})).toBeNull();
    expect(canaryConfigFromEnv({ DRAFT_CANARY_LEAGUE_ID: LEAGUE, DRAFT_CANARY_USER_ID: USER, DRAFT_WS_HOST: 'h' })).toBeNull();
    expect(canaryConfigFromEnv({ DRAFT_CANARY_LEAGUE_ID: 'nope', DRAFT_CANARY_USER_ID: USER, DRAFT_WS_HOST: 'h', DRAFT_WS_PORT: '443' })).toBeNull();
    expect(
      canaryConfigFromEnv({ DRAFT_CANARY_LEAGUE_ID: LEAGUE, DRAFT_CANARY_USER_ID: USER, DRAFT_WS_HOST: 'h', DRAFT_WS_PORT: '443' }),
    ).toMatchObject({ leagueId: LEAGUE, userId: USER, wsHost: 'h', wsPort: 443 });
  });

  it('startDraftCanary returns null (and does not schedule) when unconfigured', () => {
    expect(startDraftCanary({ env: {} })).toBeNull();
  });

  it('startDraftCanary runs a tick on the interval and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      let ticks = 0;
      const stop = startDraftCanary({
        env: { DRAFT_CANARY_LEAGUE_ID: LEAGUE, DRAFT_CANARY_USER_ID: USER, DRAFT_WS_HOST: 'h', DRAFT_WS_PORT: '443' },
        intervalMs: 1000,
        initialDelayMs: 10,
        deps: {
          issueToken: async () => {
            ticks += 1;
            throw new Error('counted');
          },
          openSocket: () => new FakeSocket(),
          now: () => Date.now(),
        },
      });
      expect(stop).not.toBeNull();
      await vi.advanceTimersByTimeAsync(10);
      expect(ticks).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(ticks).toBe(3);
      stop?.();
      await vi.advanceTimersByTimeAsync(5000);
      expect(ticks).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
