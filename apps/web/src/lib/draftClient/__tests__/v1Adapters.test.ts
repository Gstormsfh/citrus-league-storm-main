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
  participatingTeamIdsFromMatrix,
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

// ── DR-3.1 F9 regression tests ────────────────────────────────────
//
// The Showcase (2026-07-29) surfaced F9: v1's TeamRosters.tsx:97
// renders pick labels as `${round}.${pick.pick % teams.length ||
// teams.length}` — teams.length is treated as round size. A league
// with 12 in-draft-order + 1 spectator team (Gbaby, 4c742dae) fed
// 13 teams to the component and produced 2.9 / 3.1 for picks 22 / 27
// (should have been 2.10 / 3.3). Architect ratified: authoritative
// round size is the DRAFT ORDER's team count, never teams.length.
// The adapter filter is the fix — non-participating teams are
// excluded from the v1 shape at the boundary.

describe('participatingTeamIdsFromMatrix (DR-3.1 F9 helper)', () => {
  it('extracts a set of teamIds from a draft-order matrix', () => {
    const matrix = [
      { round: 1, pickNumber: 1, teamId: 'team-a' },
      { round: 1, pickNumber: 2, teamId: 'team-b' },
      { round: 2, pickNumber: 3, teamId: 'team-b' },
      { round: 2, pickNumber: 4, teamId: 'team-a' },
    ];
    const set = participatingTeamIdsFromMatrix(matrix);
    expect(set.size).toBe(2);
    expect(set.has('team-a')).toBe(true);
    expect(set.has('team-b')).toBe(true);
  });

  it('returns an empty set for a null matrix (pre-fetch state)', () => {
    expect(participatingTeamIdsFromMatrix(null).size).toBe(0);
  });
});

describe('toV1Teams — DR-3.1 F9 filter (12-in-order + 1 spectator)', () => {
  // Fixture mirrors the Showcase state: 12 harness teams in the
  // draft_order matrix + 1 spectator team (Gbaby-shape) NOT in the
  // order. Every pick's round/pickNumber comes from the server's
  // authoritative event (which used the true 12-team snake); the
  // adapter's job is to make sure the v1 components see teams.length=12
  // so their pick-in-round formula lands on the correct value.

  const HARNESS_IDS = Array.from({ length: 12 }, (_, i) =>
    `77777777-7777-7777-7777-${String(i + 1).padStart(12, '0')}`,
  );
  const SPECTATOR_ID = '4c742dae-6770-43f5-b310-cc24741e8148';

  const THIRTEEN_TEAMS: FetchedTeam[] = [
    ...HARNESS_IDS.map((id, i) => ({
      id,
      team_name: `Harness Team ${String(i + 1).padStart(2, '0')}`,
      owner_name: `Owner ${i + 1}`,
    })),
    { id: SPECTATOR_ID, team_name: 'Gbaby', owner_name: 'Garrett' },
  ];

  const MATRIX_12_TEAMS = HARNESS_IDS.map((teamId, i) => ({
    round: 1,
    pickNumber: i + 1,
    teamId,
  }));

  it('filters spectator team out when participatingTeamIds is provided', () => {
    const participating = participatingTeamIdsFromMatrix(MATRIX_12_TEAMS);
    const teams = toV1Teams(THIRTEEN_TEAMS, mkDerived(), new Map(), participating);
    expect(teams.length).toBe(12);
    expect(teams.map((t) => t.id).includes(SPECTATOR_ID)).toBe(false);
  });

  it('includes all teams when participatingTeamIds is undefined (legacy caller compat)', () => {
    const teams = toV1Teams(THIRTEEN_TEAMS, mkDerived(), new Map());
    expect(teams.length).toBe(13);
    expect(teams.map((t) => t.id).includes(SPECTATOR_ID)).toBe(true);
  });

  it('returns zero teams when participatingTeamIds is empty (pre-matrix state)', () => {
    const teams = toV1Teams(THIRTEEN_TEAMS, mkDerived(), new Map(), new Set());
    expect(teams.length).toBe(0);
  });

  it('feeds v1 TeamRosters formula the correct round size — picks 3 / 22 / 27 → 1.3 / 2.10 / 3.3', () => {
    // Simulate the Showcase rosters: slot 3 (Garrett's harness team)
    // has 3 picks at pick_number 3, 22, 27. Adapter output should
    // preserve these pick_numbers and give teams.length=12 so the
    // v1 formula `pick.pick % teams.length || teams.length` computes:
    //   pick 3  → 3 % 12 = 3  → "1.3"  ✓
    //   pick 22 → 22 % 12 = 10 → "2.10" ✓
    //   pick 27 → 27 % 12 = 3  → "3.3"  ✓
    // (Pre-fix with teams.length=13: 3%13=3, 22%13=9, 27%13=1 → 2.9/3.1 ✗)
    const slot3 = HARNESS_IDS[2];
    const derived = mkDerived({
      picksMade: 3,
      teamRosters: new Map([
        [slot3, [
          { seq: 3,  playerId: 8480000, pickNumber: 3,  roundNumber: 1 },
          { seq: 22, playerId: 8478402, pickNumber: 22, roundNumber: 2 },
          { seq: 27, playerId: 8482116, pickNumber: 27, roundNumber: 3 },
        ]],
      ]),
    });
    const participating = participatingTeamIdsFromMatrix(MATRIX_12_TEAMS);
    const teams = toV1Teams(THIRTEEN_TEAMS, derived, new Map(), participating);

    expect(teams.length).toBe(12); // ← the round size v1 will use

    const slot3Team = teams.find((t) => t.id === slot3);
    expect(slot3Team).toBeDefined();
    expect(slot3Team!.picks.map((p) => p.pick)).toEqual([3, 22, 27]);
    expect(slot3Team!.picks.map((p) => p.round)).toEqual([1, 2, 3]);

    // Apply the v1 TeamRosters formula (line 97) with teams.length=12:
    const roundSize = teams.length;
    const labels = slot3Team!.picks.map(
      (p) => `${p.round}.${p.pick % roundSize || roundSize}`,
    );
    expect(labels).toEqual(['1.3', '2.10', '3.3']);
  });
});

