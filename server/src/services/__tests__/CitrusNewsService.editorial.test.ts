import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { augmentCitrusNotesWithNews, DETECTORS } from '../CitrusNewsService';
import { NewsRoomService } from '../NewsRoomService';
import { getSupabaseAdmin } from '../../lib/supabase';
import { newsRoutes } from '../../routes/news';
import type { EditorialNewsItem } from '@citrus/shared';

vi.mock('../../lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));

const NOW = new Date('2026-09-12T12:00:00Z');
const PLAYER = { id: 1000, name: 'Connor McDavid' };
const story = (overrides: Partial<EditorialNewsItem> = {}): EditorialNewsItem => ({
  player_ids: [1000], title: 'Connor McDavid remains day-to-day', snippet: 'Connor McDavid has no return timetable.',
  source_id: 'nhl', url: 'https://nhl.com/news/mcdavid-update', published_at: '2026-09-12T09:00:00Z', ...overrides,
});
const note = (overrides = {}) => ({
  id: 'note-1', kind: 'usage-surge', season: 2025, headline: 'More ice time',
  body: 'Connor McDavid averaged 22 minutes per game in 2025-26.',
  analysis: 'Check the current assignment before projecting the extra opportunity forward.',
  published_at: '2026-08-25T12:00:00Z', ...overrides,
});

function detectorDb(tables: Record<string, Record<string, unknown>[]>) {
  return { from: (table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return builder; },
      gte: (key: string, value: string | number) => { filters.push((row) => typeof value === 'number' ? Number(row[key]) >= value : String(row[key]) >= value); return builder; },
      order: () => builder,
      range: async (start: number, end: number) => ({ data: (tables[table] || []).filter(row => filters.every(fn => fn(row))).slice(start, end + 1), error: null }),
    };
    return builder;
  } } as never;
}
const directory = { season: 2025, player_id: 1000, full_name: PLAYER.name, team_abbrev: 'EDM', position_code: 'C' };
const skater = { season: 2025, player_id: 1000, is_goalie: false, games_played: 80, goals: 10, points: 40, x_goals: 25, icetime_seconds: 80 * 20 * 60 };
const run = (kind: string, tables: Record<string, Record<string, unknown>[]>, at = NOW) => DETECTORS.find(d => d.kind === kind)!.run(detectorDb({ player_directory: [directory], ...tables }), 2025, at);

describe('first-party editorial detectors', () => {
  it('separates finishing upside from a guaranteed rebound or buy recommendation', async () => {
    const [result] = await run('bounce-back', { player_season_stats: [skater] });
    expect(result.body).toContain('finished 2025-26 with 10 goals');
    expect(result.analysis).toContain('15-goal gap');
    expect(result.analysis).toContain('If he maintains those opportunities');
    expect(result.analysis).not.toMatch(/usually closes on its own|Buy him anywhere/);
    expect(result.dedupeKey).toBe('bounce-back:2025:1000');
  });

  it('keeps usage grounded in historical minutes without claiming coaching intent', async () => {
    const [result] = await run('usage-surge', { player_season_stats: [skater, { ...skater, season: 2024, icetime_seconds: 80 * 17 * 60 }] });
    expect(result.body).toContain('2025-26');
    expect(result.body).toContain('2024-25');
    expect(result.analysis).toContain('3 more minutes');
    expect(result.analysis).toContain('does not show how much came on the power play');
    expect(result.analysis).not.toMatch(/a coaching decision|tends to persist/);
  });

  it('describes goalie volume without inferring an uncontested crease', async () => {
    const [result] = await run('goalie-workload', { player_season_stats: [{ player_id: 1000, season: 2025, is_goalie: true, goalie_gp: 55, save_pct: .915, wins: 30, shutouts: 4 }] });
    expect(result.analysis).toContain('relief work');
    expect(result.analysis).toContain('ratio categories');
    expect(result.headline).toContain('55 appearances');
    expect(result.analysis).not.toMatch(/holding a crease outright|stop worrying/);
  });

  it('contrasts finishing and playmaking big games instead of repeating the same lesson', async () => {
    const game = { player_id: 1000, season: 2025, is_goalie: false, game_id: 1, game_date: '2026-01-10', points: 3, goals: 3, primary_assists: 0, secondary_assists: 0, shots_on_goal: 6, icetime_seconds: 1200 };
    const at = new Date('2026-01-11T12:00:00Z');
    const [goals] = await run('big-game', { player_game_stats: [game] }, at);
    const [assists] = await run('big-game', { player_game_stats: [{ ...game, goals: 0, primary_assists: 3 }] }, at);
    expect(goals.analysis).toContain('6 shots');
    expect(goals.analysis).toContain('conversion');
    expect(assists.analysis).toContain('3 assists');
    expect(assists.analysis).toContain('own goal or shot output');
    expect(goals.analysis).not.toBe(assists.analysis);
    expect(goals.publishedAt).toBe('2026-01-10T12:00:00.000Z');
  });

  it('keeps projection season, figures and conditional category-specific interpretation', async () => {
    const base = { season: 2026, player_id: 1000, player_name: PLAYER.name, is_goalie: false, games_remaining: 83,
      avg_points_per_game: 3.5, total_projected_points: 290.5, projected_goals: 30, projected_assists: 60,
      projected_sog: 250, projected_hits: 20, projected_blocks: 30, projected_ppp: 35 };
    const [result] = await run('season-outlook', { player_ros_projections: [base] });
    expect(result.season).toBe(2026);
    expect(result.body).toContain('83 games in 2026-27');
    expect(result.body).toContain('3.5 fantasy points per game');
    expect(result.analysis).toContain('Assists lead');
    expect(result.analysis).toContain('when your league rewards');
    expect(result.analysis).toContain('do not confirm a first-unit assignment');
    expect(result.analysis).not.toContain('start every week without checking');
  });
});

