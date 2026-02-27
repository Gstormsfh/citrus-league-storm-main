import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayoffService } from '../PlayoffService';
import type {
  PlayoffSeries,
  PlayoffSeed,
  BracketGenerationOptions,
} from '../PlayoffService';

// =============================================================================
// MOCK SETUP
// =============================================================================

function createChainMock() {
  const chain: Record<string, any> = {};
  const chainMethods = ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'is', 'in', 'order', 'limit', 'filter'];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

let defaultChain = createChainMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => defaultChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: 2025,
}));

import { supabase } from '@/integrations/supabase/client';

// =============================================================================
// HELPERS
// =============================================================================

function resetChain() {
  defaultChain = createChainMock();
  (supabase.from as any).mockReturnValue(defaultChain);
}

function perTableChains(map: Record<string, ReturnType<typeof createChainMock>>) {
  (supabase.from as any).mockImplementation((table: string) => {
    return map[table] ?? defaultChain;
  });
  return map;
}

// =============================================================================
// getRoundName — Pure Function (no DB, no mocks needed)
// =============================================================================

describe('PlayoffService.getRoundName', () => {
  // ---- Bracket size 4 ----

  it('returns "Semifinals" for round 1 of a 4-team bracket', () => {
    expect(PlayoffService.getRoundName(4, 1)).toBe('Semifinals');
  });

  it('returns "Championship" for round 2 of a 4-team bracket', () => {
    expect(PlayoffService.getRoundName(4, 2)).toBe('Championship');
  });

  // ---- Bracket size 6 ----

  it('returns "Wild Card Round" for round 1 of a 6-team bracket', () => {
    expect(PlayoffService.getRoundName(6, 1)).toBe('Wild Card Round');
  });

  it('returns "Semifinals" for round 2 of a 6-team bracket', () => {
    expect(PlayoffService.getRoundName(6, 2)).toBe('Semifinals');
  });

  it('returns "Championship" for round 3 of a 6-team bracket', () => {
    expect(PlayoffService.getRoundName(6, 3)).toBe('Championship');
  });

  // ---- Bracket size 8 ----

  it('returns "Quarterfinals" for round 1 of an 8-team bracket', () => {
    expect(PlayoffService.getRoundName(8, 1)).toBe('Quarterfinals');
  });

  it('returns "Semifinals" for round 2 of an 8-team bracket', () => {
    expect(PlayoffService.getRoundName(8, 2)).toBe('Semifinals');
  });

  it('returns "Championship" for round 3 of an 8-team bracket', () => {
    expect(PlayoffService.getRoundName(8, 3)).toBe('Championship');
  });

  // ---- Unsupported / fallback ----

  it('returns generic "Round N" for unsupported bracket size', () => {
    expect(PlayoffService.getRoundName(10, 1)).toBe('Round 1');
    expect(PlayoffService.getRoundName(12, 2)).toBe('Round 2');
  });

  it('returns generic "Round N" for out-of-range round numbers', () => {
    expect(PlayoffService.getRoundName(4, 5)).toBe('Round 5');
    expect(PlayoffService.getRoundName(8, 99)).toBe('Round 99');
  });

  it('returns generic fallback for bracket size 0 or negative', () => {
    expect(PlayoffService.getRoundName(0, 1)).toBe('Round 1');
    expect(PlayoffService.getRoundName(-1, 1)).toBe('Round 1');
  });
});

// =============================================================================
// buildBracketTree — Pure Function (transforms data, no DB calls)
// =============================================================================

