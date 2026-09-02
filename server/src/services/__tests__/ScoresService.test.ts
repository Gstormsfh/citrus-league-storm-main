/**
 * ScoresService contract.
 *
 * The tests that matter here are the ones that stop the scoreboard saying
 * something untrue. In order of how expensive the bug would be:
 *
 *   1. A scheduled game must not render a score. `nhl_games` stores 0/0 on
 *      every scheduled row, so the naive pass-through prints "0 - 0" for a
 *      game nobody has played.
 *   2. A missing stat line must not become a zero. `player_game_stats` has
 *      no 2026 row at all, so every game the app can show today has no
 *      actuals; a zero would assert the player dressed and did nothing.
 *   3. A full slate must not lose players to the 1,000-row PostgREST clamp.
 *
 * The Supabase fake below reproduces that clamp on purpose: `range()` never
 * returns more than `pageCap` rows, exactly as the real endpoint does, so a
 * regression that drops `pagedSelect` fails here rather than in production.
 */

import { describe, it, expect } from 'vitest';
import {
  ScoresService,
  scoreOrNull,
  toNumberOrNull,
  shiftIsoDate,
  isIsoDate,
  comparePlayerLines,
  tallyConfidence,
  actualsToStatBag,
} from '../ScoresService';
import type { ScoresPlayerLine } from '@citrus/shared';

// ── A tiny fake of the PostgREST builder surface these reads use ────────
// Chainable select/eq/in/gte/lte/lt/gt/order, resolved by range() (what
// pagedSelect calls) or by limit() (what the nearest-date lookup calls).
function makeSupabase(tables: Record<string, unknown[]>, opts: { pageCap?: number } = {}) {
  const pageCap = opts.pageCap ?? 1000;

  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let sortKeys: Array<{ col: string; asc: boolean }> = [];

      const rows = () => {
        const all = ((tables[table] ?? []) as Array<Record<string, unknown>>).filter((r) =>
          filters.every((f) => f(r)),
        );
        if (sortKeys.length === 0) return all;
        return [...all].sort((a, b) => {
          for (const { col, asc } of sortKeys) {
            const av = a[col] as string | number;
            const bv = b[col] as string | number;
            if (av === bv) continue;
            const cmp = av < bv ? -1 : 1;
            return asc ? cmp : -cmp;
          }
          return 0;
        });
      };

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          filters.push((r) => vals.includes(r[col]));
          return builder;
        },
        gte: (col: string, val: string) => {
          filters.push((r) => String(r[col]) >= String(val));
          return builder;
        },
        lte: (col: string, val: string) => {
          filters.push((r) => String(r[col]) <= String(val));
          return builder;
        },
        gt: (col: string, val: string) => {
          filters.push((r) => String(r[col]) > String(val));
          return builder;
        },
        lt: (col: string, val: string) => {
          filters.push((r) => String(r[col]) < String(val));
          return builder;
        },
        order: (col: string, o?: { ascending?: boolean }) => {
          sortKeys = [...sortKeys, { col, asc: o?.ascending !== false }];
          return builder;
        },
        // The clamp, reproduced. A caller asking for 1,000 rows gets at most
        // pageCap of them and no indication that it was cut.
        range: async (from: number, to: number) => {
          const size = Math.min(to - from + 1, pageCap);
          return { data: rows().slice(from, from + size), error: null };
        },
        limit: async (n: number) => ({ data: rows().slice(0, n), error: null }),
      };
      return builder;
    },
  } as never;
}

// ── Fixtures modelled on production rows, not invented ones ─────────────

const SCHEDULED_GAME = {
  game_id: 2026020001,
  game_date: '2026-09-29',
  game_time: '2026-09-29T21:00:00+00:00',
  home_team: 'CAR',
  away_team: 'FLA',
  // The trap: production stores zeros here, not nulls.
  home_score: 0,
  away_score: 0,
  status: 'scheduled',
  period: null,
  period_time: null,
  venue: null,
  season: 2026,
  game_type: 'regular',
  home_team_id: 12,
  away_team_id: 13,
};

const LIVE_GAME = {
  ...SCHEDULED_GAME,
  game_id: 2026020002,
  home_team: 'TOR',
  away_team: 'MTL',
  home_score: 3,
  away_score: 2,
  status: 'live',
  period: '3rd',
  period_time: '00:48',
  home_team_id: 10,
  away_team_id: 8,
};

