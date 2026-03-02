import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaiverService } from '../WaiverService';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Build a chainable mock factory. Each chainable method returns `this` so that
// calls like `.from('x').select('y').eq('a', 'b').single()` work seamlessly.
// Terminal methods (`single`, `maybeSingle`) are separate so tests can override
// the resolved value per-call.

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
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
    },
  },
}));

vi.mock('../PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../GameLockService', () => ({
  GameLockService: {
    isPlayerLocked: vi.fn().mockResolvedValue({ isLocked: false, gameStatus: 'not_started' }),
  },
}));

vi.mock('../LeagueMembershipService', () => ({
  LeagueMembershipService: {
    requireMembership: vi.fn().mockResolvedValue(undefined),
    requireCommissioner: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/utils/queryColumns', () => ({
  COLUMNS: {
    WAIVER: 'id, league_id, team_id, player_id, drop_player_id, priority, bid_amount, is_conditional_drop, status, created_at, processed_at, failure_reason',
  },
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: 2025,
}));

// Grab the mocked modules so we can configure them per-test
import { supabase } from '@/integrations/supabase/client';
import { GameLockService } from '../GameLockService';
import { LeagueMembershipService } from '../LeagueMembershipService';

// =============================================================================
// HELPERS
// =============================================================================

/** Rebuild a fresh chain mock and wire it into `supabase.from`. */
function resetChain() {
  defaultChain = createChainMock();
  (supabase.from as any).mockReturnValue(defaultChain);
}

/**
 * Configure `supabase.from` to return different chain mocks depending on the
 * table name. This is critical for methods that query multiple tables.
 *
 * Usage:
 *   const chains = perTableChains({ leagues: leagueChain, transaction_ledger: txChain });
 */
function perTableChains(map: Record<string, ReturnType<typeof createChainMock>>) {
  (supabase.from as any).mockImplementation((table: string) => {
    return map[table] ?? defaultChain;
  });
  return map;
}

// =============================================================================
// checkTransactionLimits
// =============================================================================

describe('WaiverService.checkTransactionLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  // ---- Unlimited (0) ----

  it('allows adds when both limits are 0 (unlimited)', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { weeklyAddLimit: 0, seasonAddLimit: 0 } },
      error: null,
    });

    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(true);
  });

  it('allows adds when limits are not set in settings (defaults to 0)', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });

    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(true);
  });

  it('allows adds when settings is undefined', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: undefined },
      error: null,
    });

    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(true);
  });

  // ---- Weekly cap ----

  it('blocks adds when weekly limit is reached', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { weeklyAddLimit: 3, seasonAddLimit: 0 } },
      error: null,
    });

    const txChain = createChainMock();
    // Terminal select with count returns on the chain itself (head: true → no rows, just count)
    txChain.gte.mockReturnValue({
      ...txChain,
      // The final promise resolution (no terminal method — the chain itself resolves)
      then: (cb: any) => Promise.resolve({ data: null, error: null, count: 3 }).then(cb),
    });

    // Because the method uses `select('*', { count: 'exact', head: true })` which
    // returns a promise directly (no `.single()`), we mock the chain to resolve.
    // Re-implement: the Supabase pattern here ends with `.gte(...)` as the last
    // chained call, and the whole chain is awaited. So we need the chain's final
    // call to resolve as a promise.
    const weeklyTxChain = createChainMock();
    // Make the chain itself thenable after .gte()
    const gteResult = {
      data: null,
      error: null,
      count: 3,
    };
    weeklyTxChain.gte.mockResolvedValue(gteResult);

    perTableChains({
      leagues: leagueChain,
      transaction_ledger: weeklyTxChain,
    });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Weekly add limit reached');
    expect(result.reason).toContain('3/3');
    expect(result.weeklyAdds).toBe(3);
  });

  it('allows adds when weekly count is below the weekly limit', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { weeklyAddLimit: 5, seasonAddLimit: 0 } },
      error: null,
    });

    const weeklyTxChain = createChainMock();
    weeklyTxChain.gte.mockResolvedValue({ data: null, error: null, count: 2 });

    perTableChains({
      leagues: leagueChain,
      transaction_ledger: weeklyTxChain,
    });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(true);
  });

  // ---- Season cap ----

  it('blocks adds when season limit is reached', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { weeklyAddLimit: 0, seasonAddLimit: 50 } },
      error: null,
    });

    // Season check: select → eq → eq → eq (no gte) — chain ends and resolves
    const seasonTxChain = createChainMock();
    // The season check chain ends at `.eq('type', 'ADD')` which is the 3rd eq call.
    // Since all eq's return the chain itself, the chain must resolve as a promise.
    // Override the chain to be thenable for the season path (no gte call).
    // Actually the chain is awaited directly after the last `.eq()`.
    // We make `.eq` aware of the call count.
    let eqCount = 0;
    seasonTxChain.eq.mockImplementation(() => {
      eqCount++;
      if (eqCount === 3) {
        // Third `.eq('type', 'ADD')` — return a thenable with count
        return Promise.resolve({ data: null, error: null, count: 50 });
      }
      return seasonTxChain;
    });

    perTableChains({
      leagues: leagueChain,
      transaction_ledger: seasonTxChain,
    });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Season add limit reached');
    expect(result.reason).toContain('50/50');
    expect(result.seasonAdds).toBe(50);
  });

  // ---- Both caps ----

  it('checks weekly limit first when both caps are set', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { weeklyAddLimit: 3, seasonAddLimit: 100 } },
      error: null,
    });

    // Weekly hits limit first
    const txChain = createChainMock();
    txChain.gte.mockResolvedValue({ data: null, error: null, count: 3 });

    perTableChains({
      leagues: leagueChain,
      transaction_ledger: txChain,
    });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Weekly');
  });

  it('falls through to season limit when weekly is under cap', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { weeklyAddLimit: 10, seasonAddLimit: 50 } },
      error: null,
    });

    // Weekly: under limit — need gte to return count < limit
    // Season: at limit — need eq chain to resolve with count = 50
    // Because the same table is queried twice, we track call order.
    const callNum = 0;
    const txChain = createChainMock();
    // First await (weekly): ends at .gte() → resolves with low count
    txChain.gte.mockResolvedValue({ data: null, error: null, count: 2 });
    // Second await (season): we need `.eq('type', 'ADD')` to resolve
    // Since weekly path also uses eq, we handle season by counting selects
    let selectCallNum = 0;
    txChain.select.mockImplementation(() => {
      selectCallNum++;
      return txChain;
    });
    // For the season path, the chain ends at the 3rd eq without gte
    const seasonEqCount = 0;
    const origEq = txChain.eq;
    txChain.eq.mockImplementation(() => {
      // After the weekly path is done (gte was called), reset for season path
      return txChain;
    });
    // This is getting complex — let's use a simpler approach.
    // Override `from` to return different chains per call order.
    let fromCallNum = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'transaction_ledger') {
        fromCallNum++;
        if (fromCallNum === 1) {
          // Weekly check — ends at gte
          const weeklyChain = createChainMock();
          weeklyChain.gte.mockResolvedValue({ data: null, error: null, count: 2 });
          return weeklyChain;
        } else {
          // Season check — ends at 3rd eq
          const seasonChain = createChainMock();
          let eqCalls = 0;
          seasonChain.eq.mockImplementation(() => {
            eqCalls++;
            if (eqCalls === 3) {
              return Promise.resolve({ data: null, error: null, count: 50 });
            }
            return seasonChain;
          });
          return seasonChain;
        }
      }
      return defaultChain;
    });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Season add limit reached');
  });

  // ---- Edge cases ----

  it('fails open (allows) when no league is found', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: null, error: null });

    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.checkTransactionLimits('missing-league', 'team-1');
    expect(result.allowed).toBe(true);
  });

  it('fails open when DB query throws an error', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockRejectedValue(new Error('DB connection failed'));

    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(true);
  });

  it('allows adds when weekly count query has an error (fails open)', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { weeklyAddLimit: 3, seasonAddLimit: 0 } },
      error: null,
    });

    const txChain = createChainMock();
    // Query returns an error — count should be ignored
    txChain.gte.mockResolvedValue({ data: null, error: { message: 'timeout' }, count: null });

    perTableChains({
      leagues: leagueChain,
      transaction_ledger: txChain,
    });

    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    // When error occurs, the `if (!error && count !== null)` check fails → falls through → allowed
    expect(result.allowed).toBe(true);
  });
});