describe('PlayoffService.buildBracketTree', () => {
  const baseSeed = (overrides: Partial<PlayoffSeed>): PlayoffSeed => ({
    id: 'seed-1',
    bracket_id: 'bracket-1',
    team_id: 'team-1',
    seed_number: 1,
    regular_season_wins: 10,
    regular_season_losses: 5,
    regular_season_ties: 0,
    regular_season_points_for: 500,
    source: 'standings' as const,
    created_at: '2025-12-01T00:00:00Z',
    ...overrides,
  });

  const baseSeries = (overrides: Partial<PlayoffSeries>): PlayoffSeries => ({
    id: 'series-1',
    bracket_id: 'bracket-1',
    round_number: 1,
    match_number: 1,
    bracket_position: 'winners' as const,
    home_seed: 1,
    away_seed: 4,
    home_team_id: 'team-1',
    away_team_id: 'team-4',
    home_score: 0,
    away_score: 0,
    winner_team_id: null,
    loser_team_id: null,
    status: 'pending' as const,
    matchup_week_1: 22,
    matchup_week_2: null,
    winner_advances_to: null,
    winner_slot: null,
    loser_drops_to: null,
    loser_slot: null,
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2025-12-01T00:00:00Z',
    ...overrides,
  });

  const teamNames: Record<string, string> = {
    'team-1': 'Frost Fangs',
    'team-2': 'Ice Bears',
    'team-3': 'Slap Shots',
    'team-4': 'Puck Dynasty',
    'team-5': 'Net Ninjas',
    'team-6': 'Blue Liners',
  };

  it('separates winners, consolation, and third-place series', () => {
    const series: PlayoffSeries[] = [
      baseSeries({ id: 's1', bracket_position: 'winners', round_number: 1, match_number: 1 }),
      baseSeries({ id: 's2', bracket_position: 'winners', round_number: 1, match_number: 2 }),
      baseSeries({ id: 's3', bracket_position: 'consolation', round_number: 1, match_number: 1 }),
      baseSeries({ id: 's4', bracket_position: 'third_place', round_number: 2, match_number: 1 }),
    ];
    const seeds: PlayoffSeed[] = [
      baseSeed({ team_id: 'team-1', seed_number: 1 }),
    ];

    const tree = PlayoffService.buildBracketTree(series, seeds, teamNames, 4);

    // Winners bracket should have round 1 with 2 series
    expect(tree.winners.get(1)).toHaveLength(2);
    // Consolation should have round 1 with 1 series
    expect(tree.consolation.get(1)).toHaveLength(1);
    // Third place should be set
    expect(tree.thirdPlace).not.toBeNull();
    expect(tree.thirdPlace!.id).toBe('s4');
  });

  it('sorts matchups within each round by match_number', () => {
    const series: PlayoffSeries[] = [
      baseSeries({ id: 's2', bracket_position: 'winners', round_number: 1, match_number: 2 }),
      baseSeries({ id: 's1', bracket_position: 'winners', round_number: 1, match_number: 1 }),
      baseSeries({ id: 's4', bracket_position: 'winners', round_number: 1, match_number: 4 }),
      baseSeries({ id: 's3', bracket_position: 'winners', round_number: 1, match_number: 3 }),
    ];

    const tree = PlayoffService.buildBracketTree(series, [], teamNames, 8);

    const round1 = tree.winners.get(1)!;
    expect(round1[0].match_number).toBe(1);
    expect(round1[1].match_number).toBe(2);
    expect(round1[2].match_number).toBe(3);
    expect(round1[3].match_number).toBe(4);
  });

  it('builds seed map keyed by team_id', () => {
    const seeds: PlayoffSeed[] = [
      baseSeed({ team_id: 'team-1', seed_number: 1 }),
      baseSeed({ id: 'seed-2', team_id: 'team-2', seed_number: 2 }),
      baseSeed({ id: 'seed-3', team_id: 'team-3', seed_number: 3 }),
    ];

    const tree = PlayoffService.buildBracketTree([], seeds, teamNames, 4);

    expect(tree.seedMap.size).toBe(3);
    expect(tree.seedMap.get('team-1')!.seed_number).toBe(1);
    expect(tree.seedMap.get('team-2')!.seed_number).toBe(2);
    expect(tree.seedMap.get('team-3')!.seed_number).toBe(3);
  });

  it('handles empty series and seeds', () => {
    const tree = PlayoffService.buildBracketTree([], [], teamNames, 4);

    expect(tree.winners.size).toBe(0);
    expect(tree.consolation.size).toBe(0);
    expect(tree.thirdPlace).toBeNull();
    expect(tree.seedMap.size).toBe(0);
  });

  it('groups series into correct rounds across multiple rounds', () => {
    const series: PlayoffSeries[] = [
      baseSeries({ id: 's1', bracket_position: 'winners', round_number: 1, match_number: 1 }),
      baseSeries({ id: 's2', bracket_position: 'winners', round_number: 1, match_number: 2 }),
      baseSeries({ id: 's3', bracket_position: 'winners', round_number: 2, match_number: 1 }),
      baseSeries({ id: 's4', bracket_position: 'winners', round_number: 3, match_number: 1 }),
    ];

    const tree = PlayoffService.buildBracketTree(series, [], teamNames, 8);

    expect(tree.winners.get(1)).toHaveLength(2);
    expect(tree.winners.get(2)).toHaveLength(1);
    expect(tree.winners.get(3)).toHaveLength(1);
  });

  it('handles consolation bracket across multiple rounds', () => {
    const series: PlayoffSeries[] = [
      baseSeries({ id: 'c1', bracket_position: 'consolation', round_number: 1, match_number: 1 }),
      baseSeries({ id: 'c2', bracket_position: 'consolation', round_number: 1, match_number: 2 }),
      baseSeries({ id: 'c3', bracket_position: 'consolation', round_number: 2, match_number: 1 }),
    ];

    const tree = PlayoffService.buildBracketTree(series, [], teamNames, 8);

    expect(tree.consolation.get(1)).toHaveLength(2);
    expect(tree.consolation.get(2)).toHaveLength(1);
    expect(tree.winners.size).toBe(0);
  });
});

