import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules
// =============================================================================

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: null }),
  },
}));

const mockSearchPlayers = vi.fn().mockResolvedValue({ data: [] });
const mockGetPlayersByIds = vi.fn().mockResolvedValue({ data: [] });
const mockGetTrendingPlayers = vi.fn().mockResolvedValue({ data: [] });
const mockRecordPlayerTransaction = vi.fn().mockResolvedValue({ data: null });
const mockClearCache = vi.fn();

vi.mock('@/api/players', () => ({
  playerApi: {
    searchPlayers: (...args: any[]) => mockSearchPlayers(...args),
    getPlayersByIds: (...args: any[]) => mockGetPlayersByIds(...args),
    getTrendingPlayers: (...args: any[]) => mockGetTrendingPlayers(...args),
    recordPlayerTransaction: (...args: any[]) => mockRecordPlayerTransaction(...args),
    clearCache: (...args: any[]) => mockClearCache(...args),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: 2025,
  HEADSHOT_SEASON: '20252026',
  getHeadshotUrl: (teamAbbrev: string | null, playerId: number | string | null) => {
    if (!teamAbbrev || !playerId) return null;
    return `https://assets.nhle.com/mugs/nhl/20252026/${teamAbbrev}/${playerId}.png`;
  },
}));

// =============================================================================
// HELPERS — ServerPlayer format (as returned by the API server)
// =============================================================================

/** Create a minimal ServerPlayer (skater) for testing. */
function makeServerPlayer(overrides: Partial<{
  id: number;
  full_name: string;
  position: string;
  team: string;
  jersey_number: number | null;
  headshot_url: string | null;
  is_goalie: boolean;
  status: string;
  roster_status: string | null;
  is_ir_eligible: boolean;
  eligible_positions: string[];
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  hits: number;
  blocks: number;
  pim: number;
  ppp: number;
  shp: number;
  plus_minus: number;
  icetime_seconds: number;
  x_goals: number;
  goalie_gp: number;
  wins: number;
  losses: number;
  ot_losses: number;
  saves: number;
  shots_faced: number;
  goals_against: number;
  save_pct: number;
  gaa: number;
  shutouts: number;
  gsax: number | null;
}> = {}) {
  return {
    id: 8478402,
    full_name: 'Connor McDavid',
    position: 'C',
    team: 'EDM',
    jersey_number: 97,
    headshot_url: null,
    is_goalie: false,
    status: 'active',
    roster_status: null,
    is_ir_eligible: false,
    eligible_positions: ['C'],
    games_played: 40,
    goals: 20,
    assists: 35,
    points: 55,
    shots: 150,
    hits: 10,
    blocks: 5,
    pim: 12,
    ppp: 8,
    shp: 1,
    plus_minus: 15,
    icetime_seconds: 50000,
    x_goals: 18.5,
    goalie_gp: 0,
    wins: 0,
    losses: 0,
    ot_losses: 0,
    saves: 0,
    shots_faced: 0,
    goals_against: 0,
    save_pct: 0,
    gaa: 0,
    shutouts: 0,
    gsax: null,
    ...overrides,
  };
}

/** Create a minimal ServerPlayer (goalie) for testing. */
function makeServerGoalie(overrides: Partial<ReturnType<typeof makeServerPlayer>> = {}) {
  return makeServerPlayer({
    id: 8477424,
    full_name: 'Stuart Skinner',
    position: 'G',
    is_goalie: true,
    jersey_number: 74,
    eligible_positions: ['G'],
    games_played: 30,
    goalie_gp: 30,
    wins: 18,
    losses: 8,
    ot_losses: 4,
    saves: 800,
    shots_faced: 870,
    goals_against: 70,
    shutouts: 2,
    save_pct: 0.920,
    gaa: 2.45,
    gsax: 5.2,
    goals: 0,
    assists: 0,
    points: 0,
    shots: 0,
    hits: 0,
    blocks: 0,
    pim: 0,
    ppp: 0,
    shp: 0,
    plus_minus: 0,
    x_goals: 0,
    ...overrides,
  });
}

// =============================================================================
// Import PlayerService AFTER mocks are registered
// =============================================================================

import { PlayerService } from '../PlayerService';
import type { Player } from '../PlayerService';

// =============================================================================
// Tests
// =============================================================================

describe('PlayerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear internal cache between tests so each test starts fresh
    PlayerService.clearCache();
  });

  // ===========================================================================
  // clearCache
  // ===========================================================================

  describe('clearCache', () => {
    it('does not throw when called with no cached data', () => {
      expect(() => PlayerService.clearCache()).not.toThrow();
    });
  });

  // ===========================================================================
  // getAllPlayers
  // ===========================================================================

  describe('getAllPlayers', () => {
    it('returns an empty array when API returns no data', async () => {
      mockSearchPlayers.mockResolvedValueOnce({ data: [] });
      const players = await PlayerService.getAllPlayers();
      expect(players).toEqual([]);
    });

    it('returns a mapped skater with correct stats', async () => {
      const sp = makeServerPlayer();
      mockSearchPlayers.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);

      const p = players[0];
      expect(p.id).toBe('8478402');
      expect(p.full_name).toBe('Connor McDavid');
      expect(p.position).toBe('C');
      expect(p.team).toBe('EDM');
      expect(p.goals).toBe(20);
      expect(p.assists).toBe(35);
      expect(p.points).toBe(55);
      expect(p.plus_minus).toBe(15);
      expect(p.shots).toBe(150);
      expect(p.hits).toBe(10);
      expect(p.blocks).toBe(5);
      expect(p.pim).toBe(12);
      expect(p.ppp).toBe(8);
      expect(p.shp).toBe(1);
      expect(p.xGoals).toBe(18.5);
      // Skater should NOT have goalie-specific stats
      expect(p.wins).toBeNull();
      expect(p.losses).toBeNull();
      expect(p.saves).toBeNull();
      expect(p.save_percentage).toBeNull();
      expect(p.goals_against_average).toBeNull();
    });

    it('returns a mapped goalie with correct stats and GSAx', async () => {
      const sg = makeServerGoalie();
      mockSearchPlayers.mockResolvedValueOnce({ data: [sg] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);

      const g = players[0];
      expect(g.id).toBe('8477424');
      expect(g.position).toBe('G');
      expect(g.wins).toBe(18);
      expect(g.losses).toBe(8);
      expect(g.ot_losses).toBe(4);
      expect(g.saves).toBe(800);
      expect(g.shutouts).toBe(2);
      expect(g.save_percentage).toBe(0.920);
      expect(g.goals_against_average).toBe(2.45);
      expect(g.goalsSavedAboveExpected).toBe(5.2);
      expect(g.goalie_gp).toBe(30);
    });

    it('sets goalie GSAx to 0 when no GSAx data is available', async () => {
      const sg = makeServerGoalie({ gsax: null });
      mockSearchPlayers.mockResolvedValueOnce({ data: [sg] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].goalsSavedAboveExpected).toBe(0);
    });

    it('returns player with zero stats when games_played is 0', async () => {
      const sp = makeServerPlayer({
        games_played: 0,
        goals: 0,
        assists: 0,
        points: 0,
        shots: 0,
      });
      mockSearchPlayers.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);

      const p = players[0];
      expect(p.games_played).toBe(0);
      expect(p.goals).toBe(0);
      expect(p.assists).toBe(0);
      expect(p.points).toBe(0);
    });

    it('sorts players by points descending', async () => {
      const sp1 = makeServerPlayer({ id: 1, full_name: 'Player A', goals: 10, assists: 5, points: 15 });
      const sp2 = makeServerPlayer({ id: 2, full_name: 'Player B', goals: 30, assists: 40, points: 70 });
      const sp3 = makeServerPlayer({ id: 3, full_name: 'Player C', goals: 20, assists: 15, points: 35 });

      mockSearchPlayers.mockResolvedValueOnce({ data: [sp1, sp2, sp3] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(3);
      expect(players[0].full_name).toBe('Player B'); // 70 pts
      expect(players[1].full_name).toBe('Player C'); // 35 pts
      expect(players[2].full_name).toBe('Player A'); // 15 pts
    });

    it('derives IR status from server data', async () => {
      const sp = makeServerPlayer({
        status: 'injured',
        roster_status: 'IR',
        is_ir_eligible: true,
      });
      mockSearchPlayers.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].status).toBe('injured');
      expect(players[0].roster_status).toBe('IR');
      expect(players[0].is_ir_eligible).toBe(true);
    });

    it('derives active status when no IR/LTIR roster_status', async () => {
      const sp = makeServerPlayer({
        status: 'active',
        roster_status: 'ACT',
        is_ir_eligible: false,
      });
      mockSearchPlayers.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].status).toBe('active');
    });

    it('returns empty array and logs error when API call fails', async () => {
      mockSearchPlayers.mockRejectedValueOnce(new Error('Network error'));

      const players = await PlayerService.getAllPlayers();
      expect(players).toEqual([]);
    });

    it('uses cached data on second call within TTL', async () => {
      mockSearchPlayers.mockResolvedValueOnce({ data: [makeServerPlayer()] });

      const first = await PlayerService.getAllPlayers();
      expect(first).toHaveLength(1);

      // Second call should return cached result — searchPlayers should not be called again
      const second = await PlayerService.getAllPlayers();
      expect(second).toHaveLength(1);
      expect(mockSearchPlayers).toHaveBeenCalledTimes(1);
    });

    it('fetches fresh data after cache is cleared', async () => {
      mockSearchPlayers.mockResolvedValueOnce({ data: [makeServerPlayer()] });

      await PlayerService.getAllPlayers();
      expect(mockSearchPlayers).toHaveBeenCalledTimes(1);

      PlayerService.clearCache();

      mockSearchPlayers.mockResolvedValueOnce({
        data: [makeServerPlayer({ full_name: 'Updated Name' })],
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].full_name).toBe('Updated Name');
      // searchPlayers should have been called again
      expect(mockSearchPlayers).toHaveBeenCalledTimes(2);
    });

    it('maps eligible_positions from server response', async () => {
      const sp = makeServerPlayer({
        position: 'C',
        eligible_positions: ['C', 'LW'],
      });
      mockSearchPlayers.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].eligible_positions).toContain('C');
      expect(players[0].eligible_positions).toContain('LW');
      expect(players[0].eligible_positions).toHaveLength(2);
    });

    it('uses pre-computed eligible_positions from server when available', async () => {
      const sp = makeServerPlayer({
        position: 'C',
        eligible_positions: ['C', 'LW', 'RW'],
      });
      mockSearchPlayers.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].eligible_positions).toEqual(['C', 'LW', 'RW']);
    });

    it('generates headshot URL from team and player ID when not provided', async () => {
      const sp = makeServerPlayer({ headshot_url: null });
      mockSearchPlayers.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].headshot_url).toBe(
        'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png'
      );
    });

    it('uses headshot_url from server when available', async () => {
      const sp = makeServerPlayer({ headshot_url: 'https://custom-headshot.com/mcdavid.png' });
      mockSearchPlayers.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].headshot_url).toBe('https://custom-headshot.com/mcdavid.png');
    });
  });

  // ===========================================================================
  // getPlayersByPosition
  // ===========================================================================

  describe('getPlayersByPosition', () => {
    it('filters players by primary position', async () => {
      const center = makeServerPlayer({ id: 1, full_name: 'Center', position: 'C', points: 10 });
      const dman = makeServerPlayer({ id: 2, full_name: 'Defenseman', position: 'D', points: 5 });
      const goalie = makeServerGoalie({ id: 3, full_name: 'Goaltender' });

      mockSearchPlayers.mockResolvedValueOnce({ data: [center, dman, goalie] });

      const defensemen = await PlayerService.getPlayersByPosition('D');
      expect(defensemen).toHaveLength(1);
      expect(defensemen[0].full_name).toBe('Defenseman');
    });

    it('returns empty array when no players match position', async () => {
      mockSearchPlayers.mockResolvedValueOnce({ data: [makeServerPlayer()] });

      const result = await PlayerService.getPlayersByPosition('G');
      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // searchPlayers
  // ===========================================================================

  describe('searchPlayers', () => {
    it('finds players by case-insensitive partial name match', async () => {
      const mcd = makeServerPlayer({ id: 1, full_name: 'Connor McDavid', points: 55 });
      const drai = makeServerPlayer({ id: 2, full_name: 'Leon Draisaitl', points: 50 });
      const nuge = makeServerPlayer({ id: 3, full_name: 'Ryan Nugent-Hopkins', points: 40 });

      mockSearchPlayers.mockResolvedValueOnce({ data: [mcd, drai, nuge] });

      const results = await PlayerService.searchPlayers('mcdavid');
      expect(results).toHaveLength(1);
      expect(results[0].full_name).toBe('Connor McDavid');
    });

    it('returns multiple matches when query matches multiple players', async () => {
      const p1 = makeServerPlayer({ id: 1, full_name: 'Alex Ovechkin', points: 40 });
      const p2 = makeServerPlayer({ id: 2, full_name: 'Alexander Barkov', points: 35 });
      const p3 = makeServerPlayer({ id: 3, full_name: 'Sidney Crosby', points: 50 });

      mockSearchPlayers.mockResolvedValueOnce({ data: [p1, p2, p3] });

      const results = await PlayerService.searchPlayers('alex');
      expect(results).toHaveLength(2);
      expect(results.map(r => r.full_name)).toContain('Alex Ovechkin');
      expect(results.map(r => r.full_name)).toContain('Alexander Barkov');
    });

    it('returns empty array when no players match search query', async () => {
      mockSearchPlayers.mockResolvedValueOnce({ data: [makeServerPlayer()] });

      const results = await PlayerService.searchPlayers('zzzznonexistent');
      expect(results).toEqual([]);
    });

    it('handles mixed-case search queries', async () => {
      mockSearchPlayers.mockResolvedValueOnce({ data: [makeServerPlayer()] });

      const results = await PlayerService.searchPlayers('CONNOR');
      expect(results).toHaveLength(1);
      expect(results[0].full_name).toBe('Connor McDavid');
    });
  });

  // ===========================================================================
  // getPlayersByIds
  // ===========================================================================

  describe('getPlayersByIds', () => {
    it('returns empty array for empty playerIds input', async () => {
      const players = await PlayerService.getPlayersByIds([]);
      expect(players).toEqual([]);
      // Should not call the API at all
      expect(mockGetPlayersByIds).not.toHaveBeenCalled();
    });

    it('returns mapped players for given IDs', async () => {
      const sp = makeServerPlayer();
      mockGetPlayersByIds.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getPlayersByIds(['8478402']);
      expect(players).toHaveLength(1);
      expect(players[0].id).toBe('8478402');
      expect(players[0].full_name).toBe('Connor McDavid');
      expect(players[0].goals).toBe(20);
      expect(players[0].assists).toBe(35);
      expect(players[0].points).toBe(55);
    });

    it('returns multiple players for multiple IDs', async () => {
      const sp1 = makeServerPlayer({ id: 1, full_name: 'Player A', points: 30 });
      const sp2 = makeServerPlayer({ id: 2, full_name: 'Player B', points: 40 });

      mockGetPlayersByIds.mockResolvedValueOnce({ data: [sp1, sp2] });

      const players = await PlayerService.getPlayersByIds(['1', '2']);
      expect(players).toHaveLength(2);
    });

    it('returns goalie with GSAx', async () => {
      const sg = makeServerGoalie({ gsax: 4.1 });
      mockGetPlayersByIds.mockResolvedValueOnce({ data: [sg] });

      const players = await PlayerService.getPlayersByIds(['8477424']);
      expect(players).toHaveLength(1);
      expect(players[0].goalsSavedAboveExpected).toBe(4.1);
    });

    it('uses per-player cache on second call within TTL', async () => {
      mockGetPlayersByIds.mockResolvedValueOnce({ data: [makeServerPlayer()] });

      const first = await PlayerService.getPlayersByIds(['8478402']);
      expect(first).toHaveLength(1);

      // Second call — should use per-player cache
      const second = await PlayerService.getPlayersByIds(['8478402']);
      expect(second).toHaveLength(1);
      expect(second[0].full_name).toBe('Connor McDavid');
      // API should only have been called once
      expect(mockGetPlayersByIds).toHaveBeenCalledTimes(1);
    });

    it('fetches only uncached players on partial cache hit', async () => {
      // First call: fetch player 1
      mockGetPlayersByIds.mockResolvedValueOnce({
        data: [makeServerPlayer({ id: 1, full_name: 'Player A', points: 15 })],
      });

      await PlayerService.getPlayersByIds(['1']);
      expect(mockGetPlayersByIds).toHaveBeenCalledTimes(1);

      // Second call: fetch player 1 (cached) + player 2 (uncached)
      mockGetPlayersByIds.mockResolvedValueOnce({
        data: [makeServerPlayer({ id: 2, full_name: 'Player B', points: 35 })],
      });

      const players = await PlayerService.getPlayersByIds(['1', '2']);
      expect(players).toHaveLength(2);
      // Should have made a second call for the uncached player
      expect(mockGetPlayersByIds).toHaveBeenCalledTimes(2);
      // The second call should only request the uncached ID
      expect(mockGetPlayersByIds).toHaveBeenLastCalledWith(['2']);
    });

    it('returns empty array on API error (no fallback)', async () => {
      mockGetPlayersByIds.mockRejectedValueOnce(new Error('API error'));

      const players = await PlayerService.getPlayersByIds(['8478402']);
      expect(players).toEqual([]);
    });

    it('returns cached players on API error when partial cache exists', async () => {
      // First: cache player 1
      mockGetPlayersByIds.mockResolvedValueOnce({
        data: [makeServerPlayer({ id: 1, full_name: 'Cached Player', points: 10 })],
      });

      await PlayerService.getPlayersByIds(['1']);

      // Second: error fetching player 2, but player 1 is cached
      mockGetPlayersByIds.mockRejectedValueOnce(new Error('API error'));

      const players = await PlayerService.getPlayersByIds(['1', '2']);
      // Should return the cached player 1, since fetching player 2 failed
      expect(players).toHaveLength(1);
      expect(players[0].full_name).toBe('Cached Player');
    });

    it('derives LTIR status from server data', async () => {
      const sp = makeServerPlayer({
        status: 'injured',
        roster_status: 'LTIR',
        is_ir_eligible: true,
      });
      mockGetPlayersByIds.mockResolvedValueOnce({ data: [sp] });

      const players = await PlayerService.getPlayersByIds(['8478402']);
      expect(players).toHaveLength(1);
      expect(players[0].status).toBe('injured');
      expect(players[0].roster_status).toBe('LTIR');
      expect(players[0].is_ir_eligible).toBe(true);
    });

    it('sorts returned players by points descending', async () => {
      const sp1 = makeServerPlayer({ id: 1, full_name: 'Low Points', points: 10 });
      const sp2 = makeServerPlayer({ id: 2, full_name: 'High Points', points: 70 });

      mockGetPlayersByIds.mockResolvedValueOnce({ data: [sp1, sp2] });

      const players = await PlayerService.getPlayersByIds(['1', '2']);
      expect(players[0].full_name).toBe('High Points');
      expect(players[1].full_name).toBe('Low Points');
    });
  });
});
