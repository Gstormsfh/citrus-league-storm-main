import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules
// =============================================================================

const mockUpdateWaiverSettings = vi.fn();
const mockUpdateScoringSettings = vi.fn();
const mockUpdateDraftSettings = vi.fn();
const mockUpdateKeeperSettings = vi.fn();
const mockUpdateCategorySettings = vi.fn();
const mockUpdateRosterSlots = vi.fn();

vi.mock('@/api/leagues', () => ({
  leagueApi: {
    updateWaiverSettings: (...args: unknown[]) => mockUpdateWaiverSettings(...args),
    updateScoringSettings: (...args: unknown[]) => mockUpdateScoringSettings(...args),
    updateDraftSettings: (...args: unknown[]) => mockUpdateDraftSettings(...args),
    updateKeeperSettings: (...args: unknown[]) => mockUpdateKeeperSettings(...args),
    updateCategorySettings: (...args: unknown[]) => mockUpdateCategorySettings(...args),
    updateRosterSlots: (...args: unknown[]) => mockUpdateRosterSlots(...args),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// =============================================================================
// Import AFTER mocks
// =============================================================================

import { LeagueSettingsService } from '../LeagueSettingsService';

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// updateWaiverSettings
// =============================================================================

describe('LeagueSettingsService.updateWaiverSettings', () => {
  it('updates waiver settings successfully', async () => {
    mockUpdateWaiverSettings.mockResolvedValue({});

    const result = await LeagueSettingsService.updateWaiverSettings(
      'league-1',
      'user-1',
      { waiver_type: 'rolling', waiver_period_hours: 24 }
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(mockUpdateWaiverSettings).toHaveBeenCalledWith('league-1', {
      waiver_type: 'rolling',
      waiver_period_hours: 24,
    });
  });

  it('returns error when user is not commissioner', async () => {
    mockUpdateWaiverSettings.mockRejectedValue(new Error('Not a commissioner'));

    const result = await LeagueSettingsService.updateWaiverSettings(
      'league-1',
      'user-not-comm',
      { waiver_type: 'rolling' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns error when API update fails', async () => {
    mockUpdateWaiverSettings.mockRejectedValue(new Error('DB error'));

    const result = await LeagueSettingsService.updateWaiverSettings(
      'league-1',
      'user-1',
      { waiver_period_hours: 48 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// =============================================================================
// updateScoringSettings
// =============================================================================

describe('LeagueSettingsService.updateScoringSettings', () => {
  it('updates scoring settings successfully when draft is not completed', async () => {
    mockUpdateScoringSettings.mockResolvedValue({});

    const result = await LeagueSettingsService.updateScoringSettings(
      'league-1',
      'user-1',
      { skater: { goals: 3, assists: 2 } }
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  it('blocks scoring changes after games have started', async () => {
    mockUpdateScoringSettings.mockRejectedValue(
      new Error('Scoring settings cannot be changed after games have started')
    );

    const result = await LeagueSettingsService.updateScoringSettings(
      'league-1',
      'user-1',
      { skater: { goals: 5 } }
    );

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain('Scoring settings cannot be changed');
  });

  it('returns error when user is not commissioner', async () => {
    mockUpdateScoringSettings.mockRejectedValue(new Error('Not a commissioner'));

    const result = await LeagueSettingsService.updateScoringSettings(
      'league-1',
      'user-1',
      { skater: { goals: 3 } }
    );

    expect(result.success).toBe(false);
  });
});

// =============================================================================
// updateDraftSettings
// =============================================================================

describe('LeagueSettingsService.updateDraftSettings', () => {
  it('updates draft rounds successfully', async () => {
    mockUpdateDraftSettings.mockResolvedValue({});

    const result = await LeagueSettingsService.updateDraftSettings(
      'league-1',
      'user-1',
      { draft_rounds: 20 }
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(mockUpdateDraftSettings).toHaveBeenCalledWith('league-1', { draft_rounds: 20 });
  });

  it('updates pickTimeLimit into settings JSONB', async () => {
    mockUpdateDraftSettings.mockResolvedValue({});

    const result = await LeagueSettingsService.updateDraftSettings(
      'league-1',
      'user-1',
      { pickTimeLimit: 120 }
    );

    expect(result.success).toBe(true);
    expect(mockUpdateDraftSettings).toHaveBeenCalledWith('league-1', { pickTimeLimit: 120 });
  });

  it('returns error when user is not commissioner', async () => {
    mockUpdateDraftSettings.mockRejectedValue(new Error('Forbidden'));

    const result = await LeagueSettingsService.updateDraftSettings(
      'league-1',
      'user-bad',
      { draft_rounds: 5 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// =============================================================================
// updateKeeperSettings
// =============================================================================

describe('LeagueSettingsService.updateKeeperSettings', () => {
  it('updates keeper settings successfully before draft', async () => {
    mockUpdateKeeperSettings.mockResolvedValue({});

    const result = await LeagueSettingsService.updateKeeperSettings(
      'league-1',
      'user-1',
      { keeperEnabled: true, keeperCount: 3, keeperPenalty: 'round-cost', dynastyMode: false }
    );

    expect(result.success).toBe(true);
  });

  it('blocks keeper changes after draft is completed', async () => {
    mockUpdateKeeperSettings.mockRejectedValue(
      new Error('Keeper settings cannot be changed after the draft is completed')
    );

    const result = await LeagueSettingsService.updateKeeperSettings(
      'league-1',
      'user-1',
      { keeperEnabled: true, keeperCount: 3, keeperPenalty: 'none', dynastyMode: false }
    );

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain('Keeper settings cannot be changed');
  });
});

// =============================================================================
// updateCategorySettings
// =============================================================================

describe('LeagueSettingsService.updateCategorySettings', () => {
  it('updates categories successfully before draft', async () => {
    mockUpdateCategorySettings.mockResolvedValue({});

    const result = await LeagueSettingsService.updateCategorySettings(
      'league-1',
      'user-1',
      ['goals', 'assists', 'points', 'hits']
    );

    expect(result.success).toBe(true);
  });

  it('blocks category changes after draft is completed', async () => {
    mockUpdateCategorySettings.mockRejectedValue(
      new Error('Category settings cannot be changed after the draft is completed')
    );

    const result = await LeagueSettingsService.updateCategorySettings(
      'league-1',
      'user-1',
      ['goals', 'assists', 'points']
    );

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain('Category settings cannot be changed');
  });

  it('requires at least 2 categories', async () => {
    mockUpdateCategorySettings.mockRejectedValue(
      new Error('At least 2 categories are required')
    );

    const result = await LeagueSettingsService.updateCategorySettings(
      'league-1',
      'user-1',
      ['goals'] // only 1 category
    );

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain('At least 2 categories');
  });

  it('returns error when user is not commissioner', async () => {
    mockUpdateCategorySettings.mockRejectedValue(new Error('Not commissioner'));

    const result = await LeagueSettingsService.updateCategorySettings(
      'league-1',
      'user-bad',
      ['goals', 'assists']
    );

    expect(result.success).toBe(false);
  });
});

// =============================================================================
// updateRosterSlotSettings
// =============================================================================

describe('LeagueSettingsService.updateRosterSlotSettings', () => {
  it('updates roster slots successfully', async () => {
    mockUpdateRosterSlots.mockResolvedValue({});

    const rosterSlots = { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1, BN: 4, IR: 1 };
    const result = await LeagueSettingsService.updateRosterSlotSettings(
      'league-1',
      'user-1',
      rosterSlots
    );

    expect(result.success).toBe(true);
    expect(mockUpdateRosterSlots).toHaveBeenCalledWith('league-1', rosterSlots);
  });

  it('blocks roster slot changes after draft is completed', async () => {
    mockUpdateRosterSlots.mockRejectedValue(
      new Error('Roster slots cannot be changed after the draft is completed')
    );

    const result = await LeagueSettingsService.updateRosterSlotSettings(
      'league-1',
      'user-1',
      { C: 2 }
    );

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain('Roster slots cannot be changed');
  });

  it('returns error when user is not commissioner', async () => {
    mockUpdateRosterSlots.mockRejectedValue(new Error('Forbidden'));

    const result = await LeagueSettingsService.updateRosterSlotSettings(
      'league-1',
      'user-bad',
      { C: 2 }
    );

    expect(result.success).toBe(false);
  });
});
