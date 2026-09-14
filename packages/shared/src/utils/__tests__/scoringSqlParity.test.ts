/**
 * SQL ↔ TypeScript SCORING PARITY (2026-09-14).
 *
 * CLAUDE.md names `ScoringCalculator` the single source of truth for scoring
 * LOGIC, but matchup daily scores are computed in SQL: score_matchup_lines()
 * sums value × multiplier over v_player_game_stat_long against
 * get_effective_scoring_rules(). Two implementations of one formula, and
 * until now nothing compared them: the only cross-check in the repo was
 * SQL-vs-SQL (the v2 writer proof) and TS-vs-TS (the defaults equivalence
 * test). This test feeds the same stat lines and the same weights to both
 * and requires the answers to agree to the thousandth, which is the
 * precision the SQL rounds to.
 *
 * The SQL is read from the dated production snapshot in
 * data-pipeline/tests/rehearsal, the same text the 2026-09-03 migration
 * installed, so a change to either side shows up here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ScoringCalculator, ADDITIONAL_SCORING_STATS, DEFAULT_SCORING, type ScoringSettings } from '../scoring';
import { SCORING_DEFAULTS } from '../../constants/scoringDefaults';

const REPO = resolve(__dirname, '../../../../..');
const SNAPSHOT = readFileSync(resolve(REPO, 'data-pipeline/tests/rehearsal/production-scoring-functions-20260912.sql'), 'utf8');

function functionText(name: string): string {
  const start = SNAPSHOT.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`${name} not in snapshot`);
  const end = SNAPSHOT.indexOf('$function$;', start) + '$function$;'.length;
  return SNAPSHOT.slice(start, end);
}

/** stat_key -> player_game_stats column, exactly as v_player_game_stat_long maps them. */
const SKATER_COLUMNS: Record<string, string> = {
  goals: 'nhl_goals', assists: 'nhl_assists', power_play_points: 'nhl_ppp', short_handed_points: 'nhl_shp',
  shots_on_goal: 'nhl_shots_on_goal', blocks: 'nhl_blocks', hits: 'nhl_hits', penalty_minutes: 'nhl_pim',
  plus_minus: 'nhl_plus_minus', power_play_goals: 'nhl_ppg', power_play_assists: 'nhl_ppa',
  short_handed_goals: 'nhl_shg', short_handed_assists: 'nhl_sha', game_winning_goals: 'nhl_gwg',
  overtime_goals: 'nhl_otg', faceoff_wins: 'nhl_faceoff_wins', faceoff_losses: 'nhl_faceoff_losses',
  takeaways: 'nhl_takeaways', giveaways: 'nhl_giveaways', shot_attempts: 'nhl_shot_attempts',
  shots_missed: 'nhl_shots_missed', shots_blocked_by_opp: 'nhl_shots_blocked', shifts: 'nhl_shifts',
};
const GOALIE_COLUMNS: Record<string, string> = {
  wins: 'nhl_wins', saves: 'nhl_saves', shutouts: 'nhl_shutouts', goals_against: 'nhl_goals_against',
  losses: 'nhl_losses', ot_losses: 'nhl_ot_losses', shots_faced: 'nhl_shots_faced',
  even_saves: 'nhl_even_saves', pp_saves: 'nhl_pp_saves', sh_saves: 'nhl_sh_saves',
};
const ALL_COLUMNS = [...new Set([...Object.values(SKATER_COLUMNS), ...Object.values(GOALIE_COLUMNS), 'nhl_toi_seconds'])];

const LEAGUE = '11111111-1111-1111-1111-111111111111';
const MATCHUP = '22222222-2222-2222-2222-222222222222';
const TEAM = '33333333-3333-3333-3333-333333333333';
const ZERO = '00000000-0000-0000-0000-000000000000';