const FINAL_GAME = {
  ...SCHEDULED_GAME,
  game_id: 2026020003,
  home_team: 'BOS',
  away_team: 'NYR',
  home_score: 4,
  away_score: 5,
  status: 'final',
  period: 'OT',
  period_time: null,
  home_team_id: 6,
  away_team_id: 3,
};

const TEAMS = [
  { team_id: 12, abbreviation: 'CAR', city: 'Carolina', name: 'Hurricanes' },
  { team_id: 13, abbreviation: 'FLA', city: 'Florida', name: 'Panthers' },
  { team_id: 10, abbreviation: 'TOR', city: 'Toronto', name: 'Maple Leafs' },
  { team_id: 8, abbreviation: 'MTL', city: 'Montreal', name: 'Canadiens' },
  { team_id: 6, abbreviation: 'BOS', city: 'Boston', name: 'Bruins' },
  { team_id: 3, abbreviation: 'NYR', city: 'New York', name: 'Rangers' },
];

const proj = (over: Record<string, unknown>) => ({
  player_id: 8480801,
  game_id: 2026020001,
  season: 2026,
  is_goalie: false,
  total_projected_points: '8.889',
  confidence_label: 'High',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

const dir = (over: Record<string, unknown>) => ({
  player_id: 8480801,
  season: 2026,
  full_name: 'Brady Tkachuk',
  team_abbrev: 'FLA',
  position_code: 'LW',
  is_goalie: false,
  headshot_url: 'https://assets.nhle.com/mugs/nhl/8480801.png',
  ...over,
});

describe('pure helpers', () => {
  it('nulls the score of a game that has not started, zeros and all', () => {
    // The single most important assertion in this file.
    expect(scoreOrNull('scheduled', 0)).toBeNull();
    expect(scoreOrNull('postponed', 0)).toBeNull();
    expect(scoreOrNull('unknown', 0)).toBeNull();
    expect(scoreOrNull('live', 0)).toBe(0);
    expect(scoreOrNull('final', 4)).toBe(4);
  });

  it('keeps a real 0 for a live game that is genuinely scoreless', () => {
    expect(scoreOrNull('live', 0)).toBe(0);
  });

  it('coerces numerics without inventing a value', () => {
    expect(toNumberOrNull('8.889')).toBeCloseTo(8.889);
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull('not a number')).toBeNull();
  });

  it('shifts dates across month and year boundaries', () => {
    expect(shiftIsoDate('2026-09-29', 1)).toBe('2026-09-30');
    expect(shiftIsoDate('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftIsoDate('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('rejects anything that is not a real YYYY-MM-DD', () => {
    expect(isIsoDate('2026-09-29')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('9/29/2026')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it('ranks your own players first, then league rosters, then projection', () => {
    const line = (over: Partial<ScoresPlayerLine>): ScoresPlayerLine => ({
      playerId: 1,
      name: 'x',
      teamAbbrev: null,
      position: null,
      isGoalie: false,
      headshotUrl: null,
      projectedPoints: 1,
      confidenceLabel: null,
      actualPoints: null,
      actuals: null,
      roster: null,
      ...over,
    });

    const mine = line({ playerId: 1, projectedPoints: 2, roster: { teamId: 't', teamName: null, isMine: true } });
    const theirs = line({ playerId: 2, projectedPoints: 9, roster: { teamId: 'u', teamName: null, isMine: false } });
    const free = line({ playerId: 3, projectedPoints: 12 });

    expect([free, theirs, mine].sort(comparePlayerLines).map((l) => l.playerId)).toEqual([1, 2, 3]);
  });

  it('buckets confidence labels and counts anything unknown as unlabeled', () => {
    expect(tallyConfidence(['High', 'high', 'Medium', 'Low', null, 'Wild'])).toEqual({
      high: 2,
      medium: 1,
      low: 1,
      unlabeled: 2,
    });
  });

  it('maps goalie and skater actuals onto the scoring calculator shape', () => {
    const base = {
      game_id: 1, player_id: 1, nhl_goals: 1, nhl_assists: 2, nhl_points: 3,
      nhl_shots_on_goal: 5, nhl_blocks: 2, nhl_hits: 4, nhl_ppp: 1, nhl_shp: 0,
      nhl_pim: 2, nhl_plus_minus: 1, nhl_toi_seconds: 1200, nhl_saves: 30,
      nhl_goals_against: 2, nhl_wins: 1, nhl_shutouts: 0,
    };
    expect(actualsToStatBag({ ...base, is_goalie: true } as never)).toEqual({
      wins: 1, saves: 30, shutouts: 0, goals_against: 2,
    });
    expect(actualsToStatBag({ ...base, is_goalie: false } as never)).toMatchObject({
      goals: 1, assists: 2, shots_on_goal: 5, blocks: 2,
    });
  });
});

describe('ScoresService.getDay', () => {
  it('rejects a date that is not YYYY-MM-DD before it reaches a query', async () => {
    const svc = new ScoresService(makeSupabase({}));
    const { result, error } = await svc.getDay('tomorrow');
    expect(result).toBeNull();
    expect(error?.message).toContain('YYYY-MM-DD');
  });

  it('never sends a score for a scheduled game, and does send one once live', async () => {
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [SCHEDULED_GAME, LIVE_GAME, FINAL_GAME],
        nhl_teams: TEAMS,
        player_projected_stats: [],
        player_game_stats: [],
        player_directory: [],
      }),
    );

    const { result } = await svc.getDay('2026-09-29');
    const byId = new Map(result!.games.map((g) => [g.gameId, g]));

    expect(byId.get(2026020001)!.homeScore).toBeNull();
    expect(byId.get(2026020001)!.awayScore).toBeNull();
    expect(byId.get(2026020001)!.state).toBe('scheduled');

    expect(byId.get(2026020002)!.homeScore).toBe(3);
    expect(byId.get(2026020002)!.awayScore).toBe(2);
    expect(byId.get(2026020002)!.state).toBe('live');

    expect(byId.get(2026020003)!.homeScore).toBe(4);
    expect(byId.get(2026020003)!.state).toBe('final');
  });

  it('names both sides from nhl_teams and leaves an unknown abbrev unnamed', async () => {
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [{ ...SCHEDULED_GAME, away_team: 'ZZZ', away_team_id: null }],
        nhl_teams: TEAMS,
        player_projected_stats: [],
        player_game_stats: [],
        player_directory: [],
      }),
    );

    const { result } = await svc.getDay('2026-09-29');
    const g = result!.games[0];
    expect(g.home).toEqual({ abbrev: 'CAR', teamId: 12, city: 'Carolina', name: 'Hurricanes' });
    // No invented name for a club we do not carry.
    expect(g.away).toEqual({ abbrev: 'ZZZ', teamId: null, city: null, name: null });
  });

  it('attaches the top projections and caps the collapsed row at three', async () => {
    const players = [
      { pid: 1, name: 'Nine', pts: '9.0' },
      { pid: 2, name: 'Eight', pts: '8.0' },
      { pid: 3, name: 'Seven', pts: '7.0' },
      { pid: 4, name: 'Six', pts: '6.0' },
    ];

    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [SCHEDULED_GAME],
        nhl_teams: TEAMS,
        player_projected_stats: players.map((p) =>
          proj({ player_id: p.pid, total_projected_points: p.pts }),
        ),
        player_directory: players.map((p) => dir({ player_id: p.pid, full_name: p.name })),
        player_game_stats: [],
      }),
    );

    const { result } = await svc.getDay('2026-09-29');
    const citrus = result!.games[0].citrus!;

    expect(citrus.projectedPlayers).toBe(4);
    expect(citrus.players).toHaveLength(3);
    expect(citrus.players.map((p) => p.name)).toEqual(['Nine', 'Eight', 'Seven']);
    expect(citrus.confidence).toEqual({ high: 4, medium: 0, low: 0, unlabeled: 0 });
    expect(citrus.hasActuals).toBe(false);
  });

  it('leaves actualPoints null when there is no stat row, rather than zero', async () => {
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [SCHEDULED_GAME],
        nhl_teams: TEAMS,
        player_projected_stats: [proj({})],
        player_directory: [dir({})],
        // Production state for every 2026 game: the table has no row.
        player_game_stats: [],
      }),
    );

    const { result } = await svc.getDay('2026-09-29');
    const line = result!.games[0].citrus!.players[0];
    expect(line.actualPoints).toBeNull();
    expect(line.actuals).toBeNull();
    expect(result!.games[0].citrus!.hasActuals).toBe(false);
  });

  it('scores real actuals through ScoringCalculator under default settings', async () => {
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [FINAL_GAME],
        nhl_teams: TEAMS,
        player_projected_stats: [proj({ game_id: FINAL_GAME.game_id })],
        player_directory: [dir({})],
        player_game_stats: [
          {
            game_id: FINAL_GAME.game_id,
            player_id: 8480801,
            is_goalie: false,
            nhl_goals: 1, nhl_assists: 1, nhl_points: 2, nhl_shots_on_goal: 4,
            nhl_blocks: 1, nhl_hits: 3, nhl_ppp: 1, nhl_shp: 0, nhl_pim: 2,
            nhl_plus_minus: 1, nhl_toi_seconds: 1140, nhl_saves: 0,
            nhl_goals_against: 0, nhl_wins: 0, nhl_shutouts: 0,
          },
        ],
      }),
    );

    const { result } = await svc.getDay('2026-09-29');
    const line = result!.games[0].citrus!.players[0];
    // G 6 + A 4 + PPP 2 + SOG 4x0.9 + BLK 1 = 16.6. Hits and PIM score 0.
    expect(line.actualPoints).toBeCloseTo(16.6, 5);
    expect(line.actuals).toMatchObject({ goals: 1, assists: 1, shotsOnGoal: 4, hits: 3 });
    expect(result!.games[0].citrus!.hasActuals).toBe(true);
  });

  it('marks rostered players and the requesting user\'s own, and counts both', async () => {
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [SCHEDULED_GAME],
        nhl_teams: TEAMS,
        player_projected_stats: [
          proj({ player_id: 1, total_projected_points: '2.0' }),
          proj({ player_id: 2, total_projected_points: '3.0' }),
          proj({ player_id: 3, total_projected_points: '99.0' }),
        ],
        player_directory: [
          dir({ player_id: 1, full_name: 'Mine' }),
          dir({ player_id: 2, full_name: 'Rival' }),
          dir({ player_id: 3, full_name: 'Free agent' }),
        ],
        player_game_stats: [],
        // player_id is TEXT in this table, integer everywhere else.
        roster_assignments: [
          { id: 'r1', league_id: 'lg', team_id: 'tm-me', player_id: '1' },
          { id: 'r2', league_id: 'lg', team_id: 'tm-them', player_id: '2' },
          { id: 'r3', league_id: 'lg', team_id: 'tm-me', player_id: 'not-a-number' },
        ],
        teams: [
          { id: 'tm-me', league_id: 'lg', owner_id: 'user-1', team_name: 'My Team' },
          { id: 'tm-them', league_id: 'lg', owner_id: 'user-2', team_name: 'Their Team' },
        ],
        leagues: [{ id: 'lg', scoring_settings: null }],
      }),
    );

    const { result } = await svc.getDay('2026-09-29', { leagueId: 'lg', userId: 'user-1' });
    const citrus = result!.games[0].citrus!;

    // Own player first despite the lowest projection; the 99-point free agent last.
    expect(citrus.players.map((p) => p.name)).toEqual(['Mine', 'Rival', 'Free agent']);
    expect(citrus.players[0].roster).toEqual({ teamId: 'tm-me', teamName: 'My Team', isMine: true });
    expect(citrus.players[1].roster?.isMine).toBe(false);
    expect(citrus.players[2].roster).toBeNull();
    expect(citrus.rosteredCount).toBe(2);
    expect(citrus.myCount).toBe(1);
    expect(result!.league).toEqual({ id: 'lg', rostersResolved: true });
  });

  it('reports no roster context at all when no league was requested', async () => {
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [SCHEDULED_GAME],
        nhl_teams: TEAMS,
        player_projected_stats: [proj({})],
        player_directory: [dir({})],
        player_game_stats: [],
      }),
    );

    const { result } = await svc.getDay('2026-09-29');
    expect(result!.games[0].citrus!.rosteredCount).toBeNull();
    expect(result!.games[0].citrus!.myCount).toBeNull();
    expect(result!.league).toEqual({ id: null, rostersResolved: false });
  });

  it('offers the nearest days with games when the requested day has none', async () => {
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [
          { ...FINAL_GAME, game_date: '2026-06-14' },
          { ...SCHEDULED_GAME, game_date: '2026-09-29' },
          { ...SCHEDULED_GAME, game_id: 9, game_date: '2026-09-30' },
        ],
        nhl_teams: TEAMS,
      }),
    );

    const { result } = await svc.getDay('2026-09-02');
    expect(result!.games).toEqual([]);
    expect(result!.nearestDateWithGames).toEqual({ before: '2026-06-14', after: '2026-09-29' });
  });

  it('carries a full slate past the 1000-row clamp instead of losing players', async () => {
    // 1,400 projections is what a 28-game night looks like. An unpaged read
    // returns exactly 1,000 of them and says nothing about the other 400.
    const projections = Array.from({ length: 1400 }, (_, i) =>
      proj({ player_id: 1000 + i, total_projected_points: String(i / 100) }),
    );
    const directory = projections.map((p) =>
      dir({ player_id: p.player_id, full_name: `P${p.player_id}` }),
    );

    const svc = new ScoresService(
      makeSupabase(
        {
          nhl_games: [SCHEDULED_GAME],
          nhl_teams: TEAMS,
          player_projected_stats: projections,
          player_directory: directory,
          player_game_stats: [],
        },
        { pageCap: 1000 },
      ),
    );

    const { result } = await svc.getDay('2026-09-29');
    expect(result!.games[0].citrus!.projectedPlayers).toBe(1400);
    // The highest projection lives in the tail an unpaged read would drop.
    expect(result!.games[0].citrus!.players[0].name).toBe('P2399');
    expect(result!.truncated).toBe(false);
  });

  it('keeps one projection per player when a backfill leaves two', async () => {
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [SCHEDULED_GAME],
        nhl_teams: TEAMS,
        player_projected_stats: [
          proj({ total_projected_points: '1.0', updated_at: '2026-09-01T00:00:00Z' }),
          proj({ total_projected_points: '7.5', updated_at: '2026-09-02T00:00:00Z' }),
        ],
        player_directory: [dir({})],
        player_game_stats: [],
      }),
    );

    const { result } = await svc.getDay('2026-09-29');
    const citrus = result!.games[0].citrus!;
    expect(citrus.projectedPlayers).toBe(1);
    expect(citrus.players[0].projectedPoints).toBeCloseTo(7.5);
  });

  it('leaves citrus null for a game nobody is projected in', async () => {
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [SCHEDULED_GAME],
        nhl_teams: TEAMS,
        player_projected_stats: [],
        player_directory: [],
        player_game_stats: [],
      }),
    );

    const { result } = await svc.getDay('2026-09-29');
    expect(result!.games[0].citrus).toBeNull();
  });
});

