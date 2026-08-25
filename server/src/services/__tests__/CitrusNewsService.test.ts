// Citrus News Engine contract (2026-08-25).
//
// This engine publishes prose under our own byline, so the tests that matter
// are the ones that stop it saying something untrue: a detector must not fire
// on a player it has no evidence about, must not republish, and must not lose
// players to a silent pagination cap.

import { describe, it, expect, vi } from 'vitest';
import {
  DETECTORS,
  isOffseason,
  generateCitrusNews,
  type GeneratedNote,
} from '../CitrusNewsService';

// ── A tiny fake of the PostgREST builder surface these detectors use ──
// Chainable .select/.eq/.gte, resolved by .range(). Rows are filtered in the
// fake exactly the way PostgREST would filter them, so a detector's own
// threshold logic is what's under test.
function makeSupabase(tables: Record<string, any[]>, opts: { pageCap?: number } = {}) {
  const pageCap = opts.pageCap ?? 1000;
  const upserted: any[] = [];

  const api = {
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        gte: (col: string, val: any) => {
          // PostgREST compares dates lexically, not numerically. Coercing a
          // 'YYYY-MM-DD' to Number yields NaN, and every comparison against
          // NaN is false — which silently filtered out every game row.
          filters.push((r) => {
            const a = r[col];
            if (typeof val === 'string' && Number.isNaN(Number(val))) {
              return String(a) >= val;
            }
            return Number(a) >= Number(val);
          });
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        range: async (from: number, to: number) => {
          const all = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
          // Emulate the cap that silently truncates real responses.
          const size = Math.min(to - from + 1, pageCap);
          return { data: all.slice(from, from + size), error: null };
        },
        upsert: (rows: any[]) => {
          const sel = {
            select: async () => {
              const fresh = rows.filter(
                (r) => !upserted.some((u) => u.dedupe_key === r.dedupe_key),
              );
              upserted.push(...fresh);
              return { data: fresh.map((r) => ({ id: r.dedupe_key })), error: null };
            },
          };
          return sel;
        },
      };
      return builder;
    },
    __upserted: upserted,
  };
  return api as any;
}

/** Fixed offseason moment; detectors take `now` so they're testable at a date. */
const OFFSEASON = new Date(2026, 7, 25);

const directory = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    season: 2025,
    player_id: 1000 + i,
    full_name: `Player Number${i}`,
    team_abbrev: 'TOR',
    position_code: 'C',
  }));

describe('detector registry', () => {
  it('every detector has a unique kind', () => {
    const kinds = DETECTORS.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('every detector declares a phase', () => {
    for (const d of DETECTORS) {
      expect(['offseason', 'inseason', 'always']).toContain(d.phase);
    }
  });
});

describe('isOffseason', () => {
  it('is true in August, when there are no fixtures at all', () => {
    expect(isOffseason(new Date(2026, 7, 25))).toBe(true);
  });

  it('is false in December, mid-season', () => {
    expect(isOffseason(new Date(2026, 11, 1))).toBe(false);
  });
});

describe('bounce-back detector', () => {
  const kind = 'bounce-back';
  const detector = DETECTORS.find((d) => d.kind === kind)!;

  const row = (over: Partial<Record<string, number>> = {}) => ({
    season: 2025,
    is_goalie: false,
    player_id: 1000,
    games_played: 80,
    goals: 10,
    points: 40,
    x_goals: 25,
    icetime_seconds: 80 * 17 * 60,
    ...over,
  });

  it('fires on a real shortfall and quotes both real numbers', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [row()],
    });
    const notes = await detector.run(sb, 2025, OFFSEASON);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('10 goals');
    expect(notes[0].body).toContain('25 expected');
    expect(notes[0].severity).toBe('positive');
  });

  it('does NOT fire when the player finished roughly as expected', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [row({ goals: 22, x_goals: 25 })],
    });
    expect(await detector.run(sb, 2025, OFFSEASON)).toHaveLength(0);
  });

  it('does NOT fire on a tiny expected-goals sample, however lopsided', async () => {
    // 1 goal on 5 xG is a 80% shortfall but means nothing.
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [row({ goals: 1, x_goals: 5 })],
    });
    expect(await detector.run(sb, 2025, OFFSEASON)).toHaveLength(0);
  });

  it('skips a player with no directory entry rather than naming him "undefined"', async () => {
    const sb = makeSupabase({
      player_directory: [],
      player_season_stats: [row()],
    });
    expect(await detector.run(sb, 2025, OFFSEASON)).toHaveLength(0);
  });

  it('paginates past the 1,000-row cap instead of silently losing players', async () => {
    // 1,200 qualifying skaters. An unpaginated read returns 1,000 and reports
    // no error — the exact failure this guards.
    const stats = Array.from({ length: 1200 }, (_, i) => row({ player_id: 1000 + i }));
    const sb = makeSupabase({ player_directory: directory(1200), player_season_stats: stats });
    const notes = await detector.run(sb, 2025, OFFSEASON);
    expect(notes).toHaveLength(1200);
  });
});

