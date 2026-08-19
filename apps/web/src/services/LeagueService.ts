import { Player, PlayerService } from "@/services/PlayerService";
import { rosterApi } from "@/api/rosters";
import { apiClient } from "@/api/client";
import { DraftService } from "./DraftService";
import { MatchupService } from "./MatchupService";
import { RosterCacheService } from "./RosterCacheService";
import { LeagueMembershipService } from "./LeagueMembershipService";
import { DEMO_LEAGUE_ID_FOR_GUESTS } from "./DemoLeagueService";
import { logger } from "@/utils/logger";
import { ScoringCalculator, type CategoryStats } from "@/utils/scoringUtils";
import { getTodayMST, getTodayMSTDate, formatMoment } from "@/utils/timezoneUtils";

import type { LeagueType, ScoringFormat, DraftType as LeagueDraftType, LeagueSettings } from "@/types/leagueTypes";
import { extractFormatSettings } from "@/types/leagueTypes";
import { leagueApi } from "@/api/leagues";

// Sub-services extracted from this file for modularity
import { StandingsService } from "./StandingsService";
import { LineupService } from "./LineupService";
import { LeagueSettingsService } from "./LeagueSettingsService";

export interface League {
  id: string;
  name: string;
  commissioner_id: string;
  draft_status: 'not_started' | 'queued' | 'in_progress' | 'completed';
  join_code: string;
  roster_size: number;
  draft_rounds: number;
  settings: LeagueSettings;
  // Waiver settings
  waiver_process_time?: string;
  waiver_period_hours?: number;
  waiver_game_lock?: boolean;
  waiver_type?: 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings';
  allow_trades_during_games?: boolean;
  scoring_settings?: {
    skater?: {
      goals?: number;
      assists?: number;
      shots_on_goal?: number;
      blocks?: number;
      [key: string]: number | undefined;
    };
    goalie?: {
      wins?: number;
      saves?: number;
      shutouts?: number;
      goals_against?: number;
      [key: string]: number | undefined;
    };
    [key: string]: Record<string, number | undefined> | undefined;
  };
  scheduled_draft_time?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Helper to extract league format info from a league's settings JSONB.
 * Returns typed format identifiers with safe defaults for backward compatibility.
 */
export function getLeagueFormat(league: League): {
  leagueType: LeagueType;
  scoringFormat: ScoringFormat;
  draftType: LeagueDraftType;
  positionType?: 'individual' | 'forward';
} {
  const fmt = extractFormatSettings(league.settings || {});
  return {
    leagueType: fmt.leagueType || 'fantasy',
    scoringFormat: fmt.scoringFormat || 'h2h-points',
    draftType: fmt.draftType || 'snake',
    positionType: fmt.positionType || 'individual',
  };
}

export interface Team {
  id: string;
  league_id: string;
  owner_id: string | null;
  team_name: string;
  created_at: string;
  updated_at: string;
}

/**
 * ============================================================================
 * DEMO LEAGUE DATA - READ-ONLY STATIC DATA
 * ============================================================================
 * 
 * ⚠️ CRITICAL: This data is STATIC and READ-ONLY for demo purposes only.
 * 
 * The demo league contains exactly 10 teams (IDs 1-10):
 * - Team 1: Touchdown Titans
 * - Team 2: Scoring Sharks
 * - Team 3: Citrus Crushers (shown to guests as "My Team")
 * - Team 4: Field Generals
 * - Team 5: Blitz Brigade
 * - Team 6: Goal Getters
 * - Team 7: Victory Vipers
 * - Team 8: Hustle Heroes
 * - Team 9: Gridiron Gladiators
 * - Team 10: Puck Pythons
 * 
 * All 10 teams have:
 * - Static records (wins/losses)
 * - Static point totals
 * - Static rosters (18-21 players each, distributed via snake draft simulation)
 * - Static lineups (initialized once, never change)
 * 
 * This data is NEVER modified by user actions.
 * This data is NEVER persisted to the database.
 * This data is ONLY for demonstration purposes.
 */

export interface LeagueTeam {
  id: number;
  name: string;
  owner: string;
  logo: string; // Emoji or short text for now
  record: { wins: number; losses: number };
  points: number;
  streak: string;
  roster: Player[];
}

export const LEAGUE_TEAMS_DATA = [
  { 
    id: 1, 
    name: 'Touchdown Titans', 
    owner: 'Alex Johnson',
    logo: 'TT',
    record: { wins: 9, losses: 1 },
    points: 1432,
    streak: 'W4'
  },
  { 
    id: 2, 
    name: 'Scoring Sharks', 
    owner: 'Samantha Lee',
    logo: 'SS',
    record: { wins: 8, losses: 2 },
    points: 1378,
    streak: 'W2'
  },
  { 
    id: 3, 
    name: 'Citrus Crushers', 
    owner: 'You',
    logo: 'CC',
    record: { wins: 7, losses: 3 },
    points: 1247,
    streak: 'W1'
  },
  { 
    id: 4, 
    name: 'Field Generals', 
    owner: 'Carlos Rodriguez',
    logo: 'FG',
    record: { wins: 6, losses: 4 },
    points: 1189,
    streak: 'L1'
  },
  { 
    id: 5, 
    name: 'Blitz Brigade', 
    owner: 'Taylor Kim',
    logo: 'BB',
    record: { wins: 5, losses: 5 },
    points: 1145,
    streak: 'W3'
  },
  { 
    id: 6, 
    name: 'Goal Getters', 
    owner: 'Jamie Zhang',
    logo: 'GG',
    record: { wins: 4, losses: 6 },
    points: 1102,
    streak: 'L2'
  },
  { 
    id: 7, 
    name: 'Victory Vipers', 
    owner: 'Morgan Williams',
    logo: 'VV',
    record: { wins: 3, losses: 7 },
    points: 1067,
    streak: 'L4'
  },
  { 
    id: 8, 
    name: 'Hustle Heroes', 
    owner: 'Jordan Patel',
    logo: 'HH',
    record: { wins: 2, losses: 8 },
    points: 987,
    streak: 'L1'
  },
  { 
    id: 9, 
    name: 'Gridiron Gladiators', 
    owner: 'Casey Thompson',
    logo: 'GG',
    record: { wins: 1, losses: 9 },
    points: 896,
    streak: 'L6'
  },
  { 
    id: 10, 
    name: 'Puck Pythons', 
    owner: 'Avery Davis',
    logo: 'PP',
    record: { wins: 0, losses: 10 },
    points: 850,
    streak: 'L10'
  }
];

export interface Transaction {
  id: string;
  type: 'claim' | 'drop' | 'trade' | 'waiver';
  playerId: string;
  playerName: string;
  playerPosition?: string | null;
  playerTeam: string;
  date: string;
  /** Raw ISO timestamp of when the row was created (for MT formatting). */
  createdAt?: string | null;
  status: 'pending' | 'processed' | 'failed';
  failureReason?: string | null;
  // ─── Pending waiver-claim enrichment (only populated for waiver rows) ──
  /** Player being dropped as part of this waiver claim. */
  dropPlayerId?: string | null;
  dropPlayerName?: string | null;
  dropPlayerPosition?: string | null;
  dropPlayerTeam?: string | null;
  /** Team's waiver priority at claim time (rolling/reverse-standings). */
  priority?: number | null;
  /** Bid amount in FAAB leagues. */
  bidAmount?: number | null;
  isConditionalDrop?: boolean | null;
  /** ISO when this player's waiver window opened. */
  waiverDroppedAt?: string | null;
  /** ISO when the player clears waivers. */
  waiverClearsAt?: string | null;
  /** League's waiver processing time (e.g. "02:00:00"). */
  leagueWaiverProcessTime?: string | null;
  leagueWaiverPeriodHours?: number | null;
}

let cachedLeagueState: Record<number, Player[]> | null = null;
let cachedFreeAgents: Player[] | null = null;
const cachedWatchlist: Set<string> = new Set();
let cachedLineupsInitialized: boolean = false;
const cachedTransactions: Transaction[] = [
  { id: '1', type: 'claim', playerId: '101', playerName: 'Joey Daccord', playerTeam: 'SEA', date: '2024-03-25', status: 'pending' }
];

// Helper to reset lineup initialization cache (useful for debugging)
export const resetLineupCache = () => {
  cachedLineupsInitialized = false;
};

// Helper to force re-initialization of all demo team lineups
export const forceReinitializeDemoLineups = async (allPlayers: Player[]) => {
  cachedLineupsInitialized = false;
  await LeagueService.initializeLeague(allPlayers);
};

const POS_MAPPING: Record<string, string> = {
  'Centre': 'C', 'Left Wing': 'LW', 'Right Wing': 'RW', 'Defence': 'D', 'Goalie': 'G'
};

const getNormalizedPos = (p: Player) => {
  if (!p?.position) return 'UTIL';
  if (POS_MAPPING[p.position]) return POS_MAPPING[p.position];
  return p.position;
};

// ─── Request deduplication for league fetches ─────────────────────
// Prevents identical in-flight HTTP requests from being duplicated.
const LEAGUE_CACHE_TTL = 30_000; // 30 seconds
const leagueRequestCache = new Map<string, { promise: Promise<any>; timestamp: number }>();

/**
 * 2026-08-18 launch audit — do not cache failures.
 *
 * This cache holds the PROMISE, and several callers here (notably
 * getUserLeagues) catch internally and RESOLVE with `{ ..., error }`
 * rather than rejecting. A failed fetch therefore looked like a
 * perfectly good cached value and was replayed for the full 30s TTL.
 *
 * The user-visible effect: pressing Retry — including the new
 * LeagueLoadErrorBanner retry and LeagueContext.refreshLeagues — did
 * nothing at all for 30 seconds, replaying the same failure and looking
 * like a dead button. Deduplication is still worth having; caching a
 * failure is not. Evict any settled value that carries an error.
 */
function resolvedWithError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    (value as { error: unknown }).error != null
  );
}

