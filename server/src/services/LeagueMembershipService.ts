import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@citrus/shared';

/**
 * ============================================================================
 * LEAGUE MEMBERSHIP SERVICE - CENTRALIZED ACCESS CONTROL (SERVER)
 * ============================================================================
 *
 * Server-side version with dependency-injected Supabase client.
 * Identical business logic to the web version, but receives the
 * Supabase client as a constructor parameter instead of importing a global.
 *
 * CRITICAL SECURITY PRINCIPLE:
 * - ALL league data access must validate membership FIRST
 * - RLS is a backup layer — explicit checks are primary
 * - Fail closed on errors
 * ============================================================================
 */

/**
 * F14(a) (2026-08-03 architect ruling): `teamId` REMOVED from the
 * cached result. Team ownership is identity-critical and must be
 * resolved fresh on every read — see getUserTeamIdFresh() below.
 * Only boolean membership + commissioner status is cached, and only
 * for CACHE_TTL. Stale positive tolerance ≤30s is accepted by design:
 *
 *   - Kicked user retains route access for ≤30s
 *   - Just-joined user is denied for ≤30s
 *   - Neither is an F6 recurrence — this is the documented behavior
 *
 * Anything requiring stricter freshness (identity, ownership) MUST
 * NOT touch this cache.
 */
interface MembershipCheckResult {
  isMember: boolean;
  isCommissioner: boolean;
}

// Cache for membership checks (30s TTL). Boolean-only per F14(a).
const membershipCache = new Map<string, {
  result: MembershipCheckResult;
  timestamp: number;
}>();

const CACHE_TTL = 30000;

/**
 * Hard cap on membership-cache entries, with oldest-first eviction.
 *
 * MEMORY (2026-09-04 load audit) — before this, the map was write-only:
 * entries were checked for expiry on READ but never deleted, so a key was
 * born on the first request for a (league, user) pair and lived for the
 * lifetime of the Cloud Run instance. Cloud Run runs this service at
 * min-instances=1 with no CPU throttling, so an instance can stay warm for
 * days and the map only ever grows — one entry per league per member who
 * touched it, plus one per commissioner probe.
 *
 * The size is not alarming on its own (a 12-team league contributes ~12
 * keys), but "grows forever and is never pruned" is a defect regardless of
 * the constant, and it is one line to close. 20,000 entries covers ~1,600
 * twelve-team leagues of simultaneously-active members, well past the
 * Sept-29 shape, and bounds the map at roughly 2 MB.
 */
const CACHE_MAX_ENTRIES = 20_000;

function getCacheKey(leagueId: string, userId: string): string {
  return `${leagueId}:${userId}`;
}

export class LeagueMembershipService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async checkMembership(leagueId: string, userId: string): Promise<MembershipCheckResult> {
    if (!userId || userId === 'undefined') {
      throw new Error(`SECURITY ERROR: checkMembership called with invalid userId: "${userId}"`);
    }

