import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateEligibleGamesRemaining } from '../rosterUtils';
import { MatchupPlayer } from '@/components/matchup/types';

// Mock timezoneUtils to control "today"
vi.mock('@/utils/timezoneUtils', () => ({
  getTodayMST: () => '2026-01-05',
}));

function makePlayer(
  position: string,
  games: Array<{ game_date: string; status?: string }>
): MatchupPlayer {
  return {
    id: Math.random().toString(),
    name: 'Test Player',
    position,
    team: 'TST',
    games: games.map((g) => ({
      game_id: Math.floor(Math.random() * 100000),
      game_date: g.game_date,
      home_team: 'TST',
      away_team: 'OPP',
      status: g.status || 'scheduled',
    })),
  } as unknown as MatchupPlayer;
}

describe('calculateEligibleGamesRemaining', () => {
  it('returns 0 for empty roster', () => {
    expect(calculateEligibleGamesRemaining([])).toBe(0);
  });

  it('returns 0 when all games are in the past', () => {
    const player = makePlayer('C', [
      { game_date: '2026-01-01', status: 'final' },
      { game_date: '2026-01-03', status: 'final' },
    ]);
    expect(calculateEligibleGamesRemaining([player])).toBe(0);
  });

  it('returns 0 when games are postponed', () => {
    const player = makePlayer('C', [
      { game_date: '2026-01-06', status: 'postponed' },
    ]);
    expect(calculateEligibleGamesRemaining([player])).toBe(0);
  });

  it('counts a single future game for one player', () => {
    const player = makePlayer('C', [
      { game_date: '2026-01-06', status: 'scheduled' },
    ]);
    expect(calculateEligibleGamesRemaining([player])).toBe(1);
  });

  it('counts today as a remaining game', () => {
    const player = makePlayer('LW', [
      { game_date: '2026-01-05', status: 'scheduled' },
    ]);
    expect(calculateEligibleGamesRemaining([player])).toBe(1);
  });

  it('respects position slot limits (2 C max)', () => {
    // 3 centers on the same day — only 2 slots
    const players = [
      makePlayer('C', [{ game_date: '2026-01-06' }]),
      makePlayer('C', [{ game_date: '2026-01-06' }]),
      makePlayer('C', [{ game_date: '2026-01-06' }]),
    ];
    // 2 C slots + 1 UTIL slot = 3
    expect(calculateEligibleGamesRemaining(players)).toBe(3);
  });

  it('fills UTIL slot with overflow skaters', () => {
    // 3 LW on the same day — 2 LW slots + 1 UTIL = 3
    const players = [
      makePlayer('LW', [{ game_date: '2026-01-06' }]),
      makePlayer('LW', [{ game_date: '2026-01-06' }]),
      makePlayer('LW', [{ game_date: '2026-01-06' }]),
    ];
    expect(calculateEligibleGamesRemaining(players)).toBe(3);
  });

  it('does not use UTIL for goalie overflow', () => {
    // 3 goalies on same day — only 2 G slots, no UTIL for goalies
    const players = [
      makePlayer('G', [{ game_date: '2026-01-06' }]),
      makePlayer('G', [{ game_date: '2026-01-06' }]),
      makePlayer('G', [{ game_date: '2026-01-06' }]),
    ];
    expect(calculateEligibleGamesRemaining(players)).toBe(2);
  });

  it('handles multiple game days correctly', () => {
    // 1 center with 2 games on different days
    const player = makePlayer('C', [
      { game_date: '2026-01-06' },
      { game_date: '2026-01-08' },
    ]);
    expect(calculateEligibleGamesRemaining([player])).toBe(2);
  });

  it('handles full roster on one day', () => {
    // 2C + 2LW + 2RW + 4D + 2G + 1 UTIL(extra skater) = 13
    const players = [
      makePlayer('C', [{ game_date: '2026-01-06' }]),
      makePlayer('C', [{ game_date: '2026-01-06' }]),
      makePlayer('LW', [{ game_date: '2026-01-06' }]),
      makePlayer('LW', [{ game_date: '2026-01-06' }]),
      makePlayer('RW', [{ game_date: '2026-01-06' }]),
      makePlayer('RW', [{ game_date: '2026-01-06' }]),
      makePlayer('D', [{ game_date: '2026-01-06' }]),
      makePlayer('D', [{ game_date: '2026-01-06' }]),
      makePlayer('D', [{ game_date: '2026-01-06' }]),
      makePlayer('D', [{ game_date: '2026-01-06' }]),
      makePlayer('G', [{ game_date: '2026-01-06' }]),
      makePlayer('G', [{ game_date: '2026-01-06' }]),
      // Extra skater for UTIL
      makePlayer('C', [{ game_date: '2026-01-06' }]),
    ];
    expect(calculateEligibleGamesRemaining(players)).toBe(13);
  });

  it('UTIL slot limited to 1 even with many overflow', () => {
    // 5 centers on same day: 2 C slots + 1 UTIL = 3 (not 5)
    const players = [
      makePlayer('C', [{ game_date: '2026-01-06' }]),
      makePlayer('C', [{ game_date: '2026-01-06' }]),
      makePlayer('C', [{ game_date: '2026-01-06' }]),
      makePlayer('C', [{ game_date: '2026-01-06' }]),
      makePlayer('C', [{ game_date: '2026-01-06' }]),
    ];
    expect(calculateEligibleGamesRemaining(players)).toBe(3);
  });

  it('handles players with no games array', () => {
    const player = { position: 'C' } as unknown as MatchupPlayer;
    expect(calculateEligibleGamesRemaining([player])).toBe(0);
  });

  it('handles mixed final and scheduled games', () => {
    const player = makePlayer('D', [
      { game_date: '2026-01-03', status: 'final' },
      { game_date: '2026-01-07', status: 'scheduled' },
    ]);
    expect(calculateEligibleGamesRemaining([player])).toBe(1);
  });

  it('normalizes position strings', () => {
    // "Centre" and "Defense" should normalize
    const players = [
      makePlayer('Centre', [{ game_date: '2026-01-06' }]),
      makePlayer('Defense', [{ game_date: '2026-01-06' }]),
    ];
    expect(calculateEligibleGamesRemaining(players)).toBe(2);
  });

  it('handles game_date with time component', () => {
    const player = makePlayer('C', [
      { game_date: '2026-01-06T19:00:00Z' },
    ]);
    expect(calculateEligibleGamesRemaining([player])).toBe(1);
  });
});