// =============================================================================
// getBracket — Fetching Bracket Data (Supabase Mocked)
// =============================================================================

describe('PlayoffService.getBracket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns null bracket when no bracket exists for the league', async () => {
    const bracketChain = createChainMock();
    bracketChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    perTableChains({ playoff_brackets: bracketChain });

    const result = await PlayoffService.getBracket('league-no-bracket');
    expect(result.bracket).toBeNull();
    expect(result.seeds).toEqual([]);
    expect(result.series).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('returns bracket with seeds and series when bracket exists', async () => {
    const mockBracket = {
      id: 'bracket-1',
      league_id: 'league-1',
      season: 2025,
      bracket_size: 8,
      status: 'active',
      current_round: 1,
      total_rounds: 3,
      seeding_method: 'standings',
      reseed_each_round: false,
      consolation_enabled: true,
      two_week_matchups: false,
      champion_team_id: null,
      runner_up_team_id: null,
      third_place_team_id: null,
      generated_by: 'user-1',
      started_at: '2025-12-15T00:00:00Z',
      completed_at: null,
      created_at: '2025-12-14T00:00:00Z',
      updated_at: '2025-12-15T00:00:00Z',
    };

    const mockSeeds = [
      { id: 'seed-1', bracket_id: 'bracket-1', team_id: 'team-1', seed_number: 1 },
      { id: 'seed-2', bracket_id: 'bracket-1', team_id: 'team-2', seed_number: 2 },
    ];

    const mockSeries = [
      { id: 'series-1', bracket_id: 'bracket-1', round_number: 1, match_number: 1 },
    ];

    const bracketChain = createChainMock();
    bracketChain.maybeSingle.mockResolvedValue({ data: mockBracket, error: null });

    // Seeds chain: .select().eq().order() — single order call, awaited directly
    const seedsChain = createChainMock();
    seedsChain.order.mockResolvedValue({ data: mockSeeds, error: null });

    // Series chain: .select().eq().order().order() — two order calls.
    // First order returns chain, second order returns the awaited promise.
    const seriesChain = createChainMock();
    let seriesOrderCount = 0;
    seriesChain.order.mockImplementation(() => {
      seriesOrderCount++;
      if (seriesOrderCount >= 2) {
        return Promise.resolve({ data: mockSeries, error: null });
      }
      return seriesChain;
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'playoff_brackets') return bracketChain;
      if (table === 'playoff_seeds') return seedsChain;
      if (table === 'playoff_series') return seriesChain;
      return defaultChain;
    });

    const result = await PlayoffService.getBracket('league-1');
    expect(result.bracket).not.toBeNull();
    expect(result.bracket!.id).toBe('bracket-1');
    expect(result.bracket!.bracket_size).toBe(8);
    expect(result.seeds).toHaveLength(2);
    expect(result.series).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it('returns error when bracket query fails', async () => {
    const bracketChain = createChainMock();
    bracketChain.maybeSingle.mockResolvedValue({
      data: null,
      error: new Error('Connection refused'),
    });

    perTableChains({ playoff_brackets: bracketChain });

    const result = await PlayoffService.getBracket('league-1');
    expect(result.bracket).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Connection refused');
  });

  it('returns error when seeds query fails after bracket is found', async () => {
    const bracketChain = createChainMock();
    bracketChain.maybeSingle.mockResolvedValue({
      data: { id: 'bracket-1' },
      error: null,
    });

    const seedsChain = createChainMock();
    seedsChain.order.mockResolvedValue({
      data: null,
      error: new Error('Seeds table missing'),
    });

    // Series chain needs to support .order().order() (two chained calls)
    const seriesChain = createChainMock();
    let seriesOrderCount = 0;
    seriesChain.order.mockImplementation(() => {
      seriesOrderCount++;
      if (seriesOrderCount >= 2) {
        return Promise.resolve({ data: [], error: null });
      }
      return seriesChain;
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'playoff_brackets') return bracketChain;
      if (table === 'playoff_seeds') return seedsChain;
      if (table === 'playoff_series') return seriesChain;
      return defaultChain;
    });

    const result = await PlayoffService.getBracket('league-1');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Seeds table missing');
  });
});