describe('current reporting on first-party notes', () => {
  it('adds only to the newest note and preserves its historical publication date, stats, and season', () => {
    const notes = [note(), note({ id: 'older', published_at: '2026-08-01T12:00:00Z' })];
    const result = augmentCitrusNotesWithNews(notes, PLAYER, [story(), story()], NOW);
    expect(result[0].body).toContain('Current report: nhl.com (2026-09-12)');
    expect(result[0].body).toContain('averaged 22 minutes per game in 2025-26');
    expect(result[0].published_at).toBe(notes[0].published_at);
    expect(result[0].season).toBe(2025);
    expect(result[1]).toEqual(notes[1]);
    expect(result[0].news_sources).toEqual([{ source: 'nhl.com', url: story().url, published_at: '2026-09-12T09:00:00.000Z' }]);
    expect(augmentCitrusNotesWithNews(result, PLAYER, [story()], NOW)).toEqual(result);
  });

  it('uses raw reporting rather than generated summaries and ignores wrong identities or stale news', () => {
    const input = story({ title: 'Jack Hughes remains day-to-day', snippet: 'Jack Hughes has no return timetable.' });
    expect(augmentCitrusNotesWithNews([note()], PLAYER, [input], NOW)).toEqual([note()]);
    expect(augmentCitrusNotesWithNews([note()], PLAYER, [story({ published_at: '2026-08-01T00:00:00Z' })], NOW)).toEqual([note()]);
    const result = augmentCitrusNotesWithNews([note()], PLAYER, [{ ...story(), summary: 'Connor McDavid will return September 15.' } as EditorialNewsItem], NOW);
    expect(result[0].analysis).toContain('does not establish a return date');
    expect(result[0].analysis).not.toContain('September 15');
  });

  it('reflects fresh clearance on the next read without retaining the earlier injury context', () => {
    const injury = augmentCitrusNotesWithNews([note({ analysis: null })], PLAYER, [story()], NOW);
    const cleared = story({ title: 'Connor McDavid cleared to play', snippet: '', published_at: '2026-09-12T10:00:00Z' });
    const result = augmentCitrusNotesWithNews(injury, PLAYER, [story(), cleared], NOW);
    expect(result[0].body).toContain('clearance or activation');
    expect(result[0].body).not.toContain('uncertain availability');
    expect((result[0].analysis.match(/News implication:/g) || []).length).toBe(1);
    expect(augmentCitrusNotesWithNews(result, PLAYER, [], NOW)).toEqual([note({ analysis: null })]);
  });

  it('replaces known unsafe legacy verdicts even without identity or news access', () => {
    const result = augmentCitrusNotesWithNews([note({ analysis: 'A jump this size is a coaching decision rather than a hot streak.' })], null, null, NOW);
    expect(result[0].analysis).toContain('Check the current line');
    expect(result[0].body).toBe(note().body);
    expect(result[0].analysis).not.toContain('a coaching decision');
  });
});

describe('player news route integration', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['wire', 'identity', 'none'])('preserves notes when %s fails independently and enriches on success', async (failure) => {
    const source = story({ published_at: new Date().toISOString() });
    vi.spyOn(NewsRoomService.prototype, 'forPlayer').mockImplementation(async () => {
      if (failure === 'wire') throw new Error('wire offline');
      return [source] as never;
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue({ from: (table: string) => {
      const q = {
        select: () => q, eq: () => q, order: () => q,
        limit: async () => table === 'citrus_news'
          ? { data: [note()], error: null }
          : failure === 'identity' ? { data: null, error: { message: 'directory offline' } }
            : { data: [{ full_name: PLAYER.name }], error: null },
      };
      return q;
    } } as never);
    const app = new Hono().route('/api/news', newsRoutes);
    const response = await app.request('/api/news/player/1000');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.notes).toHaveLength(1);
    if (failure === 'none') expect(data.notes[0].body).toContain('Current report:');
    else expect(data.notes[0].body).toBe(note().body);
    expect(data.items).toHaveLength(failure === 'wire' ? 0 : 1);
  });
});