describe('regression-risk detector', () => {
  const detector = DETECTORS.find((d) => d.kind === 'regression-risk')!;
  const row = (over: Partial<Record<string, number>> = {}) => ({
    season: 2025,
    is_goalie: false,
    player_id: 1000,
    games_played: 80,
    goals: 40,
    points: 70,
    x_goals: 25,
    icetime_seconds: 80 * 18 * 60,
    ...over,
  });

  it('fires on a large over-performance', async () => {
    const sb = makeSupabase({ player_directory: directory(1), player_season_stats: [row()] });
    const notes = await detector.run(sb, 2025, OFFSEASON);
    expect(notes).toHaveLength(1);
    expect(notes[0].severity).toBe('caution');
  });

  it('hedges rather than declaring regression certain', async () => {
    // Elite shooters genuinely do beat xG repeatedly. Copy that ignores this
    // is a horoscope, so the note must acknowledge the skill side.
    const sb = makeSupabase({ player_directory: directory(1), player_season_stats: [row()] });
    const [note] = await detector.run(sb, 2025, OFFSEASON);
    expect(note.analysis).toMatch(/flag, not a verdict/i);
    expect(note.analysis).toMatch(/elite shooters/i);
  });

  it('does NOT fire on a low goal total, where the ratio is noise', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [row({ goals: 8, x_goals: 3 })],
    });
    expect(await detector.run(sb, 2025, OFFSEASON)).toHaveLength(0);
  });
});

describe('usage-surge detector', () => {
  const detector = DETECTORS.find((d) => d.kind === 'usage-surge')!;

  const mk = (season: number, player_id: number, toiMin: number, gp = 70) => ({
    season,
    is_goalie: false,
    player_id,
    games_played: gp,
    goals: 10,
    points: 30,
    x_goals: 10,
    icetime_seconds: gp * toiMin * 60,
  });

  it('fires when ice time jumps year over year', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [mk(2025, 1000, 18), mk(2024, 1000, 15)],
    });
    const notes = await detector.run(sb, 2025, OFFSEASON);
    expect(notes).toHaveLength(1);
    expect(notes[0].headline).toContain('3');
  });

  it('does NOT fire on a small drift', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [mk(2025, 1000, 16), mk(2024, 1000, 15)],
    });
    expect(await detector.run(sb, 2025, OFFSEASON)).toHaveLength(0);
  });

  it('does NOT fire without a prior season to compare against', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [mk(2025, 1000, 22)],
    });
    expect(await detector.run(sb, 2025, OFFSEASON)).toHaveLength(0);
  });
});

// ── In-season detectors ──────────────────────────────────────────────

const IN_SEASON = new Date(2026, 0, 11); // 11 Jan 2026, mid-season
const gameRow = (over: Record<string, any> = {}) => ({
  season: 2025,
  is_goalie: false,
  player_id: 1000,
  game_id: 501,
  game_date: '2026-01-10',
  team_abbrev: 'TOR',
  points: 3,
  goals: 1,
  primary_assists: 1,
  secondary_assists: 1,
  shots_on_goal: 5,
  icetime_seconds: 20 * 60,
  saves: 0,
  shots_faced: 0,
  goals_against: 0,
  shutouts: 0,
  wins: 0,
  ...over,
});