// =============================================================================
// submitWaiverClaim — Waiver Claim Creation Validation
// =============================================================================

describe('WaiverService.submitWaiverClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns error when league is not found', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: null, error: { message: 'not found' } });

    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.submitWaiverClaim('bad-league', 'team-1', 8478402, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('League not found');
  });

  it('blocks waivers in Best Ball leagues', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { bestBallEnabled: true } },
      error: null,
    });

    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Best Ball');
  });

  it('blocks waivers when transaction limits are exceeded', async () => {
    // We spy on checkTransactionLimits so it returns denied
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({
      allowed: false,
      reason: 'Weekly add limit reached (3/3). Resets Monday.',
    });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });
    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Weekly add limit');

    vi.restoreAllMocks();
  });

  it('returns error when waiver priority is not found', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({ allowed: true });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });

    const priorityChain = createChainMock();
    priorityChain.single.mockResolvedValue({ data: null, error: null });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_priority') return priorityChain;
      return defaultChain;
    });

    const result = await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('waiver priority not found');

    vi.restoreAllMocks();
  });

  it('successfully submits a waiver claim', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({ allowed: true });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });

    const priorityChain = createChainMock();
    priorityChain.single.mockResolvedValue({
      data: { priority: 3 },
      error: null,
    });

    const claimChain = createChainMock();
    claimChain.single.mockResolvedValue({
      data: { id: 'claim-uuid-123' },
      error: null,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_priority') return priorityChain;
      if (table === 'waiver_claims') return claimChain;
      return defaultChain;
    });

    const result = await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(true);
    expect(result.claimId).toBe('claim-uuid-123');

    vi.restoreAllMocks();
  });

  it('forwards the drop_player_id into the claim insert', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({ allowed: true });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });

    const priorityChain = createChainMock();
    priorityChain.single.mockResolvedValue({
      data: { priority: 1 },
      error: null,
    });

    const claimChain = createChainMock();
    claimChain.single.mockResolvedValue({
      data: { id: 'claim-uuid-456' },
      error: null,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_priority') return priorityChain;
      if (table === 'waiver_claims') return claimChain;
      return defaultChain;
    });

    await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, 8477474);

    // Verify insert was called with drop_player_id
    expect(claimChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        drop_player_id: 8477474,
        player_id: 8478402,
        priority: 1,
        status: 'pending',
      })
    );

    vi.restoreAllMocks();
  });

  it('returns DB error message on insert failure', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({ allowed: true });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });

    const priorityChain = createChainMock();
    priorityChain.single.mockResolvedValue({
      data: { priority: 2 },
      error: null,
    });

    const claimChain = createChainMock();
    claimChain.single.mockResolvedValue({
      data: null,
      error: { message: 'Unique constraint violation' },
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_priority') return priorityChain;
      if (table === 'waiver_claims') return claimChain;
      return defaultChain;
    });

    const result = await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unique constraint violation');

    vi.restoreAllMocks();
  });
});

