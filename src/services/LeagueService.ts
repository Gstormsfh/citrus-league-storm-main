import { Player } from "@/services/PlayerService";
import { supabase } from "@/integrations/supabase/client";
import { DraftService } from "./DraftService";
import { MatchupService } from "./MatchupService";

export interface League {
  id: string;
  name: string;
  commissioner_id: string;
  draft_status: 'not_started' | 'queued' | 'in_progress' | 'completed';
  join_code: string;
  roster_size: number;
  draft_rounds: number;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
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
  type: 'claim' | 'drop' | 'trade';
  playerId: string;
  playerName: string;
  playerTeam: string;
  date: string;
  status: 'pending' | 'processed' | 'failed';
}

let cachedLeagueState: Record<number, Player[]> | null = null;
let cachedFreeAgents: Player[] | null = null;
let cachedWatchlist: Set<string> = new Set();
let cachedLineupsInitialized: boolean = false;
let cachedTransactions: Transaction[] = [
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

export const LeagueService = {
  /**
   * Create a new league and automatically create the commissioner's team
   */
  async createLeague(
    name: string,
    commissionerId: string,
    rosterSize: number = 21,
    draftRounds: number = 21,
    settings: Record<string, any> = {}
  ): Promise<{ league: League | null; team: Team | null; error: any }> {
    try {
      // Create the league
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .insert({
          name,
          commissioner_id: commissionerId,
          roster_size: rosterSize,
          draft_rounds: draftRounds,
          settings,
        })
        .select()
        .single();

      if (leagueError) throw leagueError;

      // Get the commissioner's profile for default team name
      const { data: profile } = await supabase
        .from('profiles')
        .select('username, default_team_name')
        .eq('id', commissionerId)
        .single();

      // Use default_team_name if set, otherwise fall back to username-based name
      const teamName = profile?.default_team_name?.trim() 
        || (profile?.username 
          ? `${profile.username}'s Team`
          : 'My Team');

      // Create the commissioner's team
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .insert({
          league_id: league.id,
          owner_id: commissionerId,
          team_name: teamName,
        })
        .select()
        .single();

      if (teamError) throw teamError;

      return { league, team, error: null };
    } catch (error) {
      console.error('Error creating league:', error);
      return { league: null, team: null, error };
    }
  },

  /**
   * Get a league by ID
   */
  async getLeague(leagueId: string): Promise<{ league: League | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('leagues')
        .select('*')
        .eq('id', leagueId)
        .single();

      if (error) throw error;
      return { league: data, error: null };
    } catch (error) {
      return { league: null, error };
    }
  },

  /**
   * Get all leagues the user belongs to (as commissioner or team owner)
   */
  async getUserLeagues(userId: string): Promise<{ leagues: League[]; error: any }> {
    try {
      // Get leagues where user is commissioner (exclude demo league)
      const { data: commissionerLeagues, error: commError } = await supabase
        .from('leagues')
        .select('*')
        .eq('commissioner_id', userId)
        .neq('id', '00000000-0000-0000-0000-000000000001') // Exclude demo league
        .order('created_at', { ascending: false });

      if (commError) throw commError;

      // Get leagues where user owns a team (exclude demo league teams)
      const { data: userTeams } = await supabase
        .from('teams')
        .select('league_id')
        .eq('owner_id', userId)
        .neq('league_id', '00000000-0000-0000-0000-000000000001'); // Exclude demo league

      const leagueIds = userTeams?.map(t => t.league_id) || [];
      
      let ownerLeagues: League[] = [];
      if (leagueIds.length > 0) {
        const { data, error: ownerError } = await supabase
          .from('leagues')
          .select('*')
          .in('id', leagueIds)
          .neq('id', '00000000-0000-0000-0000-000000000001') // Exclude demo league
          .order('created_at', { ascending: false });

        if (ownerError) throw ownerError;
        ownerLeagues = data || [];
      }

      // Combine and deduplicate
      const allLeagues = [...(commissionerLeagues || []), ...ownerLeagues];
      const uniqueLeagues = Array.from(
        new Map(allLeagues.map(l => [l.id, l])).values()
      );

      return { leagues: uniqueLeagues, error: null };
    } catch (error) {
      return { leagues: [], error };
    }
  },

  /**
   * Get all teams in a league
   */
  async getLeagueTeams(leagueId: string): Promise<{ teams: Team[]; error: any }> {
    try {
      console.log('Fetching teams for league:', leagueId);
      const { data, error } = await supabase
        .from('teams')
        .select('*')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching teams:', error);
        throw error;
      }
      console.log('Fetched teams:', data);
      return { teams: data || [], error: null };
    } catch (error) {
      console.error('Exception in getLeagueTeams:', error);
      return { teams: [], error };
    }
  },

  /**
   * Get all teams in a league with owner profile information
   */
  async getLeagueTeamsWithOwners(leagueId: string): Promise<{ teams: (Team & { owner_name?: string })[]; error: any }> {
    try {
      console.log('Fetching teams with owners for league:', leagueId);
      const { data: teams, error: teamsError } = await supabase
        .from('teams')
        .select('*')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: true });

      if (teamsError) {
        console.error('Error fetching teams:', teamsError);
        throw teamsError;
      }

      if (!teams || teams.length === 0) {
        return { teams: [], error: null };
      }

      // Get unique owner IDs
      const ownerIds = teams
        .map(t => t.owner_id)
        .filter((id): id is string => id !== null);

      // Fetch owner profiles
      let ownerProfiles: Record<string, { first_name?: string; last_name?: string; username?: string }> = {};
      if (ownerIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, username')
          .in('id', ownerIds);

        if (!profilesError && profiles) {
          profiles.forEach(profile => {
            ownerProfiles[profile.id] = profile;
          });
        }
      }

      // Map teams with owner names
      const teamsWithOwners = teams.map(team => {
        if (!team.owner_id) {
          return { ...team, owner_name: 'AI Team' };
        }

        const owner = ownerProfiles[team.owner_id];
        if (owner) {
          const ownerName = owner.first_name && owner.last_name
            ? `${owner.first_name} ${owner.last_name}`
            : owner.username || 'User';
          return { ...team, owner_name: ownerName };
        }

        return { ...team, owner_name: 'User' };
      });

      console.log('Fetched teams with owners:', teamsWithOwners);
      return { teams: teamsWithOwners, error: null };
    } catch (error) {
      console.error('Exception in getLeagueTeamsWithOwners:', error);
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
  async simulateLeagueFill(leagueId: string, numTeams: number = 12): Promise<{ error: any }> {
    try {
      console.log('simulateLeagueFill: Starting for league', leagueId, 'target teams:', numTeams);
      
      // Get ALL existing teams with their names to avoid duplicates
      const { data: existingTeams, error: countError } = await supabase
        .from('teams')
        .select('id, team_name, owner_id')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: true });

      if (countError) {
        console.error('simulateLeagueFill: Error counting existing teams:', countError);
        throw countError;
      }

      const existingCount = existingTeams?.length || 0;
      console.log('simulateLeagueFill: Existing teams count:', existingCount);
      console.log('simulateLeagueFill: Existing teams:', existingTeams?.map(t => t.team_name));
      
      const teamsToCreate = numTeams - existingCount;
      console.log('simulateLeagueFill: Teams to create:', teamsToCreate);

      if (teamsToCreate <= 0) {
        console.log('simulateLeagueFill: Already has enough teams (', existingCount, '>=', numTeams, ')');
        return { error: null }; // Already has enough teams
      }

      // Get existing AI team numbers to avoid duplicates
      const existingAITeamNumbers = new Set<number>();
      existingTeams?.forEach(team => {
        // Match "AI Team X" pattern
        const match = team.team_name.match(/^AI Team (\d+)$/);
        if (match) {
          const num = parseInt(match[1]);
          existingAITeamNumbers.add(num);
          console.log('simulateLeagueFill: Found existing AI Team', num);
        }
      });

      // Find the next available team numbers starting from 1
      const teamsToInsert = [];
      let teamNumber = 1;
      let attempts = 0;
      const maxAttempts = 100; // Safety limit
      
      while (teamsToInsert.length < teamsToCreate && attempts < maxAttempts) {
        if (!existingAITeamNumbers.has(teamNumber)) {
          teamsToInsert.push({
            league_id: leagueId,
            owner_id: null, // Simulated teams have no owner
            team_name: `AI Team ${teamNumber}`,
          });
          console.log('simulateLeagueFill: Will create AI Team', teamNumber);
        }
        teamNumber++;
        attempts++;
      }

      if (teamsToInsert.length === 0) {
        console.log('simulateLeagueFill: No teams to insert (all numbers 1-100 are taken)');
        return { error: null };
      }

      if (teamsToInsert.length < teamsToCreate) {
        console.warn('simulateLeagueFill: Could only create', teamsToInsert.length, 'out of', teamsToCreate, 'requested teams');
      }

      console.log('simulateLeagueFill: Inserting', teamsToInsert.length, 'teams:', teamsToInsert.map(t => t.team_name));

      // Insert teams one at a time to avoid any potential race conditions
      // Actually, let's do a single insert for efficiency, but with proper error handling
      const { data: insertedTeams, error } = await supabase
        .from('teams')
        .insert(teamsToInsert)
        .select();

      if (error) {
        console.error('simulateLeagueFill: Insert error:', error);
        throw error;
      }

      console.log('simulateLeagueFill: Successfully inserted', insertedTeams?.length || 0, 'teams');
      console.log('simulateLeagueFill: Inserted teams:', insertedTeams?.map(t => t.team_name));
      
      return { error: null };
    } catch (error) {
      console.error('simulateLeagueFill: Exception:', error);
      return { error };
    }
  },

  /**
   * Get user's team in a league
   */
  async getUserTeam(leagueId: string, userId: string): Promise<{ team: Team | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('teams')
        .select('*')
        .eq('league_id', leagueId)
        .eq('owner_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return { team: data || null, error: null };
    } catch (error) {
      return { team: null, error };
    }
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
        console.log('initializeLeague: Starting async lineup initialization for all 10 demo teams (non-blocking)...');
        cachedLineupsInitialized = true; // Mark immediately to prevent blocking
        // Run asynchronously - don't block roster loading
        // This processes ALL 10 teams (1-10), ensuring each has a valid lineup
        this.initializeDefaultLineups().then(() => {
          console.log('initializeLeague: ✅ All 10 demo team lineups initialized successfully');
        }).catch(err => {
          console.error('initializeLeague: Error initializing lineups (non-critical):', err);
        });
      } else {
        // Even if initialized before, verify and fix any invalid lineups
        // This is important for fixing corrupted lineups (e.g., teams 1, 4, 6 with all players on bench)
        console.log('initializeLeague: Verifying all 10 demo team lineups are valid (fixing any invalid ones, non-blocking)...');
        // Run asynchronously - don't block
        this.initializeDefaultLineups().then(() => {
          console.log('initializeLeague: ✅ All 10 demo team lineups verified');
        }).catch(err => {
          console.error('initializeLeague: Error verifying lineups (non-critical):', err);
        });
      }
      return;
    }

    const teamsCount = LEAGUE_TEAMS_DATA.length;
    // Target roster distribution: 4-5 C, 4-5 LW, 4-5 RW, 5-6 D, 3 G
    // Maximum roster size: 21 players total (starting lineup + 8 bench)
    const MAX_ROSTER_SIZE = 21;
    const targetRoster = {
      'C': { min: 4, max: 5 },
      'LW': { min: 4, max: 5 },
      'RW': { min: 4, max: 5 },
      'D': { min: 5, max: 6 },
      'G': { min: 3, max: 3 } // Exactly 3 goalies
    };
    
    // Minimum requirements for a valid starting lineup (for initial draft priority)
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
        // Wins * 4 + Saves * 0.2 - GoalsAgainst * 2
        // If stats are null, give them a baseline value to ensure they get drafted
        const wins = p.wins || 0;
        const saves = p.saves || 0;
        // If no stats (e.g. start of season or fallback data without stats), give arbitrary high value
        if (wins === 0 && saves === 0) return 100; // Middle tier
        return (wins * 4) + (saves * 0.2); 
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
      console.log('initializeLeague: Starting async lineup initialization for all 10 demo teams (non-blocking)...');
      cachedLineupsInitialized = true; // Mark immediately to prevent blocking
      // Run lineup initialization in background - don't await
      // This processes ALL 10 teams (1-10), not just Team 3
      this.initializeDefaultLineups().then(() => {
        console.log('initializeLeague: ✅ All 10 demo team lineups initialized successfully');
      }).catch((error) => {
        console.error('initializeLeague: Error initializing lineups (non-critical):', error);
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
      console.log('initializeDefaultLineups: No cached league state, skipping');
      return;
    }
    
    // Use a fixed demo league ID for demo teams (not a real database league)
    const demoLeagueId = 'demo-league-id';
    
    console.log('initializeDefaultLineups: Starting lineup initialization for all demo teams (1-10)');

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
    console.log(`initializeDefaultLineups: Processing all ${LEAGUE_TEAMS_DATA.length} demo teams...`);
    for (let teamIdNum = 1; teamIdNum <= LEAGUE_TEAMS_DATA.length; teamIdNum++) {
      const players = cachedLeagueState[teamIdNum] || [];
      
      if (players.length === 0) {
        console.warn(`Team ${teamIdNum}: No players assigned, skipping lineup initialization`);
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
        console.log(`Team ${teamIdNum}: Lineup already exists and is valid (${starterCount} starters, ${benchCount} bench)`);
        continue; // Skip if lineup already exists and is valid
      }
      
      // Log what we found - especially important for teams with all players on bench
      if (existingLineup) {
        if (starterCount === 0 && benchCount > 0) {
          console.error(`Team ${teamIdNum}: ❌ CRITICAL - All ${benchCount} players are on bench, NO STARTERS! This is invalid. Re-initializing...`);
        } else {
          console.log(`Team ${teamIdNum}: Existing lineup is INVALID (${starterCount} starters, ${benchCount} bench). Re-initializing...`);
        }
      } else {
        console.log(`Team ${teamIdNum}: No lineup exists, creating default lineup...`);
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
          console.log(`Team ${teamIdNum}: ✅ Lineup saved successfully (${starters.length} starters, ${bench.length} bench, ${ir.length} IR)`);
        } catch (error) {
          console.error(`Team ${teamIdNum}: ❌ FAILED to save lineup:`, error);
        }
      } else {
        console.error(`Team ${teamIdNum}: ❌ CRITICAL - Has insufficient players for a valid lineup (${starters.length} starters, ${bench.length} bench, ${players.length} total players). This should not happen in demo league!`);
        // Even if we can't fill all slots, save what we have to prevent empty lineups
        if (starters.length > 0 && demoLeagueId) {
          try {
            await this.saveLineup(teamIdNum, demoLeagueId, {
              starters,
              bench,
              ir,
              slotAssignments
            });
            console.log(`Team ${teamIdNum}: ⚠️ Saved partial lineup as fallback (${starters.length} starters, ${bench.length} bench)`);
          } catch (error) {
            console.error(`Team ${teamIdNum}: ❌ FAILED to save even partial lineup:`, error);
          }
        }
      }
    }
    
    console.log('initializeDefaultLineups: Completed lineup initialization for all demo teams');
  },

  async getMyTeam(allPlayers: Player[]): Promise<Player[]> {
    await this.initializeLeague(allPlayers);
    return cachedLeagueState?.[3] || []; // User is Team 3
  },

  async getTeamRoster(teamId: number, allPlayers: Player[]): Promise<Player[]> {
    await this.initializeLeague(allPlayers);
    return cachedLeagueState?.[teamId] || [];
  },

  async getFreeAgents(allPlayers: Player[], leagueId?: string): Promise<Player[]> {
    // If leagueId is provided, use real database data
    if (leagueId) {
      try {
        // Get all active draft picks for this league (only non-deleted)
        const { picks: draftPicks } = await DraftService.getDraftPicks(leagueId);
        
        // Get player IDs that are currently owned (active picks only)
        const ownedPlayerIds = new Set(draftPicks.map(pick => pick.player_id));
        
        // Filter out owned players - only return players NOT in the owned set
        // This includes:
        // 1. Players never drafted
        // 2. Players that were dropped (deleted_at is not null, so not in draftPicks)
        const freeAgents = allPlayers.filter(player => !ownedPlayerIds.has(player.id));
        
        return freeAgents;
      } catch (error) {
        console.error('Error getting free agents from database:', error);
        // Fallback to demo data if database query fails
        await this.initializeLeague(allPlayers);
        return cachedFreeAgents || [];
      }
    }
    
    // No leagueId provided - use demo data
    await this.initializeLeague(allPlayers);
    return cachedFreeAgents || [];
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
  async fetchTransactions(leagueId: string): Promise<{ transactions: Transaction[]; error: any }> {
    try {
      const { data, error } = await supabase
        .from('roster_transactions')
        .select(`
          id,
          type,
          player_id,
          created_at,
          source,
          teams(team_name),
          profiles(full_name)
        `)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Error fetching transactions:', error);
        return { transactions: [], error };
      }

      // Get all players to map player_id to player details
      const allPlayers = await PlayerService.getAllPlayers();
      const playerMap = new Map(allPlayers.map(p => [p.id, p]));

      const transactions: Transaction[] = (data || []).map((tx: any) => {
        const player = playerMap.get(tx.player_id);
        const type = tx.type.toLowerCase() as 'claim' | 'drop' | 'trade';
        
        return {
          id: tx.id,
          type: type === 'add' ? 'claim' : type, // Map 'ADD' to 'claim' for UI
          playerId: tx.player_id,
          playerName: player?.full_name || 'Unknown Player',
          playerTeam: player?.team || 'N/A',
          date: new Date(tx.created_at).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
          }),
          status: 'processed' as const, // All transactions in DB are processed
        };
      });

      return { transactions, error: null };
    } catch (error) {
      console.error('Error in fetchTransactions:', error);
      return { transactions: [], error };
    }
  },

  /**
   * Fetch recent transactions for notifications (last 10, across all user's leagues)
   */
  async fetchRecentTransactionsForNotifications(userId: string): Promise<Transaction[]> {
    try {
      // Get all leagues the user is in
      const { data: userTeams, error: teamsError } = await supabase
        .from('teams')
        .select('league_id')
        .eq('owner_id', userId);

      if (teamsError || !userTeams || userTeams.length === 0) {
        return [];
      }

      const leagueIds = userTeams.map(t => t.league_id);

      const { data, error } = await supabase
        .from('roster_transactions')
        .select(`
          id,
          type,
          player_id,
          created_at,
          source,
          league_id,
          teams(team_name)
        `)
        .in('league_id', leagueIds)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error || !data) {
        return [];
      }

      // Get all players to map player_id to player details
      const allPlayers = await PlayerService.getAllPlayers();
      const playerMap = new Map(allPlayers.map(p => [p.id, p]));

      const transactions: Transaction[] = data.map((tx: any) => {
        const player = playerMap.get(tx.player_id);
        const type = tx.type.toLowerCase() as 'claim' | 'drop' | 'trade';
        
        return {
          id: tx.id,
          type: type === 'add' ? 'claim' : type,
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
      console.error('Error fetching notifications:', error);
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

  /**
   * Save lineup configuration to Supabase (with localStorage fallback)
   * Stores player IDs and their slot assignments in shared database
   * @param leagueId - Required for league isolation
   */
  async saveLineup(teamId: string | number, leagueId: string, lineup: { 
    starters: (string | number)[], 
    bench: (string | number)[], 
    ir: (string | number)[], 
    slotAssignments: Record<string, string> 
  }) {
    // Read-only guard: Block all lineup saves for demo league EXCEPT during initialization
    // Check if this is initialization (no lineup exists yet) vs user modification (lineup exists)
    if (leagueId === '00000000-0000-0000-0000-000000000001') {
      // Check if lineup already exists - if yes, block (user trying to modify)
      // If no, allow (initialization)
      const { data: existingLineup } = await supabase
        .from('team_lineups')
        .select('id')
        .eq('league_id', leagueId)
        .eq('team_id', String(teamId))
        .maybeSingle();
      
      if (existingLineup) {
        // Lineup exists - user trying to modify, block it
        console.warn('[saveLineup] Demo league is read-only. Sign up to create your own league!');
        return; // Silently fail - demo league is read-only
      }
      // No lineup exists - this is initialization, allow it
    }

    // Convert all IDs to strings for consistency
    const lineupToSave = {
      starters: lineup.starters.map(id => String(id)),
      bench: lineup.bench.map(id => String(id)),
      ir: lineup.ir.map(id => String(id)),
      slotAssignments: lineup.slotAssignments
    };

    try {
      // Try Supabase first (shared database, with league_id for isolation)
      const { error, data } = await supabase
        .from('team_lineups')
        .upsert({
          league_id: leagueId,
          team_id: teamId,
          starters: lineupToSave.starters,
          bench: lineupToSave.bench,
          ir: lineupToSave.ir,
          slot_assignments: lineupToSave.slotAssignments,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'league_id,team_id'
        })
        .select()
        .single();
      
      if (error) {
        console.warn('[saveLineup] Supabase save failed, using localStorage fallback:', error);
        throw error; // Fall through to localStorage
      }
      
      // Verify the save was successful
      if (data) {
        console.log('[saveLineup] Lineup saved successfully to Supabase:', {
          teamId,
          leagueId,
          starters: data.starters?.length || 0,
          bench: data.bench?.length || 0,
          ir: data.ir?.length || 0
        });
      }
      
      // Supabase save succeeded - clear any stale localStorage data to prevent conflicts
      const key = `lineup_team_${teamId}`;
      localStorage.removeItem(key);
      console.log('[saveLineup] Cleared stale localStorage');
      
      // Clear roster cache when lineup is saved so matchup page shows updated lineup
      MatchupService.clearRosterCache(String(teamId), leagueId);
    } catch (error) {
      // Fallback to localStorage if Supabase fails (offline mode, errors, etc.)
      try {
        const key = `lineup_team_${teamId}`;
        localStorage.setItem(key, JSON.stringify(lineupToSave));
        console.log('[saveLineup] Saved to localStorage as fallback (Supabase unavailable)');
        
        // Still clear cache even if using localStorage fallback
        MatchupService.clearRosterCache(String(teamId), leagueId);
      } catch (localError) {
        console.error('Failed to save lineup to both Supabase and localStorage:', localError);
      }
    }
  },

  /**
   * Load saved lineup configuration from Supabase (with localStorage fallback)
   * Returns lineup from shared database, or falls back to localStorage
   * @param leagueId - Required for league isolation
   */
  async getLineup(teamId: string | number, leagueId: string): Promise<{ 
    starters: string[], 
    bench: string[], 
    ir: string[], 
    slotAssignments: Record<string, string> 
  } | null> {
    try {
      // Skip Supabase query if leagueId is not a valid UUID (e.g., 'demo-league-id')
      // UUIDs are 36 characters with dashes: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leagueId);
      if (!isValidUUID) {
        // For non-UUID league IDs (like demo league), skip Supabase and try localStorage
        const key = `lineup_team_${teamId}`;
        const saved = localStorage.getItem(key);
        if (saved) {
          return JSON.parse(saved);
        }
        return null;
      }

      // Try Supabase first (shared database, with league_id for isolation)
      const { data, error } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir, slot_assignments')
        .eq('team_id', teamId)
        .eq('league_id', leagueId)
        .maybeSingle();
      
      if (error) {
        // PGRST116 is "not found", which is OK - no lineup exists yet
        if (error.code === 'PGRST116') {
          // No lineup in Supabase - clear any stale localStorage data
          const key = `lineup_team_${teamId}`;
          localStorage.removeItem(key);
          console.log('[getLineup] No lineup in Supabase, cleared stale localStorage');
          return null;
        }
        // Actual error (network, permission, etc.) - fall back to localStorage
        console.warn('[getLineup] Supabase query error, trying localStorage fallback:', error);
        const key = `lineup_team_${teamId}`;
        const saved = localStorage.getItem(key);
        if (saved) {
          console.log('[getLineup] Loaded from localStorage fallback (Supabase error)');
          return JSON.parse(saved);
        }
        return null;
      }
      
      if (data) {
        // Supabase data found - clear any stale localStorage data to prevent conflicts
        const key = `lineup_team_${teamId}`;
        localStorage.removeItem(key);
        console.log('[getLineup] Loaded from Supabase, cleared stale localStorage');
        
        // Normalize slot assignment keys to strings for consistency
        const rawSlotAssignments = (data.slot_assignments || {}) as Record<string | number, string>;
        const normalizedSlotAssignments: Record<string, string> = {};
        Object.entries(rawSlotAssignments).forEach(([playerId, slotId]) => {
          normalizedSlotAssignments[String(playerId)] = slotId;
        });
        
        return {
          starters: (data.starters || []) as string[],
          bench: (data.bench || []) as string[],
          ir: (data.ir || []) as string[],
          slotAssignments: normalizedSlotAssignments
        };
      }
      
      // No data found in Supabase (null result, not an error) - clear localStorage and return null
      // Don't fall back to localStorage when Supabase returns null, as that indicates no lineup exists
      const key = `lineup_team_${teamId}`;
      localStorage.removeItem(key);
      console.log('[getLineup] No lineup in Supabase (null result), cleared stale localStorage');
      return null;
    } catch (error) {
      // Only fallback to localStorage on actual exceptions (network failures, etc.)
      console.warn('[getLineup] Exception occurred, trying localStorage fallback:', error);
      try {
        const key = `lineup_team_${teamId}`;
        const saved = localStorage.getItem(key);
        if (saved) {
          console.log('[getLineup] Loaded from localStorage fallback (exception)');
          return JSON.parse(saved);
        }
      } catch (localError) {
        console.error('[getLineup] Failed to load lineup from both Supabase and localStorage:', localError);
      }
      return null;
    }
  },

  /**
   * Calculate team standings stats from their drafted players
   * Note: Points for/against are only calculated from actual matchup results.
   * Since matchup system isn't implemented yet, these return 0.
   */
  async calculateTeamStandings(
    leagueId: string,
    teams: Team[],
    draftPicks: Array<{ team_id: string; player_id: string }>,
    allPlayers: Array<{ id: string; points: number }>
  ): Promise<Record<string, { pointsFor: number; pointsAgainst: number; wins: number; losses: number }>> {
    // Initialize all teams with 0 stats
    // Points for/against should only come from actual matchup results, not player season totals
    const teamStats: Record<string, { pointsFor: number; pointsAgainst: number; wins: number; losses: number }> = {};
    
    teams.forEach(team => {
      teamStats[team.id] = {
        pointsFor: 0,      // Only calculated from matchup results
        pointsAgainst: 0,   // Only calculated from matchup results
        wins: 0,
        losses: 0
      };
    });

    // TODO: When matchup system is implemented, calculate pointsFor/pointsAgainst from actual matchup results
    // For now, since there are no matchups, all values remain 0

    return teamStats;
  },

  /**
   * Update all teams owned by a user with a new team name
   * This syncs the default_team_name from profiles to existing teams
   */
  async updateUserTeamNames(userId: string, newTeamName: string): Promise<{ error: any; updatedCount?: number }> {
    try {
      if (!newTeamName || !newTeamName.trim()) {
        return { error: null, updatedCount: 0 }; // No name to update
      }

      const trimmedName = newTeamName.trim();

      // First, check how many teams will be updated
      const { data: existingTeams, error: countError } = await supabase
        .from('teams')
        .select('id, team_name')
        .eq('owner_id', userId);

      if (countError) {
        console.error('Error checking existing teams:', countError);
        throw countError;
      }

      const teamCount = existingTeams?.length || 0;
      console.log(`Updating ${teamCount} teams for user ${userId} with new name: "${trimmedName}"`);

      if (teamCount === 0) {
        console.log('No teams found for user, nothing to update');
        return { error: null, updatedCount: 0 };
      }

      // Update all teams owned by this user
      const { data, error } = await supabase
        .from('teams')
        .update({ team_name: trimmedName })
        .eq('owner_id', userId)
        .select();

      if (error) {
        console.error('Error updating user team names:', error);
        throw error;
      }

      const updatedCount = data?.length || 0;
      console.log(`Successfully updated ${updatedCount} team(s) for user ${userId}`);
      
      // Log the updated team names for debugging
      if (data && data.length > 0) {
        console.log('Updated teams:', data.map(t => ({ id: t.id, name: t.team_name })));
      }

      return { error: null, updatedCount };
    } catch (error) {
      console.error('Exception in updateUserTeamNames:', error);
      return { error, updatedCount: 0 };
    }
  },

  /**
   * Initialize lineup for a team from their draft picks
   * Auto-assigns players to starter/bench/IR slots and saves to team_lineups table
   */
  async initializeTeamLineup(
    teamId: string,
    leagueId: string,
    allPlayers: Player[]
  ): Promise<{ 
    lineup: { starters: string[]; bench: string[]; ir: string[]; slotAssignments: Record<string, string> } | null;
    error: any 
  }> {
    try {
      // Get draft picks for this team
      const { picks: draftPicks } = await DraftService.getDraftPicks(leagueId);
      const teamPicks = draftPicks.filter(p => p.team_id === teamId);
      
      if (teamPicks.length === 0) {
        console.log(`No draft picks found for team ${teamId}`);
        return { lineup: null, error: null };
      }

      // Map draft picks to players
      const playerIds = teamPicks.map(p => p.player_id);
      const teamPlayers = allPlayers.filter(p => playerIds.includes(p.id));

      if (teamPlayers.length === 0) {
        console.log(`No players found for team ${teamId} draft picks`);
        return { lineup: null, error: null };
      }

      // Helper function to transform position to fantasy slot
      const getFantasyPosition = (position: string): 'C' | 'LW' | 'RW' | 'D' | 'G' | 'UTIL' => {
        const pos = position?.toUpperCase() || '';
        if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
        if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
        if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
        if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
        if (['G', 'GOALIE'].includes(pos)) return 'G';
        return 'UTIL';
      };

      // Helper to calculate slot assignments
      const calculateInitialSlotAssignments = (starters: Player[]) => {
        const assignments: Record<string, string> = {};
        const playersByPos: Record<string, Player[]> = {
          'C': [], 'LW': [], 'RW': [], 'D': [], 'G': [], 'UTIL': []
        };
        
        starters.forEach(p => {
          const pos = getFantasyPosition(p.position);
          if (pos !== 'UTIL') playersByPos[pos].push(p);
        });
        
        // Assign C, LW, RW to first 2 slots
        ['C', 'LW', 'RW'].forEach(pos => {
          playersByPos[pos].slice(0, 2).forEach((p, i) => {
            assignments[String(p.id)] = `slot-${pos}-${i + 1}`;
          });
        });

        // Assign D to first 4 slots
        playersByPos['D'].slice(0, 4).forEach((p, i) => {
          assignments[String(p.id)] = `slot-D-${i + 1}`;
        });

        // Assign G to first 2 slots
        playersByPos['G'].slice(0, 2).forEach((p, i) => {
          assignments[String(p.id)] = `slot-G-${i + 1}`;
        });
        
        // Assign remaining non-goalie starters to UTIL if not already assigned
        const assignedIds = new Set(Object.keys(assignments));
        const unassigned = starters.filter(p => !assignedIds.has(String(p.id)));
        const utilPlayer = unassigned.find(p => getFantasyPosition(p.position) !== 'G');
        if (utilPlayer) {
          assignments[String(utilPlayer.id)] = 'slot-UTIL';
        }
        
        return assignments;
      };

      // Sort players consistently by ID for deterministic auto-assignment
      teamPlayers.sort((a, b) => {
        const idA = typeof a.id === 'string' ? parseInt(a.id) : a.id;
        const idB = typeof b.id === 'string' ? parseInt(b.id) : b.id;
        return idA - idB;
      });

      // Organize into slots
      const starters: Player[] = [];
      const bench: Player[] = [];
      const ir: Player[] = [];
      const irSlotAssignments: Record<string, string> = {};

      // Simple draft logic to fill slots
      const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
      const slotsFilled = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0 };

      // Track IR slot assignments
      let irSlotIndex = 1;
      
      // Only use actual IR/SUSP status for IR placement (deterministic)
      teamPlayers.forEach(p => {
        if (p.status === 'injured' || p.status === 'suspended') {
          if (irSlotIndex <= 3) {
            ir.push(p);
            irSlotAssignments[String(p.id)] = `ir-slot-${irSlotIndex}`;
            irSlotIndex++;
          } else {
            bench.push(p);
          }
          return;
        }

        const pos = getFantasyPosition(p.position);
        
        if (pos !== 'UTIL' && slotsFilled[pos] < slotsNeeded[pos]) {
          starters.push(p);
          slotsFilled[pos]++;
        } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
          starters.push(p);
          slotsFilled['UTIL']++;
        } else {
          bench.push(p);
        }
      });

      const starterSlotAssignments = calculateInitialSlotAssignments(starters);
      // Merge IR slot assignments with starter assignments
      const allSlotAssignments = { ...starterSlotAssignments, ...irSlotAssignments };

      const lineup = {
        starters: starters.map(p => String(p.id)),
        bench: bench.map(p => String(p.id)),
        ir: ir.map(p => String(p.id)),
        slotAssignments: allSlotAssignments
      };

      // Save lineup to Supabase (with league_id for isolation)
      await this.saveLineup(teamId, leagueId, lineup);

      console.log(`Initialized lineup for team ${teamId}: ${starters.length} starters, ${bench.length} bench, ${ir.length} IR`);
      
      return { lineup, error: null };
    } catch (error) {
      console.error(`Error initializing lineup for team ${teamId}:`, error);
      return { lineup: null, error };
    }
  },

  /**
   * Drop a player from the roster using handle_roster_transaction
   */
  async dropPlayer(
    leagueId: string,
    userId: string,
    playerId: string,
    source: string = 'Roster Tab'
  ): Promise<{ success: boolean; error: any }> {
    // Read-only guard: Block all drops for demo league
    if (leagueId === '00000000-0000-0000-0000-000000000001') {
      return { 
        success: false, 
        error: new Error('Demo league is read-only. Sign up to create your own league!') 
      };
    }

    try {
      const { data, error } = await supabase.rpc('handle_roster_transaction', {
        p_league_id: leagueId,
        p_user_id: userId,
        p_drop_player_id: playerId,
        p_add_player_id: null,
        p_transaction_source: source
      });

      if (error) {
        return { success: false, error };
      }

      const result = data as { status: string; message: string };
      if (result.status === 'error') {
        return { success: false, error: new Error(result.message) };
      }

      // Clear roster cache for the user's team when player is dropped
      // Get team ID to clear cache
      const { data: teamData } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('owner_id', userId)
        .maybeSingle();
      
      if (teamData) {
        MatchupService.clearRosterCache(teamData.id, leagueId);
      }

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
  ): Promise<{ success: boolean; error: any }> {
    // Read-only guard: Block all adds for demo league
    if (leagueId === '00000000-0000-0000-0000-000000000001') {
      return { 
        success: false, 
        error: new Error('Demo league is read-only. Sign up to create your own league!') 
      };
    }

    try {
      // First check roster size limit
      const { league, error: leagueError } = await this.getLeague(leagueId);
      if (leagueError || !league) {
        return { success: false, error: leagueError || new Error('League not found') };
      }

      // Get current roster size
      const { data: teamData } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('owner_id', userId)
        .single();

      if (!teamData) {
        return { success: false, error: new Error('Team not found') };
      }

      // Get lineup data (use maybeSingle to handle case where no lineup exists yet)
      const { data: lineupData, error: lineupError } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir')
        .eq('team_id', teamData.id)
        .eq('league_id', leagueId)
        .maybeSingle();

      // Check for query errors (not just "no rows found")
      if (lineupError && lineupError.code !== 'PGRST116') {
        // PGRST116 = no rows found (expected when no lineup exists yet)
        // Any other error is a real database error
        console.error('Error fetching lineup data:', lineupError);
        return { success: false, error: new Error('Could not load lineup information') };
      }

      // Calculate current roster size
      // If lineup exists, use it; otherwise count draft picks
      let currentRosterSize = 0;
      if (lineupData) {
        // Lineup exists - use lineup data
        currentRosterSize = 
          (lineupData.starters?.length || 0) +
          (lineupData.bench?.length || 0) +
          (lineupData.ir?.length || 0);
      } else {
        // No lineup exists yet - count draft picks instead
        const { count: draftPicksCount, error: picksError } = await supabase
          .from('draft_picks')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', teamData.id)
          .eq('league_id', leagueId)
          .is('deleted_at', null);
        
        if (picksError) {
          console.error('Error counting draft picks:', picksError);
          return { success: false, error: new Error('Could not load draft picks for roster size check') };
        } else {
          currentRosterSize = draftPicksCount || 0;
        }
      }

      const maxRosterSize = league.roster_size + 3; // roster_size + 3 IR slots

      if (currentRosterSize >= maxRosterSize) {
        return { 
          success: false, 
          error: new Error(`Roster is full. Maximum size is ${maxRosterSize} (${league.roster_size} roster + 3 IR slots)`) 
        };
      }

      const { data, error } = await supabase.rpc('handle_roster_transaction', {
        p_league_id: leagueId,
        p_user_id: userId,
        p_drop_player_id: null,
        p_add_player_id: playerId,
        p_transaction_source: source
      });

      if (error) {
        return { success: false, error };
      }

      const result = data as { status: string; message: string };
      if (result.status === 'error') {
        return { success: false, error: new Error(result.message) };
      }

      // Clear roster cache for this team when player is added
      if (teamData) {
        const { MatchupService } = await import('./MatchupService');
        MatchupService.clearRosterCache(teamData.id, leagueId);
      }

      return { success: true, error: null };
    } catch (error) {
      return { success: false, error };
    }
  }
};