// =============================================================================
// generateBracket — Bracket Generation Options
// =============================================================================

describe('PlayoffService.generateBracket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('calls RPC with default options when none provided', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { bracket_id: 'new-bracket-1', bracket_size: 8 },
      error: null,
    });

    const result = await PlayoffService.generateBracket('league-1');

    expect(supabase.rpc).toHaveBeenCalledWith('generate_playoff_bracket', {
      p_league_id: 'league-1',
      p_consolation_enabled: false,
      p_two_week_matchups: false,
      p_reseed_each_round: false,
      p_seeding_method: 'standings',
    });
    expect(result.error).toBeNull();
    expect(result.result).toEqual({ bracket_id: 'new-bracket-1', bracket_size: 8 });
  });

  it('passes all custom options to RPC', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { bracket_id: 'new-bracket-2' },
      error: null,
    });

    const options: BracketGenerationOptions = {
      consolationEnabled: true,
      twoWeekMatchups: true,
      reseedEachRound: true,
      seedingMethod: 'manual',
    };

    await PlayoffService.generateBracket('league-1', options);

    expect(supabase.rpc).toHaveBeenCalledWith('generate_playoff_bracket', {
      p_league_id: 'league-1',
      p_consolation_enabled: true,
      p_two_week_matchups: true,
      p_reseed_each_round: true,
      p_seeding_method: 'manual',
    });
  });

  it('passes "standings" seeding method by default', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { bracket_id: 'b-1' },
      error: null,
    });

    await PlayoffService.generateBracket('league-1', { consolationEnabled: true });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'generate_playoff_bracket',
      expect.objectContaining({
        p_seeding_method: 'standings',
      })
    );
  });

  it('returns error when RPC fails', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: new Error('Not enough teams for bracket'),
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Not enough teams');
  });

  it('handles RPC returning error in data payload (string)', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: JSON.stringify({ error: 'Bracket already exists for this season' }),
      error: null,
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Bracket already exists');
  });

  it('handles RPC returning error in data payload (object)', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { error: 'League has no completed regular season' },
      error: null,
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('no completed regular season');
  });

  it('handles unexpected exceptions', async () => {
    (supabase.rpc as any).mockRejectedValue(new Error('Network timeout'));

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Network timeout');
  });
});

