import { describe, it, expect } from 'vitest';
import { assignDepthChart } from '../depthChart';
import type { Player } from '@/services/PlayerService';
const player = (id: string, position: string, eligible_positions: string[], points = 100) =>
  ({ id, position, eligible_positions, points } as Player);

describe('draft depth chart eligibility', () => {
  it('moves the dual-eligible center to LW so both players fit, without duplicates', () => {
    const result = assignDepthChart([player('dual', 'C', ['LW'], 200), player('center', 'C', [])], { C: 1, LW: 1 });
    expect(result.starters.map(s => [s.position, s.player.id])).toEqual([['C', 'center'], ['LW', 'dual']]);
    expect(result.bench).toEqual([]);
  });
  it('honors zero capacity and never puts a goalie or unknown identity in utility', () => {
    const result = assignDepthChart([player('g', 'G', ['LW']), player('bad', '', []), player('d', 'D', [])], { C: 0, UTIL: 1 });
    expect(result.starters.map(s => s.player.id)).toEqual(['d']);
    expect(result.bench.map(p => p.id)).toEqual(['g', 'bad']);
  });
  it('folds forward eligibility while preserving the highest scoring selection', () => {
    const result = assignDepthChart([player('dual', 'C', ['LW'], 200), player('center', 'C', [])], { F: 1 });
    expect(result.starters.map(s => s.player.id)).toEqual(['dual']);
    expect(result.bench.map(p => p.id)).toEqual(['center']);
  });
});


it('bounds assignment work by the player pool even with an excessive configured count', () => {
  const result = assignDepthChart([player('one', 'C', [])], { C: 1_000_000_000 });
  expect(result.starters.map(s => s.player.id)).toEqual(['one']);
});