function getLeagueCachedOrFetch<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = leagueRequestCache.get(cacheKey);
  if (existing && Date.now() - existing.timestamp < LEAGUE_CACHE_TTL) {
    return existing.promise as Promise<T>;
  }

  const evict = () => {
    const entry = leagueRequestCache.get(cacheKey);
    if (entry && entry.promise === promise) {
      leagueRequestCache.delete(cacheKey);
    }
  };

  // The `: never` annotation on the rejection handler matters: without
  // it TypeScript widens the result to `T | undefined` and every caller
  // of this helper loses its return type (it inferred `unknown` and
  // produced ~10 downstream errors when this was first written).
  const promise: Promise<T> = fetcher().then(
    (value: T) => {
      // Resolved-but-failed: drop it immediately so the next call retries.
      if (resolvedWithError(value)) evict();
      return value;
    },
    (err: unknown): never => {
      // A genuine rejection must not be replayed either.
      evict();
      throw err;
    },
  );

  // Successful entries still expire on the normal TTL. The trailing
  // catch is required: `promise` is returned to the caller who handles
  // rejection, but this second chain would otherwise surface the same
  // rejection a second time as an unhandled promise rejection.
  void promise
    .finally(() => {
      setTimeout(evict, LEAGUE_CACHE_TTL);
    })
    .catch(() => {});

  leagueRequestCache.set(cacheKey, { promise, timestamp: Date.now() });
  return promise;
}