describe('toAvailablePlayers — the draftable guard (PLAYER-POOL 2026-08-12)', () => {
  // player_directory is an all-time index. 923 of 2,035 staging rows have no
  // NHL club — Jagr, Chara, Thornton — and every one of them used to be
  // draftable. A manager drafted three retired centres in a live test by
  // clicking the top of the list.
  it('excludes players with no NHL club', () => {
    const players = new Map([
      ['8466138', mkPlayer('8466138', { full_name: 'Joe Thornton', team: '' })],
      ['8478402', mkPlayer('8478402', { full_name: 'Connor McDavid', team: 'EDM' })],
    ]);
    const ids = toAvailablePlayers(players, mkDerived()).map((p) => p.id);

    expect(ids).toEqual(['8478402']);
  });

  it('treats whitespace-only club as no club', () => {
    const players = new Map([['1', mkPlayer('1', { team: '   ' })]]);
    expect(toAvailablePlayers(players, mkDerived())).toHaveLength(0);
  });

  it('keeps a rostered rookie who has no stats yet', () => {
    // The guard is on CLUB, not on production — a prospect called up today
    // must stay draftable.
    const players = new Map([
      ['9', mkPlayer('9', { full_name: 'Rookie', team: 'SJS', points: 0, games_played: 0 })],
    ]);
    expect(toAvailablePlayers(players, mkDerived()).map((p) => p.id)).toEqual(['9']);
  });

  it('still resolves the NAME of a drafted clubless player', () => {
    // The asymmetry that makes this safe: filtering the pool must not blind
    // the board. Filtering at the directory load would render this as
    // `#8466138 / ? / -` on a finished roster.
    const players = new Map([
      ['8466138', mkPlayer('8466138', { full_name: 'Joe Thornton', team: '' })],
    ]);
    const pick = rosterEntryToDraftPick(
      { seq: 1, playerId: 8466138, pickNumber: 1, roundNumber: 1 },
      'team-1',
      'Alpha',
      players,
    );

    expect(pick.playerName).toBe('Joe Thornton');
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