// =============================================================================
// checkPlayerAvailability — Game Lock Integration
// =============================================================================

describe('WaiverService.checkPlayerAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('validates league membership before checking availability', async () => {
    (LeagueMembershipService.requireMembership as any).mockRejectedValue(
      new Error('Not a member')
    );

    await expect(
      WaiverService.checkPlayerAvailability(8478402, 'league-1', 'user-1')
    ).rejects.toThrow('Not a member');

    expect(LeagueMembershipService.requireMembership).toHaveBeenCalledWith('league-1', 'user-1');
  });

  it('returns unavailable when player is already rostered', async () => {
    (LeagueMembershipService.requireMembership as any).mockResolvedValue(undefined);

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { waiver_game_lock: false, waiver_period_hours: 0, waiver_type: 'rolling', waiver_process_time: '03:00' },
      error: null,
    });

    const rosterChain = createChainMock();
    rosterChain.maybeSingle.mockResolvedValue({
      data: { id: 'assignment-1' },
      error: null,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'roster_assignments') return rosterChain;
      return defaultChain;
    });

    const result = await WaiverService.checkPlayerAvailability(8478402, 'league-1', 'user-1');
    expect(result.is_available).toBe(false);
    expect(result.lock_reason).toContain('already rostered');
  });

  it('returns available when player is not rostered and game lock is off', async () => {
    (LeagueMembershipService.requireMembership as any).mockResolvedValue(undefined);

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { waiver_game_lock: false, waiver_period_hours: 0, waiver_type: 'rolling', waiver_process_time: '03:00' },
      error: null,
    });

    const rosterChain = createChainMock();
    rosterChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const playerChain = createChainMock();
    playerChain.maybeSingle.mockResolvedValue({
      data: { team_abbrev: 'TOR' },
      error: null,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'roster_assignments') return rosterChain;
      if (table === 'player_directory') return playerChain;
      return defaultChain;
    });

    const result = await WaiverService.checkPlayerAvailability(8478402, 'league-1', 'user-1');
    expect(result.is_available).toBe(true);
    expect(result.is_game_locked).toBe(false);
    expect(result.is_on_waivers).toBe(false);
  });

  it('marks player as game-locked when game lock is enabled and player is in a live game', async () => {
    (LeagueMembershipService.requireMembership as any).mockResolvedValue(undefined);
    (GameLockService.isPlayerLocked as any).mockResolvedValue({
      isLocked: true,
      gameStatus: 'live',
    });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { waiver_game_lock: true, waiver_period_hours: 0, waiver_type: 'rolling', waiver_process_time: '03:00' },
      error: null,
    });

    const rosterChain = createChainMock();
    rosterChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const playerChain = createChainMock();
    playerChain.maybeSingle.mockResolvedValue({
      data: { team_abbrev: 'TOR' },
      error: null,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'roster_assignments') return rosterChain;
      if (table === 'player_directory') return playerChain;
      return defaultChain;
    });

    const result = await WaiverService.checkPlayerAvailability(8478402, 'league-1', 'user-1');
    expect(result.is_available).toBe(false);
    expect(result.is_game_locked).toBe(true);
    expect(result.lock_reason).toContain('currently in a game');
  });

  it('marks player as game-locked with final game status', async () => {
    (LeagueMembershipService.requireMembership as any).mockResolvedValue(undefined);
    (GameLockService.isPlayerLocked as any).mockResolvedValue({
      isLocked: true,
      gameStatus: 'final',
    });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { waiver_game_lock: true, waiver_period_hours: 0 },
      error: null,
    });

    const rosterChain = createChainMock();
    rosterChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const playerChain = createChainMock();
    playerChain.maybeSingle.mockResolvedValue({
      data: { team_abbrev: 'EDM' },
      error: null,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'roster_assignments') return rosterChain;
      if (table === 'player_directory') return playerChain;
      return defaultChain;
    });

    const result = await WaiverService.checkPlayerAvailability(8478402, 'league-1', 'user-1');
    expect(result.is_game_locked).toBe(true);
    expect(result.lock_reason).toContain('just finished');
  });

  it('returns available for a player with no NHL team (unsigned/retired)', async () => {
    (LeagueMembershipService.requireMembership as any).mockResolvedValue(undefined);

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { waiver_game_lock: true, waiver_period_hours: 0 },
      error: null,
    });

    const rosterChain = createChainMock();
    rosterChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const playerChain = createChainMock();
    playerChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'roster_assignments') return rosterChain;
      if (table === 'player_directory') return playerChain;
      return defaultChain;
    });

    const result = await WaiverService.checkPlayerAvailability(9999999, 'league-1', 'user-1');
    expect(result.is_available).toBe(true);
    expect(result.is_game_locked).toBe(false);
  });

  it('throws when league is not found', async () => {
    (LeagueMembershipService.requireMembership as any).mockResolvedValue(undefined);

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: null, error: null });

    perTableChains({ leagues: leagueChain });

    await expect(
      WaiverService.checkPlayerAvailability(8478402, 'bad-league', 'user-1')
    ).rejects.toThrow('League not found');
  });
});