export const LeagueService = {
  /** Clear the league request cache (useful after mutations like joining/creating) */
  clearLeagueCache() {
    leagueRequestCache.clear();
  },

  /**
   * Create a new league and automatically create the commissioner's team
   */
  async createLeague(
    name: string,
    _commissionerId: string,
    rosterSize: number = 21,
    draftRounds: number = 21,
    settings: LeagueSettings = {},
    scoringSettings?: Record<string, unknown>,
    waiverSettings?: {
      waiver_process_time?: string;
      waiver_period_hours?: number;
      waiver_game_lock?: boolean;
      waiver_type?: 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings';
      allow_trades_during_games?: boolean;
    }
  ): Promise<{ league: League | null; team: Team | null; error: unknown }> {
    try {
      const response = await leagueApi.createLeague({
        name,
        settings: { ...settings, ...waiverSettings } as Record<string, unknown>,
        scoring_settings: scoringSettings as Record<string, unknown>,
        roster_size: rosterSize,
        draft_rounds: draftRounds,
      });
      const data = response.data;
      // ARCHITECT 2026-08-12 (LEAGUE-CACHE / inbox E126) — see the note in
      // joinLeagueByCode. Creating a league changes the same membership the
      // 'userLeagues' key caches, so the cache must not survive it.
      leagueRequestCache.clear();
      return { league: data?.league || null, team: data?.team || null, error: null };
    } catch (error) {
      logger.error('Error creating league:', error);
      return { league: null, team: null, error };
    }
  },

  /**
   * Get a league by ID
   * REQUIRES: User must be a member of the league (commissioner or team owner)
   */
  async getLeague(leagueId: string, _userId?: string): Promise<{ league: League | null; error: unknown }> {
    return getLeagueCachedOrFetch(`league:${leagueId}`, async () => {
      try {
        const response = await leagueApi.getLeague(leagueId);
        return { league: response.data || null, error: null };
      } catch (error) {
        return { league: null, error };
      }
    });
  },

  /**
 * Join a league using a join code
 * Creates a team for the user in the specified league
 * 
 * SECURITY: Uses atomic RPC function with rate limiting to prevent:
 * - Information leakage (can't query leagues without joining)
 * - Race conditions (atomic team creation)
 * - Brute force attacks (10 attempts per hour limit)
 */
async joinLeagueByCode(
  joinCode: string,
  _userId: string,
  teamName?: string
): Promise<{ league: League | null; team: Team | null; error: unknown }> {
  try {
    if (!joinCode || !joinCode.trim()) {
      return { league: null, team: null, error: new Error('Join code is required') };
    }

    const response = await leagueApi.joinLeague({ joinCode: joinCode.trim(), teamName });
    const data = response.data;
    // ARCHITECT 2026-08-12 (LEAGUE-CACHE / inbox E126). The user's league
    // membership just changed, so every cached league read is now wrong.
    // `getLeagueCachedOrFetch` holds RESOLVED PROMISES for LEAGUE_CACHE_TTL
    // (30s) and nothing in the app was invalidating them: `clearLeagueCache`
    // existed, its doc comment said "useful after mutations like
    // joining/creating", and grep across apps/web found exactly one call
    // site — inside its own unit test.
    //
    // The visible consequence: `CreateLeague.handleJoinLeague` does
    // `await refreshLeagues()` immediately after a successful join, and
    // that comment says in as many words that it exists because "users
    // reported joined but got dumped in a different league / GM Office".
    // With a live cache entry (near-certain — the list was fetched on mount
    // seconds earlier) that refresh returned the PRE-JOIN list and the fix
    // was a no-op for up to 30 seconds. Eleven managers will join by code
    // within a few minutes of each other on draft night.
    //
    // Invalidating here rather than at the call site means every caller —
    // present and future — is correct by default.
    leagueRequestCache.clear();
    return {
      league: data?.league || null,
      team: data?.team || null,
      error: null
    };
  } catch (error) {
    logger.error('Exception in joinLeagueByCode:', error);
    return { league: null, team: null, error };
  }
},

  // ─── Settings methods (delegated to LeagueSettingsService) ───────
  updateWaiverSettings: LeagueSettingsService.updateWaiverSettings.bind(LeagueSettingsService),
  updateScoringSettings: LeagueSettingsService.updateScoringSettings.bind(LeagueSettingsService),
  updateDraftSettings: LeagueSettingsService.updateDraftSettings.bind(LeagueSettingsService),
  updateKeeperSettings: LeagueSettingsService.updateKeeperSettings.bind(LeagueSettingsService),
  updateCategorySettings: LeagueSettingsService.updateCategorySettings.bind(LeagueSettingsService),
  updateRosterSlotSettings: LeagueSettingsService.updateRosterSlotSettings.bind(LeagueSettingsService),

  /**
   * Create a notification for all league members
   * NOTE: notifications table schema requires:
   *   - type: one of ('ADD', 'DROP', 'WAIVER', 'TRADE', 'CHAT', 'SYSTEM')
   *   - title: TEXT NOT NULL
   *   - message: TEXT NOT NULL
   *   - read_status: BOOLEAN (not "read")
   */
  async notifyLeagueMembers(leagueId: string, message: string, title?: string): Promise<void> {
    try {
      // Use the SECURITY DEFINER RPC to insert notifications for all league members.
      // Direct INSERT is blocked by RLS (no INSERT policy for type='SYSTEM' from client).
      // The RPC verifies the caller is the commissioner and creates notifications for everyone.
      // Route through the API server to send league-wide notifications
      const { notificationApi } = await import('@/api/notifications');
      await notificationApi.sendChatMessage(leagueId, message, title || 'League Settings Changed');
    } catch (error) {
      logger.error('Error creating notifications:', error);
      // Don't throw - notification failure shouldn't block settings update
    }
  },

  /**
   * Get all leagues the user belongs to (as commissioner or team owner)
   */
  async getUserLeagues(_userId: string): Promise<{ leagues: League[]; error: unknown }> {
    return getLeagueCachedOrFetch('userLeagues', async () => {
      try {
        const response = await leagueApi.getUserLeagues();
        return { leagues: response.data || [], error: null };
      } catch (error) {
        logger.error('[LeagueService] Error in getUserLeagues:', error);
        return { leagues: [], error };
      }
    });
  },

  /**
   * Get all teams in a league
   * Uses RPC function to bypass RLS and return all teams
   */
  async getLeagueTeams(leagueId: string): Promise<{ teams: Team[]; error: unknown }> {
    return getLeagueCachedOrFetch(`leagueTeams:${leagueId}`, async () => {
      try {
        const response = await leagueApi.getTeams(leagueId);
        return { teams: response.data || [], error: null };
      } catch (error) {
        logger.error('Exception in getLeagueTeams:', error);
        return { teams: [], error };
      }
    });
  },

  /**
   * Delete a team from a league (Commissioner only)
   * Also cleans up related data (roster_assignments, team_lineups, draft_picks, etc.)
   */
  async deleteTeam(teamId: string, leagueId: string, _userId: string): Promise<{ success: boolean; error: unknown }> {
    try {
      await leagueApi.deleteTeam(leagueId, teamId);
      return { success: true, error: null };
    } catch (error) {
      logger.error('[LeagueService] Error deleting team:', error);
      return { success: false, error };
    }
  },

  /**
   * Get all teams in a league with owner profile information
   */
  async getLeagueTeamsWithOwners(leagueId: string): Promise<{ teams: (Team & { owner_name?: string })[]; error: unknown }> {
    try {
      const response = await leagueApi.getTeams(leagueId, true);
      return { teams: (response.data || []) as (Team & { owner_name?: string })[], error: null };
    } catch (error) {
      logger.error('Exception in getLeagueTeamsWithOwners:', error);
      return { teams: [], error };
    }
  },

  /**
   * Create simulated teams for a league (for testing/demo)
   */
  /**
   * Create simulated teams for a league (for testing/demo)
   * This function is idempotent - it will only create teams up to the target number
   * and will never create duplicates
   */
  async simulateLeagueFill(leagueId: string, numTeams: number = 12): Promise<{ error: unknown }> {
    try {
      // Get ALL existing teams with their names to avoid duplicates
      const teamsResponse = await leagueApi.getTeams(leagueId);
      const existingTeams = (teamsResponse.data || []) as Array<{ id: string; team_name: string; owner_id: string | null }>;

      const existingCount = existingTeams.length;

      const teamsToCreate = numTeams - existingCount;

      if (teamsToCreate <= 0) {
        return { error: null }; // Already has enough teams
      }

      // Get existing AI team numbers to avoid duplicates
      const existingAITeamNumbers = new Set<number>();
      existingTeams.forEach(team => {
        // Match "AI Team X" pattern
        const match = team.team_name.match(/^AI Team (\d+)$/);
        if (match) {
          const num = parseInt(match[1]);
          existingAITeamNumbers.add(num);
        }
      });

      // Find the next available team numbers starting from 1
      const teamNames: string[] = [];
      let teamNumber = 1;
      let attempts = 0;
      const maxAttempts = 100; // Safety limit

      while (teamNames.length < teamsToCreate && attempts < maxAttempts) {
        if (!existingAITeamNumbers.has(teamNumber)) {
          teamNames.push(`AI Team ${teamNumber}`);
        }
        teamNumber++;
        attempts++;
      }

      if (teamNames.length === 0) {
        return { error: null };
      }

      if (teamNames.length < teamsToCreate) {
        logger.warn('simulateLeagueFill: Could only create', teamNames.length, 'out of', teamsToCreate, 'requested teams');
      }

      // TODO: Add server route POST /api/leagues/:leagueId/simulate-fill
      // For now, call the planned endpoint which will handle the insert server-side
      await apiClient.post(`/api/leagues/${leagueId}/simulate-fill`, { numTeams, teamNames });

      return { error: null };
    } catch (error) {
      logger.error('simulateLeagueFill: Exception:', error);
      return { error };
    }
  },

  /**
   * Get user's team in a league
   */
  async getUserTeam(leagueId: string, _userId: string): Promise<{ team: Team | null; error: unknown }> {
    return getLeagueCachedOrFetch(`userTeam:${leagueId}`, async () => {
      try {
        const response = await leagueApi.getMyTeam(leagueId);
        return { team: response.data || null, error: null };
      } catch (error) {
        return { team: null, error };
      }
    });
  },

  /**
   * Initializes the league state by distributing all players among teams.
   * This ensures that a player is only on one team at a time.
   * Players not assigned to a team become free agents.
   */
  async initializeLeague(allPlayers: Player[]) {
    if (cachedLeagueState && cachedFreeAgents) {
      // Always verify and fix lineups - this catches invalid lineups (e.g., all players on bench)
      // The initializeDefaultLineups function will skip teams with valid lineups, so it's safe to call multiple times
      if (!cachedLineupsInitialized) {
        logger.debug('initializeLeague: Starting async lineup initialization for all 10 demo teams (non-blocking)...');
        cachedLineupsInitialized = true; // Mark immediately to prevent blocking
        // Run asynchronously - don't block roster loading
        // This processes ALL 10 teams (1-10), ensuring each has a valid lineup
        this.initializeDefaultLineups().then(() => {
          logger.debug('initializeLeague: All 10 demo team lineups initialized successfully');
        }).catch(err => {
          logger.error('initializeLeague: Error initializing lineups (non-critical):', err);
        });
      } else {
        // Even if initialized before, verify and fix any invalid lineups
        // This is important for fixing corrupted lineups (e.g., teams 1, 4, 6 with all players on bench)
        logger.debug('initializeLeague: Verifying all 10 demo team lineups are valid (fixing any invalid ones, non-blocking)...');
        // Run asynchronously - don't block
        this.initializeDefaultLineups().then(() => {
          logger.debug('initializeLeague: All 10 demo team lineups verified');
        }).catch(err => {
          logger.error('initializeLeague: Error verifying lineups (non-critical):', err);
        });
      }
      return;
    }

    const teamsCount = LEAGUE_TEAMS_DATA.length;
    // Roster distribution driven by league settings (falls back to standard defaults)
    // MAX_ROSTER_SIZE comes from the league or defaults to 21
    const MAX_ROSTER_SIZE = 21; // Demo league default — real leagues use leagues.roster_size
    // Target roster composition: adapts based on starter slot counts
    // Starters fill first, then bench fills proportionally
    const targetRoster = {
      'C': { min: 4, max: 5 },
      'LW': { min: 4, max: 5 },
      'RW': { min: 4, max: 5 },
      'D': { min: 5, max: 6 },
      'G': { min: 3, max: 3 }
    };

    // Minimum requirements for a valid starting lineup
    const minReqs = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2 };

    const leagueRosters: Record<number, Player[]> = {};
    for (let i = 1; i <= teamsCount; i++) {
      leagueRosters[i] = [];
    }

    // Sort players by "value" (points) to simulate a draft
    // We use points as a proxy for value, but we need to normalize goalie value
    const getPlayerValue = (p: Player) => {
      const pos = getNormalizedPos(p);
      if (pos === 'G') {
        // Rough fantasy point equivalent for goalies to make them draftable
        // Uses centralized ScoringCalculator for consistent scoring weights
        // If stats are null, give them a baseline value to ensure they get drafted
        const wins = p.wins || 0;
        const saves = p.saves || 0;
        // If no stats (e.g. start of season or fallback data without stats), give arbitrary high value
        if (wins === 0 && saves === 0) return 100; // Middle tier
        const goalieScorer = new ScoringCalculator();
        return goalieScorer.calculatePoints({ wins, saves }, true);
      }
      return p.points || 0;
    };

    // Assign exactly 3 goalies to each team
    // Find all goalies sorted by value
    const goalies = allPlayers.filter(p => getNormalizedPos(p) === 'G')
      .sort((a, b) => getPlayerValue(b) - getPlayerValue(a));
    
    // Distribute goalies evenly across teams (3 per team)
    const goaliesPerTeam = 3;
    let goalieIndex = 0;
    for (let teamId = 1; teamId <= teamsCount; teamId++) {
      for (let g = 0; g < goaliesPerTeam && goalieIndex < goalies.length; g++) {
        leagueRosters[teamId].push(goalies[goalieIndex]);
        goalieIndex++;
      }
    }

    // Filter out assigned goalies from the draft pool
    const assignedIds = new Set(goalies.slice(0, goalieIndex).map(p => p.id));
    
    // Initial pool of available players
    const availablePlayers = [...allPlayers]
      .filter(p => !assignedIds.has(p.id))
      .sort((a, b) => getPlayerValue(b) - getPlayerValue(a));

    // Snake draft simulation
    // Round 1: 1 -> 10
    // Round 2: 10 -> 1
    let round = 0;
    // We continue until all teams are full or we run out of players
    while (true) {
      const isEvenRound = round % 2 === 0; // 0, 2, 4... (1->10)
      
      let teamsProcessedInRound = 0;

      for (let i = 0; i < teamsCount; i++) {
        const teamId = isEvenRound ? (i + 1) : (teamsCount - i);
        const currentRoster = leagueRosters[teamId];

        // Determine current position counts first
        const counts = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0 };
        currentRoster.forEach(p => {
          const pos = getNormalizedPos(p);
          if (counts[pos] !== undefined) counts[pos]++;
        });

        // Check if roster has reached maximum size (hard cap of 22)
        if (currentRoster.length >= MAX_ROSTER_SIZE) {
          teamsProcessedInRound++;
          continue;
        }

        // Check if roster is complete (all positions at target minimum)
        const isRosterComplete = 
          counts['C'] >= targetRoster['C'].min &&
          counts['LW'] >= targetRoster['LW'].min &&
          counts['RW'] >= targetRoster['RW'].min &&
          counts['D'] >= targetRoster['D'].min &&
          counts['G'] >= targetRoster['G'].min;
        
        // If roster is complete and at or near max size, skip (allow some flexibility for final picks)
        if (isRosterComplete && currentRoster.length >= MAX_ROSTER_SIZE - 1) {
          teamsProcessedInRound++;
          continue;
        }

        // Draft Strategy:
        // 1. Fill starting requirements first (minReqs)
        // 2. Then fill target roster distribution (targetRoster)
        // 3. Then Best Available
        
        // Find needed positions (prioritize positions below target minimum)
        const needs: string[] = [];
        
        // First priority: Fill starting lineup requirements (skip G since we already have 3)
        if (counts['C'] < minReqs['C']) needs.push('C');
        if (counts['LW'] < minReqs['LW']) needs.push('LW');
        if (counts['RW'] < minReqs['RW']) needs.push('RW');
        if (counts['D'] < minReqs['D']) needs.push('D');
        // Skip G - we already assigned 3 goalies to each team
        
        // Second priority: Fill target roster distribution (if starting lineup is filled)
        if (needs.length === 0) {
          if (counts['C'] < targetRoster['C'].min) needs.push('C');
          if (counts['LW'] < targetRoster['LW'].min) needs.push('LW');
          if (counts['RW'] < targetRoster['RW'].min) needs.push('RW');
          if (counts['D'] < targetRoster['D'].min) needs.push('D');
          // Skip G - we already assigned 3 goalies to each team
        }
        
        // Third priority: Fill up to maximum if below max (for flexibility)
        if (needs.length === 0) {
          if (counts['C'] < targetRoster['C'].max) needs.push('C');
          if (counts['LW'] < targetRoster['LW'].max) needs.push('LW');
          if (counts['RW'] < targetRoster['RW'].max) needs.push('RW');
          if (counts['D'] < targetRoster['D'].max) needs.push('D');
          // G is already at max (3), so skip
        }

        let pickedPlayer: Player | null = null;
        let pickedIndex = -1;

        if (needs.length > 0) {
          // Find best player matching a need (prioritize by value within needs)
          // Filter available players to only those matching needs, then sort by value
          const matchingPlayers = availablePlayers
            .map((p, idx) => ({ player: p, index: idx, pos: getNormalizedPos(p) }))
            .filter(item => needs.includes(item.pos))
            .sort((a, b) => getPlayerValue(b.player) - getPlayerValue(a.player));
          
          if (matchingPlayers.length > 0) {
            pickedIndex = matchingPlayers[0].index;
          }
        }

        // If no player found for needs (or no needs left), take best available (UTIL/Bench)
        // BUT exclude goalies since we already have 3
        if (pickedIndex === -1) {
          // Find best available player that is NOT a goalie (since we already have 3)
          pickedIndex = availablePlayers.findIndex(p => getNormalizedPos(p) !== 'G');
          // If no non-goalie available, skip this pick
          if (pickedIndex === -1) {
            teamsProcessedInRound++;
            continue;
          }
        }
        
        // Double-check: Never draft a goalie if we already have 3
        if (pickedIndex !== -1 && pickedIndex < availablePlayers.length) {
          const candidate = availablePlayers[pickedIndex];
          if (getNormalizedPos(candidate) === 'G' && counts['G'] >= 3) {
            // Skip this goalie, find next non-goalie
            pickedIndex = availablePlayers.findIndex((p, idx) => 
              idx > pickedIndex && getNormalizedPos(p) !== 'G'
            );
            if (pickedIndex === -1) {
              teamsProcessedInRound++;
              continue;
            }
          }
        }

        if (pickedIndex !== -1 && pickedIndex < availablePlayers.length) {
          pickedPlayer = availablePlayers[pickedIndex];
          // Remove from available
          availablePlayers.splice(pickedIndex, 1);
          // Add to roster
          currentRoster.push(pickedPlayer);
        }
        
        teamsProcessedInRound++;
      }

      // Check if all teams have reached maximum roster size or run out of players
      const allAtMax = Object.values(leagueRosters).every(roster => roster.length >= MAX_ROSTER_SIZE);
      
      if (allAtMax || availablePlayers.length === 0) break;

      round++;
    }

    cachedLeagueState = leagueRosters;
    cachedFreeAgents = availablePlayers;
    
    // Initialize default lineups for ALL 10 demo teams (only once per session)
    // This ensures all 10 demo teams have full starting lineups for non-logged-in users
    // NOTE: Do this asynchronously so it doesn't block roster loading
    if (!cachedLineupsInitialized) {
      logger.debug('initializeLeague: Starting async lineup initialization for all 10 demo teams (non-blocking)...');
      cachedLineupsInitialized = true; // Mark immediately to prevent blocking
      // Run lineup initialization in background - don't await
      // This processes ALL 10 teams (1-10), not just Team 3
      this.initializeDefaultLineups().then(() => {
        logger.debug('initializeLeague: All 10 demo team lineups initialized successfully');
      }).catch((error) => {
        logger.error('initializeLeague: Error initializing lineups (non-critical):', error);
        // This is non-critical - rosters are already available in cachedLeagueState
      });
    }
  },

  /**
   * Initialize default lineups for ALL 10 teams in the demo league
   * 
   * ⚠️ DEMO STATE ONLY: This function creates static lineups for all demo teams.
   * 
   * This function:
   * 1. Processes ALL 10 demo teams (IDs 1-10)
   * 2. Creates valid starting lineups for each team (10+ starters, bench players)
   * 3. Saves lineups to database using demo league ID ('demo-league-id')
   * 4. Runs asynchronously (non-blocking) so it doesn't delay roster loading
   * 
   * CRITICAL: This ensures ALL 10 demo teams have complete, valid lineups.
   * Not just Team 3 (the guest's team), but ALL teams in the demo league.
   * 
   * The lineups are saved to the database but are completely isolated from real user data.
   * They use the special 'demo-league-id' which is not a real league.
   */
  async initializeDefaultLineups() {
    if (!cachedLeagueState) {
      return;
    }
    
    // Use a fixed demo league ID for demo teams (not a real database league)
    const demoLeagueId = 'demo-league-id';
    
    const getFantasyPosition = (position: string): 'C' | 'LW' | 'RW' | 'D' | 'G' | 'UTIL' => {
      const pos = position?.toUpperCase() || '';
      if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
      if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
      if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
      if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
      if (['G', 'GOALIE'].includes(pos)) return 'G';
      return 'UTIL';
    };

    // Process ALL 10 demo teams (IDs 1-10) from LEAGUE_TEAMS_DATA
    // This ensures EVERY team in the demo league has a full, valid lineup
    // Not just Team 3 (guest's team), but ALL 10 teams
    for (let teamIdNum = 1; teamIdNum <= LEAGUE_TEAMS_DATA.length; teamIdNum++) {
      const players = cachedLeagueState[teamIdNum] || [];
      
      if (players.length === 0) {
        logger.warn(`Team ${teamIdNum}: No players assigned, skipping lineup initialization`);
        continue; // Skip teams with no players
      }
      
      // For demo league, ALWAYS check and ensure valid lineups
      // Check if lineup exists and validate it (with league_id for isolation)
      // Note: demoLeagueId is passed to initializeDemoLeagueLineups
      const existingLineup = demoLeagueId ? await this.getLineup(teamIdNum, demoLeagueId) : null;
      
      // Validate existing lineup: must have at least 10 starters (minimum for a valid lineup)
      // CRITICAL: If all players are on bench with no starters, lineup is invalid
      const starterCount = existingLineup?.starters && Array.isArray(existingLineup.starters) 
        ? existingLineup.starters.length 
        : 0;
      const benchCount = existingLineup?.bench && Array.isArray(existingLineup.bench) 
        ? existingLineup.bench.length 
        : 0;
      
      // Lineup is valid ONLY if it has at least 10 starters AND some bench players
      // If starters is empty or too small, it's invalid (all players on bench = bad)
      const isValidLineup = starterCount >= 10 && benchCount > 0;
      
      if (isValidLineup) {
        continue; // Skip if lineup already exists and is valid
      }
      
      // Log what we found - especially important for teams with all players on bench
      if (existingLineup) {
        if (starterCount === 0 && benchCount > 0) {
          logger.error(`Team ${teamIdNum}: ❌ CRITICAL - All ${benchCount} players are on bench, NO STARTERS! This is invalid. Re-initializing...`);
        }
      }
      
      // If we get here, either no lineup exists or it's invalid - create/fix it
      // Use EXACT same logic for all teams (same as team 2 which works)
      
      // Auto-assign players to starters/bench
      const starters: string[] = [];
      const bench: string[] = [];
      const ir: string[] = [];
      const slotAssignments: Record<string, string> = {};
      
      const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
      const slotsFilled = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0 };
      
      let irSlotIndex = 1;
      
      // Sort players by points (best players first) for consistent assignment
      const sortedPlayers = [...players].sort((a, b) => {
        const valueA = a.points || 0;
        const valueB = b.points || 0;
        return valueB - valueA;
      });
      
      sortedPlayers.forEach(p => {
        const playerId = String(p.id);
        
        // Check for IR status (if status field exists)
        const statusLower = p.status?.toLowerCase() || '';
        if (statusLower === 'injured' || statusLower === 'suspended' || statusLower === 'ir') {
          if (irSlotIndex <= 3) {
            ir.push(playerId);
            slotAssignments[playerId] = `ir-slot-${irSlotIndex}`;
            irSlotIndex++;
          } else {
            bench.push(playerId);
          }
          return;
        }
        
        const pos = getFantasyPosition(p.position);
        let assigned = false;
        
        // Fill position slots first
        if (pos !== 'UTIL' && slotsFilled[pos] < slotsNeeded[pos]) {
          slotsFilled[pos]++;
          assigned = true;
          slotAssignments[playerId] = `slot-${pos}-${slotsFilled[pos]}`;
        } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
          slotsFilled['UTIL']++;
          assigned = true;
          slotAssignments[playerId] = 'slot-UTIL';
        }
        
        if (assigned) {
          starters.push(playerId);
        } else {
          bench.push(playerId);
        }
      });
      
      // Only save if we have a valid lineup (at least 10 starters AND bench players)
      if (starters.length >= 10 && bench.length > 0 && demoLeagueId) {
        try {
          await this.saveLineup(teamIdNum, demoLeagueId, {
            starters,
            bench,
            ir,
            slotAssignments
          });
          logger.debug(`Team ${teamIdNum}: Lineup saved successfully (${starters.length} starters, ${bench.length} bench, ${ir.length} IR)`);
        } catch (error) {
          logger.error(`Team ${teamIdNum}: ❌ FAILED to save lineup:`, error);
        }
      } else {
        logger.error(`Team ${teamIdNum}: ❌ CRITICAL - Has insufficient players for a valid lineup (${starters.length} starters, ${bench.length} bench, ${players.length} total players). This should not happen in demo league!`);
        // Even if we can't fill all slots, save what we have to prevent empty lineups
        if (starters.length > 0 && demoLeagueId) {
          try {
            await this.saveLineup(teamIdNum, demoLeagueId, {
              starters,
              bench,
              ir,
              slotAssignments
            });
          } catch (error) {
            logger.error(`Team ${teamIdNum}: ❌ FAILED to save even partial lineup:`, error);
          }
        }
      }
    }
    
  },

  async getMyTeam(allPlayers: Player[]): Promise<Player[]> {
    await this.initializeLeague(allPlayers);
    return cachedLeagueState?.[3] || []; // User is Team 3
  },

  async getTeamRoster(teamId: number, allPlayers: Player[]): Promise<Player[]> {
    await this.initializeLeague(allPlayers);
    return cachedLeagueState?.[teamId] || [];
  },

  async getFreeAgents(allPlayers: Player[], leagueId?: string, userId?: string): Promise<{ players: Player[]; rosterLookupFailed: boolean }> {
    // If leagueId is provided, use real database data
    if (leagueId && userId) {
      try {
        // CRITICAL FIX: Use roster_assignments (single source of truth) instead of draft_picks.
        // draft_picks only tracks drafted players — players added via waivers/FA are NOT in draft_picks,
        // causing them to incorrectly appear as free agents while already on a roster.
        const rostersResponse = await rosterApi.getLeagueRosters(leagueId);
        const rosterAssignments = (rostersResponse.data || []) as Array<{ player_id: string }>;

        // Get player IDs that are currently on any roster in this league
        const ownedPlayerIds = new Set(
          rosterAssignments.map((r: { player_id: string }) => String(r.player_id))
        );

        // Filter out owned players - only return players NOT on any roster
        const freeAgents = allPlayers.filter(player => !ownedPlayerIds.has(String(player.id)));

        return { players: freeAgents, rosterLookupFailed: false };
      } catch (error) {
        logger.error('Error getting free agents from database:', error);
        logger.error(`Failed to fetch rosters for league ${leagueId} — showing all players as free agents instead of 0`, error);
        // CRITICAL FIX: If we can't determine which players are rostered,
        // treat ALL players as free agents rather than returning an empty list.
        // Previously this fell back to demo data (cachedFreeAgents) which was
        // often empty/null for real leagues, causing "0 of 0" display.
        return { players: allPlayers, rosterLookupFailed: true };
      }
    }

    // No leagueId provided - use demo data
    await this.initializeLeague(allPlayers);
    return { players: cachedFreeAgents || [], rosterLookupFailed: false };
  },

  getWatchlist(): Set<string> {
    return cachedWatchlist;
  },

  addToWatchlist(playerId: string) {
    cachedWatchlist.add(playerId);
  },

  removeFromWatchlist(playerId: string) {
    cachedWatchlist.delete(playerId);
  },

  getTransactions(): Transaction[] {
    return cachedTransactions;
  },

  addTransaction(transaction: Transaction) {
    cachedTransactions.unshift(transaction);
  },

  /**
   * Fetch real transactions from roster_transactions table
   */
  /**
   * Fetch real transactions from roster_transactions table
   */
  async fetchTransactions(leagueId: string): Promise<{ transactions: Transaction[]; error: unknown }> {
    try {
      const response = await leagueApi.getTransactions(leagueId);
      const data = (response.data || []) as Array<{
        id: string;
        type: string;
        player_id: string;
        drop_player_id?: string | null;
        created_at: string;
        source: string | null;
        status?: string | null;
        failure_reason?: string | null;
        teams: { team_name: string } | null;
        profiles: { first_name: string | null; last_name: string | null } | null;
        // Waiver claim enrichment fields (present on WAIVER_PENDING/WAIVER_FAILED rows)
        priority?: number | null;
        bid_amount?: number | null;
        is_conditional_drop?: boolean | null;
        waiver_dropped_at?: string | null;
        waiver_clears_at?: string | null;
        league_waiver_period_hours?: number | null;
        league_waiver_process_time?: string | null;
      }>;

      // Get all players to map player_id to player details
      const allPlayers = await PlayerService.getAllPlayers();
      const playerMap = new Map(allPlayers.map(p => [p.id, p]));

      const mapType = (raw: string, source: string | null): Transaction['type'] => {
        const t = (raw || '').toLowerCase();
        if (t === 'waiver_pending' || t === 'waiver_failed') return 'waiver';
        if (t === 'drop') return 'drop';
        if (t === 'trade') return 'trade';
        if (t === 'add') return source === 'Waiver Processing' ? 'waiver' : 'claim';
        return 'claim';
      };

      const mapStatus = (raw: string | null | undefined): Transaction['status'] => {
        if (raw === 'pending') return 'pending';
        if (raw === 'failed') return 'failed';
        return 'processed';
      };

      const transactions: Transaction[] = (data || []).map((tx) => {
        const player = playerMap.get(tx.player_id);
        const dropPlayer = tx.drop_player_id ? playerMap.get(tx.drop_player_id) : null;
        return {
          id: tx.id,
          type: mapType(tx.type, tx.source),
          playerId: tx.player_id,
          playerName: player?.full_name || 'Unknown Player',
          playerPosition: player?.position || null,
          playerTeam: player?.team || 'N/A',
          // Mountain Time formatted label like "Tue Apr 7 • 12:52 PM MT".
          // Roster.tsx renders this verbatim so the Transactions tab shows
          // the same explicit MT language as the Waiver Wire page.
          date: formatMoment(tx.created_at) || new Date(tx.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          createdAt: tx.created_at ?? null,
          status: mapStatus(tx.status),
          failureReason: tx.failure_reason ?? null,
          dropPlayerId: tx.drop_player_id ?? null,
          dropPlayerName: dropPlayer?.full_name ?? null,
          dropPlayerPosition: dropPlayer?.position ?? null,
          dropPlayerTeam: dropPlayer?.team ?? null,
          priority: tx.priority ?? null,
          bidAmount: tx.bid_amount ?? null,
          isConditionalDrop: tx.is_conditional_drop ?? null,
          waiverDroppedAt: tx.waiver_dropped_at ?? null,
          waiverClearsAt: tx.waiver_clears_at ?? null,
          leagueWaiverProcessTime: tx.league_waiver_process_time ?? null,
          leagueWaiverPeriodHours: tx.league_waiver_period_hours ?? null,
        };
      });

      return { transactions, error: null };
    } catch (error) {
      logger.error('Error in fetchTransactions:', error);
      return { transactions: [], error };
    }
  },

  /**
   * Fetch recent transactions for notifications (last 10, across all user's leagues)
   */
  async fetchRecentTransactionsForNotifications(userId: string): Promise<Transaction[]> {
    try {
      // Get all leagues the user is in via the API
      const leaguesResponse = await leagueApi.getUserLeagues();
      const userLeagues = (leaguesResponse.data || []) as Array<{ id: string }>;

      if (userLeagues.length === 0) {
        return [];
      }

      // Fetch transactions from each league and combine
      const allTransactionData: Array<{ id: string; type: string; player_id: string; created_at: string; source: string | null; league_id: string; teams: { team_name: string } | null }> = [];

      for (const league of userLeagues) {
        try {
          const txResponse = await leagueApi.getTransactions(league.id);
          const txData = (txResponse.data || []) as Array<{ id: string; type: string; player_id: string; created_at: string; source: string | null; league_id?: string; teams: { team_name: string } | null }>;
          txData.forEach(tx => allTransactionData.push({ ...tx, league_id: league.id }));
        } catch {
          // Skip leagues where transaction fetch fails
        }
      }

      if (allTransactionData.length === 0) {
        return [];
      }

      // Sort by created_at descending and take the 10 most recent
      allTransactionData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const data = allTransactionData.slice(0, 10);

      // Get all players to map player_id to player details
      const allPlayers = await PlayerService.getAllPlayers();
      const playerMap = new Map(allPlayers.map(p => [p.id, p]));

      const transactions: Transaction[] = data.map((tx: { id: string; type: string; player_id: string; created_at: string; source: string | null; league_id: string; teams: { team_name: string } | null }) => {
        const player = playerMap.get(tx.player_id);
        const lowered = (tx.type || '').toLowerCase();
        let type: Transaction['type'] = 'claim';
        if (lowered === 'drop') type = 'drop';
        else if (lowered === 'trade') type = 'trade';
        else if (lowered === 'waiver_pending' || lowered === 'waiver_failed') type = 'waiver';
        else if (lowered === 'add' && tx.source === 'Waiver Processing') type = 'waiver';

        return {
          id: tx.id,
          type,
          playerId: tx.player_id,
          playerName: player?.full_name || 'Unknown Player',
          playerTeam: player?.team || 'N/A',
          date: new Date(tx.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          }),
          status: 'processed' as const,
        };
      });

      return transactions;
    } catch (error) {
      logger.error('Error fetching notifications:', error);
      return [];
    }
  },

  getAllTeams(): LeagueTeam[] {
    // This returns the static team data, rosters need to be fetched via getTeamRoster
    // or we can merge them here if we are careful about async initialization
    return LEAGUE_TEAMS_DATA.map(t => ({
        ...t,
        roster: cachedLeagueState?.[t.id] || []
    }));
  },
  
  async getAllTeamsWithRosters(allPlayers: Player[]): Promise<LeagueTeam[]> {
    await this.initializeLeague(allPlayers);
    return LEAGUE_TEAMS_DATA.map(t => ({
        ...t,
        roster: cachedLeagueState?.[t.id] || []
    }));
  },

  // ─── Lineup methods (delegated to LineupService) ────────────────
  saveLineup: LineupService.saveLineup.bind(LineupService),
  backfillMissingDailyRosters: LineupService.backfillMissingDailyRosters.bind(LineupService),
  backfillAllMatchupsForLeague: LineupService.backfillAllMatchupsForLeague.bind(LineupService),
  canUpdateRosterForDate: LineupService.canUpdateRosterForDate.bind(LineupService),
  getLineup: LineupService.getLineup.bind(LineupService),
  loadDailyRoster: LineupService.loadDailyRoster.bind(LineupService),

  // ─── Standings methods (delegated to StandingsService) ─────────
  calculateTeamStandings: StandingsService.calculateTeamStandings.bind(StandingsService),
  calculateSeasonPointsStandings: StandingsService.calculateSeasonPointsStandings.bind(StandingsService),
  calculateCategoryStandings: StandingsService.calculateCategoryStandings.bind(StandingsService),
  calculateRotoStandingsFromDB: StandingsService.calculateRotoStandingsFromDB.bind(StandingsService),

  /**
   * Update all teams owned by a user with a new team name
   * This syncs the default_team_name from profiles to existing teams
   */
  async updateUserTeamNames(userId: string, newTeamName: string): Promise<{ error: unknown; updatedCount?: number }> {
    try {
      if (!newTeamName || !newTeamName.trim()) {
        return { error: null, updatedCount: 0 }; // No name to update
      }

      const trimmedName = newTeamName.trim();

      // TODO: Add server route PUT /api/account/team-name
      // For now, call the planned endpoint which will handle the update server-side
      const response = await apiClient.put('/api/account/team-name', { teamName: trimmedName });
      const result = response.data as { updatedCount?: number } | undefined;

      return { error: null, updatedCount: result?.updatedCount || 0 };
    } catch (error) {
      logger.error('Exception in updateUserTeamNames:', error);
      return { error, updatedCount: 0 };
    }
  },

  // initializeTeamLineup delegated to LineupService (see lineup methods above)
  initializeTeamLineup: LineupService.initializeTeamLineup.bind(LineupService),

  /**
   * Drop a player from the roster using process_roster_move (Transactional Engine)
   */
  async dropPlayer(
    leagueId: string,
    userId: string,
    playerId: string,
    source: string = 'Roster Tab'
  ): Promise<{ success: boolean; error: unknown }> {
    // Read-only guard: Block all drops for demo league
    if (leagueId === DEMO_LEAGUE_ID_FOR_GUESTS) {
      return {
        success: false,
        error: new Error('Demo league is read-only. Sign up to create your own league!')
      };
    }

    try {
      // Route through API server for roster moves
      const { waiverApi } = await import('@/api/waivers');
      const { leagueApi } = await import('@/api/leagues');

      // Get user's team ID
      const teamResult = await leagueApi.getMyTeam(leagueId);
      const teamId = teamResult.data?.id;
      if (!teamId) return { success: false, error: new Error('Team not found') };

      const dropResult = await waiverApi.dropPlayer(leagueId, { teamId, playerId });
      if (dropResult.error) {
        return { success: false, error: new Error(dropResult.error) };
      }

      MatchupService.clearRosterCache(teamId, leagueId);
      return { success: true, error: null };
    } catch (error) {
      return { success: false, error };
    }
  },

  /**
   * Add a player to the roster (with roster size check)
   */
  async addPlayer(
    leagueId: string,
    userId: string,
    playerId: string,
    source: string = 'Roster Tab'
  ): Promise<{ success: boolean; error: unknown }> {
    // Read-only guard: Block all adds for demo league
    if (leagueId === DEMO_LEAGUE_ID_FOR_GUESTS) {
      return { 
        success: false, 
        error: new Error('Demo league is read-only. Sign up to create your own league!') 
      };
    }

    try {
      // First check roster size limit (pass userId for membership validation)
      const { league, error: leagueError } = await this.getLeague(leagueId, userId);
      if (leagueError || !league) {
        return { success: false, error: leagueError || new Error('League not found') };
      }

      // Route through API server for roster moves (server handles size checks)
      const { waiverApi } = await import('@/api/waivers');
      const { leagueApi: leagueApiImport } = await import('@/api/leagues');

      // Get user's team ID
      const teamResult = await leagueApiImport.getMyTeam(leagueId);
      const teamId = teamResult.data?.id;
      if (!teamId) return { success: false, error: new Error('Team not found') };

      const addResult = await waiverApi.addFreeAgent(leagueId, { teamId, playerId });
      if (addResult.error) {
        return { success: false, error: new Error(addResult.error) };
      }

      // Clear roster cache for this team when player is added
      const { MatchupService } = await import('./MatchupService');
      MatchupService.clearRosterCache(teamId, leagueId);

      return { success: true, error: null };
    } catch (error) {
      return { success: false, error };
    }
  }
};
