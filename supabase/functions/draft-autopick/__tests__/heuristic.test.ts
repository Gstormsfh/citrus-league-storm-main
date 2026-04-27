// Deno tests for the Phase 4 autopick heuristic.
//
// Run with:
//   deno test supabase/functions/draft-autopick/__tests__/heuristic.test.ts
//
// These tests do NOT require a Supabase project, network, or database.
// The heuristic is pure; all dependencies (ScoringCalculator) are
// bundled via the relative re-export shim and exercised in-memory.
//
// Default scoring (per @citrus/shared/utils/scoring.DEFAULT_SCORING):
//   skater: goals=3, assists=2, ppp=1, shp=2, sog=0.4, blk=0.5, hit=0.2, pim=0.5
//   goalie: wins=4, shutouts=3, saves=0.2, goals_against=-1
// Tests exploit these weights to construct fixtures where the boost
// either does or does not flip the winner.

import {
  assertEquals,
  assertExists,
  assertStrictEquals,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts';

import {
  selectByHeuristic,
  type HeuristicPlayer,
} from '../heuristic.ts';

// ── Fixture builders ──────────────────────────────────────────────────

function skater(opts: Partial<HeuristicPlayer> & { id: number }): HeuristicPlayer {
  return {
    position: 'C',
    goals: 0, assists: 0, shots: 0, blocks: 0, hits: 0, pim: 0, ppp: 0, shp: 0,
    ...opts,
  };
}

function goalie(opts: Partial<HeuristicPlayer> & { id: number }): HeuristicPlayer {
  return {
    position: 'G',
    wins: 0, saves: 0, shutouts: 0, goals_against: 0,
    ...opts,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

Deno.test('returns null for empty undrafted list', () => {
  const result = selectByHeuristic({
    undraftedPlayers: [],
    teamPriorPositions: [],
  });
  assertStrictEquals(result, null);
});

Deno.test('returns the only player when list has size 1', () => {
  const only = skater({ id: 7, goals: 1 });
  const result = selectByHeuristic({
    undraftedPlayers: [only],
    teamPriorPositions: [],
  });
  assertExists(result);
  assertStrictEquals(result.selected, only);
});

Deno.test('all-zero stats still returns top-of-list (v1 behavior parity)', () => {
  // Three skaters, all 0 fpts. v1 returns the first after sort.
  const a = skater({ id: 1 });
  const b = skater({ id: 2 });
  const c = skater({ id: 3 });
  const result = selectByHeuristic({
    undraftedPlayers: [a, b, c],
    teamPriorPositions: [],
  });
  assertExists(result);
  // First-in-list wins on score-tie because the iteration uses strict
  // `>` (not `>=`) when comparing to current best.
  assertStrictEquals(result.selected, a);
  assertEquals(result.fpts, 0);
  assertEquals(result.score, 0);
});

Deno.test('goalie player uses goalie scoring path', () => {
  // Goalie with 10 wins should beat a skater with 5 goals when no
  // positional boost flips the result.
  // Skater (5 goals) → 5 * 3 = 15 fpts. Position 'C' is unfilled
  //   (default need 2, have 0) → 15 * 1.15 = 17.25.
  // Goalie (10 wins) → 10 * 4 = 40 fpts. Position 'G' is unfilled
  //   (default need 2, have 0) → 40 * 1.15 = 46.
  // Goalie wins.
  const sk = skater({ id: 100, position: 'C', goals: 5 });
  const gk = goalie({ id: 200, wins: 10 });

  const result = selectByHeuristic({
    undraftedPlayers: [sk, gk],
    teamPriorPositions: [],
  });
  assertExists(result);
  assertStrictEquals(result.selected, gk);
  assertEquals(result.fpts, 40);
});

Deno.test('positional boost applied to unfilled-position player', () => {
  // No prior picks on the team → all positions unfilled → all candidates
  // get the boost. This test verifies the boost flag flips on, not that
  // the boost flips a winner.
  const player = skater({ id: 1, position: 'C', goals: 10 });
  const result = selectByHeuristic({
    undraftedPlayers: [player],
    teamPriorPositions: [],
  });
  assertExists(result);
  assertStrictEquals(result.positionBoosted, true);
  assertEquals(result.fpts, 30);                 // 10 * 3
  assertEquals(result.score, 30 * 1.15);          // boost applied
});

Deno.test('positional boost flips winner when needed-position player has lower raw FPTS', () => {
  // Team has 2 C's already (filled at default need=2).
  // Position 'C' is FILLED → no boost on C picks.
  // Position 'LW' is UNFILLED → 15% boost on LW picks.
  // C candidate: 25 goals = 75 fpts (no boost).
  // LW candidate: 22 goals = 66 fpts (boosted: 75.9).
  // LW wins by virtue of the boost.
  const cPlayer  = skater({ id: 1, position: 'C',  goals: 25 });
  const lwPlayer = skater({ id: 2, position: 'LW', goals: 22 });

  const result = selectByHeuristic({
    undraftedPlayers: [cPlayer, lwPlayer],
    teamPriorPositions: ['C', 'C'],
  });
  assertExists(result);
  assertStrictEquals(result.selected, lwPlayer);
  assertStrictEquals(result.positionBoosted, true);
});

Deno.test('forward-format league collapses C/LW/RW into F', () => {
  // positionType='forward'. C/LW/RW all count toward the F slot.
  // Team has 6 forwards (any mix) → F is filled at default need 6.
  // D and G unfilled.
  // C candidate: 25 goals = 75 fpts (NO boost, F is filled).
  // D candidate: 20 goals = 60 fpts (BOOST applied, D is unfilled).
  //   Boosted: 60 * 1.15 = 69.
  // C still wins (75 > 69) — sanity check that forward collapse
  // routed the boost to D, not to C.
  const cPlayer = skater({ id: 1, position: 'C', goals: 25 });
  const dPlayer = skater({ id: 2, position: 'D', goals: 20 });

  const result = selectByHeuristic({
    undraftedPlayers: [cPlayer, dPlayer],
    teamPriorPositions: ['C', 'LW', 'RW', 'C', 'LW', 'RW'], // 6 forwards
    leagueSettings: { positionType: 'forward' },
  });
  assertExists(result);
  assertStrictEquals(result.selected, cPlayer);
  // C's leaguePos is F (collapsed); F is filled → no boost on C.
  assertStrictEquals(result.positionBoosted, false);
});

Deno.test('forward-format league boosts an F candidate when F still unfilled', () => {
  // positionType='forward'. Team has 5 forwards (one short of need=6).
  // F unfilled → boost on any C/LW/RW candidate.
  const cPlayer = skater({ id: 1, position: 'C', goals: 10 });

  const result = selectByHeuristic({
    undraftedPlayers: [cPlayer],
    teamPriorPositions: ['C', 'C', 'LW', 'RW', 'C'],  // 5 forwards
    leagueSettings: { positionType: 'forward' },
  });
  assertExists(result);
  assertStrictEquals(result.positionBoosted, true);
});

Deno.test('rosterSlots overrides fallback needs', () => {
  // Override C need to 4. Team has 2 C's. C is still unfilled (2 < 4).
  // Without override (default need 2), C would be filled.
  const cPlayer = skater({ id: 1, position: 'C', goals: 1 });

  const result = selectByHeuristic({
    undraftedPlayers: [cPlayer],
    teamPriorPositions: ['C', 'C'],
    leagueSettings: { rosterSlots: { C: 4, LW: 2, RW: 2, D: 4, G: 2 } },
  });
  assertExists(result);
  assertStrictEquals(result.positionBoosted, true);
});

Deno.test('depth bonus extends boost set when all starters are full', () => {
  // 'individual' format. Default starter needs total: 2+2+2+4+2 = 12.
  // Default depth bonus:                              1+1+1+2+1 =  6.
  // Team has exactly the 12 starters filled. All starters full →
  // depth bonus kicks in, every position cap = starter+depth.
  // C cap = 2+1 = 3. Team has 2 C's → C is in unfilledPositions
  //   (boost re-enabled).
  // We give the candidate one C with low fpts and one D with higher
  // fpts; since BOTH positions are now in unfilledPositions, both
  // get the boost — D wins on raw FPTS.
  const cPlayer = skater({ id: 1, position: 'C', goals: 5 });   // 15 raw, 17.25 boosted
  const dPlayer = skater({ id: 2, position: 'D', goals: 8 });   // 24 raw, 27.6 boosted

  const result = selectByHeuristic({
    undraftedPlayers: [cPlayer, dPlayer],
    teamPriorPositions: [
      'C','C', 'LW','LW', 'RW','RW',
      'D','D','D','D',
      'G','G',
    ], // exactly 12 starters
  });
  assertExists(result);
  // Both positions boosted; D wins on higher raw FPTS.
  assertStrictEquals(result.selected, dPlayer);
  assertStrictEquals(result.positionBoosted, true);
});

Deno.test('position normalization handles null position (defaults to C in individual format)', () => {
  // A player with null position is treated as 'C' (individual format
  // default) per v1. Team has 2 C's → 'C' is filled → no boost.
  const unknown = skater({ id: 1, position: null, goals: 10 });

  const result = selectByHeuristic({
    undraftedPlayers: [unknown],
    teamPriorPositions: ['C', 'C'],
  });
  assertExists(result);
  assertStrictEquals(result.positionBoosted, false);
});

Deno.test('custom scoring settings change FPTS calculation', () => {
  // Custom scoring: goals worth 10 instead of default 3. A 1-goal
  // player should score 10, not 3.
  const player = skater({ id: 1, goals: 1 });

  const result = selectByHeuristic({
    undraftedPlayers: [player],
    teamPriorPositions: [],
    leagueScoring: {
      skater: {
        goals: 10, assists: 2, power_play_points: 1, short_handed_points: 2,
        shots_on_goal: 0.4, blocks: 0.5, hits: 0.2, penalty_minutes: 0.5,
      },
      goalie: {
        wins: 4, shutouts: 3, saves: 0.2, goals_against: -1,
      },
    },
  });
  assertExists(result);
  assertEquals(result.fpts, 10);  // not 3
});
