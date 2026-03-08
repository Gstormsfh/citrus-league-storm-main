import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCK SETUP
// =============================================================================

vi.mock('@/api/playoffs', () => ({
  playoffApi: {
    getBracket: vi.fn(),
    generateBracket: vi.fn(),
    advanceRound: vi.fn(),
    resetBracket: vi.fn(),
    getPlayoffPicture: vi.fn(),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// =============================================================================
// Import AFTER mocks
// =============================================================================

import { playoffApi } from '@/api/playoffs';
import { PlayoffService } from '../PlayoffService';
import type {
  PlayoffSeries,
  PlayoffSeed,
  BracketGenerationOptions,
} from '../PlayoffService';

beforeEach(() => {
  vi.clearAllMocks();
});

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
// getBracket — Fetching Bracket Data (API Mocked)
// =============================================================================

describe('PlayoffService.getBracket', () => {
  it('returns null bracket when no bracket exists for the league', async () => {
    (playoffApi.getBracket as any).mockResolvedValue({
      data: { bracket: null, seeds: [], series: [] },
      error: undefined,
    });

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

    (playoffApi.getBracket as any).mockResolvedValue({
      data: {
        bracket: mockBracket,
        seeds: mockSeeds,
        series: mockSeries,
      },
      error: undefined,
    });

    const result = await PlayoffService.getBracket('league-1');
    expect(result.bracket).not.toBeNull();
    expect(result.bracket!.id).toBe('bracket-1');
    expect(result.bracket!.bracket_size).toBe(8);
    expect(result.seeds).toHaveLength(2);
    expect(result.series).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it('returns error when API call fails', async () => {
    (playoffApi.getBracket as any).mockResolvedValue({
      data: null,
      error: 'Connection refused',
    });

    const result = await PlayoffService.getBracket('league-1');
    expect(result.bracket).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Connection refused');
  });

  it('returns error when API throws an exception', async () => {
    (playoffApi.getBracket as any).mockRejectedValue(new Error('Network error'));

    const result = await PlayoffService.getBracket('league-1');
    expect(result.bracket).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Network error');
  });
});

// =============================================================================
// generateBracket — Bracket Generation Options
// =============================================================================

describe('PlayoffService.generateBracket', () => {
  it('calls API with default options when none provided', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: { bracket_id: 'new-bracket-1', bracket_size: 8 },
      error: undefined,
    });

    const result = await PlayoffService.generateBracket('league-1');

    expect(playoffApi.generateBracket).toHaveBeenCalledWith('league-1', {});
    expect(result.error).toBeNull();
    expect(result.result).toEqual({ bracket_id: 'new-bracket-1', bracket_size: 8 });
  });

  it('passes all custom options to API', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: { bracket_id: 'new-bracket-2' },
      error: undefined,
    });

    const options: BracketGenerationOptions = {
      consolationEnabled: true,
      twoWeekMatchups: true,
      reseedEachRound: true,
      seedingMethod: 'manual',
    };

    await PlayoffService.generateBracket('league-1', options);

    expect(playoffApi.generateBracket).toHaveBeenCalledWith('league-1', options);
  });

  it('passes partial options to API', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: { bracket_id: 'b-1' },
      error: undefined,
    });

    await PlayoffService.generateBracket('league-1', { consolationEnabled: true });

    expect(playoffApi.generateBracket).toHaveBeenCalledWith('league-1', {
      consolationEnabled: true,
    });
  });

  it('returns error when API returns error', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: null,
      error: 'Not enough teams for bracket',
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Not enough teams');
  });

  it('handles unexpected exceptions', async () => {
    (playoffApi.generateBracket as any).mockRejectedValue(new Error('Network timeout'));

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
  it('calls API with bracket ID and returns result', async () => {
    (playoffApi.advanceRound as any).mockResolvedValue({
      data: { advanced_to_round: 2, series_created: 2 },
      error: undefined,
    });

    const result = await PlayoffService.advanceRound('bracket-1');

    expect(playoffApi.advanceRound).toHaveBeenCalledWith('bracket-1');
    expect(result.error).toBeNull();
    expect(result.result).toEqual({ advanced_to_round: 2, series_created: 2 });
  });

  it('returns error when API returns error', async () => {
    (playoffApi.advanceRound as any).mockResolvedValue({
      data: null,
      error: 'Round not complete yet',
    });

    const result = await PlayoffService.advanceRound('bracket-1');
    expect(result.result).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Round not complete');
  });

  it('handles unexpected exceptions', async () => {
    (playoffApi.advanceRound as any).mockRejectedValue(new Error('Service unavailable'));

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
  it('calls API and returns success', async () => {
    (playoffApi.resetBracket as any).mockResolvedValue({ data: null, error: undefined });

    const result = await PlayoffService.resetBracket('league-1');

    expect(playoffApi.resetBracket).toHaveBeenCalledWith('league-1');
    expect(result.error).toBeNull();
  });

  it('returns error when API returns error', async () => {
    (playoffApi.resetBracket as any).mockResolvedValue({
      data: null,
      error: 'Permission denied',
    });

    const result = await PlayoffService.resetBracket('league-1');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Permission denied');
  });

  it('handles unexpected exceptions', async () => {
    (playoffApi.resetBracket as any).mockRejectedValue(new Error('DB crash'));

    const result = await PlayoffService.resetBracket('league-1');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('DB crash');
  });
});

// =============================================================================
// getPlayoffPicture — Playoff Picture / Clinch / Elimination
// =============================================================================

describe('PlayoffService.getPlayoffPicture', () => {
  it('returns playoff picture data from API', async () => {
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

    (playoffApi.getPlayoffPicture as any).mockResolvedValue({ data: mockPicture, error: undefined });

    const result = await PlayoffService.getPlayoffPicture('league-1');
    expect(result.error).toBeNull();
    expect(result.picture).not.toBeNull();
    expect(result.picture!.playoff_teams).toBe(6);
    expect(result.picture!.total_teams).toBe(12);
    expect(result.picture!.teams).toHaveLength(2);
    expect(result.picture!.teams[0].clinch_status).toBe('clinched');
    expect(result.picture!.teams[1].clinch_status).toBe('eliminated');
  });

  it('returns null picture on API error', async () => {
    (playoffApi.getPlayoffPicture as any).mockResolvedValue({
      data: null,
      error: 'League has no standings',
    });

    const result = await PlayoffService.getPlayoffPicture('league-1');
    expect(result.picture).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('no standings');
  });

  it('handles unexpected exceptions', async () => {
    (playoffApi.getPlayoffPicture as any).mockRejectedValue(new Error('Unexpected failure'));

    const result = await PlayoffService.getPlayoffPicture('league-1');
    expect(result.picture).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('Unexpected failure');
  });

  it('calls API with the correct league ID', async () => {
    (playoffApi.getPlayoffPicture as any).mockResolvedValue({
      data: { playoff_teams: 4, total_teams: 8, weeks_completed: 20, remaining_weeks: 2, teams: [] },
      error: undefined,
    });

    await PlayoffService.getPlayoffPicture('my-league-id');

    expect(playoffApi.getPlayoffPicture).toHaveBeenCalledWith('my-league-id');
  });
});

// =============================================================================
// Bracket Size Validation (via generateBracket)
// =============================================================================

describe('PlayoffService bracket size handling', () => {
  it('generates bracket for 4-team size', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: { bracket_id: 'b-4', bracket_size: 4, total_rounds: 2 },
      error: undefined,
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toEqual(
      expect.objectContaining({ bracket_size: 4 })
    );
  });

  it('generates bracket for 6-team size', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: { bracket_id: 'b-6', bracket_size: 6, total_rounds: 3 },
      error: undefined,
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toEqual(
      expect.objectContaining({ bracket_size: 6 })
    );
  });

  it('generates bracket for 8-team size', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: { bracket_id: 'b-8', bracket_size: 8, total_rounds: 3 },
      error: undefined,
    });

    const result = await PlayoffService.generateBracket('league-1');
    expect(result.result).toEqual(
      expect.objectContaining({ bracket_size: 8 })
    );
  });

  it('API rejects invalid bracket size gracefully', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: null,
      error: 'Invalid bracket size: 5. Must be 4, 6, or 8.',
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
  it('passes no seeding method when not specified (defaults handled server-side)', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({ data: {}, error: undefined });

    await PlayoffService.generateBracket('league-1');

    expect(playoffApi.generateBracket).toHaveBeenCalledWith('league-1', {});
  });

  it('passes manual seeding method when specified', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({ data: {}, error: undefined });

    await PlayoffService.generateBracket('league-1', { seedingMethod: 'manual' });

    expect(playoffApi.generateBracket).toHaveBeenCalledWith('league-1', {
      seedingMethod: 'manual',
    });
  });

  it('passes reseedEachRound option correctly', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({ data: {}, error: undefined });

    await PlayoffService.generateBracket('league-1', { reseedEachRound: true });

    expect(playoffApi.generateBracket).toHaveBeenCalledWith('league-1', {
      reseedEachRound: true,
    });
  });
});

