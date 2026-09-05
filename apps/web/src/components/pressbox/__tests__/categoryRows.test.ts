/**
 * The CATEGORIES tab's arithmetic (2026-09-05). See categoryRows.ts.
 */
import { describe, it, expect } from 'vitest';
import type { MatchupPlayer } from '@/components/matchup/types';
import { categoryRows, categoryTally, leader } from '../categoryRows';

const skater = (id: number, matchupStats: MatchupPlayer['matchupStats']): MatchupPlayer =>
  ({ id, name: `S${id}`, position: 'C', points: 0, gamesRemaining: 0, status: null, isStarter: true, stats: { goals: 0, assists: 0, sog: 0, blk: 0 }, games: [], matchupStats }) as unknown as MatchupPlayer;
const goalie = (id: number, over: Partial<MatchupPlayer>): MatchupPlayer =>
  ({ id, name: `G${id}`, position: 'G', isGoalie: true, points: 0, gamesRemaining: 0, status: null, isStarter: true, stats: { goals: 0, assists: 0, sog: 0, blk: 0 }, games: [], ...over }) as unknown as MatchupPlayer;

describe('categoryRows', () => {
  it('sums each side by category, skaters and goalies apart, and keeps every category as a row', () => {
    const yours = [
      skater(1, { goals: 2, assists: 1, sog: 9, blocks: 3, ppp: 1, shp: 0, hits: 4, pim: 2 }),
      skater(2, { goals: 1, assists: 3, sog: 6, blocks: 0, ppp: 0, shp: 1, hits: 2, pim: 0 }),
      goalie(3, { goalieMatchupStats: { wins: 2, saves: 61, shutouts: 1, goalsAgainst: 4 } }),
    ];
    const theirs = [
      skater(4, { goals: 4, assists: 2, sog: 12, blocks: 1, ppp: 2, shp: 0, hits: 6, pim: 5 }),
      goalie(5, { goalieMatchupStats: { wins: 1, saves: 48, shutouts: 0, goalsAgainst: 7 } }),
    ];
    const rows = categoryRows(yours, theirs);
    expect(rows.map((r) => r.label)).toEqual(['G', 'A', 'SOG', 'PPP', 'SHP', 'HIT', 'BLK', 'PIM', 'W', 'SV', 'SO', 'GA']);
    const by = Object.fromEntries(rows.map((r) => [r.label, [r.yours, r.theirs]]));
    expect(by.G).toEqual([3, 4]);
    expect(by.A).toEqual([4, 2]);
    expect(by.SOG).toEqual([15, 12]);
    expect(by.SHP).toEqual([1, 0]);
    expect(by.PIM).toEqual([2, 5]);
    expect(by.W).toEqual([2, 1]);
    expect(by.SV).toEqual([61, 48]);
    expect(by.GA).toEqual([4, 7]);
  });

  it("reads a goalie's selected-day line from matchupStats when that is what he carries", () => {
    const rows = categoryRows([goalie(3, { matchupStats: { wins: 1, saves: 30, shutouts: 0, goals_against: 2 } })], []);
    const by = Object.fromEntries(rows.map((r) => [r.label, r.yours]));
    expect(by.W).toBe(1);
    expect(by.SV).toBe(30);
    expect(by.GA).toBe(2);
  });

  it('a skater with no week yet is a 0, not a missing row, and never counts into the goalie rows', () => {
    const rows = categoryRows([skater(1, undefined)], [skater(2, { goals: 1 })]);
    const by = Object.fromEntries(rows.map((r) => [r.label, [r.yours, r.theirs]]));
    expect(by.G).toEqual([0, 1]);
    expect(by.SV).toEqual([0, 0]);
    expect(rows).toHaveLength(12);
  });
});

describe('leader and the tally', () => {
  it('more is the lead on every counting stat; on GA, less is', () => {
    const rows = categoryRows(
      [skater(1, { goals: 2, pim: 4 }), goalie(3, { goalieMatchupStats: { wins: 1, saves: 40, shutouts: 0, goalsAgainst: 3 } })],
      [skater(2, { goals: 1, pim: 4 }), goalie(4, { goalieMatchupStats: { wins: 1, saves: 40, shutouts: 0, goalsAgainst: 5 } })],
    );
    const by = Object.fromEntries(rows.map((r) => [r.label, leader(r)]));
    expect(by.G).toBe('you');
    expect(by.PIM).toBe('even');
    expect(by.GA).toBe('you');
    expect(by.W).toBe('even');
    // G and GA to you; A/SOG/PPP/SHP/HIT/BLK/PIM/W/SV/SO level at 0 or equal.
    expect(categoryTally(rows)).toEqual({ you: 2, them: 0, even: 10 });
  });
});
