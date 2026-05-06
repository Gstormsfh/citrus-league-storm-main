// Phase 4.5 chunk 11g.4 step 6a — draftOrderGenerator tests.
//
// Two test groups:
//   1. Spot checks — small configurations with known-correct expected
//      output. Tight assertions on exact slot shape.
//   2. Property-based sweep — realistic configurations (8×15, 10×16,
//      12×16, 14×20, 16×25), assert structural invariants hold for
//      every config: every team appears exactly totalRounds times,
//      pickNumbers are unique and form a contiguous 1..N sequence,
//      snake reverses correctly at every odd→even round boundary,
//      total slot count = teamCount × totalRounds.
//
// The utility is NOT on the production path (production loads from
// `public.draft_order` per chunk-6a recon Path B); these tests
// document the snake/linear semantic and provide test fixtures.

import { describe, it, expect } from 'vitest';
import { generateDraftOrder } from '../draftOrderGenerator';

// ── Spot checks ──────────────────────────────────────────────────────

describe('generateDraftOrder spot checks (chunk 11g.4 step 6a)', () => {
  it('snake 3 teams × 3 rounds (9 picks) — exact reversal pattern', () => {
    const slots = generateDraftOrder(['A', 'B', 'C'], 3, 'snake');
    expect(slots).toEqual([
      // Round 1: forward (A, B, C)
      { round: 1, pickNumber: 1, teamId: 'A' },
      { round: 1, pickNumber: 2, teamId: 'B' },
      { round: 1, pickNumber: 3, teamId: 'C' },
      // Round 2: reverse (C, B, A)
      { round: 2, pickNumber: 4, teamId: 'C' },
      { round: 2, pickNumber: 5, teamId: 'B' },
      { round: 2, pickNumber: 6, teamId: 'A' },
      // Round 3: forward again (A, B, C)
      { round: 3, pickNumber: 7, teamId: 'A' },
      { round: 3, pickNumber: 8, teamId: 'B' },
      { round: 3, pickNumber: 9, teamId: 'C' },
    ]);
  });

  it('linear 3 teams × 3 rounds (9 picks) — every round forward', () => {
    const slots = generateDraftOrder(['A', 'B', 'C'], 3, 'linear');
    expect(slots).toEqual([
      { round: 1, pickNumber: 1, teamId: 'A' },
      { round: 1, pickNumber: 2, teamId: 'B' },
      { round: 1, pickNumber: 3, teamId: 'C' },
      { round: 2, pickNumber: 4, teamId: 'A' },
      { round: 2, pickNumber: 5, teamId: 'B' },
      { round: 2, pickNumber: 6, teamId: 'C' },
      { round: 3, pickNumber: 7, teamId: 'A' },
      { round: 3, pickNumber: 8, teamId: 'B' },
      { round: 3, pickNumber: 9, teamId: 'C' },
    ]);
  });

  it('snake 1 round (no reversal possible) — equivalent to linear', () => {
    const snake = generateDraftOrder(['A', 'B', 'C'], 1, 'snake');
    const linear = generateDraftOrder(['A', 'B', 'C'], 1, 'linear');
    expect(snake).toEqual(linear);
  });

  it('snake 2 teams × 4 rounds — alternating reversal pattern', () => {
    const slots = generateDraftOrder(['A', 'B'], 4, 'snake');
    expect(slots.map((s) => s.teamId)).toEqual([
      'A', 'B', // round 1 forward
      'B', 'A', // round 2 reverse
      'A', 'B', // round 3 forward
      'B', 'A', // round 4 reverse
    ]);
  });

  it('throws on auction format', () => {
    expect(() => generateDraftOrder(['A', 'B'], 3, 'auction')).toThrow(
      /auction format does not use deterministic pick order/,
    );
  });

  it('throws on empty teamIds or non-positive totalRounds', () => {
    expect(() => generateDraftOrder([], 3, 'snake')).toThrow(/non-empty/);
    expect(() => generateDraftOrder(['A'], 0, 'snake')).toThrow(/positive integer/);
    expect(() => generateDraftOrder(['A'], -1, 'snake')).toThrow(/positive integer/);
    expect(() => generateDraftOrder(['A'], 1.5, 'snake')).toThrow(/positive integer/);
  });
});

