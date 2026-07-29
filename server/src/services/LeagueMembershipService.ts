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

interface MembershipCheckResult {
  isMember: boolean;
  isCommissioner: boolean;
  teamId?: string;
}

// Cache for membership checks (30s TTL)
const membershipCache = new Map<string, {
  result: MembershipCheckResult;
  timestamp: number;
}>();

const CACHE_TTL = 30000;

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
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      // eslint-disable-next-line no-console
      console.log(
        `[DR-2 diag checkMembership CACHE HIT] key=${key} isMember=${cached.result.isMember} isCommissioner=${cached.result.isCommissioner} ageMs=${Date.now() - cached.timestamp}`,
      );
      return cached.result;
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

      // DR-2 diagnostic (2026-07-29): print raw query results so we
      // can see what the user-scoped RLS actually returns for Garrett.
      // eslint-disable-next-line no-console
      console.log(
        `[DR-2 diag checkMembership leagues query] leagueId=${leagueId} userId=${userId} ` +
          `leagueData=${JSON.stringify(leagueData)} leagueError=${leagueError ? JSON.stringify(leagueError) : 'null'}`,
      );

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

      // eslint-disable-next-line no-console
      console.log(
        `[DR-2 diag checkMembership teams query] teamData=${JSON.stringify(teamData)} teamError=${teamError ? JSON.stringify(teamError) : 'null'}`,
      );

      const isMember = isCommissioner || !!teamData;
      const result: MembershipCheckResult = {
        isMember,
        isCommissioner,
        teamId: teamData?.id,
      };

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

  async getUserTeamId(leagueId: string, userId: string): Promise<string | null> {
    const result = await this.checkMembership(leagueId, userId);
    return result.teamId || null;
  }

  static clearCache(leagueId?: string, userId?: string): void {
    if (leagueId && userId) {
      membershipCache.delete(getCacheKey(leagueId, userId));
    } else {
      membershipCache.clear();
    }
  }
}