// =============================================================================
// submitFAABBid — FAAB Bid Validation
// =============================================================================

describe('WaiverService.submitFAABBid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('rejects negative bid amounts', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({ allowed: true });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });
    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, -5, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('negative');

    vi.restoreAllMocks();
  });

  it('rejects bids exceeding remaining budget', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({ allowed: true });
    vi.spyOn(WaiverService, 'getFAABBudget').mockResolvedValue(25);

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });
    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 50, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds remaining budget');
    expect(result.error).toContain('$25');

    vi.restoreAllMocks();
  });

  it('rejects bids when FAAB budget is not found (null)', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({ allowed: true });
    vi.spyOn(WaiverService, 'getFAABBudget').mockResolvedValue(null);

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });
    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 10, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('FAAB budget not found');

    vi.restoreAllMocks();
  });

  it('allows a zero-dollar bid ($0 FAAB)', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({ allowed: true });
    vi.spyOn(WaiverService, 'getFAABBudget').mockResolvedValue(100);

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });

    // No existing claim
    const claimCheckChain = createChainMock();
    claimCheckChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    // New claim insert
    const claimInsertChain = createChainMock();
    claimInsertChain.single.mockResolvedValue({
      data: { id: 'claim-faab-0' },
      error: null,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_claims') {
        // First call: check existing (maybeSingle), Second: insert
        return claimCheckChain;
      }
      return defaultChain;
    });

    // Since the check and insert use the same table, we need to handle two calls.
    // First call to from('waiver_claims'): returns chain with maybeSingle for check
    // Second call: returns chain with insert + single for creation
    let waiverCallNum = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_claims') {
        waiverCallNum++;
        if (waiverCallNum === 1) return claimCheckChain;
        return claimInsertChain;
      }
      return defaultChain;
    });

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 0, null);
    expect(result.success).toBe(true);
    expect(result.claimId).toBe('claim-faab-0');

    vi.restoreAllMocks();
  });

  it('blocks FAAB bids in Best Ball leagues', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { bestBallEnabled: true } },
      error: null,
    });
    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 10, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Best Ball');
  });

  it('returns error when league is not found for FAAB', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: null, error: { message: 'not found' } });
    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.submitFAABBid('bad-league', 'team-1', 8478402, 10, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('League not found');
  });

  it('updates existing pending bid instead of creating a new one', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({ allowed: true });
    vi.spyOn(WaiverService, 'getFAABBudget').mockResolvedValue(100);

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });

    // Existing claim found
    const existingClaimChain = createChainMock();
    existingClaimChain.maybeSingle.mockResolvedValue({
      data: { id: 'existing-claim-id' },
      error: null,
    });

    // Update chain (for the update call on existing)
    const updateChain = createChainMock();
    updateChain.eq.mockResolvedValue({ data: null, error: null });

    let waiverCallNum = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_claims') {
        waiverCallNum++;
        if (waiverCallNum === 1) return existingClaimChain;
        return updateChain;
      }
      return defaultChain;
    });

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 30, null);
    expect(result.success).toBe(true);
    expect(result.claimId).toBe('existing-claim-id');

    vi.restoreAllMocks();
  });

  it('enforces transaction limits before allowing FAAB bid', async () => {
    vi.spyOn(WaiverService, 'checkTransactionLimits').mockResolvedValue({
      allowed: false,
      reason: 'Season add limit reached (100/100).',
    });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });
    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 10, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Season add limit');

    vi.restoreAllMocks();
  });
});

