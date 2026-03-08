import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Player } from '@/services/PlayerService';

// Mock ALL dependencies before importing the module under test
vi.mock('@/services/PlayerService', () => ({
  PlayerService: {
    getPlayersByIds: vi.fn(),
  },
}));

vi.mock('@/components/roster/HockeyPlayerCard', () => ({
  // Just export the type — no component needed for testing
}));

const mockCalculatePointsPerGame = vi.fn().mockReturnValue(2.5);
vi.mock('@/utils/scoringUtils', () => ({
  ScoringCalculator: class MockScoringCalculator {
    calculatePointsPerGame = mockCalculatePointsPerGame;
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Import after mocks
import { getPlayerWithSeasonStats } from '../playerStatsHelper';
import { PlayerService } from '@/services/PlayerService';

const mockGetPlayersByIds = vi.mocked(PlayerService.getPlayersByIds);

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: '8478402',
    full_name: 'Connor McDavid',
    position: 'C',
    eligible_positions: ['C'],
    team: 'EDM',
    jersey_number: '97',
    status: null,
    headshot_url: 'https://example.com/headshot.png',
    last_updated: '2026-01-01',
    games_played: 40,
    goals: 25,
    assists: 45,
    points: 70,
    plus_minus: 15,
    shots: 150,
    hits: 20,
    blocks: 10,
    pim: 12,
    ppp: 20,
    shp: 2,
    icetime_seconds: 50400,
    xGoals: 22.5,
    wins: null,
    losses: null,
    ot_losses: null,
    saves: null,
    goals_against_average: null,
    save_percentage: null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
    ...overrides,
  } as Player;
}

describe('getPlayerWithSeasonStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCalculatePointsPerGame.mockReturnValue(2.5);
  });

  it('returns null when player is not found', async () => {
    mockGetPlayersByIds.mockResolvedValue([]);
    const result = await getPlayerWithSeasonStats('9999999');
    expect(result).toBeNull();
  });

  it('returns HockeyPlayer with correct mapped fields', async () => {
    const player = makePlayer();
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('8478402');
    expect(result!.name).toBe('Connor McDavid');
    expect(result!.position).toBe('C');
    expect(result!.number).toBe(97);
    expect(result!.team).toBe('EDM');
    expect(result!.teamAbbreviation).toBe('EDM');
    expect(result!.image).toBe('https://example.com/headshot.png');
  });

  it('maps skater stats correctly', async () => {
    const player = makePlayer();
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');

    expect(result!.stats.gamesPlayed).toBe(40);
    expect(result!.stats.goals).toBe(25);
    expect(result!.stats.assists).toBe(45);
    expect(result!.stats.points).toBe(70);
    expect(result!.stats.plusMinus).toBe(15);
    expect(result!.stats.shots).toBe(150);
    expect(result!.stats.hits).toBe(20);
    expect(result!.stats.blockedShots).toBe(10);
    expect(result!.stats.pim).toBe(12);
    expect(result!.stats.powerPlayPoints).toBe(20);
    expect(result!.stats.shortHandedPoints).toBe(2);
    expect(result!.stats.xGoals).toBe(22.5);
  });

  it('formats TOI per game correctly', async () => {
    // 50400 seconds / 40 games = 1260 sec/game = 21:00
    const player = makePlayer({ icetime_seconds: 50400, games_played: 40 });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result!.stats.toi).toBe('21:00');
  });

  it('returns 0:00 for TOI when no icetime', async () => {
    const player = makePlayer({ icetime_seconds: undefined });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result!.stats.toi).toBe('0:00');
  });

  it('maps goalie stats correctly', async () => {
    const player = makePlayer({
      position: 'G',
      wins: 20,
      losses: 8,
      ot_losses: 3,
      goals_against_average: 2.45,
      save_percentage: 0.915,
      shutouts: 3,
      saves: 900,
      goals_against: 75,
      goalsSavedAboveExpected: 12.5,
    });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');

    expect(result!.stats.wins).toBe(20);
    expect(result!.stats.losses).toBe(8);
    expect(result!.stats.otl).toBe(3);
    expect(result!.stats.gaa).toBe(2.45);
    expect(result!.stats.savePct).toBe(0.915);
    expect(result!.stats.shutouts).toBe(3);
    expect(result!.stats.saves).toBe(900);
    expect(result!.stats.goalsAgainst).toBe(75);
    expect(result!.stats.goalsSavedAboveExpected).toBe(12.5);
  });

  it('handles injured status', async () => {
    const player = makePlayer({ status: 'injured' });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result!.status).toBe('IR');
  });

  it('handles non-injured status', async () => {
    const player = makePlayer({ status: 'active' });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result!.status).toBeNull();
  });

  it('defaults PPP/SHP to 0 when null', async () => {
    const player = makePlayer({ ppp: null as unknown as number, shp: null as unknown as number });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result!.stats.powerPlayPoints).toBe(0);
    expect(result!.stats.shortHandedPoints).toBe(0);
  });

  it('handles numeric player ID', async () => {
    const player = makePlayer();
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats(8478402);

    expect(result).not.toBeNull();
    expect(mockGetPlayersByIds).toHaveBeenCalledWith(['8478402']);
  });

  it('sets projectedPoints to 0 when games_played is 0', async () => {
    const player = makePlayer({ games_played: 0 });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result!.projectedPoints).toBe(0);
  });

  it('calculates projectedPoints when games_played > 0', async () => {
    const player = makePlayer({ games_played: 40 });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result!.projectedPoints).toBe(2.5);
  });

  it('returns null on error', async () => {
    mockGetPlayersByIds.mockRejectedValue(new Error('Network error'));

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result).toBeNull();
  });

  it('handles missing headshot_url', async () => {
    const player = makePlayer({ headshot_url: null });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result!.image).toBeUndefined();
  });

  it('handles missing jersey_number', async () => {
    const player = makePlayer({ jersey_number: null });
    mockGetPlayersByIds.mockResolvedValue([player]);

    const result = await getPlayerWithSeasonStats('8478402');
    expect(result!.number).toBe(0);
  });
});