describe('big-game detector', () => {
  const detector = DETECTORS.find((d) => d.kind === 'big-game')!;

  it('fires on a three-point night', async () => {
    const sb = makeSupabase({ player_directory: directory(1), player_game_stats: [gameRow()] });
    const notes = await detector.run(sb, 2025, IN_SEASON);
    expect(notes).toHaveLength(1);
    expect(notes[0].headline).toContain('3 points');
  });

  it('does NOT fire on a two-point night', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [gameRow({ points: 2, goals: 1, primary_assists: 1, secondary_assists: 0 })],
    });
    expect(await detector.run(sb, 2025, IN_SEASON)).toHaveLength(0);
  });

  it('calls three goals a hat trick', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [gameRow({ points: 3, goals: 3, primary_assists: 0, secondary_assists: 0 })],
    });
    const [note] = await detector.run(sb, 2025, IN_SEASON);
    expect(note.headline).toContain('hat trick');
    expect(note.tags).toContain('Hat trick');
  });

  it('stamps the GAME date, not the run time', async () => {
    // The whole point: a Saturday game reported on Monday is still Saturday's
    // news. Stamping now() is the lie the fabricated fallback told.
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [gameRow({ game_date: '2026-01-10' })],
    });
    const [note] = await detector.run(sb, 2025, IN_SEASON);
    expect(note.publishedAt).toBe('2026-01-10T12:00:00.000Z');
  });

  it('ignores games outside the lookback window', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [gameRow({ game_date: '2025-11-01' })],
    });
    expect(await detector.run(sb, 2025, IN_SEASON)).toHaveLength(0);
  });

  it('gives each game its own dedupe key so two big nights both publish', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [
        gameRow({ game_id: 501, game_date: '2026-01-09' }),
        gameRow({ game_id: 502, game_date: '2026-01-10' }),
      ],
    });
    const notes = await detector.run(sb, 2025, IN_SEASON);
    expect(new Set(notes.map((n) => n.dedupeKey)).size).toBe(2);
  });
});

describe('goalie-gem detector', () => {
  const detector = DETECTORS.find((d) => d.kind === 'goalie-gem')!;
  const g = (over: Record<string, any> = {}) =>
    gameRow({ is_goalie: true, points: 0, goals: 0, primary_assists: 0, secondary_assists: 0, ...over });

  it('fires on a shutout', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [g({ shutouts: 1, saves: 28, shots_faced: 28, wins: 1 })],
    });
    const [note] = await detector.run(sb, 2025, IN_SEASON);
    expect(note.headline).toContain('shutout');
    expect(note.body).toContain('all 28 shots');
  });

  it('fires on a high-volume win', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [g({ saves: 38, shots_faced: 40, goals_against: 2, wins: 1 })],
    });
    const [note] = await detector.run(sb, 2025, IN_SEASON);
    expect(note.headline).toContain('38 saves');
  });

  it('does NOT fire on a routine start', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [g({ saves: 22, shots_faced: 25, goals_against: 3, wins: 1 })],
    });
    expect(await detector.run(sb, 2025, IN_SEASON)).toHaveLength(0);
  });

  it('does NOT fire on a big save count in a LOSS', async () => {
    // 38 saves in a loss is a busy night, not a gem worth surfacing.
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [g({ saves: 38, shots_faced: 42, goals_against: 4, wins: 0 })],
    });
    expect(await detector.run(sb, 2025, IN_SEASON)).toHaveLength(0);
  });
});

describe('point-streak detector', () => {
  const detector = DETECTORS.find((d) => d.kind === 'point-streak')!;

  /** n consecutive games with a point, most recent first. */
  const streakGames = (n: number, pointsEach = 1) =>
    Array.from({ length: n }, (_, i) => {
      const day = 10 - i;
      return gameRow({
        game_id: 600 + i,
        game_date: `2026-01-${String(day).padStart(2, '0')}`,
        points: pointsEach,
        goals: 1,
        primary_assists: 0,
        secondary_assists: 0,
      });
    });

  it('publishes at the 5-game milestone', async () => {
    const sb = makeSupabase({ player_directory: directory(1), player_game_stats: streakGames(5) });
    const notes = await detector.run(sb, 2025, IN_SEASON);
    expect(notes).toHaveLength(1);
    expect(notes[0].headline).toContain('5 straight games');
    expect(notes[0].dedupeKey).toBe('point-streak:2025:1000:5');
  });

  it('stays silent BETWEEN milestones so one player cannot flood the feed', async () => {
    // A 7-game run is still the 5-game note until it reaches 10.
    const sb = makeSupabase({ player_directory: directory(1), player_game_stats: streakGames(7) });
    expect(await detector.run(sb, 2025, IN_SEASON)).toHaveLength(0);
  });

  it('publishes again at the next milestone with a distinct key', async () => {
    const sb = makeSupabase({ player_directory: directory(1), player_game_stats: streakGames(10) });
    const [note] = await detector.run(sb, 2025, IN_SEASON);
    expect(note.dedupeKey).toBe('point-streak:2025:1000:10');
  });

  it('a pointless game breaks the streak', async () => {
    const games = streakGames(5);
    games[0] = gameRow({ game_id: 700, game_date: '2026-01-10', points: 0, goals: 0, primary_assists: 0, secondary_assists: 0 });
    const sb = makeSupabase({ player_directory: directory(1), player_game_stats: games });
    expect(await detector.run(sb, 2025, IN_SEASON)).toHaveLength(0);
  });

  it('counts backwards from the most recent game regardless of row order', async () => {
    const games = streakGames(5);
    const shuffled = [games[3], games[0], games[4], games[1], games[2]];
    const sb = makeSupabase({ player_directory: directory(1), player_game_stats: shuffled });
    const notes = await detector.run(sb, 2025, IN_SEASON);
    expect(notes).toHaveLength(1);
    expect(notes[0].headline).toContain('5 straight');
  });
});

