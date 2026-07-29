// DR-3 (2026-07-29) — adapter unit tests. Cover the four adapter
// contracts + the fallback-rendering promise (unresolvable ID →
// `#<id>` chip everywhere a name would appear).

import { describe, expect, it } from 'vitest';
import {
  resolvePlayerDisplay,
  rosterEntryToDraftPick,
  toV1Teams,
  toDraftHistory,
  toDraftedPlayerIds,
  toAvailablePlayers,
  type FetchedTeam,
} from '../v1Adapters';
import type {
  DerivedDraftState,
  RosterEntry,
} from '../deriveDraftState';
import type { Player } from '@/services/PlayerService';

// ── Fixtures ──────────────────────────────────────────────────────

function mkPlayer(id: string, over: Partial<Player> = {}): Player {
  return {
    id,
    full_name: `Player ${id}`,
    position: 'C',
    eligible_positions: ['C'],
    team: 'BOS',
    jersey_number: null,
    status: null,
    headshot_url: null,
    last_updated: null,
    games_played: 0,
    goals: 0,
    assists: 0,
    points: 0,
    plus_minus: 0,
    shots: 0,
    hits: 0,
    blocks: 0,
    xGoals: 0,
    wins: null,
    losses: null,
    ot_losses: null,
    saves: null,
    goals_against_average: null,
    save_percentage: null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
    ...over,
  };
}

function mkRoster(entries: Partial<RosterEntry>[]): RosterEntry[] {
  return entries.map((e, i) => ({
    seq: i + 1,
    playerId: 8478050 + i,
    pickNumber: i + 1,
    roundNumber: 1,
    ...e,
  }));
}

function mkDerived(over: Partial<DerivedDraftState> = {}): DerivedDraftState {
  return {
    currentPickNumber: null,
    currentRoundNumber: null,
    onClockTeamId: null,
    picksMade: 0,
    totalPicks: 12,
    draftStatus: 'not_started',
    teamRosters: new Map(),
    foldedThroughSeq: 0,
    ...over,
  };
}

const TEAMS: FetchedTeam[] = [
  { id: 'team-1', team_name: 'Alpha', owner_name: 'Alice' },
  { id: 'team-2', team_name: 'Bravo', owner_name: 'Bob' },
  { id: 'team-3', team_name: 'Charlie', owner_name: null },
];

// ── resolvePlayerDisplay ──────────────────────────────────────────

describe('resolvePlayerDisplay', () => {
  it('returns real player fields when the id resolves', () => {
    const map = new Map([['8478050', mkPlayer('8478050', { full_name: 'Auston Matthews', position: 'C', team: 'TOR' })]]);
    expect(resolvePlayerDisplay(8478050, map)).toEqual({
      playerName: 'Auston Matthews',
      position: 'C',
      playerTeam: 'TOR',
    });
  });

  it('falls back to #<id> chip on unresolved id (fixture-only path)', () => {
    const empty = new Map<string, Player>();
    const out = resolvePlayerDisplay(8478050, empty);
    expect(out.playerName).toBe('#8478050');
    expect(out.position).toBe('?');
    expect(out.playerTeam).toBeUndefined();
  });

  it('falls back to #<id> when full_name is empty string', () => {
    const map = new Map([['9999', mkPlayer('9999', { full_name: '' })]]);
    expect(resolvePlayerDisplay(9999, map).playerName).toBe('#9999');
  });
});

// ── rosterEntryToDraftPick ────────────────────────────────────────

describe('rosterEntryToDraftPick', () => {
  it('maps a resolved roster entry to the v1 DraftPick shape', () => {
    const entry: RosterEntry = { seq: 3, playerId: 8478050, pickNumber: 3, roundNumber: 1 };
    const players = new Map([['8478050', mkPlayer('8478050', { full_name: 'Auston Matthews', position: 'C', team: 'TOR' })]]);
    const pick = rosterEntryToDraftPick(entry, 'team-1', 'Alpha', players);
    expect(pick).toEqual({
      id: 'team-1-3',
      teamId: 'team-1',
      teamName: 'Alpha',
      playerId: '8478050',
      playerName: 'Auston Matthews',
      position: 'C',
      round: 1,
      pick: 3,
      timestamp: 3000,
      playerTeam: 'TOR',
    });
  });

  it('emits #<id> fallback name + ? position when player is unresolved', () => {
    const entry: RosterEntry = { seq: 7, playerId: 8478000, pickNumber: 7, roundNumber: 1 };
    const pick = rosterEntryToDraftPick(entry, 'team-2', 'Bravo', new Map());
    expect(pick.playerName).toBe('#8478000');
    expect(pick.position).toBe('?');
    expect(pick.playerTeam).toBeUndefined();
    expect(pick.playerId).toBe('8478000');
  });

  it('uses seq*1000 as the timestamp (monotonic, seq-derived)', () => {
    const entry: RosterEntry = { seq: 42, playerId: 100, pickNumber: 42, roundNumber: 4 };
    const pick = rosterEntryToDraftPick(entry, 't', 'T', new Map());
    expect(pick.timestamp).toBe(42_000);
  });
});

