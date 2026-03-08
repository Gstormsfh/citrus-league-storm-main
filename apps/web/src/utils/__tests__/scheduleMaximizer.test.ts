import { describe, it, expect, vi } from 'vitest';

// Mock services that trigger Supabase client initialization
vi.mock('@/services/ScheduleService', () => ({
  ScheduleService: {
    getGamesForTeams: vi.fn(),
    getGamesForDateRange: vi.fn(),
  },
}));

vi.mock('@/services/LeagueService', () => ({
  LeagueService: {
    getLeague: vi.fn(),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Import after mocks
import { calculatePlayerSchedule } from '../scheduleMaximizer';
import type { Player } from '@/services/PlayerService';
import type { NHLGame } from '@/services/ScheduleService';

function makeGame(game_date: string): NHLGame {
  return {
    game_id: Math.floor(Math.random() * 100000),
    game_date,
    home_team: 'TST',
    away_team: 'OPP',
    status: 'scheduled',
  } as NHLGame;
}

function makePlayer(team: string): Player {
  return {
    id: '1',
    full_name: 'Test Player',
    position: 'C',
    team,
    jersey_number: '10',
  } as Player;
}

describe('calculatePlayerSchedule', () => {
  it('returns 0 games when team has no games', () => {
    const player = makePlayer('TST');
    const gameMap = new Map<string, NHLGame[]>();
    const result = calculatePlayerSchedule(player, gameMap);
    expect(result.gamesThisWeek).toBe(0);
    expect(result.gameDays).toEqual([]);
  });

  it('returns correct game count for team with games', () => {
    const player = makePlayer('TST');
    const gameMap = new Map<string, NHLGame[]>([
      ['TST', [makeGame('2026-01-05'), makeGame('2026-01-07')]],
    ]);
    const result = calculatePlayerSchedule(player, gameMap);
    expect(result.gamesThisWeek).toBe(2);
  });

  it('returns correct day abbreviations', () => {
    const player = makePlayer('TST');
    // 2026-01-05 is Monday, 2026-01-07 is Wednesday
    const gameMap = new Map<string, NHLGame[]>([
      ['TST', [makeGame('2026-01-05'), makeGame('2026-01-07')]],
    ]);
    const result = calculatePlayerSchedule(player, gameMap);
    expect(result.gameDays).toContain('Mon');
    expect(result.gameDays).toContain('Wed');
  });

  it('deduplicates game days', () => {
    const player = makePlayer('TST');
    // Two games on same date (doubleheader scenario)
    const gameMap = new Map<string, NHLGame[]>([
      ['TST', [makeGame('2026-01-05'), makeGame('2026-01-05')]],
    ]);
    const result = calculatePlayerSchedule(player, gameMap);
    expect(result.gamesThisWeek).toBe(2);
    // gameDays should deduplicate
    expect(result.gameDays).toHaveLength(1);
  });

  it('handles game_date with time component', () => {
    const player = makePlayer('TST');
    const gameMap = new Map<string, NHLGame[]>([
      ['TST', [makeGame('2026-01-05T19:00:00Z')]],
    ]);
    const result = calculatePlayerSchedule(player, gameMap);
    expect(result.gamesThisWeek).toBe(1);
    expect(result.gameDays).toHaveLength(1);
  });

  it('uses player team to look up games', () => {
    const player = makePlayer('EDM');
    const gameMap = new Map<string, NHLGame[]>([
      ['TST', [makeGame('2026-01-05')]],
      ['EDM', [makeGame('2026-01-06'), makeGame('2026-01-08'), makeGame('2026-01-10')]],
    ]);
    const result = calculatePlayerSchedule(player, gameMap);
    expect(result.gamesThisWeek).toBe(3);
  });
});