    // Check cache
    const key = getCacheKey(leagueId, userId);
    const cached = membershipCache.get(key);
    if (cached) {
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.result;
      }
      // Expired — drop it now rather than leaving a dead entry behind. The
      // fresh value is written below; deleting first also re-inserts this
      // key at the end of the Map, keeping insertion order ~= recency for
      // the eviction below.
      membershipCache.delete(key);
    }

    try {
      const { data: leagueData, error: leagueError } = await this.supabase
        .from('leagues')
        .select('commissioner_id')
        .eq('id', leagueId)
        .single();

      if (leagueError && leagueError.code !== 'PGRST116') {
        logger.error('[LeagueMembershipService] Error checking commissioner:', leagueError);
      }

      const isCommissioner = leagueData?.commissioner_id === userId;

      const { data: teamData, error: teamError } = await this.supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('owner_id', userId)
        .limit(1)
        .maybeSingle();

      if (teamError && teamError.code !== 'PGRST116') {
        logger.error('[LeagueMembershipService] Error checking team ownership:', teamError);
      }

      const isMember = isCommissioner || !!teamData;
      const result: MembershipCheckResult = {
        isMember,
        isCommissioner,
      };

      if (membershipCache.size >= CACHE_MAX_ENTRIES) {
        // Map iteration order is insertion order, and every refresh deletes
        // before re-inserting, so the first key is the least recently
        // refreshed. O(1) — no scan.
        const oldestKey = membershipCache.keys().next().value;
        if (oldestKey !== undefined) membershipCache.delete(oldestKey);
      }
      membershipCache.set(key, { result, timestamp: Date.now() });
      return result;
    } catch (error) {
      logger.error('[LeagueMembershipService] Unexpected error:', error);
      // Fail closed
      return { isMember: false, isCommissioner: false };
    }
  }

  async verifyMembership(leagueId: string, userId: string): Promise<boolean> {
    const result = await this.checkMembership(leagueId, userId);
    return result.isMember;
  }

  async requireMembership(leagueId: string, userId: string): Promise<void> {
    const result = await this.checkMembership(leagueId, userId);
    if (!result.isMember) {
      throw new Error('Access denied: You are not a member of this league');
    }
  }

  async requireCommissioner(leagueId: string, userId: string): Promise<void> {
    const result = await this.checkMembership(leagueId, userId);
    if (!result.isCommissioner) {
      throw new Error('Access denied: Commissioner privileges required');
    }
  }

  async isCommissioner(leagueId: string, userId: string): Promise<boolean> {
    const result = await this.checkMembership(leagueId, userId);
    return result.isCommissioner;
  }

  /**
   * F14(a) (2026-08-03) — canonical fresh teamId resolver. Always
   * issues a direct `teams` DB query for the (leagueId, userId) pair.
   * NEVER touches the membership cache — the name carries the
   * contract, not the mechanism. If someone later adds caching inside
   * this method, the name becomes a lie a reviewer can catch (the
   * F19 lesson: an asserted-but-false property is the same species
   * of defect as a false name).
   *
   * Used by:
   *   - draft.ts:154 (v1 makePick "you can only pick for your own
   *     team" enforcement — see F14 registry entry for why the v1
   *     path is hardened even though the F14 incident hit v2)
   *   - draft.ts:299 (v1 pick submission parallel path)
   *   - Any future callsite that needs team-identity certainty.
   *
   * The `/api/leagues/:leagueId/my-team` route ALSO bypasses this
   * service (goes through LeagueService.getUserTeam's direct query).
   * This method is here for callers that already have a
   * LeagueMembershipService in hand.
   */
  async getUserTeamIdFresh(leagueId: string, userId: string): Promise<string | null> {
    if (!userId || userId === 'undefined') {
      throw new Error(`SECURITY ERROR: getUserTeamIdFresh called with invalid userId: "${userId}"`);
    }
    const { data, error } = await this.supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId)
      .eq('owner_id', userId)
      .limit(1)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') {
      logger.error('[LeagueMembershipService] getUserTeamIdFresh error:', error);
    }
    return data?.id ?? null;
  }

  /**
   * Invalidate cached membership entries. F14(a) contract:
   *
   *   - `clearCache(leagueId, userId)` — clear ONE entry (single-side
   *     ownership change).
   *   - `clearCache(leagueId, userIdA, userIdB)` — clear BOTH entries
   *     (A → B ownership transfer per Amendment 4). Prevents A from
   *     briefly appearing to still own a team AFTER the transfer.
   *   - `clearCache()` — nuke the whole cache (mostly for tests).
   *
   * WHY THIS IS DEFENSE IN DEPTH, NOT A SILVER BULLET: the cache is
   * module-scope and per-process. Cloud Run runs N instances; a
   * clearCache call from instance A does not touch B..N. See the
   * pre-production architecture note in the F14 registry entry —
   * this wiring covers the SAME instance's cache, which is the
   * common case for a follow-up request from the same client after
   * a write. Cross-instance invalidation is a separate problem.
   *
   * Structurally unreachable writers (per F14 Amendment 3
   * enumeration): DB-side RPCs like `public.join_league_with_code`
   * write owner_id without any Node code running. Their invalidation
   * relies on the TTL alone.
   */
  static clearCache(leagueId?: string, userId?: string, alsoUserId?: string): void {
    if (leagueId && userId) {
      membershipCache.delete(getCacheKey(leagueId, userId));
      if (alsoUserId) {
        membershipCache.delete(getCacheKey(leagueId, alsoUserId));
      }
    } else {
      membershipCache.clear();
    }
  }
}