describe('phase gating', () => {
  it('offseason runs never emit game-event notes', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [gameRow()],
      player_season_stats: [],
    });
    const result = await generateCitrusNews(sb, { season: 2025, now: new Date(2026, 7, 25) });
    expect(result.phase).toBe('offseason');
    expect(result.skipped).toContain('big-game');
    expect(result.skipped).toContain('point-streak');
  });

  it('in-season runs skip the offseason draft-prep detectors', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_game_stats: [gameRow()],
      player_season_stats: [],
    });
    const result = await generateCitrusNews(sb, { season: 2025, now: IN_SEASON });
    expect(result.phase).toBe('inseason');
    expect(result.ran).toContain('big-game');
    expect(result.skipped).toContain('bounce-back');
    expect(result.generated).toBeGreaterThan(0);
  });
});

describe('generateCitrusNews', () => {
  it('runs only phase-appropriate detectors and reports what it skipped', async () => {
    const sb = makeSupabase({ player_directory: [], player_season_stats: [] });
    const result = await generateCitrusNews(sb, { season: 2025, now: new Date(2026, 7, 25) });
    expect(result.phase).toBe('offseason');
    // Every detector shipped today is offseason-phase.
    expect(result.ran.length).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  it('is idempotent — a second run inserts nothing new', async () => {
    const stats = [
      {
        season: 2025, is_goalie: false, player_id: 1000, games_played: 80,
        goals: 10, points: 40, x_goals: 25, icetime_seconds: 80 * 17 * 60,
      },
    ];
    const sb = makeSupabase({ player_directory: directory(1), player_season_stats: stats });

    const first = await generateCitrusNews(sb, { season: 2025, now: new Date(2026, 7, 25) });
    expect(first.inserted).toBeGreaterThan(0);

    const second = await generateCitrusNews(sb, { season: 2025, now: new Date(2026, 7, 25) });
    expect(second.generated).toBe(first.generated);
    expect(second.inserted).toBe(0); // dedupe_key collision → no republish
  });

  it('one failing detector does not lose the others output', async () => {
    const sb = makeSupabase({ player_directory: directory(1), player_season_stats: [] });
    const broken = {
      kind: 'explode',
      label: 'Explode',
      phase: 'offseason' as const,
      run: async () => {
        throw new Error('boom');
      },
    };
    DETECTORS.push(broken);
    try {
      const result = await generateCitrusNews(sb, { season: 2025, now: new Date(2026, 7, 25) });
      expect(result.errors.some((e) => e.kind === 'explode')).toBe(true);
      expect(result.ran.length).toBeGreaterThan(0);
    } finally {
      DETECTORS.pop();
    }
  });
});

describe('note shape', () => {
  it('every generated note carries a dedupe key scoped by kind, season and player', async () => {
    const detector = DETECTORS.find((d) => d.kind === 'bounce-back')!;
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [
        {
          season: 2025, is_goalie: false, player_id: 1000, games_played: 80,
          goals: 10, points: 40, x_goals: 25, icetime_seconds: 80 * 17 * 60,
        },
      ],
    });
    const [note] = (await detector.run(sb, 2025, OFFSEASON)) as GeneratedNote[];
    expect(note.dedupeKey).toBe('bounce-back:2025:1000');
    expect(note.headline.length).toBeGreaterThan(0);
    expect(note.body.length).toBeGreaterThan(0);
    expect(note.body).not.toMatch(/NaN|undefined|Infinity/);
    expect(note.analysis).not.toMatch(/NaN|undefined|Infinity/);
  });
});