// =============================================================================
// Integration: Full Bracket Flow Simulation
// =============================================================================

describe('PlayoffService full bracket flow', () => {
  it('generate → advance → advance → complete flow', async () => {
    // Step 1: Generate
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: { bracket_id: 'flow-bracket', bracket_size: 4, total_rounds: 2 },
      error: undefined,
    });

    const genResult = await PlayoffService.generateBracket('league-flow');
    expect(genResult.error).toBeNull();
    expect(genResult.result.bracket_id).toBe('flow-bracket');

    // Step 2: Advance round 1 → round 2
    (playoffApi.advanceRound as any).mockResolvedValue({
      data: { advanced_to_round: 2, series_created: 1 },
      error: undefined,
    });

    const advResult1 = await PlayoffService.advanceRound('flow-bracket');
    expect(advResult1.error).toBeNull();
    expect(advResult1.result.advanced_to_round).toBe(2);

    // Step 3: Advance round 2 → championship complete
    (playoffApi.advanceRound as any).mockResolvedValue({
      data: { bracket_completed: true, champion_team_id: 'team-1' },
      error: undefined,
    });

    const advResult2 = await PlayoffService.advanceRound('flow-bracket');
    expect(advResult2.error).toBeNull();
    expect(advResult2.result.bracket_completed).toBe(true);
    expect(advResult2.result.champion_team_id).toBe('team-1');
  });

  it('generate → reset flow', async () => {
    (playoffApi.generateBracket as any).mockResolvedValue({
      data: { bracket_id: 'reset-bracket' },
      error: undefined,
    });

    const genResult = await PlayoffService.generateBracket('league-reset');
    expect(genResult.error).toBeNull();

    (playoffApi.resetBracket as any).mockResolvedValue({ data: null, error: undefined });

    const resetResult = await PlayoffService.resetBracket('league-reset');
    expect(resetResult.error).toBeNull();
  });
});
