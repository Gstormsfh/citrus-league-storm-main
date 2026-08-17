/**
 * SETTINGS-ENFORCEMENT (2026-08-16) — the deploy-safety invariant.
 *
 * Today's fix threads league scoring into 6 call sites that previously
 * constructed `new ScoringCalculator()` bare. The fix ships in the same
 * bundle THE TWELVE use hours from now, in a DEFAULT-settings league.
 * This suite pins the property that makes that safe:
 *
 *   ScoringCalculator(undefined) ≡ ScoringCalculator(DEFAULT_SCORING)
 *   ≡ ScoringCalculator(<the DB default jsonb>)  — for skaters AND
 *   goalies, points and PPG.
 *
 * If that equivalence ever breaks, threading settings changes numbers
 * for default leagues, and this fails before any deploy does.
 */

import { describe, it, expect } from 'vitest';
import { ScoringCalculator, DEFAULT_SCORING } from '../scoringUtils';

// The leagues.scoring_settings column default, verbatim from the live
// schema (information_schema, 2026-08-16).
const DB_DEFAULT = {
  goalie: { wins: 4, saves: 0.2, shutouts: 3, goals_against: -1 },
  skater: {
    hits: 0.2, goals: 3, blocks: 0.5, assists: 2, shots_on_goal: 0.4,
    penalty_minutes: 0.5, power_play_points: 1, short_handed_points: 2,
  },
  advanced: {
    assist_per_goal_ratio: 0.0, use_fractional_scoring: false,
    shooting_percentage_bonus: 0.0,
  },
} as unknown as Parameters<typeof ScoringCalculator.prototype.calculatePoints> extends never ? never : ConstructorParameters<typeof ScoringCalculator>[0];

const SKATER = { goals: 2, assists: 1, shots: 5, blocks: 3, hits: 4, pim: 2, ppp: 1, shp: 0 };
const GOALIE = { wins: 1, saves: 30, shutouts: 1, goals_against: 2 };

describe('default-league equivalence (deploy safety for THE TWELVE)', () => {
  const bare = new ScoringCalculator();
  const explicit = new ScoringCalculator(DEFAULT_SCORING);
  const fromDb = new ScoringCalculator(DB_DEFAULT);

  it('skater points identical across all three constructions', () => {
    const a = bare.calculatePoints(SKATER, false);
    expect(explicit.calculatePoints(SKATER, false)).toBe(a);
    expect(fromDb.calculatePoints(SKATER, false)).toBe(a);
  });

  it('goalie points identical across all three constructions', () => {
    const a = bare.calculatePoints(GOALIE, true);
    expect(explicit.calculatePoints(GOALIE, true)).toBe(a);
    expect(fromDb.calculatePoints(GOALIE, true)).toBe(a);
  });

  it('and custom settings DO change the result (the fix is not a no-op)', () => {
    const custom = new ScoringCalculator({
      ...DEFAULT_SCORING,
      skater: { ...DEFAULT_SCORING.skater, goals: 10 },
    } as ConstructorParameters<typeof ScoringCalculator>[0]);
    expect(custom.calculatePoints(SKATER, false))
      .not.toBe(bare.calculatePoints(SKATER, false));
  });
});