// ── Property-based sweep ─────────────────────────────────────────────

interface Config {
  teamCount: number;
  totalRounds: number;
}

const REALISTIC_CONFIGS: ReadonlyArray<Config> = [
  { teamCount: 8, totalRounds: 15 },
  { teamCount: 10, totalRounds: 16 },
  { teamCount: 12, totalRounds: 16 },
  { teamCount: 14, totalRounds: 20 },
  { teamCount: 16, totalRounds: 25 },
  // Edge: 1-round, 2-team
  { teamCount: 2, totalRounds: 1 },
  // Edge: many rounds, few teams
  { teamCount: 2, totalRounds: 30 },
];

function makeTeamIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `team-${i + 1}`);
}

describe.each(REALISTIC_CONFIGS)(
  'generateDraftOrder properties — $teamCount teams × $totalRounds rounds',
  ({ teamCount, totalRounds }) => {
    const teamIds = makeTeamIds(teamCount);

    for (const format of ['snake', 'linear'] as const) {
      describe(`format=${format}`, () => {
        const slots = generateDraftOrder(teamIds, totalRounds, format);

        it('total slot count equals teamCount × totalRounds', () => {
          expect(slots.length).toBe(teamCount * totalRounds);
        });

        it('every team appears exactly totalRounds times', () => {
          const counts = new Map<string, number>();
          for (const slot of slots) {
            counts.set(slot.teamId, (counts.get(slot.teamId) ?? 0) + 1);
          }
          expect(counts.size).toBe(teamCount);
          for (const [, count] of counts) {
            expect(count).toBe(totalRounds);
          }
        });

        it('pickNumbers are unique and form a contiguous 1..N sequence', () => {
          const pickNumbers = slots.map((s) => s.pickNumber);
          const sorted = [...pickNumbers].sort((a, b) => a - b);
          const expected = Array.from({ length: slots.length }, (_, i) => i + 1);
          expect(sorted).toEqual(expected);
          // Also assert in-order (generator should already produce them sorted)
          expect(pickNumbers).toEqual(expected);
        });

        it('round numbers progress monotonically (each round contains exactly teamCount slots)', () => {
          for (let round = 1; round <= totalRounds; round++) {
            const roundSlots = slots.filter((s) => s.round === round);
            expect(roundSlots.length).toBe(teamCount);
          }
        });

        if (format === 'snake') {
          it('snake reverses at every odd→even round boundary, repeats at even→odd', () => {
            for (let round = 1; round < totalRounds; round++) {
              const currentRound = slots.filter((s) => s.round === round).map((s) => s.teamId);
              const nextRound = slots.filter((s) => s.round === round + 1).map((s) => s.teamId);
              if (round % 2 === 1) {
                // odd → even: teams should reverse
                expect(nextRound).toEqual([...currentRound].reverse());
              } else {
                // even → odd: teams should match the prior odd round's order
                expect(nextRound).toEqual([...currentRound].reverse());
              }
            }
          });

          it('odd rounds are forward; even rounds are reversed', () => {
            for (let round = 1; round <= totalRounds; round++) {
              const roundTeams = slots.filter((s) => s.round === round).map((s) => s.teamId);
              if (round % 2 === 1) {
                expect(roundTeams).toEqual(teamIds);
              } else {
                expect(roundTeams).toEqual([...teamIds].reverse());
              }
            }
          });
        }

        if (format === 'linear') {
          it('every round uses identical forward team ordering', () => {
            for (let round = 1; round <= totalRounds; round++) {
              const roundTeams = slots.filter((s) => s.round === round).map((s) => s.teamId);
              expect(roundTeams).toEqual(teamIds);
            }
          });
        }
      });
    }
  },
);
