// Phase 4.5 chunk 11g.4 step 5 — uws-helpers unit tests.
//
// 5 tests covering: parseClientMessage routes resync correctly,
// invalid JSON is dropped silently, missing-lobby produces an error
// server message, valid resync calls handleResyncRequest and sends
// the response, exhaustive shape (resync without sinceSeq is dropped).
//
// The pure-function extraction means these tests don't need uWS —
// they pass a plain object with `send: vi.fn()` to assert against.

import { describe, it, expect, vi } from 'vitest';
import { handleClientMessage, type SendableWebSocket } from '../uws-helpers';
import type { LobbyRegistry } from '../LobbyRegistry';
import type { LobbyManager } from '../LobbyManager';
import type { DraftServerMessage, DraftSocketUserData } from '../types';

// ── Test helpers ──────────────────────────────────────────────────────

function makeMockWs(): { ws: SendableWebSocket; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  return { ws: { send }, send };
}

function makeUserData(overrides: Partial<DraftSocketUserData> = {}): DraftSocketUserData {
  return {
    lobbyId: 'lobby-1',
    userId: 'user-1',
    leagueId: 'league-1',
    draftId: 'lobby-1',
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    lastPongAt: 0,
    ...overrides,
  };
}

interface MockLobbyHandle {
  lobby: LobbyManager;
  handleResyncRequest: ReturnType<typeof vi.fn>;
}

function makeMockLobby(): MockLobbyHandle {
  const handleResyncRequest = vi.fn();
  const lobby = { handleResyncRequest } as unknown as LobbyManager;
  return { lobby, handleResyncRequest };
}

interface MockRegistryHandle {
  registry: LobbyRegistry;
  get: ReturnType<typeof vi.fn>;
}

function makeMockRegistry(opts: { lobby?: LobbyManager | undefined } = {}): MockRegistryHandle {
  const get = vi.fn().mockReturnValue(opts.lobby);
  const registry = { get } as unknown as LobbyRegistry;
  return { registry, get };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('uws-helpers handleClientMessage (chunk 11g.4 step 5)', () => {
  it('valid resync message calls handleResyncRequest and sends the response via ws.send', () => {
    const { lobby, handleResyncRequest } = makeMockLobby();
    const response: DraftServerMessage = {
      v: 1,
      type: 'resync_response',
      timestamp: '2026-05-05T12:00:00.000Z',
      payload: { ok: true, events: [] },
    };
    handleResyncRequest.mockReturnValue(response);

    const { registry, get } = makeMockRegistry({ lobby });
    const { ws, send } = makeMockWs();
    const userData = makeUserData({ userId: 'user-resync-1' });

    handleClientMessage(
      ws,
      registry,
      JSON.stringify({ type: 'resync', payload: { sinceSeq: 42 } }),
      userData,
    );

    expect(get).toHaveBeenCalledWith('lobby-1');
    expect(handleResyncRequest).toHaveBeenCalledWith(userData, 42);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual(response);
  });

  it('invalid JSON is dropped silently — no ws.send, no registry.get', () => {
    const { registry, get } = makeMockRegistry();
    const { ws, send } = makeMockWs();
    const userData = makeUserData();

    handleClientMessage(ws, registry, 'this is not json {{{', userData);

    expect(get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('resync without a numeric sinceSeq is dropped silently', () => {
    const { registry, get } = makeMockRegistry();
    const { ws, send } = makeMockWs();
    const userData = makeUserData();

    handleClientMessage(
      ws,
      registry,
      JSON.stringify({ type: 'resync', payload: { sinceSeq: 'not-a-number' } }),
      userData,
    );

    expect(get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('unknown message type is dropped silently', () => {
    const { registry, get } = makeMockRegistry();
    const { ws, send } = makeMockWs();
    const userData = makeUserData();

    handleClientMessage(
      ws,
      registry,
      JSON.stringify({ type: 'totally_unknown', payload: {} }),
      userData,
    );

    expect(get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('resync against a missing lobby sends a structured error response (lobby_not_ready)', () => {
    const { registry, get } = makeMockRegistry({ lobby: undefined });
    const { ws, send } = makeMockWs();
    const userData = makeUserData({ lobbyId: 'lobby-missing-1', userId: 'user-err-1' });

    handleClientMessage(
      ws,
      registry,
      JSON.stringify({ type: 'resync', payload: { sinceSeq: 0 } }),
      userData,
    );

    expect(get).toHaveBeenCalledWith('lobby-missing-1');
    expect(send).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(send.mock.calls[0][0]);
    expect(parsed).toMatchObject({
      v: 1,
      type: 'error',
      payload: {
        code: 'lobby_not_ready',
      },
    });
    expect(typeof parsed.timestamp).toBe('string');
  });
});