// =============================================================================
// advanceRound — Round Advancement
// =============================================================================

describe('PlayoffService.advanceRound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('calls RPC with bracket ID and returns result', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { advanced_to_round: 2, series_created: 2 },
      error: null,
    });

    const result = await PlayoffService.advanceRound('bracket-1');

    expect(supabase.rpc).toHaveBeenCalledWith('advance_playoff_round', {
      p_bracket_id: 'bracket-1',
    });
    expect(result.error).toBeNull();
    expect(result.result).toEqual({ advanced_to_round: 2, series_created: 2 });
  });

  it('returns error when RPC fails', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: new Error('Round not complete yet'),
    });

    const result = await PlayoffService.advanceRound('bracket-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Round not complete');
  });

  it('handles data-level error from RPC (string response)', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: JSON.stringify({ error: 'Cannot advance - not all series are completed' }),
      error: null,
    });

    const result = await PlayoffService.advanceRound('bracket-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('not all series');
  });

  it('handles data-level error from RPC (object response)', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { error: 'Bracket is already completed' },
      error: null,
    });

    const result = await PlayoffService.advanceRound('bracket-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('already completed');
  });

  it('handles unexpected exceptions', async () => {
    (supabase.rpc as any).mockRejectedValue(new Error('Service unavailable'));

    const result = await PlayoffService.advanceRound('bracket-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Service unavailable');
  });
});

// =============================================================================
// resetBracket — Bracket Reset
// =============================================================================

describe('PlayoffService.resetBracket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('calls RPC and returns success', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    const result = await PlayoffService.resetBracket('league-1');

    expect(supabase.rpc).toHaveBeenCalledWith('reset_playoff_bracket', {
      p_league_id: 'league-1',
    });
    expect(result.error).toBeNull();
  });

  it('returns error when RPC fails', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: new Error('Permission denied'),
    });

    const result = await PlayoffService.resetBracket('league-1');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Permission denied');
  });

  it('handles data-level error from RPC', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { error: 'No bracket to reset' },
      error: null,
    });

    const result = await PlayoffService.resetBracket('league-1');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('No bracket to reset');
  });

  it('handles unexpected exceptions', async () => {
    (supabase.rpc as any).mockRejectedValue(new Error('DB crash'));

    const result = await PlayoffService.resetBracket('league-1');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('DB crash');
  });
});

// =============================================================================
// getPlayoffPicture — Playoff Picture / Clinch / Elimination
// =============================================================================

