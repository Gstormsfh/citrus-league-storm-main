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
          filters.push((r) => Number(r[col]) >= Number(val));
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
    const notes = await detector.run(sb, 2025);
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
    expect(await detector.run(sb, 2025)).toHaveLength(0);
  });

  it('does NOT fire on a tiny expected-goals sample, however lopsided', async () => {
    // 1 goal on 5 xG is a 80% shortfall but means nothing.
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [row({ goals: 1, x_goals: 5 })],
    });
    expect(await detector.run(sb, 2025)).toHaveLength(0);
  });

  it('skips a player with no directory entry rather than naming him "undefined"', async () => {
    const sb = makeSupabase({
      player_directory: [],
      player_season_stats: [row()],
    });
    expect(await detector.run(sb, 2025)).toHaveLength(0);
  });

  it('paginates past the 1,000-row cap instead of silently losing players', async () => {
    // 1,200 qualifying skaters. An unpaginated read returns 1,000 and reports
    // no error — the exact failure this guards.
    const stats = Array.from({ length: 1200 }, (_, i) => row({ player_id: 1000 + i }));
    const sb = makeSupabase({ player_directory: directory(1200), player_season_stats: stats });
    const notes = await detector.run(sb, 2025);
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
    const notes = await detector.run(sb, 2025);
    expect(notes).toHaveLength(1);
    expect(notes[0].severity).toBe('caution');
  });

  it('hedges rather than declaring regression certain', async () => {
    // Elite shooters genuinely do beat xG repeatedly. Copy that ignores this
    // is a horoscope, so the note must acknowledge the skill side.
    const sb = makeSupabase({ player_directory: directory(1), player_season_stats: [row()] });
    const [note] = await detector.run(sb, 2025);
    expect(note.analysis).toMatch(/flag, not a verdict/i);
    expect(note.analysis).toMatch(/elite shooters/i);
  });

  it('does NOT fire on a low goal total, where the ratio is noise', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [row({ goals: 8, x_goals: 3 })],
    });
    expect(await detector.run(sb, 2025)).toHaveLength(0);
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
    const notes = await detector.run(sb, 2025);
    expect(notes).toHaveLength(1);
    expect(notes[0].headline).toContain('3');
  });

  it('does NOT fire on a small drift', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [mk(2025, 1000, 16), mk(2024, 1000, 15)],
    });
    expect(await detector.run(sb, 2025)).toHaveLength(0);
  });

  it('does NOT fire without a prior season to compare against', async () => {
    const sb = makeSupabase({
      player_directory: directory(1),
      player_season_stats: [mk(2025, 1000, 22)],
    });
    expect(await detector.run(sb, 2025)).toHaveLength(0);
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
    const [note] = (await detector.run(sb, 2025)) as GeneratedNote[];
    expect(note.dedupeKey).toBe('bounce-back:2025:1000');
    expect(note.headline.length).toBeGreaterThan(0);
    expect(note.body.length).toBeGreaterThan(0);
    expect(note.body).not.toMatch(/NaN|undefined|Infinity/);
    expect(note.analysis).not.toMatch(/NaN|undefined|Infinity/);
  });
});