// ── toV1Teams ─────────────────────────────────────────────────────

describe('toV1Teams', () => {
  it('assigns stable rotating colors keyed on team index', () => {
    const teams = toV1Teams(TEAMS, mkDerived(), new Map());
    expect(teams).toHaveLength(3);
    expect(teams[0].color).toBe('#F97316'); // first palette entry
    expect(teams[1].color).toBe('#22C55E');
    expect(teams[2].color).toBe('#3B82F6');
  });

  it('falls back owner to "Manager" when owner_name is null', () => {
    const teams = toV1Teams(TEAMS, mkDerived(), new Map());
    expect(teams[2].owner).toBe('Manager');
    expect(teams[0].owner).toBe('Alice');
  });

  it('flattens the derived roster map into per-team picks', () => {
    const derived = mkDerived({
      picksMade: 3,
      teamRosters: new Map([
        ['team-1', mkRoster([{ playerId: 100 }, { playerId: 101, seq: 3, pickNumber: 3 }])],
        ['team-2', mkRoster([{ playerId: 200, seq: 2, pickNumber: 2 }])],
      ]),
    });
    const teams = toV1Teams(TEAMS, derived, new Map());
    expect(teams[0].picks.map((p) => p.playerId)).toEqual(['100', '101']);
    expect(teams[1].picks.map((p) => p.playerId)).toEqual(['200']);
    expect(teams[2].picks).toEqual([]);
  });
});

// ── toDraftHistory ────────────────────────────────────────────────

describe('toDraftHistory', () => {
  it('flattens all rosters into a chronological array sorted by pick', () => {
    const derived = mkDerived({
      picksMade: 4,
      teamRosters: new Map([
        ['team-1', [
          { seq: 1, playerId: 100, pickNumber: 1, roundNumber: 1 },
          { seq: 4, playerId: 103, pickNumber: 4, roundNumber: 1 },
        ]],
        ['team-2', [
          { seq: 2, playerId: 101, pickNumber: 2, roundNumber: 1 },
        ]],
        ['team-3', [
          { seq: 3, playerId: 102, pickNumber: 3, roundNumber: 1 },
        ]],
      ]),
    });
    const history = toDraftHistory(TEAMS, derived, new Map());
    expect(history.map((h) => h.pick)).toEqual([1, 2, 3, 4]);
    expect(history.map((h) => h.playerId)).toEqual(['100', '101', '102', '103']);
    // Team names attributed correctly.
    expect(history[0].teamName).toBe('Alpha');
    expect(history[1].teamName).toBe('Bravo');
    expect(history[2].teamName).toBe('Charlie');
    expect(history[3].teamName).toBe('Alpha');
  });

  it('renders #<id> names when players are unresolved (fallback path)', () => {
    const derived = mkDerived({
      picksMade: 2,
      teamRosters: new Map([
        ['team-1', [{ seq: 1, playerId: 8478050, pickNumber: 1, roundNumber: 1 }]],
        ['team-2', [{ seq: 2, playerId: 8478999, pickNumber: 2, roundNumber: 1 }]],
      ]),
    });
    const history = toDraftHistory(TEAMS, derived, new Map());
    expect(history.map((h) => h.playerName)).toEqual(['#8478050', '#8478999']);
    expect(history.every((h) => h.position === '?')).toBe(true);
  });
});

// ── toDraftedPlayerIds / toAvailablePlayers ───────────────────────

describe('toDraftedPlayerIds', () => {
  it('returns every drafted playerId across all teams as strings', () => {
    const derived = mkDerived({
      teamRosters: new Map([
        ['t1', [{ seq: 1, playerId: 100, pickNumber: 1, roundNumber: 1 }]],
        ['t2', [{ seq: 2, playerId: 200, pickNumber: 2, roundNumber: 1 }]],
      ]),
    });
    expect(toDraftedPlayerIds(derived).sort()).toEqual(['100', '200']);
  });

  it('returns empty array when no picks have been made', () => {
    expect(toDraftedPlayerIds(mkDerived())).toEqual([]);
  });
});

describe('toAvailablePlayers', () => {
  it('filters drafted players out of the full player index', () => {
    const players = new Map([
      ['100', mkPlayer('100')],
      ['200', mkPlayer('200')],
      ['300', mkPlayer('300')],
    ]);
    const derived = mkDerived({
      teamRosters: new Map([
        ['t1', [{ seq: 1, playerId: 100, pickNumber: 1, roundNumber: 1 }]],
      ]),
    });
    const available = toAvailablePlayers(players, derived);
    expect(available.map((p) => p.id).sort()).toEqual(['200', '300']);
  });
});