describe('PlayoffService.getPlayoffPicture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns playoff picture data from RPC', async () => {
    const mockPicture = {
      playoff_teams: 6,
      total_teams: 12,
      weeks_completed: 18,
      remaining_weeks: 4,
      teams: [
        {
          team_id: 'team-1',
          team_name: 'Frost Fangs',
          rank: 1,
          wins: 14,
          losses: 4,
          ties: 0,
          pf: 1200,
          pa: 900,
          clinch_status: 'clinched',
          magic_number: 0,
        },
        {
          team_id: 'team-12',
          team_name: 'Bench Warmers',
          rank: 12,
          wins: 3,
          losses: 15,
          ties: 0,
          pf: 600,
          pa: 1400,
          clinch_status: 'eliminated',
          magic_number: -1,
        },
      ],
    };

    (supabase.rpc as any).mockResolvedValue({ data: mockPicture, error: null });

    const result = await PlayoffService.getPlayoffPicture('league-1');
    expect(result.error).toBeNull();
    expect(result.picture).not.toBeNull();
    expect(result.picture!.playoff_teams).toBe(6);
    expect(result.picture!.total_teams).toBe(12);
    expect(result.picture!.teams).toHaveLength(2);
    expect(result.picture!.teams[0].clinch_status).toBe('clinched');
    expect(result.picture!.teams[1].clinch_status).toBe('eliminated');
  });

  it('returns null picture on RPC error', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: new Error('League has no standings'),
    });

    const result = await PlayoffService.getPlayoffPicture('league-1');
    expect(result.picture).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('no standings');
  });

  it('handles string data response (JSON parsing)', async () => {
    const mockPicture = {
      playoff_teams: 4,
      total_teams: 8,
      weeks_completed: 20,
      remaining_weeks: 2,
      teams: [],
    };

    (supabase.rpc as any).mockResolvedValue({
      data: JSON.stringify(mockPicture),
      error: null,
    });

    const result = await PlayoffService.getPlayoffPicture('league-1');
    expect(result.picture).not.toBeNull();
    expect(result.picture!.playoff_teams).toBe(4);
  });

  it('handles data-level error from RPC', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { error: 'Season not started' },
      error: null,
    });

    const result = await PlayoffService.getPlayoffPicture('league-1');
    expect(result.picture).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Season not started');
  });

  it('handles data-level error from RPC (string format)', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: JSON.stringify({ error: 'Insufficient data' }),
      error: null,
    });

    const result = await PlayoffService.getPlayoffPicture('league-1');
    expect(result.picture).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Insufficient data');
  });

  it('handles unexpected exceptions', async () => {
    (supabase.rpc as any).mockRejectedValue(new Error('Unexpected failure'));

    const result = await PlayoffService.getPlayoffPicture('league-1');
    expect(result.picture).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Unexpected failure');
  });

  it('calls RPC with the correct league ID parameter', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: { teams: [] }, error: null });

    await PlayoffService.getPlayoffPicture('my-league-id');

    expect(supabase.rpc).toHaveBeenCalledWith('get_playoff_picture', {
      p_league_id: 'my-league-id',
    });
  });
});

// =============================================================================
// isCommissioner — Commissioner Check
// =============================================================================

describe('PlayoffService.isCommissioner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns true when user is the commissioner', async () => {
    const leagueChain = createChainMock();
    leagueChain.maybeSingle.mockResolvedValue({
      data: { commissioner_id: 'user-1' },
      error: null,
    });

    perTableChains({ leagues: leagueChain });

    const result = await PlayoffService.isCommissioner('league-1', 'user-1');
    expect(result).toBe(true);
  });

  it('returns false when user is not the commissioner', async () => {
    const leagueChain = createChainMock();
    leagueChain.maybeSingle.mockResolvedValue({
      data: { commissioner_id: 'user-1' },
      error: null,
    });

    perTableChains({ leagues: leagueChain });

    const result = await PlayoffService.isCommissioner('league-1', 'user-2');
    expect(result).toBe(false);
  });

  it('returns false when league is not found', async () => {
    const leagueChain = createChainMock();
    leagueChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    perTableChains({ leagues: leagueChain });

    const result = await PlayoffService.isCommissioner('missing-league', 'user-1');
    expect(result).toBe(false);
  });

  it('returns false when query throws an error', async () => {
    const leagueChain = createChainMock();
    leagueChain.maybeSingle.mockRejectedValue(new Error('DB error'));

    perTableChains({ leagues: leagueChain });

    const result = await PlayoffService.isCommissioner('league-1', 'user-1');
    expect(result).toBe(false);
  });
});

// =============================================================================
// Bracket Size Validation (via generateBracket)
// =============================================================================