// =============================================================================
// getFAABBudget — Budget Calculations
// =============================================================================

describe('WaiverService.getFAABBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns budget from faab_budgets table when available', async () => {
    const budgetChain = createChainMock();
    budgetChain.maybeSingle.mockResolvedValue({
      data: { remaining_budget: 75 },
      error: null,
    });

    perTableChains({ faab_budgets: budgetChain });

    const budget = await WaiverService.getFAABBudget('league-1', 'team-1');
    expect(budget).toBe(75);
  });

  it('falls back to calculating from settings minus completed claims', async () => {
    const budgetChain = createChainMock();
    budgetChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { faabBudget: 200 } },
      error: null,
    });

    const claimsChain = createChainMock();
    // completed claims with bid_amount values
    claimsChain.eq.mockImplementation(() => claimsChain);
    // The final eq call on status resolves the query
    let eqCalls = 0;
    claimsChain.eq.mockImplementation(() => {
      eqCalls++;
      if (eqCalls >= 3) {
        return Promise.resolve({
          data: [
            { bid_amount: 50, priority: 50 },
            { bid_amount: 30, priority: 30 },
          ],
          error: null,
        });
      }
      return claimsChain;
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'faab_budgets') return budgetChain;
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_claims') return claimsChain;
      return defaultChain;
    });

    const budget = await WaiverService.getFAABBudget('league-1', 'team-1');
    // 200 - 50 - 30 = 120
    expect(budget).toBe(120);
  });

  it('defaults to $100 budget when faabBudget is not set in settings', async () => {
    const budgetChain = createChainMock();
    budgetChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: {} },
      error: null,
    });

    const claimsChain = createChainMock();
    let eqCalls = 0;
    claimsChain.eq.mockImplementation(() => {
      eqCalls++;
      if (eqCalls >= 3) {
        return Promise.resolve({ data: [], error: null });
      }
      return claimsChain;
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'faab_budgets') return budgetChain;
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_claims') return claimsChain;
      return defaultChain;
    });

    const budget = await WaiverService.getFAABBudget('league-1', 'team-1');
    expect(budget).toBe(100);
  });

  it('never returns negative budget (clamps to 0)', async () => {
    const budgetChain = createChainMock();
    budgetChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { settings: { faabBudget: 50 } },
      error: null,
    });

    const claimsChain = createChainMock();
    let eqCalls = 0;
    claimsChain.eq.mockImplementation(() => {
      eqCalls++;
      if (eqCalls >= 3) {
        return Promise.resolve({
          data: [
            { bid_amount: 30, priority: 30 },
            { bid_amount: 25, priority: 25 },
          ],
          error: null,
        });
      }
      return claimsChain;
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'faab_budgets') return budgetChain;
      if (table === 'leagues') return leagueChain;
      if (table === 'waiver_claims') return claimsChain;
      return defaultChain;
    });

    const budget = await WaiverService.getFAABBudget('league-1', 'team-1');
    // 50 - 30 - 25 = -5 → clamped to 0
    expect(budget).toBe(0);
  });

  it('returns null when DB query throws', async () => {
    const budgetChain = createChainMock();
    budgetChain.maybeSingle.mockRejectedValue(new Error('DB error'));

    perTableChains({ faab_budgets: budgetChain });

    const budget = await WaiverService.getFAABBudget('league-1', 'team-1');
    expect(budget).toBeNull();
  });
});

