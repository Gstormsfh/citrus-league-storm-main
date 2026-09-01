/**
 * INDUSTRY-STANDARD SCORING (2026-09-01) — the cross-home defaults guard.
 *
 * Default scoring lives in more homes than anyone remembers: the shared
 * calculator, the web mirror, the CreateLeague form, the server-side
 * creation fallback, the DB migration (stat_catalog + global rules +
 * column default + the projection-rebuild RPCs), the Python pipeline,
 * and Stormy's system prompt. The 2026-09-01 change aligned all of them
 * with Yahoo's default points scoring (G6 A4 PPP2 SOG0.9 BLK1 /
 * W5 SO5 SV0.6 GA-3; SHP/hits/PIM/+/- opt-in at 0).
 *
 * This suite pins every home to ONE expected object so the next scoring
 * change cannot land in some homes and not others. If you are here
 * because it failed: update EVERY home, not the assertion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SCORING as SHARED_DEFAULTS } from '@citrus/shared';
import { DEFAULT_SCORING as WEB_DEFAULTS } from '@/utils/scoringUtils';

const here = dirname(fileURLToPath(import.meta.url));
const repo = (p: string) => readFileSync(resolve(here, '../../../..', p), 'utf-8');

const EXPECTED = {
  skater: {
    goals: 6,
    assists: 4,
    power_play_points: 2,
    short_handed_points: 0,
    shots_on_goal: 0.9,
    blocks: 1,
    hits: 0,
    penalty_minutes: 0,
    plus_minus: 0,
  },
  goalie: {
    wins: 5,
    shutouts: 5,
    saves: 0.6,
    goals_against: -3,
  },
};

describe('industry-standard scoring defaults hold in every home', () => {
  it('packages/shared DEFAULT_SCORING is the expected set', () => {
    expect(SHARED_DEFAULTS).toEqual(EXPECTED);
  });

  it('the web mirror is byte-for-byte the same values', () => {
    expect(WEB_DEFAULTS).toEqual(EXPECTED);
  });

  it('CreateLeague form defaults match, with opt-in stats disabled', () => {
    const src = repo('apps/web/src/pages/CreateLeague.tsx');
    const stat = (id: string) => {
      const m = src.match(new RegExp(`\\{ id: "${id}",[^}]*\\}`));
      expect(m, `stat row ${id} missing`).not.toBeNull();
      return m![0];
    };
    // enabled defaults carry the Yahoo values
    expect(stat('g')).toContain('points: 6');
    expect(stat('g')).toContain('enabled: true');
    expect(stat('a')).toContain('points: 4');
    expect(stat('ppp')).toContain('points: 2');
    expect(stat('sog')).toContain('points: 0.9');
    expect(stat('blk')).toContain('points: 1');
    expect(stat('w')).toContain('points: 5');
    expect(stat('so')).toContain('points: 5');
    expect(stat('sv')).toContain('points: 0.6');
    expect(stat('ga')).toContain('points: -3');
    // opt-in categories ship disabled → ptsFor() writes 0 into the snapshot
    for (const id of ['shg', 'hit', 'pim', 'pm']) {
      expect(stat(id), `${id} must be an opt-in (disabled) category`).toContain('enabled: false');
    }
  });

  it('the server-side creation fallback matches', () => {
    const src = repo('server/src/services/LeagueService.ts');
    expect(src).toContain('goals: 6, assists: 4, power_play_points: 2, short_handed_points: 0,');
    expect(src).toContain('shots_on_goal: 0.9, blocks: 1, hits: 0, penalty_minutes: 0,');
    expect(src).toContain('goalie: { wins: 5, saves: 0.6, shutouts: 5, goals_against: -3 }');
  });

  it('the migration carries the same values into the DB homes', () => {
    const sql = repo('supabase/migrations/20260901150000_industry_standard_default_scoring.sql');
    // stat_catalog / global rules VALUES lists
    expect(sql).toContain("('goals',               6.0)");
    expect(sql).toContain("('shots_on_goal',       0.9)");
    expect(sql).toContain("('goals_against',      -3.0)");
    expect(sql).toContain("('short_handed_points', 0.0)");
    // leagues.scoring_settings column default
    expect(sql).toContain('"wins": 5, "saves": 0.6, "shutouts": 5, "goals_against": -3');
    // the projection rebuilds score with the new weights AND include GA
    expect(sql).toContain('r.r_ga*r.rem_starts*(-3.0)');
    expect(sql).toContain('pr.r_ga*(-3.0)');
    expect(sql).toContain('r.r_goal*r.rem_gp*6.0');
  });

  it('the Python pipeline defaults match', () => {
    const simulate = repo('data-pipeline/scoring/simulate_matchups.py');
    expect(simulate).toContain('"goals": 6.0');
    expect(simulate).toContain('"goals_against": -3.0');
    const daily = repo('data-pipeline/projections/run_daily_projections.py');
    expect(daily).toContain('"shots_on_goal": 0.9');
    expect(daily).toContain('"wins": 5');
    const matchups = repo('data-pipeline/scoring/calculate_matchup_scores.py');
    expect(matchups).toContain('"saves": 0.6');
    expect(matchups).toContain('"short_handed_points": 0');
  });

  it('the secondary TS homes match too (BASE_STATS ×2, commissioner form fallbacks)', () => {
    for (const p of ['apps/web/src/types/leagueTypes.ts', 'packages/shared/src/types/league.ts']) {
      const src = repo(p);
      expect(src, p).toContain('{ id: "g", name: "Goals", points: 6,');
      expect(src, p).toContain('{ id: "sv", name: "Saves", points: 0.6,');
      expect(src, p).toContain('{ id: "ga", name: "Goals Against", points: -3,');
      expect(src, p).toContain('{ id: "hit", name: "Hits", points: 0.5, default: false, category: "Defense", enabled: false }');
    }
    const profile = repo('apps/web/src/pages/Profile.tsx');
    expect(profile).toContain("{ key: 'goals', label: 'Goals', default: 6 }");
    expect(profile).toContain("{ key: 'goals_against', label: 'Goals Against', default: -3 }");
  });

  it('every ROS consumer that rescores goalies feeds goals-against (review defect, 2026-09-01)', () => {
    // The draft board hard-coded goals_against: 0 while rescoring ROS rows
    // under league settings — under GA -3 that overstated a 55-start goalie
    // by ~480 pts. The route must serve the column and the board must use it.
    expect(repo('server/src/routes/players.ts')).toContain('projected_shutouts_ros, projected_ga_ros');
    expect(repo('apps/web/src/pages/DraftRoom.tsx')).toContain('goals_against: p.projected_ga_ros || 0');
    expect(repo('server/src/services/TeamAnalyticsService.ts')).toContain('num(p.projected_ga_ros)');
  });

  it('Stormy tells users the real defaults', () => {
    const prompt = repo('server/src/lib/stormy/systemPrompt.ts');
    expect(prompt).toContain('Goals 6 | Assists 4 | PPP +2 | SOG 0.9 | BLK 1');
    expect(prompt).toContain('W 5 | SO 5 | SV 0.6 | GA −3');
  });

  it('the stale-cache fuse blew: CACHE_VERSION bumped past the old-scoring era', () => {
    const proj = repo('data-pipeline/projections/calculate_daily_projections.py');
    expect(proj).toContain('CACHE_VERSION = "4.0"');
  });
});
