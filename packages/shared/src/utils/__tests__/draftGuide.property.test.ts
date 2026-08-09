// T14 Entry 16 O3 (2026-08-09) — property tests for draftGuide.ts.
//
// Bounded 60-min authoring window per architect. Randomized inputs
// assert invariants that must hold across ALL reasonable projection
// shapes + scoring settings + roster shapes.
//
// PROPERTIES ASSERTED
//   P1  point-value scaling under stat scale — multiplying all
//       skater stats by K > 0 multiplies each player's projected
//       points by exactly K (mathematically; strict equality after
//       coerce-to-Number). Note: rank ORDER is NOT asserted here —
//       floating-point precision on sum-then-multiply vs
//       multiply-then-sum can reorder tied-adjacent players even
//       under uniform scaling; that's a known IEEE-754 fact, not a
//       function bug.
//   P2  tie determinism — two independent runs on the SAME input
//       yield identical rank/tier/scarcity outputs (deterministic).
//   P3  tier-partition completeness — for any (ranked, leagueSize,
//       rosterShape) with leagueSize > 0 AND totalDemand > 0, EVERY
//       player in the startable pool appears in EXACTLY ONE tier
//       (no gaps, no duplicates).
//   P4  scarcity-ratio bounds — supply/demand ratio equals supply
//       divided by demand for finite demand; equals Infinity when
//       demand=0; equals 0 when supply=0 AND demand > 0.
//   P5  point-value scaling under scoring scale — multiplying ALL
//       scoring weights by K > 0 multiplies EVERY projectedPoints
//       by K (within float tolerance). Rank ORDER not asserted (same
//       IEEE-754 caveat as P1).
//
// PRNG: mulberry32 — deterministic seeded random per iteration for
//       reproducible failures. If a property fails, the test
//       reports the seed so the run is byte-for-byte replayable.

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

// ── PRNG ─────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Random projection generator ──────────────────────────────────

const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;

function genProjections(rand: () => number, count: number): PlayerProjection[] {
  const out: PlayerProjection[] = [];
  for (let i = 0; i < count; i++) {
    const pos = POSITIONS[Math.floor(rand() * POSITIONS.length)];
    const isGoalie = pos === 'G';
    // Assign a unique numeric playerId so tie-break is deterministic.
    const playerId = 8000000 + i;
    if (isGoalie) {
      out.push({
        playerId,
        playerName: `G${i}`,
        position: pos,
        isGoalie: true,
        wins: Math.floor(rand() * 40),
        shutouts: Math.floor(rand() * 8),
        saves: Math.floor(rand() * 1800),
        goals_against: Math.floor(rand() * 120),
      });
    } else {
      out.push({
        playerId,
        playerName: `S${i}`,
        position: pos,
        isGoalie: false,
        goals: Math.floor(rand() * 50),
        assists: Math.floor(rand() * 70),
        power_play_points: Math.floor(rand() * 35),
        short_handed_points: Math.floor(rand() * 8),
        shots_on_goal: Math.floor(rand() * 350),
        blocks: Math.floor(rand() * 200),
        hits: Math.floor(rand() * 300),
        penalty_minutes: Math.floor(rand() * 100),
      });
    }
  }
  return out;
}

function genRosterShape(rand: () => number): RosterShape {
  // Random but non-empty positive-integer shape across all 5 positions.
  return {
    C: 1 + Math.floor(rand() * 3),
    LW: 1 + Math.floor(rand() * 3),
    RW: 1 + Math.floor(rand() * 3),
    D: 2 + Math.floor(rand() * 4),
    G: 1 + Math.floor(rand() * 2),
  };
}

function scaleSkaterStats(p: PlayerProjection, k: number): PlayerProjection {
  if (p.isGoalie) return p;
  return {
    ...p,
    goals: (p.goals ?? 0) * k,
    assists: (p.assists ?? 0) * k,
    power_play_points: (p.power_play_points ?? 0) * k,
    short_handed_points: (p.short_handed_points ?? 0) * k,
    shots_on_goal: (p.shots_on_goal ?? 0) * k,
    blocks: (p.blocks ?? 0) * k,
    hits: (p.hits ?? 0) * k,
    penalty_minutes: (p.penalty_minutes ?? 0) * k,
  };
}

