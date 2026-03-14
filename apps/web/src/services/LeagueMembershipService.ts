import { leagueApi } from '@/api/leagues';
import { logger } from '@/utils/logger';

/**
 * ============================================================================
 * LEAGUE MEMBERSHIP SERVICE - CENTRALIZED ACCESS CONTROL
 * ============================================================================
 *
 * Uses the API server for membership checks instead of direct Supabase calls.
 * Server-side middleware handles the actual security enforcement; this service
 * provides UI-level gating.
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

function getCachedResult(leagueId: string, userId: string): MembershipCheckResult | null {
  const key = getCacheKey(leagueId, userId);
  const cached = membershipCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    membershipCache.delete(key);
    return null;
  }
  return cached.result;
}

function cacheResult(leagueId: string, userId: string, result: MembershipCheckResult): void {
  membershipCache.set(getCacheKey(leagueId, userId), { result, timestamp: Date.now() });
}

export function clearMembershipCache(leagueId?: string, userId?: string): void {
  if (leagueId && userId) {
    membershipCache.delete(getCacheKey(leagueId, userId));
  } else {
    membershipCache.clear();
  }
}

export const LeagueMembershipService = {
  async checkMembership(leagueId: string, userId: string): Promise<MembershipCheckResult> {
    if (!userId || userId === 'undefined') {
      const error = new Error(`SECURITY ERROR: checkMembership called with invalid userId: "${userId}".`);
      logger.error('[LeagueMembershipService] SECURITY VIOLATION:', error);
      throw error;
    }

    const cached = getCachedResult(leagueId, userId);
    if (cached) return cached;

    try {
      // Use the league API to get league details and teams
      const [leagueResponse, teamsResponse] = await Promise.all([
        leagueApi.getLeague(leagueId),
        leagueApi.getTeams(leagueId),
      ]);

      const league = leagueResponse.data as { commissioner_id?: string } | undefined;
      const teams = (teamsResponse.data || []) as Array<{ id: string; owner_id?: string }>;

      const isCommissioner = league?.commissioner_id === userId;
      const userTeam = teams.find(t => t.owner_id === userId);
      const isMember = isCommissioner || !!userTeam;

      const result: MembershipCheckResult = {
        isMember,
        isCommissioner,
        teamId: userTeam?.id,
      };

      cacheResult(leagueId, userId, result);
      return result;
    } catch (error) {
      logger.error('[LeagueMembershipService] Error in checkMembership:', error);
      return { isMember: false, isCommissioner: false };
    }
  },

  async verifyMembership(leagueId: string, userId: string): Promise<boolean> {
    const result = await this.checkMembership(leagueId, userId);
    return result.isMember;
  },

  async getUserRole(leagueId: string, userId: string): Promise<'commissioner' | 'member' | 'none'> {
    const result = await this.checkMembership(leagueId, userId);
    if (!result.isMember) return 'none';
    if (result.isCommissioner) return 'commissioner';
    return 'member';
  },

  async requireMembership(leagueId: string, userId: string): Promise<void> {
    const result = await this.checkMembership(leagueId, userId);
    if (!result.isMember) throw new Error('Access denied: You are not a member of this league');
  },

  async requireCommissioner(leagueId: string, userId: string): Promise<void> {
    const result = await this.checkMembership(leagueId, userId);
    if (!result.isCommissioner) throw new Error('Access denied: Only the league commissioner can perform this action');
  },

  async isCommissioner(leagueId: string, userId: string): Promise<boolean> {
    const result = await this.checkMembership(leagueId, userId);
    return result.isCommissioner;
  },

  async getUserTeamId(leagueId: string, userId: string): Promise<string | null> {
    const result = await this.checkMembership(leagueId, userId);
    return result.teamId || null;
  }
};
