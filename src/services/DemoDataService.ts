/**
 * ============================================================================
 * DEMO STATE PILLARS - CRITICAL PRINCIPLES
 * ============================================================================
 * 
 * The demo state is a READ-ONLY, STATIC demonstration of the application.
 * It serves as a showcase for guest users and logged-in users without leagues.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * PILLAR 1: READ-ONLY DATA
 * ═══════════════════════════════════════════════════════════════════════════
 * - All demo data is STATIC and HARDCODED
 * - Demo data NEVER changes based on user interactions
 * - Demo data is NOT stored in the database
 * - Demo data is NOT persisted across sessions
 * - Demo data is NOT affected by any write operations
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * PILLAR 2: FOR SHOW ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 * - Demo state is PURELY for demonstration purposes
 * - Users CANNOT make changes that affect demo data
 * - All "actions" in demo state are DISABLED or redirect to sign-up/login
 * - Demo state shows what the app CAN do, not what the user HAS done
 * - Demo state is a PREVIEW, not a functional workspace
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * PILLAR 3: COMPLETE ISOLATION
 * ═══════════════════════════════════════════════════════════════════════════
 * - Demo state is COMPLETELY SEPARATE from logged-in user state
 * - Changes in logged-in state NEVER affect demo state
 * - Demo state NEVER affects logged-in user data
 * - Demo state uses its own isolated data structures
 * - Demo state has its own "league ID" ('demo-league-id') that is NOT a real database ID
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * PILLAR 4: THREE USER STATES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * STATE 1: GUEST (user = null)
 *   - Shows: Full demo league with all 10 teams, rosters, matchups, standings
 *   - Actions: All actions redirect to sign-up/login
 *   - Data Source: Static demo data (DemoDataService, LEAGUE_TEAMS_DATA)
 *   - Persistence: None - resets on every page load
 * 
 * STATE 2: LOGGED-IN, NO LEAGUE (user exists, userLeagues.length === 0)
 *   - Shows: Same demo league as guests, but with CTAs to create a league
 *   - Actions: CTAs redirect to league creation flow
 *   - Data Source: Static demo data (same as guests)
 *   - Persistence: None - still using demo data
 * 
 * STATE 3: ACTIVE USER (user exists, userLeagues.length > 0)
 *   - Shows: User's actual league data from database
 *   - Actions: All actions work normally and persist to database
 *   - Data Source: Supabase database (real user data)
 *   - Persistence: Full - all changes saved to database
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * PILLAR 5: ALL 10 DEMO TEAMS
 * ═══════════════════════════════════════════════════════════════════════════
 * - Demo league contains exactly 10 teams (IDs 1-10)
 * - Team 3 is the "user's team" (Citrus Crushers) shown to guests
 * - All 10 teams have full rosters with 18-21 players each
 * - All 10 teams have valid starting lineups
 * - All 10 teams are visible in Standings page
 * - All teams use the same static data structure
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT NEVER HAPPENS IN DEMO STATE
 * ═══════════════════════════════════════════════════════════════════════════
 * ❌ User cannot save lineup changes
 * ❌ User cannot add/drop players
 * ❌ User cannot make trades
 * ❌ User cannot modify team settings
 * ❌ User cannot create matchups
 * ❌ User cannot update standings
 * ❌ Any write operation to database using demo league ID
 * ❌ Any mutation of demo data structures
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT ALWAYS HAPPENS IN DEMO STATE
 * ═══════════════════════════════════════════════════════════════════════════
 * ✅ Demo data loads instantly from static sources
 * ✅ All 10 teams display with full rosters
 * ✅ Matchup page shows demo matchup data
 * ✅ Standings page shows all 10 demo teams
 * ✅ Roster page shows Team 3 (Citrus Crushers) roster
 * ✅ All UI elements render correctly
 * ✅ Actions redirect to sign-up/login or league creation
 * 
 * ============================================================================
 */

import { LeagueTeam, LEAGUE_TEAMS_DATA } from './LeagueService';
import { MatchupPlayer } from '@/components/matchup/types';
import { Player } from './PlayerService';

export interface DemoLeague {
  id: 'demo-league';
  name: 'Demo League';
  teams: LeagueTeam[];
  currentWeek: number;
  matchup: {
    myTeam: MatchupPlayer[];
    opponentTeam: MatchupPlayer[];
    myScore: number;
    opponentScore: number;
    week: number;
  };
}