// =============================================================================
// cancelWaiverClaim
// =============================================================================

describe('WaiverService.cancelWaiverClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('successfully cancels a pending claim', async () => {
    // cancelWaiverClaim chain: .from('waiver_claims').update({...}).eq('id', ...).eq('status', 'pending')
    // The second .eq() is the terminal call (awaited), so it must return a promise.
    const claimChain = createChainMock();
    let eqCount = 0;
    claimChain.eq.mockImplementation(() => {
      eqCount++;
      if (eqCount >= 2) {
        return Promise.resolve({ data: null, error: null });
      }
      return claimChain;
    });

    perTableChains({ waiver_claims: claimChain });

    const result = await WaiverService.cancelWaiverClaim('claim-123');
    expect(result.success).toBe(true);
  });

  it('returns error on DB failure', async () => {
    const claimChain = createChainMock();
    let eqCount = 0;
    claimChain.eq.mockImplementation(() => {
      eqCount++;
      if (eqCount >= 2) {
        return Promise.resolve({
          data: null,
          error: { message: 'Row not found' },
        });
      }
      return claimChain;
    });

    perTableChains({ waiver_claims: claimChain });

    const result = await WaiverService.cancelWaiverClaim('claim-123');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Row not found');
  });
});

// =============================================================================
// processAllPendingWaivers
// =============================================================================