describe('PlayoffService bracket size handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('generates bracket for 4-team size', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { bracket_id: 'b-4', bracket_size: 4, total_rounds: 2 },
      error: null,
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toEqual(
      expect.objectContaining({ bracket_size: 4 })
    );
  });

  it('generates bracket for 6-team size', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { bracket_id: 'b-6', bracket_size: 6, total_rounds: 3 },
      error: null,
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toEqual(
      expect.objectContaining({ bracket_size: 6 })
    );
  });

  it('generates bracket for 8-team size', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { bracket_id: 'b-8', bracket_size: 8, total_rounds: 3 },
      error: null,
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toEqual(
      expect.objectContaining({ bracket_size: 8 })
    );
  });

  it('RPC rejects invalid bracket size gracefully', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { error: 'Invalid bracket size: 5. Must be 4, 6, or 8.' },
      error: null,
    });

    const result = await PlayoffService.generateBracket('league-too-small');
    expect(result.result).toBeNull();
    expect(result.error!.message).toContain('Invalid bracket size');
  });
});

// =============================================================================
// Seeding Method Options
// =============================================================================

describe('PlayoffService seeding methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('defaults to standings-based seeding', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: {}, error: null });

    await PlayoffService.generateBracket('league-1');

    expect(supabase.rpc).toHaveBeenCalledWith(
      'generate_playoff_bracket',
      expect.objectContaining({ p_seeding_method: 'standings' })
    );
  });

  it('passes manual seeding method when specified', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: {}, error: null });

    await PlayoffService.generateBracket('league-1', { seedingMethod: 'manual' });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'generate_playoff_bracket',
      expect.objectContaining({ p_seeding_method: 'manual' })
    );
  });

  it('passes reseedEachRound option correctly', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: {}, error: null });

    await PlayoffService.generateBracket('league-1', { reseedEachRound: true });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'generate_playoff_bracket',
      expect.objectContaining({ p_reseed_each_round: true })
    );
  });
});

// =============================================================================
// Integration: Full Bracket Flow Simulation
// =============================================================================

describe('PlayoffService full bracket flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('generate → advance → advance → complete flow', async () => {
    // Step 1: Generate
    (supabase.rpc as any).mockResolvedValueOnce({
      data: { bracket_id: 'flow-bracket', bracket_size: 4, total_rounds: 2 },
      error: null,
    });

    const genResult = await PlayoffService.generateBracket('league-flow');
    expect(genResult.error).toBeNull();
    expect(genResult.result.bracket_id).toBe('flow-bracket');

    // Step 2: Advance round 1 → round 2
    (supabase.rpc as any).mockResolvedValueOnce({
      data: { advanced_to_round: 2, series_created: 1 },
      error: null,
    });

    const advResult1 = await PlayoffService.advanceRound('flow-bracket');
    expect(advResult1.error).toBeNull();
    expect(advResult1.result.advanced_to_round).toBe(2);

    // Step 3: Advance round 2 → championship complete
    (supabase.rpc as any).mockResolvedValueOnce({
      data: { bracket_completed: true, champion_team_id: 'team-1' },
      error: null,
    });

    const advResult2 = await PlayoffService.advanceRound('flow-bracket');
    expect(advResult2.error).toBeNull();
    expect(advResult2.result.bracket_completed).toBe(true);
    expect(advResult2.result.champion_team_id).toBe('team-1');
  });

  it('generate → reset flow', async () => {
    (supabase.rpc as any).mockResolvedValueOnce({
      data: { bracket_id: 'reset-bracket' },
      error: null,
    });

    const genResult = await PlayoffService.generateBracket('league-reset');
    expect(genResult.error).toBeNull();

    (supabase.rpc as any).mockResolvedValueOnce({ data: null, error: null });

    const resetResult = await PlayoffService.resetBracket('league-reset');
    expect(resetResult.error).toBeNull();
  });
});