/** Deterministic pseudo-random so a failure is reproducible. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

interface Line { player_id: number; is_goalie: boolean; game_date: string; stats: Record<string, number>; toiSeconds: number }

function makeLines(seed: number, n: number): Line[] {
  const rnd = lcg(seed);
  const out: Line[] = [];
  for (let i = 0; i < n; i++) {
    const is_goalie = i % 4 === 3;
    const stats: Record<string, number> = {};
    for (const key of Object.keys(is_goalie ? GOALIE_COLUMNS : SKATER_COLUMNS)) {
      // small integers, plus/minus signed, saves larger
      const magnitude = key === 'saves' || key === 'shots_faced' || key === 'even_saves' ? 40 : key === 'shifts' ? 30 : 4;
      const v = Math.floor(rnd() * (magnitude + 1));
      stats[key] = key === 'plus_minus' ? v - 2 : v;
    }
    out.push({ player_id: 8470000 + i, is_goalie, game_date: `2026-10-${String(8 + (i % 5)).padStart(2, '0')}`, stats, toiSeconds: Math.floor(rnd() * 1500) });
  }
  return out;
}

async function setup(leagueWeights: ScoringSettings | null) {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE matchups(id uuid PRIMARY KEY, league_id uuid);
    CREATE TABLE stat_catalog(stat_key text PRIMARY KEY, applies_to text, default_multiplier numeric);
    CREATE TABLE league_scoring_rules(league_id uuid, stat_key text, multiplier numeric, PRIMARY KEY(league_id, stat_key));
    CREATE TABLE fantasy_daily_rosters(matchup_id uuid, team_id uuid, player_id int, slot_type text, roster_date date);
    CREATE TABLE nhl_games(game_id int PRIMARY KEY, game_type text);
    CREATE TABLE player_game_stats(game_id int, player_id int, game_date date, is_goalie boolean, ${ALL_COLUMNS.map(c => `${c} numeric`).join(', ')});
    INSERT INTO matchups VALUES ('${MATCHUP}', '${LEAGUE}');
  `);
  // stat_catalog from the one JSON source: the eight core skater keys, four
  // core goalie keys, and every additional category at 0.
  const catalog: Array<[string, string, number]> = [];
  for (const [key, w] of Object.entries(SCORING_DEFAULTS.skater)) catalog.push([key, 'skater', w as number]);
  for (const [key, w] of Object.entries(SCORING_DEFAULTS.goalie)) catalog.push([key, 'goalie', w as number]);
  for (const key of ADDITIONAL_SCORING_STATS.skater) catalog.push([key, 'skater', 0]);
  for (const key of ADDITIONAL_SCORING_STATS.goalie) catalog.push([key, 'goalie', 0]);
  for (const [key, group, w] of catalog) await db.query('INSERT INTO stat_catalog VALUES ($1,$2,$3)', [key, group, w]);
  if (leagueWeights) {
    for (const group of ['skater', 'goalie'] as const) {
      for (const [key, w] of Object.entries(leagueWeights[group])) {
        if (typeof w === 'number') await db.query('INSERT INTO league_scoring_rules VALUES ($1,$2,$3)', [LEAGUE, key, w]);
      }
    }
  }
  // The production view, verbatim shape.
  await db.exec(`
    CREATE VIEW v_player_game_stat_long AS
    SELECT pgs.game_id, pgs.player_id, pgs.game_date, pgs.is_goalie, v.stat_key, v.value
      FROM player_game_stats pgs
      CROSS JOIN LATERAL (VALUES
        ${Object.entries(SKATER_COLUMNS).map(([k, c]) => `('${k}','skater',COALESCE(pgs.${c},0)::numeric)`).join(',\n        ')},
        ('toi_minutes','skater',round(COALESCE(pgs.nhl_toi_seconds,0)::numeric/60.0,4)),
        ${Object.entries(GOALIE_COLUMNS).map(([k, c]) => `('${k}','goalie',COALESCE(pgs.${c},0)::numeric)`).join(',\n        ')},
        ('goalie_toi_minutes','goalie',round(COALESCE(pgs.nhl_toi_seconds,0)::numeric/60.0,4))
      ) v(stat_key, applies_to, value)
     WHERE (v.applies_to = 'goalie') = COALESCE(pgs.is_goalie, false);
  `);
  await db.exec(functionText('get_effective_scoring_rules'));
  await db.exec(functionText('score_matchup_lines'));
  return db;
}

async function load(db: PGlite, lines: Line[]) {
  for (const [i, line] of lines.entries()) {
    const gameId = 2026020000 + i;
    await db.query('INSERT INTO nhl_games VALUES ($1, $2)', [gameId, 'regular']);
    await db.query('INSERT INTO fantasy_daily_rosters VALUES ($1,$2,$3,$4,$5)', [MATCHUP, TEAM, line.player_id, 'active', line.game_date]);
    const cols = line.is_goalie ? GOALIE_COLUMNS : SKATER_COLUMNS;
    const names = ['game_id', 'player_id', 'game_date', 'is_goalie', 'nhl_toi_seconds', ...Object.values(cols)];
    const values = [gameId, line.player_id, line.game_date, line.is_goalie, line.toiSeconds, ...Object.keys(cols).map(k => line.stats[k])];
    await db.query(`INSERT INTO player_game_stats(${names.join(',')}) VALUES (${names.map((_, j) => `$${j + 1}`).join(',')})`, values);
  }
}

function tsPoints(scorer: ScoringCalculator, line: Line): number {
  const stats = { ...line.stats };
  const toi = Math.round((line.toiSeconds / 60) * 10000) / 10000;
  if (line.is_goalie) stats.goalie_toi_minutes = toi; else stats.toi_minutes = toi;
  return Math.round(scorer.calculatePoints(stats, line.is_goalie) * 1000) / 1000;
}

async function sqlPoints(db: PGlite): Promise<Map<string, number>> {
  const { rows } = await db.query<{ roster_date: string; player_id: number; points: string }>(
    `SELECT roster_date::text, player_id, points::text FROM score_matchup_lines($1, $2, '2026-10-01', '2026-10-31')`, [MATCHUP, TEAM]);
  return new Map(rows.map(r => [`${r.player_id}@${r.roster_date}`, Number(r.points)]));
}

describe('score_matchup_lines agrees with ScoringCalculator', () => {
  it('under default scoring (league has no rules; catalog defaults apply)', async () => {
    const db = await setup(null);
    try {
      const lines = makeLines(1, 40);
      await load(db, lines);
      const sql = await sqlPoints(db);
      const scorer = new ScoringCalculator(DEFAULT_SCORING);
      expect(sql.size).toBe(lines.length);
      for (const line of lines) {
        expect(sql.get(`${line.player_id}@${line.game_date}`), `${line.player_id} ${JSON.stringify(line.stats)}`).toBe(tsPoints(scorer, line));
      }
      // sanity: the default weights produced non-trivial totals on both sides
      expect([...sql.values()].some(v => v !== 0)).toBe(true);
    } finally { await db.close(); }
  }, 60_000);

  it('under a league that weights every category, fractional and negative included', async () => {
    const weights: ScoringSettings = {
      skater: {
        goals: 5.5, assists: 3.25, power_play_points: 1.1, short_handed_points: 2, shots_on_goal: 0.45,
        blocks: 0.75, hits: 0.3, penalty_minutes: -0.5, plus_minus: 1.5,
        faceoff_wins: 0.1, faceoff_losses: -0.1, takeaways: 0.4, giveaways: -0.4, power_play_goals: 1,
        power_play_assists: 0.5, short_handed_goals: 2, short_handed_assists: 1, shots_missed: -0.05,
        shots_blocked_by_opp: 0, shot_attempts: 0.02, game_winning_goals: 2, overtime_goals: 3, shifts: 0.01, toi_minutes: 0.05,
      },
      goalie: {
        wins: 4, shutouts: 3, saves: 0.25, goals_against: -1.5,
        losses: -1, ot_losses: -0.5, shots_faced: 0.05, even_saves: 0.1, pp_saves: 0.2, sh_saves: 0.3, goalie_toi_minutes: 0.02,
      },
    };
    const db = await setup(weights);
    try {
      const lines = makeLines(7, 60);
      await load(db, lines);
      const sql = await sqlPoints(db);
      const scorer = new ScoringCalculator(weights);
      for (const line of lines) {
        const ts = tsPoints(scorer, line);
        const got = sql.get(`${line.player_id}@${line.game_date}`);
        expect(got, `${line.player_id} ${line.is_goalie ? 'G' : 'S'} ${JSON.stringify(line.stats)}`).toBeDefined();
        expect(Math.abs((got as number) - ts), `${line.player_id}: sql ${got} vs ts ${ts}`).toBeLessThanOrEqual(0.0011);
      }
    } finally { await db.close(); }
  }, 60_000);

  it('a league that turns a default category OFF (explicit 0) scores it at 0 on both sides', async () => {
    const weights: ScoringSettings = { ...DEFAULT_SCORING, skater: { ...DEFAULT_SCORING.skater, goals: 0 } };
    const db = await setup(weights);
    try {
      const line: Line = { player_id: 8479000, is_goalie: false, game_date: '2026-10-09', toiSeconds: 0,
        stats: Object.fromEntries(Object.keys(SKATER_COLUMNS).map(k => [k, 0])) };
      line.stats.goals = 3; line.stats.assists = 1;
      await load(db, [line]);
      const sql = await sqlPoints(db);
      const ts = tsPoints(new ScoringCalculator(weights), line);
      expect(sql.get('8479000@2026-10-09')).toBe(ts);
      expect(ts).toBe(DEFAULT_SCORING.skater.assists); // one assist, goals disabled
    } finally { await db.close(); }
  }, 60_000);
});