describe('WaiverService.processAllPendingWaivers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns success with results from RPC', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          league_id: 'league-1',
          league_name: 'Test League',
          total_processed: 3,
          successful: 2,
          failed: 1,
          details: [],
        },
      ],
      error: null,
    });

    const result = await WaiverService.processAllPendingWaivers();
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].successful).toBe(2);
  });

  it('returns error when RPC fails', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: 'RPC timeout' },
    });

    const result = await WaiverService.processAllPendingWaivers();
    expect(result.success).toBe(false);
    expect(result.error).toBe('RPC timeout');
    expect(result.results).toEqual([]);
  });

  it('handles empty results gracefully', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    const result = await WaiverService.processAllPendingWaivers();
    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
  });
});

// =============================================================================
// getWaiverProcessingStatus
// =============================================================================

describe('WaiverService.getWaiverProcessingStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns league status data from RPC', async () => {
    const statusData = [
      {
        league_id: 'league-1',
        league_name: 'Test League',
        pending_claims: 5,
        last_processed: '2025-12-08T03:00:00Z',
        next_process_time: '2025-12-09T03:00:00Z',
      },
    ];

    (supabase.rpc as any).mockResolvedValue({ data: statusData, error: null });

    const result = await WaiverService.getWaiverProcessingStatus();
    expect(result.leagues).toHaveLength(1);
    expect(result.leagues[0].pending_claims).toBe(5);
    expect(result.error).toBeUndefined();
  });

  it('returns empty array and error on RPC failure', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: 'Permission denied' },
    });

    const result = await WaiverService.getWaiverProcessingStatus();
    expect(result.leagues).toEqual([]);
    expect(result.error).toBe('Permission denied');
  });
});

// =============================================================================
// recalculateReverseStandingsPriority
// =============================================================================

describe('WaiverService.recalculateReverseStandingsPriority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns success when RPC succeeds', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    const result = await WaiverService.recalculateReverseStandingsPriority('league-1');
    expect(result.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('recalculate_reverse_standings_priority', {
      p_league_id: 'league-1',
    });
  });

  it('returns error when RPC fails', async () => {
    // The code does `if (error) throw error` — supply an actual Error so the catch
    // block's `error instanceof Error ? error.message : ...` path works correctly.
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: new Error('Function does not exist'),
    });

    const result = await WaiverService.recalculateReverseStandingsPriority('league-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Function does not exist');
  });
});

// =============================================================================
// updateWaiverSettings — Commissioner Settings
// =============================================================================

