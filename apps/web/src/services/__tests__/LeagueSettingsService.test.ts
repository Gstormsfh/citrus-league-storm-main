import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules
// =============================================================================

const mockSupabaseFrom = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

vi.mock('../LeagueMembershipService', () => ({
  LeagueMembershipService: {
    requireCommissioner: vi.fn(),
  },
}));

vi.mock('@/api/notifications', () => ({
  notificationApi: {
    sendChatMessage: vi.fn().mockResolvedValue({}),
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
import { LeagueMembershipService } from '../LeagueMembershipService';

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Helper to build a chainable Supabase mock
// =============================================================================

function setupSupabaseChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, any> = {
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  // Every chainable method returns the chain
  Object.keys(chain).forEach(key => {
    if (typeof chain[key] === 'function' && !['single'].includes(key)) {
      chain[key] = vi.fn().mockReturnValue(chain);
    }
  });
  if (overrides.single) {
    chain.single = overrides.single;
  }
  if (overrides.update) {
    chain.update = overrides.update;
  }
  mockSupabaseFrom.mockReturnValue(chain);
  return chain;
}

// =============================================================================
// updateWaiverSettings
// =============================================================================

describe('LeagueSettingsService.updateWaiverSettings', () => {
  it('updates waiver settings successfully', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    const chain = setupSupabaseChain();
    chain.eq = vi.fn().mockReturnValue({ error: null });

    const result = await LeagueSettingsService.updateWaiverSettings(
      'league-1',
      'user-1',
      { waiver_type: 'rolling', waiver_period_hours: 24 }
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(LeagueMembershipService.requireCommissioner).toHaveBeenCalledWith('league-1', 'user-1');
  });

  it('returns error when user is not commissioner', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockRejectedValue(
      new Error('Not a commissioner')
    );

    const result = await LeagueSettingsService.updateWaiverSettings(
      'league-1',
      'user-not-comm',
      { waiver_type: 'rolling' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns error when Supabase update fails', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    const chain = setupSupabaseChain();
    chain.eq = vi.fn().mockReturnValue({ error: { message: 'DB error' } });

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
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    // First call: select draft_status -> returns 'pre_draft'
    // Second call: update scoring_settings
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // select draft_status
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { draft_status: 'pre_draft' }, error: null }),
            }),
          }),
        };
      }
      // update scoring_settings
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ error: null }),
        }),
      };
    });

    const result = await LeagueSettingsService.updateScoringSettings(
      'league-1',
      'user-1',
      { skater: { goals: 3, assists: 2 } }
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  it('blocks scoring changes after games have started', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // select draft_status -> completed
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { draft_status: 'completed' }, error: null }),
            }),
          }),
        };
      }
      // count fantasy_daily_rosters -> 5
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            data: null,
            count: 5,
            error: null,
          }),
        }),
      };
    });

    const result = await LeagueSettingsService.updateScoringSettings(
      'league-1',
      'user-1',
      { skater: { goals: 5 } }
    );

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain('Scoring settings cannot be changed');
  });

  it('returns error when user is not commissioner', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockRejectedValue(
      new Error('Not a commissioner')
    );

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
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // select settings, draft_rounds
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { settings: {}, draft_rounds: 15 },
                error: null,
              }),
            }),
          }),
        };
      }
      // update
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ error: null }),
        }),
      };
    });

    const result = await LeagueSettingsService.updateDraftSettings(
      'league-1',
      'user-1',
      { draft_rounds: 20 }
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  it('updates pickTimeLimit into settings JSONB', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { settings: { keeperEnabled: false }, draft_rounds: 15 },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ error: null }),
        }),
      };
    });

    const result = await LeagueSettingsService.updateDraftSettings(
      'league-1',
      'user-1',
      { pickTimeLimit: 120 }
    );

    expect(result.success).toBe(true);
  });

  it('returns error when user is not commissioner', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockRejectedValue(
      new Error('Forbidden')
    );

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
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { settings: {}, draft_status: 'pre_draft' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ error: null }),
        }),
      };
    });

    const result = await LeagueSettingsService.updateKeeperSettings(
      'league-1',
      'user-1',
      { keeperEnabled: true, keeperCount: 3, keeperPenalty: 'round-cost', dynastyMode: false }
    );

    expect(result.success).toBe(true);
  });

  it('blocks keeper changes after draft is completed', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { settings: {}, draft_status: 'completed' },
            error: null,
          }),
        }),
      }),
    });

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
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { settings: {}, draft_status: 'pre_draft' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ error: null }),
        }),
      };
    });

    const result = await LeagueSettingsService.updateCategorySettings(
      'league-1',
      'user-1',
      ['goals', 'assists', 'points', 'hits']
    );

    expect(result.success).toBe(true);
  });

  it('blocks category changes after draft is completed', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { settings: {}, draft_status: 'completed' },
            error: null,
          }),
        }),
      }),
    });

    const result = await LeagueSettingsService.updateCategorySettings(
      'league-1',
      'user-1',
      ['goals', 'assists', 'points']
    );

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain('Category settings cannot be changed');
  });

  it('requires at least 2 categories', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { settings: {}, draft_status: 'pre_draft' },
            error: null,
          }),
        }),
      }),
    });

    const result = await LeagueSettingsService.updateCategorySettings(
      'league-1',
      'user-1',
      ['goals'] // only 1 category
    );

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain('At least 2 categories');
  });

  it('returns error when user is not commissioner', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockRejectedValue(
      new Error('Not commissioner')
    );

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
  it('updates roster slots and calculates total correctly', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    let callCount = 0;
    const updateFn = vi.fn();
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { settings: {}, draft_status: 'pre_draft' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        update: updateFn.mockReturnValue({
          eq: vi.fn().mockReturnValue({ error: null }),
        }),
      };
    });

    const rosterSlots = { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1, BN: 4, IR: 1 };
    const result = await LeagueSettingsService.updateRosterSlotSettings(
      'league-1',
      'user-1',
      rosterSlots
    );

    expect(result.success).toBe(true);
    // Total slots = 2+2+2+4+2+1+4+1 = 18
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        roster_size: 18,
        settings: expect.objectContaining({ rosterSlots }),
      })
    );
  });

  it('blocks roster slot changes after draft is completed', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { settings: {}, draft_status: 'completed' },
            error: null,
          }),
        }),
      }),
    });

    const result = await LeagueSettingsService.updateRosterSlotSettings(
      'league-1',
      'user-1',
      { C: 2 }
    );

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toContain('Roster slots cannot be changed');
  });

  it('returns error when user is not commissioner', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockRejectedValue(
      new Error('Forbidden')
    );

    const result = await LeagueSettingsService.updateRosterSlotSettings(
      'league-1',
      'user-bad',
      { C: 2 }
    );

    expect(result.success).toBe(false);
  });
});