describe('ScoresService.getGameDetail', () => {
  it('returns every projected player, not just the row\'s top three', async () => {
    const players = Array.from({ length: 12 }, (_, i) => i + 1);
    const svc = new ScoresService(
      makeSupabase({
        nhl_games: [SCHEDULED_GAME, LIVE_GAME],
        nhl_teams: TEAMS,
        player_projected_stats: players.map((pid) =>
          proj({ player_id: pid, total_projected_points: String(pid) }),
        ),
        player_directory: players.map((pid) => dir({ player_id: pid, full_name: `P${pid}` })),
        player_game_stats: [],
      }),
    );

    const { result } = await svc.getGameDetail(2026020001);
    expect(result!.game.gameId).toBe(2026020001);
    expect(result!.players).toHaveLength(12);
    expect(result!.players[0].name).toBe('P12');
  });

  it('answers null for a game id that is not in the table', async () => {
    const svc = new ScoresService(
      makeSupabase({ nhl_games: [SCHEDULED_GAME], nhl_teams: TEAMS }),
    );
    const { result, error } = await svc.getGameDetail(1);
    expect(result).toBeNull();
    expect(error).toBeNull();
  });

  it('rejects a non-integer game id', async () => {
    const svc = new ScoresService(makeSupabase({}));
    const { error } = await svc.getGameDetail(Number.NaN);
    expect(error?.message).toContain('integer');
  });
});
