import { supabase } from '@/integrations/supabase/client';

/**
 * ============================================================================
 * LEAGUE MEMBERSHIP SERVICE - CENTRALIZED ACCESS CONTROL
 * ============================================================================
 * 
 * This service provides a single source of truth for league membership
 * validation, following the Yahoo/Sleeper model of application-level
 * security checks backed by database RLS policies.
 * 
 * CRITICAL SECURITY PRINCIPLE:
 * - ALL league data access must validate membership FIRST
 * - Never rely solely on RLS - it's a backup layer
 * - Explicit is better than implicit for security
 * 
 * ============================================================================
 */

interface MembershipCheckResult {
  isMember: boolean;
  isCommissioner: boolean;
  teamId?: string;
}

// Cache for membership checks to prevent redundant queries
// TTL: 30 seconds (balance between performance and security)
const membershipCache = new Map<string, {
  result: MembershipCheckResult;
  timestamp: number;
}>();

const CACHE_TTL = 30000; // 30 seconds

/**
 * Generate cache key for membership check
 */
function getCacheKey(leagueId: string, userId: string): string {
  return `${leagueId}:${userId}`;
}

/**
 * Get cached membership result if still valid
 */
function getCachedResult(leagueId: string, userId: string): MembershipCheckResult | null {
  const key = getCacheKey(leagueId, userId);
  const cached = membershipCache.get(key);
  
  if (!cached) return null;
  
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL) {
    membershipCache.delete(key);
    return null;
  }
  
  return cached.result;
}

/**
 * Cache membership result
 */
function cacheResult(leagueId: string, userId: string, result: MembershipCheckResult): void {
  const key = getCacheKey(leagueId, userId);
  membershipCache.set(key, {
    result,
    timestamp: Date.now()
  });
}

/**
 * Clear cache for a specific user/league (useful after joins/leaves)
 */
export function clearMembershipCache(leagueId?: string, userId?: string): void {
  if (leagueId && userId) {
    const key = getCacheKey(leagueId, userId);
    membershipCache.delete(key);
  } else {
    // Clear entire cache
    membershipCache.clear();
  }
}

export const LeagueMembershipService = {
  /**
   * Check if user is a member of a league
   * Returns detailed membership information
   * 
   * @param leagueId - League ID to check
   * @param userId - User ID to check
   * @returns Membership details including role and team ID
   */
  async checkMembership(leagueId: string, userId: string): Promise<MembershipCheckResult> {
    // CRITICAL SECURITY CHECK: userId must be defined
    // Fail-fast: throw error immediately if userId is missing to catch bugs during development
    if (!userId || userId === 'undefined') {
      const error = new Error(`SECURITY ERROR: checkMembership called with invalid userId: "${userId}". This indicates a bug in the calling code - userId parameter is required for membership validation.`);
      console.error('[LeagueMembershipService] SECURITY VIOLATION:', error);
      throw error;
    }

    // Check cache first
    const cached = getCachedResult(leagueId, userId);
    if (cached) {
      return cached;
    }

    try {
      // Check if user is commissioner
      const { data: leagueData, error: leagueError } = await supabase
        .from('leagues')
        .select('commissioner_id')
        .eq('id', leagueId)
        .single();

      if (leagueError && leagueError.code !== 'PGRST116') {
        console.error('[LeagueMembershipService] Error checking commissioner status:', leagueError);
      }

      const isCommissioner = leagueData?.commissioner_id === userId;

      // Check if user owns a team in the league
      const { data: teamData, error: teamError } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('owner_id', userId)
        .limit(1)
        .maybeSingle();

      if (teamError && teamError.code !== 'PGRST116') {
        console.error('[LeagueMembershipService] Error checking team ownership:', teamError);
      }

      const isMember = isCommissioner || !!teamData;
      const result: MembershipCheckResult = {
        isMember,
        isCommissioner,
        teamId: teamData?.id
      };

      // Cache the result
      cacheResult(leagueId, userId, result);

      return result;
    } catch (error) {
      console.error('[LeagueMembershipService] Unexpected error in checkMembership:', error);
      // Fail closed - deny access on error
      return {
        isMember: false,
        isCommissioner: false
      };
    }
  },

  /**
   * Simple boolean check: Is user a member of this league?
   * 
   * @param leagueId - League ID to check
   * @param userId - User ID to check
   * @returns true if user is a member (commissioner or team owner)
   */
  async verifyMembership(leagueId: string, userId: string): Promise<boolean> {
    const result = await this.checkMembership(leagueId, userId);
    return result.isMember;
  },

  /**
   * Get user's role in a league
   * 
   * @param leagueId - League ID to check
   * @param userId - User ID to check
   * @returns 'commissioner' | 'member' | 'none'
   */
  async getUserRole(leagueId: string, userId: string): Promise<'commissioner' | 'member' | 'none'> {
    const result = await this.checkMembership(leagueId, userId);
    
    if (!result.isMember) {
      return 'none';
    }
    
    if (result.isCommissioner) {
      return 'commissioner';
    }
    
    return 'member';
  },

  /**
   * Guard function: Throws error if user is not a member
   * Use this in service methods that require league membership
   * 
   * @param leagueId - League ID to check
   * @param userId - User ID to check
   * @throws Error if user is not a member
   */
  async requireMembership(leagueId: string, userId: string): Promise<void> {
    const result = await this.checkMembership(leagueId, userId);
    
    if (!result.isMember) {
      throw new Error('Access denied: You are not a member of this league');
    }
  },

  /**
   * Guard function: Throws error if user is not the commissioner
   * Use this in service methods that require commissioner privileges
   * 
   * @param leagueId - League ID to check
   * @param userId - User ID to check
   * @throws Error if user is not the commissioner
   */
  async requireCommissioner(leagueId: string, userId: string): Promise<void> {
    const result = await this.checkMembership(leagueId, userId);
    
    if (!result.isCommissioner) {
      throw new Error('Access denied: Only the league commissioner can perform this action');
    }
  },

  /**
   * Check if user is the commissioner of a league
   * 
   * @param leagueId - League ID to check
   * @param userId - User ID to check
   * @returns true if user is the commissioner
   */
  async isCommissioner(leagueId: string, userId: string): Promise<boolean> {
    const result = await this.checkMembership(leagueId, userId);
    return result.isCommissioner;
  },

  /**
   * Get user's team ID in a league (if they have one)
   * 
   * @param leagueId - League ID to check
   * @param userId - User ID to check
   * @returns Team ID or null if user doesn't have a team
   */
  async getUserTeamId(leagueId: string, userId: string): Promise<string | null> {
    const result = await this.checkMembership(leagueId, userId);
    return result.teamId || null;
  }
};
