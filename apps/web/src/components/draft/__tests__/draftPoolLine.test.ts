/**
 * The pool row's season line and position ranks (2026-09-05). See draftPoolLine.ts.
 */
import { describe, it, expect } from 'vitest';
import type { Player } from '@/services/PlayerService';
import { draftPoolSeasonLine, positionRanks } from '../draftPoolLine';

const skater = (over: Partial<Player>): Player =>
  ({ id: '1', full_name: 'A', position: 'D', team: 'COL', games_played: 80, points: 90, icetime_seconds: 80 * 1570, ...over }) as unknown as Player;

describe('draftPoolSeasonLine', () => {
  it('a skater: points and TOI per game', () => {
    expect(draftPoolSeasonLine(skater({}))).toBe('90 PTS · 26:10');
  });
  it('a goalie: wins and save percentage, the way the sport writes it', () => {
    expect(draftPoolSeasonLine(skater({ position: 'G', wins: 36, save_percentage: 0.917 }))).toBe('36 W · .917');
  });
  it('no season behind him: nothing', () => {
    expect(draftPoolSeasonLine(skater({ games_played: 0 }))).toBeNull();
  });
  it('points alone when there is no ice time', () => {
    expect(draftPoolSeasonLine(skater({ icetime_seconds: 0 }))).toBe('90 PTS');
  });
});

describe('positionRanks', () => {
  it('numbers each position in the order given', () => {
    const pos: Record<string, string> = { a: 'D', b: 'C', c: 'D', d: 'LW', e: 'G' };
    const ranks = positionRanks(['a', 'b', 'c', 'd', 'e'], (id) => pos[id]);
    expect(ranks.get('a')).toBe('D1');
    expect(ranks.get('c')).toBe('D2');
    expect(ranks.get('b')).toBe('C1');
    expect(ranks.get('d')).toBe('LW1');
    expect(ranks.get('e')).toBe('G1');
  });
});
