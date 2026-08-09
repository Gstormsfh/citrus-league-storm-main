// T14 architect Entry 13 — offline exhaustive tests for the draft
// guide computation core.

import { describe, it, expect } from 'vitest';
import {
  reweightProjections,
  computeTiers,
  scarcityByPosition,
  type PlayerProjection,
  type RosterShape,
} from '../draftGuide';
import type { ScoringSettings } from '../scoring';
import { DEFAULT_SCORING } from '../scoring';

// ── Fixtures ──────────────────────────────────────────────────────

const CITRUS_ROSTER: RosterShape = { C: 2, LW: 2, RW: 2, D: 4, G: 2 };

const mkSkater = (id: number, name: string, position: string, stats: Partial<PlayerProjection>): PlayerProjection => ({
  playerId: id,
  playerName: name,
  position,
  isGoalie: false,
  ...stats,
});

const mkGoalie = (id: number, name: string, stats: Partial<PlayerProjection>): PlayerProjection => ({
  playerId: id,
  playerName: name,
  position: 'G',
  isGoalie: true,
  ...stats,
});

// ── reweightProjections ───────────────────────────────────────────

describe('reweightProjections — happy path', () => {
  it('computes skater points using default scoring', () => {
    const proj = mkSkater(1, 'A', 'C', {
      goals: 40, assists: 60, power_play_points: 30, short_handed_points: 5,
      shots_on_goal: 300, blocks: 40, hits: 50, penalty_minutes: 20,
    });
    const [out] = reweightProjections([proj], DEFAULT_SCORING);
    // 40*3 + 60*2 + 30*1 + 5*2 + 300*0.4 + 40*0.5 + 50*0.2 + 20*0.5
    // = 120 + 120 + 30 + 10 + 120 + 20 + 10 + 10 = 440
    expect(out.projectedPoints).toBeCloseTo(440, 5);
  });

  it('computes goalie points using default scoring', () => {
    const proj = mkGoalie(2, 'Goalie', { wins: 35, shutouts: 5, saves: 1500, goals_against: 100 });
    const [out] = reweightProjections([proj], DEFAULT_SCORING);
    // 35*4 + 5*3 + 1500*0.2 + 100*(-1) = 140 + 15 + 300 - 100 = 355
    expect(out.projectedPoints).toBeCloseTo(355, 5);
  });

  it('assigns 1-indexed rank in DESC point order', () => {
    const rows = [
      mkSkater(1, 'Low', 'C', { goals: 10 }),
      mkSkater(2, 'High', 'C', { goals: 50 }),
      mkSkater(3, 'Mid', 'C', { goals: 30 }),
    ];
    const out = reweightProjections(rows, DEFAULT_SCORING);
    expect(out.map((p) => p.playerName)).toEqual(['High', 'Mid', 'Low']);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it('breaks ties by playerId ASC for deterministic ordering', () => {
    const rows = [
      mkSkater(5, 'Tied Y', 'C', { goals: 30 }),
      mkSkater(3, 'Tied X', 'C', { goals: 30 }),
      mkSkater(9, 'Tied Z', 'C', { goals: 30 }),
    ];
    const out = reweightProjections(rows, DEFAULT_SCORING);
    expect(out.map((p) => p.playerId)).toEqual([3, 5, 9]);
  });
});

describe('reweightProjections — settings edge cases', () => {
  it('missing categories in scoring settings → treated as 0-weighted', () => {
    // Partial settings: only goals matter.
    const partial: ScoringSettings = {
      skater: { goals: 6 } as unknown as ScoringSettings['skater'],
      goalie: {} as unknown as ScoringSettings['goalie'],
    };
    const rows = [
      mkSkater(1, 'A', 'C', { goals: 10, assists: 100 }), // assists ignored
      mkSkater(2, 'B', 'C', { goals: 20 }),
    ];
    const out = reweightProjections(rows, partial);
    expect(out[0].playerId).toBe(2);
    expect(out[0].projectedPoints).toBe(120);
    expect(out[1].playerId).toBe(1);
    expect(out[1].projectedPoints).toBe(60);
  });

  it('null / undefined category values → treated as 0', () => {
    const rows = [
      mkSkater(1, 'A', 'C', { goals: null }),
      mkSkater(2, 'B', 'C', {}),
    ];
    const out = reweightProjections(rows, DEFAULT_SCORING);
    expect(out.every((p) => p.projectedPoints === 0)).toBe(true);
  });

  it('negative projected points allowed (net-negative players at bottom)', () => {
    const rows = [
      mkGoalie(1, 'Bad', { wins: 0, shutouts: 0, saves: 100, goals_against: 200 }),
      mkGoalie(2, 'Good', { wins: 30, shutouts: 3, saves: 1000, goals_against: 80 }),
    ];
    const out = reweightProjections(rows, DEFAULT_SCORING);
    // Bad: 0*4 + 0*3 + 100*0.2 + 200*-1 = 20 - 200 = -180
    // Good: 30*4 + 3*3 + 1000*0.2 + 80*-1 = 120 + 9 + 200 - 80 = 249
    expect(out[0].playerName).toBe('Good');
    expect(out[1].projectedPoints).toBe(-180);
  });

  it('empty projections list → returns []', () => {
    expect(reweightProjections([], DEFAULT_SCORING)).toEqual([]);
  });
});

// ── computeTiers ──────────────────────────────────────────────────

describe('computeTiers — happy path', () => {
  it('always includes the largest-magnitude cliff among tier boundaries', () => {
    // Setup: 24 players with VARIED gaps so the top-K-by-magnitude
    // heuristic surfaces distinct cliffs (not tied-on-magnitude ties).
    //   ranks 1-3:  points 100, 98, 96   (gap 2)
    //   ranks 4-8:  points 94, 92, 90, 88, 86   (gap 2)
    //   rank 8→9:   drop 40 (the HUGE cliff)
    //   ranks 9-16: points 46, 44, 42, ... 32   (gap 2)
    //   rank 16→17: drop 20 (second cliff)
    //   ranks 17-24: points 12, 11.5, 11, ... 8.5  (gap 0.5)
    const shape: RosterShape = { X: 2 }; // 24 total demand for 12-league
    const points: number[] = [];
    for (let i = 0; i < 8; i++) points.push(100 - i * 2);   // 100..86
    for (let i = 0; i < 8; i++) points.push(46 - i * 2);     // 46..32
    for (let i = 0; i < 8; i++) points.push(12 - i * 0.5);   // 12..8.5
    const ranked = points.map((pts, i) => ({
      playerId: i + 1,
      playerName: `P${i + 1}`,
      position: 'X',
      isGoalie: false,
      projectedPoints: pts,
      rank: i + 1,
    }));
    const tiers = computeTiers(ranked, 12, shape);
    // K = ceil(24/12) = 2 cliffs → 3 tiers.
    expect(tiers).toHaveLength(3);
    // The LARGEST cliff (40-point drop at rank 8→9) MUST be a
    // boundary. That means SOME tier ends at rank 8 with
    // cliffMagnitude=40.
    const largestCliff = tiers.find((t) => t.cliffMagnitude !== null && Math.abs(t.cliffMagnitude - 40) < 0.001);
    expect(largestCliff).toBeDefined();
    expect(largestCliff!.endRank).toBe(8);
  });

  it('final tier has cliffMagnitude=null', () => {
    const shape: RosterShape = { X: 2 };
    const ranked = Array.from({ length: 10 }, (_, i) => ({
      playerId: i + 1, playerName: `P${i}`, position: 'X', isGoalie: false,
      projectedPoints: 100 - i, rank: i + 1,
    }));
    const tiers = computeTiers(ranked, 12, shape);
    expect(tiers[tiers.length - 1].cliffMagnitude).toBeNull();
  });
});

describe('computeTiers — zero-size guards', () => {
  it('leagueSize=0 → returns []', () => {
    const ranked = [{ playerId: 1, playerName: 'A', position: 'C', isGoalie: false, projectedPoints: 100, rank: 1 }];
    expect(computeTiers(ranked, 0, CITRUS_ROSTER)).toEqual([]);
  });

  it('empty rosterShape → returns [] (perTeamDemand=0)', () => {
    const ranked = [{ playerId: 1, playerName: 'A', position: 'C', isGoalie: false, projectedPoints: 100, rank: 1 }];
    expect(computeTiers(ranked, 12, {})).toEqual([]);
  });

  it('empty ranked list → returns []', () => {
    expect(computeTiers([], 12, CITRUS_ROSTER)).toEqual([]);
  });

  it('single-player pool → 1 tier with 1 player', () => {
    const ranked = [{ playerId: 1, playerName: 'A', position: 'C', isGoalie: false, projectedPoints: 100, rank: 1 }];
    const tiers = computeTiers(ranked, 1, { C: 1 });
    expect(tiers).toHaveLength(1);
    expect(tiers[0].players).toHaveLength(1);
    expect(tiers[0].cliffMagnitude).toBeNull();
  });

  it('ranked list larger than startable pool → only pool considered', () => {
    // 100 players, 12-team × 2-slot = 24 pool.
    const ranked = Array.from({ length: 100 }, (_, i) => ({
      playerId: i + 1, playerName: `P${i}`, position: 'X', isGoalie: false,
      projectedPoints: 100 - i, rank: i + 1,
    }));
    const shape: RosterShape = { X: 2 };
    const tiers = computeTiers(ranked, 12, shape);
    // All tiers combined must include exactly 24 players.
    const totalIncluded = tiers.reduce((sum, t) => sum + t.players.length, 0);
    expect(totalIncluded).toBe(24);
  });
});

// ── scarcityByPosition ────────────────────────────────────────────

describe('scarcityByPosition — happy path', () => {
  it('supply/demand ratio computed per position', () => {
    const shape: RosterShape = { C: 2, D: 4 };
    const ranked = [
      { playerId: 1, playerName: 'A', position: 'C', isGoalie: false, projectedPoints: 100, rank: 1 },
      { playerId: 2, playerName: 'B', position: 'C', isGoalie: false, projectedPoints: 90, rank: 2 },
      { playerId: 3, playerName: 'C', position: 'C', isGoalie: false, projectedPoints: 80, rank: 3 },
      { playerId: 4, playerName: 'D', position: 'D', isGoalie: false, projectedPoints: 70, rank: 4 },
      { playerId: 5, playerName: 'E', position: 'D', isGoalie: false, projectedPoints: 60, rank: 5 },
    ];
    const out = scarcityByPosition(ranked, shape);
    // C: supply=3, demand=2 → 1.5
    // D: supply=2, demand=4 → 0.5
    const cRow = out.find((r) => r.position === 'C')!;
    const dRow = out.find((r) => r.position === 'D')!;
    expect(cRow.ratio).toBe(1.5);
    expect(dRow.ratio).toBe(0.5);
    // Sorted by ratio ASC (D=0.5 before C=1.5).
    expect(out.map((r) => r.position)).toEqual(['D', 'C']);
  });

  it('supply=0 → ratio=0 (extreme scarcity)', () => {
    const shape: RosterShape = { G: 2 };
    const out = scarcityByPosition([], shape);
    expect(out[0].ratio).toBe(0);
  });

  it('demand=0 → ratio=Infinity (not a concern)', () => {
    const shape: RosterShape = { C: 0 };
    const ranked = [
      { playerId: 1, playerName: 'A', position: 'C', isGoalie: false, projectedPoints: 100, rank: 1 },
    ];
    const out = scarcityByPosition(ranked, shape);
    expect(out[0].ratio).toBe(Infinity);
  });

  it('empty rosterShape → returns []', () => {
    expect(scarcityByPosition([], {})).toEqual([]);
  });

  it('multi-position eligibility NOT modeled — primary position only', () => {
    // Two "C" players; downstream policy handles cross-eligibility.
    const shape: RosterShape = { C: 1, LW: 1 };
    const ranked = [
      { playerId: 1, playerName: 'A', position: 'C', isGoalie: false, projectedPoints: 100, rank: 1 },
      { playerId: 2, playerName: 'B', position: 'C', isGoalie: false, projectedPoints: 90, rank: 2 },
    ];
    const out = scarcityByPosition(ranked, shape);
    expect(out.find((r) => r.position === 'LW')!.supply).toBe(0);
    expect(out.find((r) => r.position === 'C')!.supply).toBe(2);
  });
});
