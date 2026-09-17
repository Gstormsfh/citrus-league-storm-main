/**
 * AUTODRAFT THAT SURVIVES A CLOSED TAB (2026-09-14).
 *
 * `teams.autodraft_enabled` reaches the engine two ways: the owner cache
 * read at init(), and a per-arm re-read of the on-clock team's row. Either
 * way an enabled seat is armed on the instant-autopick window, exactly like
 * an ownerless seat. Nothing here changes what the autopick picks; only when.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LobbyManager, type LobbyManagerOptions } from '../LobbyManager';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftEventRow, DraftServiceV2 } from '../../services/DraftServiceV2';
import type { DraftOrderSlot } from '../types';

type TeamRow = { id: string; owner_id: string | null; autodraft_enabled: boolean };

/** A supabase stub with a mutable teams table: `.eq('league_id')` lists it, `.eq('id').maybeSingle()` reads one row. */
function makeSupabase(teams: TeamRow[]): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, value: string) => {
          if (table !== 'teams') return Promise.resolve({ data: [], error: null });
          if (col === 'league_id') return Promise.resolve({ data: teams, error: null });
          return {
            maybeSingle: () => Promise.resolve({ data: teams.find((t) => t.id === value) ?? null, error: null }),
          };
        },
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
}

async function makeLobby(teams: TeamRow[]): Promise<LobbyManager> {
  const draftOrder: DraftOrderSlot[] = [
    { round: 1, pickNumber: 1, teamId: 'team-1' },
    { round: 1, pickNumber: 2, teamId: 'team-2' },
    { round: 1, pickNumber: 3, teamId: 'team-3' },
  ];
  const draftService = {
    submitPick: vi.fn(async () => ({ event_id: 1, seq: 1, pick_deadline: null, was_duplicate: false })),
    listDraftEvents: vi.fn(async (): Promise<DraftEventRow[]> => []),
    nominatePlayer: vi.fn(), placeBid: vi.fn(), closeNomination: vi.fn(), pauseAuction: vi.fn(),
    resumeAuction: vi.fn(), skipNomination: vi.fn(), commissionerOverride: vi.fn(),
  } as unknown as DraftServiceV2;
  const opts: LobbyManagerOptions = {
    lobbyId: 'lobby-autodraft', leagueId: 'league-autodraft', format: 'snake', draftOrder, draftService,
    publish: vi.fn(),
    verifyTeamAuthorization: async () => ({ authorized: true }),
    verifyCommissionerAuthorization: async () => ({ authorized: true }),
    pickClockSeconds: 60, initialPickDeadline: null, initialDraftState: 'in_progress',
    supabase: makeSupabase(teams),
    nominationOrder: [], auctionBudget: 0, auctionMinBid: 0, draftRounds: 0,
    initialTeamBudgets: new Map(), initialPlayersWon: new Map(), initialActiveNomination: null,
    auctionAntiSnipeThresholdSeconds: 0, auctionAntiSnipeExtensionSeconds: 0, auctionMinBidIncrementTiers: [],
    auctionBidWindowSeconds: 0, auctionNominationWindowSeconds: 0,
    autopickStrategies: [async () => ({ ok: true as const, playerId: 8478001, source: 'projections' })],
  };
  const lobby = new LobbyManager(opts);
  await lobby.init();
  const l = lobby as any;
  l.draftStatus = 'in_progress';
  l.pauseState = null;
  return lobby;
}

const deadlineMs = (lobby: LobbyManager) => ((lobby as any).currentTimerDeadline as Date | null)?.getTime() ?? null;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

afterEach(() => { vi.useRealTimers(); });

describe('LobbyManager — persistent autodraft', () => {
  it('a seat flagged at init is armed on the instant window, an unflagged owned seat on the full clock', async () => {
    vi.useFakeTimers();
    const lobby = await makeLobby([
      { id: 'team-1', owner_id: 'u1', autodraft_enabled: true },
      { id: 'team-2', owner_id: 'u2', autodraft_enabled: false },
      { id: 'team-3', owner_id: null, autodraft_enabled: false },
    ]);
    const full = new Date(Date.now() + 60_000);
    (lobby as any).armPickDeadline(full);
    expect(deadlineMs(lobby)).toBe(Date.now() + 2_000);
    // Move the clock to team-2 (owned, not flagged): full clock honoured.
    (lobby as any).picksMade = 1;
    (lobby as any).armPickDeadline(full);
    expect(deadlineMs(lobby)).toBe(full.getTime());
    (lobby as any).cancelPickTimer();
  });

  it('a flag flipped on from another device is picked up at the next arm, and shortens the running clock', async () => {
    vi.useFakeTimers();
    const teams: TeamRow[] = [
      { id: 'team-1', owner_id: 'u1', autodraft_enabled: false },
      { id: 'team-2', owner_id: 'u2', autodraft_enabled: false },
      { id: 'team-3', owner_id: 'u3', autodraft_enabled: false },
    ];
    const lobby = await makeLobby(teams);
    const full = new Date(Date.now() + 60_000);
    (lobby as any).armPickDeadline(full);
    await flush();
    expect(deadlineMs(lobby)).toBe(full.getTime());
    // The owner flips the toggle in another tab: the row changes.
    teams[0].autodraft_enabled = true;
    (lobby as any).armPickDeadline(full);
    await flush();
    expect(deadlineMs(lobby)).toBe(Date.now() + 2_000);
    (lobby as any).cancelPickTimer();
  });

  it('setTeamAutodraft re-arms only when that team is on the clock', async () => {
    vi.useFakeTimers();
    const lobby = await makeLobby([
      { id: 'team-1', owner_id: 'u1', autodraft_enabled: false },
      { id: 'team-2', owner_id: 'u2', autodraft_enabled: false },
      { id: 'team-3', owner_id: 'u3', autodraft_enabled: false },
    ]);
    const full = new Date(Date.now() + 60_000);
    (lobby as any).armPickDeadline(full);
    await flush();
    lobby.setTeamAutodraft('team-2', true); // not on the clock
    expect(deadlineMs(lobby)).toBe(full.getTime());
    lobby.setTeamAutodraft('team-1', true); // on the clock
    expect(deadlineMs(lobby)).toBe(Date.now() + 2_000);
    lobby.setTeamAutodraft('team-1', false); // never lengthens a clock
    expect(deadlineMs(lobby)).toBe(Date.now() + 2_000);
    (lobby as any).cancelPickTimer();
  });

  it('a read failure keeps whatever clock is armed', async () => {
    vi.useFakeTimers();
    const lobby = await makeLobby([{ id: 'team-1', owner_id: 'u1', autodraft_enabled: false }]);
    (lobby as any).supabase = { from: () => { throw new Error('db down'); } };
    const full = new Date(Date.now() + 60_000);
    (lobby as any).armPickDeadline(full);
    await flush();
    expect(deadlineMs(lobby)).toBe(full.getTime());
    (lobby as any).cancelPickTimer();
  });
});