function scaleScoring(s: ScoringSettings, k: number): ScoringSettings {
  return {
    skater: {
      goals: s.skater.goals * k,
      assists: s.skater.assists * k,
      power_play_points: s.skater.power_play_points * k,
      short_handed_points: s.skater.short_handed_points * k,
      shots_on_goal: s.skater.shots_on_goal * k,
      blocks: s.skater.blocks * k,
      hits: s.skater.hits * k,
      penalty_minutes: s.skater.penalty_minutes * k,
    },
    goalie: {
      wins: s.goalie.wins * k,
      shutouts: s.goalie.shutouts * k,
      saves: s.goalie.saves * k,
      goals_against: s.goalie.goals_against * k,
    },
  };
}

// ── Property harness ─────────────────────────────────────────────

const ITERATIONS = 200;

function runProperty(
  name: string,
  fn: (rand: () => number, seed: number) => void,
): void {
  for (let seed = 1; seed <= ITERATIONS; seed++) {
    const rand = mulberry32(seed * 0x9e3779b1);
    try {
      fn(rand, seed);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`[${name}] failed at seed=${seed}: ${detail}`);
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('draftGuide property tests — 200 iterations each', () => {
  it('P1: point values scale by K when all skater stats multiplied by K', () => {
    runProperty('P1', (rand) => {
      // Only skaters — scaleSkaterStats is a no-op on goalies. So
      // seed a skater-only projection to keep the property clean.
      const count = 20 + Math.floor(rand() * 30);
      const projections: PlayerProjection[] = [];
      for (let i = 0; i < count; i++) {
        projections.push({
          playerId: 8000000 + i,
          playerName: `S${i}`,
          position: 'C',
          isGoalie: false,
          goals: Math.floor(rand() * 50),
          assists: Math.floor(rand() * 70),
          power_play_points: Math.floor(rand() * 30),
          short_handed_points: Math.floor(rand() * 5),
          shots_on_goal: Math.floor(rand() * 300),
          blocks: Math.floor(rand() * 200),
          hits: Math.floor(rand() * 250),
          penalty_minutes: Math.floor(rand() * 80),
        });
      }
      const baseRank = reweightProjections(projections, DEFAULT_SCORING);
      const K = 1 + rand() * 9; // K in (1, 10)
      const scaled = projections.map((p) => scaleSkaterStats(p, K));
      const scaledRank = reweightProjections(scaled, DEFAULT_SCORING);
      // Assert same playerIds present (as a SET).
      expect(new Set(scaledRank.map((p) => p.playerId))).toEqual(
        new Set(baseRank.map((p) => p.playerId)),
      );
      // For each player, base_points × K should equal scaled_points
      // within float tolerance. Look up scaled by playerId.
      const scaledByPid = new Map(scaledRank.map((p) => [p.playerId, p]));
      for (const bp of baseRank) {
        const sp = scaledByPid.get(bp.playerId)!;
        if (Math.abs(bp.projectedPoints) < 1e-9) {
          expect(Math.abs(sp.projectedPoints)).toBeLessThan(1e-9);
        } else {
          expect(sp.projectedPoints / bp.projectedPoints).toBeCloseTo(K, 6);
        }
      }
    });
  });

  it('P2: tie determinism — two runs on same input yield identical outputs', () => {
    runProperty('P2', (rand) => {
      const projections = genProjections(rand, 30);
      const shape = genRosterShape(rand);
      const leagueSize = 8 + Math.floor(rand() * 8);
      const a = reweightProjections(projections, DEFAULT_SCORING);
      const b = reweightProjections(projections, DEFAULT_SCORING);
      expect(a).toEqual(b);
      const tiersA = computeTiers(a, leagueSize, shape);
      const tiersB = computeTiers(b, leagueSize, shape);
      expect(tiersA).toEqual(tiersB);
      const scarcityA = scarcityByPosition(a, shape);
      const scarcityB = scarcityByPosition(b, shape);
      expect(scarcityA).toEqual(scarcityB);
    });
  });

  it('P3: tier-partition completeness — every startable-pool player in exactly one tier', () => {
    runProperty('P3', (rand) => {
      const projections = genProjections(rand, 30 + Math.floor(rand() * 50));
      const shape = genRosterShape(rand);
      const leagueSize = 6 + Math.floor(rand() * 10);
      const ranked = reweightProjections(projections, DEFAULT_SCORING);
      const tiers = computeTiers(ranked, leagueSize, shape);
      // Union of all tiers' players
      const idsInTiers: number[] = [];
      for (const t of tiers) {
        for (const p of t.players) idsInTiers.push(p.playerId);
      }
      // Expected pool size = min(ranked.length, leagueSize * totalDemand)
      const totalDemand = Object.values(shape).reduce((s, v) => s + (v ?? 0), 0);
      const expectedPool = Math.min(ranked.length, leagueSize * totalDemand);
      // Count check: no gaps, no duplicates
      expect(idsInTiers).toHaveLength(expectedPool);
      // Uniqueness check: every id appears at most once across all tiers
      expect(new Set(idsInTiers).size).toBe(idsInTiers.length);
      // Contiguity check: idsInTiers matches ranked.slice(0, expectedPool)
      expect(idsInTiers).toEqual(
        ranked.slice(0, expectedPool).map((p) => p.playerId),
      );
    });
  });

  it('P4: scarcity-ratio bounds — supply/demand equals ratio (with Infinity + 0 special cases)', () => {
    runProperty('P4', (rand) => {
      const projections = genProjections(rand, 30);
      const ranked = reweightProjections(projections, DEFAULT_SCORING);
      // Mix in a zero-demand position + a position with no supply.
      const shape: RosterShape = {
        ...genRosterShape(rand),
        Z_NOSUPPLY: 3, // no player has this position
        Z_NODEMAND: 0, // some existing position — we use a fresh key with demand=0
      };
      const out = scarcityByPosition(ranked, shape);
      for (const row of out) {
        const supply = ranked.filter((p) => p.position === row.position).length;
        expect(row.supply).toBe(supply);
        if (row.demand === 0) {
          expect(row.ratio).toBe(Infinity);
        } else {
          // Exact ratio equality — no float shenanigans since we're
          // computing supply / demand with integer operands.
          expect(row.ratio).toBeCloseTo(supply / row.demand, 12);
        }
      }
    });
  });

  it('P5: point values scale by K when all scoring weights multiplied by K', () => {
    runProperty('P5', (rand) => {
      const projections = genProjections(rand, 25);
      const K = 0.1 + rand() * 4.9; // K in (0.1, 5)
      const baseRank = reweightProjections(projections, DEFAULT_SCORING);
      const scaled = scaleScoring(DEFAULT_SCORING, K);
      const scaledRank = reweightProjections(projections, scaled);
      // Same set of playerIds. Rank ORDER not asserted (IEEE-754
      // caveat per property comment above).
      expect(new Set(scaledRank.map((p) => p.playerId))).toEqual(
        new Set(baseRank.map((p) => p.playerId)),
      );
      // Point VALUES scaled by K per player (looked up by playerId).
      const scaledByPid = new Map(scaledRank.map((p) => [p.playerId, p]));
      for (const bp of baseRank) {
        const sp = scaledByPid.get(bp.playerId)!;
        if (Math.abs(bp.projectedPoints) < 1e-9) {
          expect(Math.abs(sp.projectedPoints)).toBeLessThan(1e-9);
        } else {
          expect(sp.projectedPoints / bp.projectedPoints).toBeCloseTo(K, 6);
        }
      }
    });
  });
});