describe('WaiverService.updateWaiverSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('requires commissioner permissions', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockRejectedValue(
      new Error('Not the commissioner')
    );

    const result = await WaiverService.updateWaiverSettings('league-1', 'user-2', {
      waiver_type: 'faab',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not the commissioner');
  });

  it('updates settings and triggers reverse standings recalculation when switching to reverse_standings', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    const leagueChain = createChainMock();
    leagueChain.eq.mockResolvedValue({ data: null, error: null });

    perTableChains({ leagues: leagueChain });

    // Mock rpc for recalculate and notify
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    vi.spyOn(WaiverService, 'recalculateReverseStandingsPriority').mockResolvedValue({
      success: true,
    });

    const result = await WaiverService.updateWaiverSettings('league-1', 'commissioner-1', {
      waiver_type: 'reverse_standings',
    });

    expect(result.success).toBe(true);
    expect(WaiverService.recalculateReverseStandingsPriority).toHaveBeenCalledWith('league-1');

    vi.restoreAllMocks();
  });

  it('does not recalculate priority when switching to faab', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    const leagueChain = createChainMock();
    leagueChain.eq.mockResolvedValue({ data: null, error: null });
    perTableChains({ leagues: leagueChain });

    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    vi.spyOn(WaiverService, 'recalculateReverseStandingsPriority');

    const result = await WaiverService.updateWaiverSettings('league-1', 'commissioner-1', {
      waiver_type: 'faab',
    });

    expect(result.success).toBe(true);
    expect(WaiverService.recalculateReverseStandingsPriority).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('returns error when league update fails', async () => {
    (LeagueMembershipService.requireCommissioner as any).mockResolvedValue(undefined);

    const leagueChain = createChainMock();
    // The chain is .update(settings).eq('id', leagueId) — eq is awaited.
    // Code does `if (error) throw error`, so supply an actual Error instance.
    leagueChain.eq.mockResolvedValue({
      data: null,
      error: new Error('Update failed'),
    });
    perTableChains({ leagues: leagueChain });

    const result = await WaiverService.updateWaiverSettings('league-1', 'commissioner-1', {
      waiver_game_lock: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Update failed');
  });
});

// =============================================================================
// addPlayer — Smart add (free agent vs waiver claim routing)
// =============================================================================

describe('WaiverService.addPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('routes to free agent pickup when player is available', async () => {
    vi.spyOn(WaiverService, 'checkPlayerAvailability').mockResolvedValue({
      player_id: 8478402,
      is_available: true,
      is_game_locked: false,
      is_on_waivers: false,
      waiver_clear_time: null,
      lock_reason: null,
    });
    vi.spyOn(WaiverService, 'addFreeAgent').mockResolvedValue({ success: true });

    // Mock team owned by the authenticated user (test-user-id from auth mock)
    const teamChain = createChainMock();
    teamChain.single.mockResolvedValue({
      data: { owner_id: 'test-user-id' },
      error: null,
    });
    perTableChains({ teams: teamChain });

    const result = await WaiverService.addPlayer('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(true);
    expect(result.isFreeAgent).toBe(true);
    expect(WaiverService.addFreeAgent).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('routes to waiver claim when player is unavailable', async () => {
    vi.spyOn(WaiverService, 'checkPlayerAvailability').mockResolvedValue({
      player_id: 8478402,
      is_available: false,
      is_game_locked: true,
      is_on_waivers: false,
      waiver_clear_time: null,
      lock_reason: 'Player is currently in a game',
    });
    vi.spyOn(WaiverService, 'submitWaiverClaim').mockResolvedValue({
      success: true,
      claimId: 'claim-xyz',
    });

    // Mock team owned by the authenticated user (test-user-id from auth mock)
    const teamChain = createChainMock();
    teamChain.single.mockResolvedValue({
      data: { owner_id: 'test-user-id' },
      error: null,
    });
    perTableChains({ teams: teamChain });

    const result = await WaiverService.addPlayer('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(true);
    expect(result.isFreeAgent).toBe(false);
    expect(result.claimId).toBe('claim-xyz');
    expect(WaiverService.submitWaiverClaim).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('returns error when team has no owner', async () => {
    const teamChain = createChainMock();
    teamChain.single.mockResolvedValue({
      data: { owner_id: null },
      error: null,
    });
    perTableChains({ teams: teamChain });

    const result = await WaiverService.addPlayer('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(false);
    // Auth checks now verify team ownership — null owner_id fails the "no owner" check
    expect(result.error).toBeDefined();
  });
});