/**
 * DemoDataService
 * 
 * Centralized service for managing demo league data.
 * Provides read-only dummy data for guest users and logged-in users without leagues.
 * 
 * ⚠️ CRITICAL: This service provides STATIC, READ-ONLY data only.
 * No write operations are allowed. All data is hardcoded and never changes.
 */
export const DemoDataService = {
  /**
   * Get demo league information
   * Returns a complete demo league structure with all 10 teams
   */
  getDemoLeague(): DemoLeague {
    return {
      id: 'demo-league',
      name: 'Demo League',
      teams: LEAGUE_TEAMS_DATA,
      currentWeek: 5,
      matchup: {
        myTeam: this.getDemoMyTeam(),
        opponentTeam: this.getDemoOpponentTeam(),
        myScore: 245.7,
        opponentScore: 232.3,
        week: 5,
      },
    };
  },

  /**
   * Get demo teams for standings
   * Returns all 10 demo teams with their static records and stats
   */
  getDemoTeams(): LeagueTeam[] {
    return LEAGUE_TEAMS_DATA;
  },

  /**
   * Get demo "My Team" roster players for matchup view
   * This represents Team 3 (Citrus Crushers) - the team shown to guests
   */
  getDemoMyTeam(): MatchupPlayer[] {
    return [
      { id: 1, name: "Connor McDavid", position: "C", team: "EDM", points: 32.5, gamesRemaining: 2, status: "In Game", isStarter: true, isToday: true, stats: { goals: 1, assists: 2, sog: 4, blk: 0, gamesPlayed: 32 }, gameInfo: { opponent: "vs CGY", score: "EDM 4-2", period: "3rd 12:45" } },
      { id: 2, name: "Leon Draisaitl", position: "C", team: "EDM", points: 28.2, gamesRemaining: 1, status: "In Game", isStarter: true, isToday: true, stats: { goals: 0, assists: 1, sog: 2, blk: 0, gamesPlayed: 32 }, gameInfo: { opponent: "vs CGY", score: "EDM 4-2", period: "3rd 12:45" } },
      { id: 3, name: "Auston Matthews", position: "C", team: "TOR", points: 25.7, gamesRemaining: 0, status: "Final", isStarter: true, isToday: false, stats: { goals: 2, assists: 0, sog: 6, blk: 1, gamesPlayed: 30 } },
      { id: 4, name: "Nathan MacKinnon", position: "C", team: "COL", points: 22.8, gamesRemaining: 2, status: "Yet to Play", isStarter: true, isToday: false, stats: { goals: 0, assists: 3, sog: 5, blk: 0, gamesPlayed: 31 } },
      { id: 5, name: "David Pastrnak", position: "RW", team: "BOS", points: 21.4, gamesRemaining: 1, status: "In Game", isStarter: true, isToday: true, stats: { goals: 1, assists: 1, sog: 3, blk: 0, gamesPlayed: 33 }, gameInfo: { opponent: "@ FLA", score: "BOS 2-1", period: "2nd 4:20" } },
      { id: 6, name: "Mikko Rantanen", position: "RW", team: "COL", points: 18.9, gamesRemaining: 2, status: "Yet to Play", isStarter: true, isToday: false, stats: { goals: 0, assists: 2, sog: 2, blk: 1, gamesPlayed: 31 } },
      { id: 7, name: "Kirill Kaprizov", position: "LW", team: "MIN", points: 17.5, gamesRemaining: 0, status: "Final", isStarter: true, isToday: false, stats: { goals: 1, assists: 0, sog: 4, blk: 0, gamesPlayed: 29 } },
      { id: 8, name: "Alex Ovechkin", position: "LW", team: "WSH", points: 16.2, gamesRemaining: 0, status: "Final", isStarter: true, isToday: false, stats: { goals: 1, assists: 0, sog: 5, blk: 1, gamesPlayed: 28 } },
      { id: 9, name: "Cale Makar", position: "D", team: "COL", points: 15.7, gamesRemaining: 2, status: "Yet to Play", isStarter: true, isToday: false, stats: { goals: 0, assists: 2, sog: 2, blk: 2, gamesPlayed: 31 } },
      { id: 10, name: "Adam Fox", position: "D", team: "NYR", points: 13.8, gamesRemaining: 1, status: "Yet to Play", isStarter: true, isToday: true, stats: { goals: 0, assists: 0, sog: 0, blk: 0, gamesPlayed: 30 }, gameInfo: { opponent: "vs NJD", time: "7:00 PM" } },
      { id: 11, name: "Roman Josi", position: "D", team: "NSH", points: 11.5, gamesRemaining: 0, status: "Final", isStarter: true, isToday: false, stats: { goals: 0, assists: 1, sog: 3, blk: 2, gamesPlayed: 32 } },
      { id: 12, name: "Victor Hedman", position: "D", team: "TBL", points: 10.7, gamesRemaining: 1, status: "Yet to Play", isStarter: true, isToday: false, stats: { goals: 0, assists: 1, sog: 2, blk: 1, gamesPlayed: 33 } },
      { id: 13, name: "Andrei Vasilevskiy", position: "G", team: "TBL", points: 24.8, gamesRemaining: 1, status: "Yet to Play", isStarter: true, isToday: false, stats: { goals: 0, assists: 0, sog: 0, blk: 0, gamesPlayed: 25 } },
      { id: 14, name: "Igor Shesterkin", position: "G", team: "NYR", points: 23.2, gamesRemaining: 1, status: "Yet to Play", isStarter: true, isToday: true, stats: { goals: 0, assists: 0, sog: 0, blk: 0, gamesPlayed: 24 }, gameInfo: { opponent: "vs NJD", time: "7:00 PM" } },
      { id: 15, name: "Matt Duchene", position: "C", team: "DAL", points: 8.5, gamesRemaining: 2, status: "Yet to Play", isStarter: false, isToday: true, stats: { goals: 0, assists: 0, sog: 0, blk: 0, gamesPlayed: 29 }, gameInfo: { opponent: "@ STL", time: "8:00 PM" } },
      { id: 16, name: "Mitch Marner", position: "RW", team: "TOR", points: 14.8, gamesRemaining: 0, status: "Final", isStarter: false, isToday: false, stats: { goals: 0, assists: 2, sog: 3, blk: 1, gamesPlayed: 30 } },
      { id: 17, name: "Brady Tkachuk", position: "LW", team: "OTT", points: 12.3, gamesRemaining: 1, status: "Yet to Play", isStarter: false, isToday: false, stats: { goals: 1, assists: 0, sog: 5, blk: 4, gamesPlayed: 28 } },
      { id: 18, name: "Quinn Hughes", position: "D", team: "VAN", points: 9.7, gamesRemaining: 2, status: "Yet to Play", isStarter: false, isToday: false, stats: { goals: 0, assists: 1, sog: 2, blk: 0, gamesPlayed: 31 } },
      { id: 19, name: "Jacob Markstrom", position: "G", team: "CGY", points: 18.5, gamesRemaining: 0, status: "Final", isStarter: false, isToday: false, stats: { goals: 0, assists: 0, sog: 0, blk: 0, gamesPlayed: 22 } },
    ];
  },

  /**
   * Get demo opponent team for matchup view
   * This represents the opponent team in the demo matchup
   */
  getDemoOpponentTeam(): MatchupPlayer[] {
    return [
      { id: 101, name: "Sidney Crosby", position: "C", team: "PIT", points: 29.7, gamesRemaining: 1, status: "Yet to Play", isStarter: true, isToday: true, stats: { goals: 0, assists: 0, sog: 0, blk: 0 }, gameInfo: { opponent: "vs PHI", time: "7:30 PM" } },
      { id: 102, name: "Nikita Kucherov", position: "RW", team: "TBL", points: 27.9, gamesRemaining: 1, status: "Yet to Play", isStarter: true, isToday: false, stats: { goals: 1, assists: 2, sog: 4, blk: 0 } },
      { id: 103, name: "Artemi Panarin", position: "LW", team: "NYR", points: 26.2, gamesRemaining: 1, status: "Yet to Play", isStarter: true, isToday: true, stats: { goals: 0, assists: 0, sog: 0, blk: 0 }, gameInfo: { opponent: "vs NJD", time: "7:00 PM" } },
      { id: 104, name: "Brad Marchand", position: "LW", team: "BOS", points: 22.1, gamesRemaining: 1, status: "In Game", isStarter: true, isToday: true, stats: { goals: 0, assists: 1, sog: 2, blk: 1 }, gameInfo: { opponent: "@ FLA", score: "BOS 2-1", period: "2nd 4:20" } },
      { id: 105, name: "Elias Pettersson", position: "C", team: "VAN", points: 20.8, gamesRemaining: 2, status: "Yet to Play", isStarter: true, isToday: false, stats: { goals: 1, assists: 1, sog: 3, blk: 1 } },
      { id: 106, name: "Jack Hughes", position: "C", team: "NJD", points: 19.5, gamesRemaining: 0, status: "Final", isStarter: true, isToday: false, stats: { goals: 1, assists: 1, sog: 5, blk: 0 } },
      { id: 107, name: "William Nylander", position: "RW", team: "TOR", points: 18.2, gamesRemaining: 0, status: "Final", isStarter: true, isToday: false, stats: { goals: 1, assists: 0, sog: 4, blk: 0 } },
      { id: 108, name: "Matthew Tkachuk", position: "RW", team: "FLA", points: 17.8, gamesRemaining: 2, status: "In Game", isStarter: true, isToday: true, stats: { goals: 1, assists: 0, sog: 3, blk: 2 }, gameInfo: { opponent: "vs BOS", score: "BOS 2-1", period: "2nd 4:20" } },
      { id: 109, name: "Brent Burns", position: "D", team: "CAR", points: 13.2, gamesRemaining: 0, status: "Final", isStarter: true, isToday: false, stats: { goals: 0, assists: 1, sog: 3, blk: 2 } },
      { id: 110, name: "Dougie Hamilton", position: "D", team: "NJD", points: 12.5, gamesRemaining: 0, status: "Final", isStarter: true, isToday: false, stats: { goals: 0, assists: 1, sog: 2, blk: 3 } },
      { id: 111, name: "Shea Theodore", position: "D", team: "VGK", points: 11.8, gamesRemaining: 1, status: "Yet to Play", isStarter: true, isToday: true, stats: { goals: 0, assists: 0, sog: 0, blk: 0 }, gameInfo: { opponent: "@ LAK", time: "10:00 PM" } },
      { id: 112, name: "Moritz Seider", position: "D", team: "DET", points: 9.9, gamesRemaining: 2, status: "Yet to Play", isStarter: true, isToday: false, stats: { goals: 0, assists: 0, sog: 1, blk: 4 } },
      { id: 113, name: "Connor Hellebuyck", position: "G", team: "WPG", points: 26.3, gamesRemaining: 2, status: "Yet to Play", isStarter: true, isToday: false, stats: { goals: 0, assists: 0, sog: 0, blk: 0 } },
      { id: 114, name: "Ilya Sorokin", position: "G", team: "NYI", points: 22.7, gamesRemaining: 1, status: "Yet to Play", isStarter: true, isToday: true, stats: { goals: 0, assists: 0, sog: 0, blk: 0 }, gameInfo: { opponent: "@ WAS", time: "7:00 PM" } },
    ];
  },

  /**
   * Get demo roster players (for roster page)
   * This will be populated from LeagueService.getMyTeam() which uses cached demo data
   * 
   * ⚠️ NOTE: This returns Team 3 (Citrus Crushers) roster from the demo league
   * All 10 demo teams have rosters, but this is the one shown to guests
   */
  async getDemoRoster(allPlayers: Player[]): Promise<Player[]> {
    const { LeagueService } = await import('./LeagueService');
    return LeagueService.getMyTeam(allPlayers);
  },

  /**
   * Get demo matchup data from actual demo rosters
   * Uses Team 3 (Citrus Crushers) as "My Team" and Team 1 as opponent
   * Transforms actual roster players into MatchupPlayer format
   * Uses two-tier approach: database first, static fallback
   */
  async getDemoMatchupData(): Promise<{ 
    myTeam: MatchupPlayer[]; 
    opponentTeam: MatchupPlayer[];
    myTeamSlotAssignments: Record<string, string>;
    opponentTeamSlotAssignments: Record<string, string>;
  }> {
    try {
      console.log('[DemoDataService] getDemoMatchupData() called - using same logic as Roster.tsx');
      const { MatchupService } = await import('./MatchupService');
      const { PlayerService } = await import('./PlayerService');
      const { LeagueService } = await import('./LeagueService');
      
      console.log('[DemoDataService] Services imported, loading players...');
      const allPlayers = await PlayerService.getAllPlayers();
      console.log('[DemoDataService] Players loaded:', allPlayers.length);
      
      // Use same approach as Roster.tsx - use LeagueService.getTeamRoster
      // Initialize demo league (same as Roster.tsx)
      await LeagueService.initializeLeague(allPlayers);
      
      // Get Team 3 (My Team) roster - same as Roster.tsx
      const myTeamRoster = await LeagueService.getTeamRoster(3, allPlayers);
      console.log('[DemoDataService] My team (Team 3) roster loaded:', myTeamRoster.length, 'players');
      
      // Get Team 1 (Opponent) roster - same approach
      const opponentTeamRoster = await LeagueService.getTeamRoster(1, allPlayers);
      console.log('[DemoDataService] Opponent team (Team 1) roster loaded:', opponentTeamRoster.length, 'players');
      
      if (myTeamRoster.length === 0 || opponentTeamRoster.length === 0) {
        console.error('[DemoDataService] One or both rosters are empty!');
        throw new Error('Demo rosters not available');
      }
      
      // Convert Player[] to HockeyPlayer[] using MatchupService
      const myTeamHockeyPlayers = myTeamRoster.map(p => MatchupService.transformToHockeyPlayer(p));
      const opponentTeamHockeyPlayers = opponentTeamRoster.map(p => MatchupService.transformToHockeyPlayer(p));
      
      console.log('[DemoDataService] Demo rosters loaded:', {
        myTeamCount: myTeamHockeyPlayers.length,
        opponentTeamCount: opponentTeamHockeyPlayers.length
      });
      
      // Sort players consistently by ID for deterministic auto-assignment (same as Roster.tsx)
      myTeamHockeyPlayers.sort((a, b) => {
        const idA = typeof a.id === 'string' ? parseInt(a.id) : a.id;
        const idB = typeof b.id === 'string' ? parseInt(b.id) : b.id;
        return idA - idB;
      });
      
      opponentTeamHockeyPlayers.sort((a, b) => {
        const idA = typeof a.id === 'string' ? parseInt(a.id) : a.id;
        const idB = typeof b.id === 'string' ? parseInt(b.id) : b.id;
        return idA - idB;
      });
      
      // Use same simple auto-organization logic as Roster.tsx (same as OtherTeam.tsx)
      const getFantasyPosition = (position: string): string => {
        const pos = position?.toUpperCase() || '';
        if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
        if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
        if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
        if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
        if (['G', 'GOALIE'].includes(pos)) return 'G';
        return 'UTIL';
      };
      
      // Helper function to organize roster into starters/bench (EXACT SAME LOGIC AS Roster.tsx)
      // This creates slot assignments as it organizes, ensuring consistency with Roster page
      const organizeRoster = (roster: any[]) => {
        const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
        const slotsFilled = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0 };
        
        const starters: any[] = [];
        const bench: any[] = [];
        const ir: any[] = [];
        const slotAssignments: Record<string, string> = {};
        let irSlotIndex = 1;
        
        roster.forEach(p => {
          if (p.status === 'IR' || p.status === 'SUSP') {
            if (irSlotIndex <= 3) {
              ir.push(p);
              slotAssignments[String(p.id)] = `ir-slot-${irSlotIndex}`;
              irSlotIndex++;
            } else {
              bench.push(p);
            }
            return;
          }
          
          const pos = getFantasyPosition(p.position);
          let assigned = false;
          
          if (pos !== 'UTIL' && slotsFilled[pos] < slotsNeeded[pos]) {
            slotsFilled[pos]++;
            assigned = true;
            slotAssignments[String(p.id)] = `slot-${pos}-${slotsFilled[pos]}`;
          } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
            slotsFilled['UTIL']++;
            assigned = true;
            slotAssignments[String(p.id)] = 'slot-UTIL';
          }
          
          if (assigned) {
            starters.push(p);
          } else {
            bench.push(p);
          }
        });
        
        return { starters, bench, ir, slotAssignments };
      };
      
      // Auto-organize both teams (same as Roster.tsx - always auto-organize for demo)
      console.log('[DemoDataService] Auto-organizing my team roster');
      const myTeamOrganized = organizeRoster(myTeamHockeyPlayers);
      const myTeamStarters = new Set(myTeamOrganized.starters.map(p => String(p.id)));
      const myTeamSlotAssignmentsFromOrg = myTeamOrganized.slotAssignments;
      
      console.log('[DemoDataService] Auto-organizing opponent team roster');
      const opponentTeamOrganized = organizeRoster(opponentTeamHockeyPlayers);
      const opponentTeamStarters = new Set(opponentTeamOrganized.starters.map(p => String(p.id)));
      const opponentTeamSlotAssignmentsFromOrg = opponentTeamOrganized.slotAssignments;
      
      console.log('[DemoDataService] Organized rosters:', {
        myTeamStarters: myTeamOrganized.starters.length,
        myTeamBench: myTeamOrganized.bench.length,
        opponentTeamStarters: opponentTeamOrganized.starters.length,
        opponentTeamBench: opponentTeamOrganized.bench.length
      });
      
      // Get current week for schedule data
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // Sunday
      weekEnd.setHours(23, 59, 59, 999);
      
      // Get all unique teams from both rosters for batch schedule query
      const allTeams = Array.from(new Set([
        ...myTeamHockeyPlayers.map(p => p.team || '').filter(t => t),
        ...opponentTeamHockeyPlayers.map(p => p.team || '').filter(t => t)
      ]));
      
      // Batch fetch games for all teams at once (more efficient)
      const { ScheduleService } = await import('./ScheduleService');
      const { gamesByTeam } = await ScheduleService.getGamesForTeams(allTeams, weekStart, weekEnd);
      
      // Transform rosters to MatchupPlayer format
      const myTeamMatchupPlayers = myTeamHockeyPlayers.map((player, index) => {
        const teamAbbrev = player.team || '';
        const games = gamesByTeam.get(teamAbbrev) || [];
        const playerIdStr = String(player.id);
        
        // Check if player is a starter
        const isStarter = myTeamStarters.has(playerIdStr);
        
        return MatchupService.transformToMatchupPlayerWithGames(
          player,
          isStarter,
          weekStart,
          weekEnd,
          'America/Denver',
          games
        );
      });
      
      const opponentTeamMatchupPlayers = opponentTeamHockeyPlayers.map((player, index) => {
        const teamAbbrev = player.team || '';
        const games = gamesByTeam.get(teamAbbrev) || [];
        const playerIdStr = String(player.id);
        
        // Check if player is a starter
        const isStarter = opponentTeamStarters.has(playerIdStr);
        
        return MatchupService.transformToMatchupPlayerWithGames(
          player,
          isStarter,
          weekStart,
          weekEnd,
          'America/Denver',
          games
        );
      });
      
      console.log('[DemoDataService] Matchup players with starter status:', {
        myTeamTotal: myTeamMatchupPlayers.length,
        myTeamStarters: myTeamMatchupPlayers.filter(p => p.isStarter).length,
        myTeamBench: myTeamMatchupPlayers.filter(p => !p.isStarter).length,
        opponentTeamTotal: opponentTeamMatchupPlayers.length,
        opponentTeamStarters: opponentTeamMatchupPlayers.filter(p => p.isStarter).length,
        opponentTeamBench: opponentTeamMatchupPlayers.filter(p => !p.isStarter).length
      });
      
      // Use slot assignments from organizeRoster (which matches Roster.tsx logic exactly)
      // This ensures consistency between Roster page and Matchup page
      // We need to map the slot assignments from HockeyPlayer IDs to MatchupPlayer IDs
      // (they should be the same, but we'll ensure consistency)
      const myTeamSlotAssignments: Record<string, string> = {};
      const opponentTeamSlotAssignments: Record<string, string> = {};
      
      // Map slot assignments from organized rosters to matchup players
      // This preserves the exact slot assignments created during organization
      myTeamMatchupPlayers.forEach(mp => {
        const slot = myTeamSlotAssignmentsFromOrg[String(mp.id)];
        if (slot) {
          myTeamSlotAssignments[String(mp.id)] = slot;
        }
      });
      
      opponentTeamMatchupPlayers.forEach(mp => {
        const slot = opponentTeamSlotAssignmentsFromOrg[String(mp.id)];
        if (slot) {
          opponentTeamSlotAssignments[String(mp.id)] = slot;
        }
      });
      
      console.log('[DemoDataService] Slot assignments calculated:', {
        myTeamSlots: Object.keys(myTeamSlotAssignments).length,
        opponentTeamSlots: Object.keys(opponentTeamSlotAssignments).length
      });
      
      return {
        myTeam: myTeamMatchupPlayers,
        opponentTeam: opponentTeamMatchupPlayers,
        myTeamSlotAssignments,
        opponentTeamSlotAssignments
      };
    } catch (error) {
      console.error('[DemoDataService] Error in getDemoMatchupData():', error);
      console.error('[DemoDataService] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      throw error; // Re-throw to let caller handle it
    }
  },
};
