// Phase 4.5 chunk 11g.4 step 1 — LobbyManager scaffold tests.
//
// Six tests proving the class shape compiles and instantiates per
// the brief. No behavioral logic to test yet; the stubs are
// stubs by design. Steps 2+ add behavior tests as each method
// gains real implementation.

import { describe, it, expect } from 'vitest';
import { LobbyManager } from '../LobbyManager';
import type { DraftAction, DraftSocketUserData } from '../types';

describe('LobbyManager (chunk 11g.4 step 1 scaffold)', () => {
  it('instantiates with snake format', () => {
    const lobby = new LobbyManager({
      lobbyId: 'lobby-snake-1',
      format: 'snake',
      leagueId: 'league-1',
    });
    expect(lobby.lobbyId).toBe('lobby-snake-1');
    expect(lobby.format).toBe('snake');
    expect(lobby.leagueId).toBe('league-1');
  });

  it('instantiates with linear format', () => {
    const lobby = new LobbyManager({
      lobbyId: 'lobby-linear-1',
      format: 'linear',
      leagueId: 'league-1',
    });
    expect(lobby.format).toBe('linear');
  });

  it('instantiates with auction format', () => {
    const lobby = new LobbyManager({
      lobbyId: 'lobby-auction-1',
      format: 'auction',
      leagueId: 'league-1',
    });
    expect(lobby.format).toBe('auction');
  });

  it('enqueueAction rejects with "not yet implemented"', async () => {
    const lobby = new LobbyManager({
      lobbyId: 'lobby-1',
      format: 'snake',
      leagueId: 'league-1',
    });
    const action: DraftAction = {
      kind: 'submit_pick',
      teamId: 'team-1',
      playerId: 'player-1',
      idempotencyKey: '00000000-0000-0000-0000-000000000001',
    };
    await expect(lobby.enqueueAction(action)).rejects.toThrow('not yet implemented');
  });

  it('getSnapshot returns identity-matching snapshot', () => {
    const lobby = new LobbyManager({
      lobbyId: 'lobby-snap-1',
      format: 'auction',
      leagueId: 'league-2',
    });
    const snap = lobby.getSnapshot();
    expect(snap.lobbyId).toBe('lobby-snap-1');
    expect(snap.format).toBe('auction');
    expect(Array.isArray(snap.recentEvents)).toBe(true);
    expect(snap.recentEvents).toHaveLength(0);
  });

  it('addConnection and removeConnection are callable as no-ops', () => {
    const lobby = new LobbyManager({
      lobbyId: 'lobby-conn-1',
      format: 'snake',
      leagueId: 'league-1',
    });
    // Stub WebSocket — neither method touches the ws value in step 1
    // (they're no-ops), so a minimal mock is sufficient. Step 4's
    // tests will use a real or richer mock once these methods do
    // something with the connection.
    const fakeWs = {} as never;
    const userData: DraftSocketUserData = {
      lobbyId: 'lobby-conn-1',
      userId: 'u-1',
      leagueId: 'league-1',
      draftId: 'lobby-conn-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
    expect(() => lobby.addConnection(fakeWs, userData)).not.toThrow();
    expect(() => lobby.removeConnection(fakeWs)).not.toThrow();
  });
});
