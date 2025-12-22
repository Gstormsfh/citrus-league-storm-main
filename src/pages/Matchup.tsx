import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { DemoDataService } from '@/services/DemoDataService';
import { TeamCard } from "@/components/matchup/TeamCard";
import { MatchupComparison } from "@/components/matchup/MatchupComparison";
import { MatchupScheduleSelector } from "@/components/matchup/MatchupScheduleSelector";
import { ScoreCard } from "@/components/matchup/ScoreCard";
import { WeeklySchedule } from "@/components/matchup/WeeklySchedule";
import { DailyRosters } from "@/components/matchup/DailyRosters";
import { getTodayMST, getTodayMSTDate } from '@/utils/timezoneUtils';
import { LiveUpdates } from "@/components/matchup/LiveUpdates";
import LeagueNotifications from "@/components/matchup/LeagueNotifications";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MatchupPlayer } from "@/components/matchup/types";
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { LeagueService, League, Team } from '@/services/LeagueService';
import { MatchupService, Matchup } from '@/services/MatchupService';
import { PlayerService } from '@/services/PlayerService';
import { supabase } from '@/integrations/supabase/client';
import { getDraftCompletionDate, getFirstWeekStartDate, getCurrentWeekNumber, getAvailableWeeks, getWeekLabel, getWeekDateLabel, getWeekStartDate, getWeekEndDate } from '@/utils/weekCalculator';
import LoadingScreen from '@/components/LoadingScreen';

const Matchup = () => {
  const { user, profile } = useAuth();
  const { userLeagueState, loading: leagueContextLoading } = useLeague();
  const { leagueId: urlLeagueId, weekId: urlWeekId } = useParams<{ leagueId?: string; weekId?: string }>();
  const navigate = useNavigate();
  
  // Debug: Log URL parameters
  console.log('[Matchup] URL parameters:', { urlLeagueId, urlWeekId, userLeagueState, leagueContextLoading });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dailyStatsMap, setDailyStatsMap] = useState<Map<number, any>>(new Map()); // For selected date (or today)
  const [dailyStatsByDate, setDailyStatsByDate] = useState<Map<string, Map<number, any>>>(new Map()); // For all 7 days
  // Start loading as true to prevent initial flash of content
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false); // Prevent concurrent loads
  const hasProcessedNoLeague = useRef(false); // Track if we've processed "no league" state
  const hasInitializedRef = useRef(false); // Track if we've completed initial load
  
  // Cache tracking to prevent unnecessary reloads
  const prevLeagueIdRef = useRef<string | undefined>(undefined);
  const prevWeekIdRef = useRef<string | undefined>(undefined);
  const loadedMatchupDataRef = useRef<{ leagueId: string; weekId: string; timestamp: number } | null>(null);
  const CACHE_TTL = 30000; // 30 seconds cache
  
  // CRITICAL: Unified loading state manager - handles all loading state logic in one place
  // This prevents conflicting state updates from multiple useEffects
  useEffect(() => {
    // Wait for LeagueContext to finish loading before making decisions
    if (leagueContextLoading) {
      return;
    }
    
    // Handle "no league" state once (prevent re-processing)
    if (userLeagueState === 'logged-in-no-league' && !hasProcessedNoLeague.current) {
      hasProcessedNoLeague.current = true;
      console.log('[MATCHUP] User has no league - stopping all loading');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      loadingRef.current = false; // Release any locks
      return;
    }
    
    // Reset the flag if user state changes back to active-user
    if (userLeagueState === 'active-user' && hasProcessedNoLeague.current) {
      hasProcessedNoLeague.current = false;
    }
  }, [leagueContextLoading, userLeagueState]);

  const [selectedPlayer, setSelectedPlayer] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);

  // Real data state
  const [league, setLeague] = useState<League | null>(null);
  const [userTeam, setUserTeam] = useState<Team | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([]);
  const [firstWeekStart, setFirstWeekStart] = useState<Date | null>(null);
  const [myTeam, setMyTeam] = useState<MatchupPlayer[]>([]);
  const [opponentTeamPlayers, setOpponentTeamPlayers] = useState<MatchupPlayer[]>([]);
  const [myTeamSlotAssignments, setMyTeamSlotAssignments] = useState<Record<string, string>>({});
  const [opponentTeamSlotAssignments, setOpponentTeamSlotAssignments] = useState<Record<string, string>>({});
  const [myTeamRecord, setMyTeamRecord] = useState<{ wins: number; losses: number }>({ wins: 0, losses: 0 });
  const [opponentTeamRecord, setOpponentTeamRecord] = useState<{ wins: number; losses: number }>({ wins: 0, losses: 0 });
  const [currentMatchup, setCurrentMatchup] = useState<Matchup | null>(null);
  const [myDailyPoints, setMyDailyPoints] = useState<number[]>([]);
  const [opponentDailyPoints, setOpponentDailyPoints] = useState<number[]>([]);
  const [selectedMatchupId, setSelectedMatchupId] = useState<string | null>(null);
  const [allWeekMatchups, setAllWeekMatchups] = useState<Array<Matchup & { team1_name?: string; team2_name?: string }>>([]);

  // Demo data - shown to guests and logged-in users without leagues
  // Load from actual demo rosters instead of static data
  const [demoMyTeam, setDemoMyTeam] = useState<MatchupPlayer[]>([]);
  const [demoOpponentTeam, setDemoOpponentTeam] = useState<MatchupPlayer[]>([]);
  const [demoMyTeamSlotAssignments, setDemoMyTeamSlotAssignments] = useState<Record<string, string>>({});
  const [demoOpponentTeamSlotAssignments, setDemoOpponentTeamSlotAssignments] = useState<Record<string, string>>({});
  
  // Load demo matchup data from actual rosters
  useEffect(() => {
    // Don't run if there's a URL leagueId (user accessing specific league)
    if (urlLeagueId) {
      return;
    }
    
    // Don't run if LeagueContext is still loading
    if (leagueContextLoading) {
      return;
    }
    
    // Only run for guests or users with no league
    if (userLeagueState === 'active-user') {
      setDemoMyTeam([]);
      setDemoOpponentTeam([]);
      setDemoMyTeamSlotAssignments({});
      setDemoOpponentTeamSlotAssignments({});
      // Don't touch loading state for active users
      return;
    }
    
    const loadDemoMatchup = async () => {
      try {
        // Only set loading for demo/guest users
        if (userLeagueState !== 'active-user') {
          setLoading(true);
        }
        console.log('[Matchup] Loading demo matchup data...');
        console.log('[Matchup] userLeagueState:', userLeagueState);
        
        const matchupData = await DemoDataService.getDemoMatchupData();
        console.log('[Matchup] Demo matchup data loaded:', {
          myTeamCount: matchupData.myTeam.length,
          opponentTeamCount: matchupData.opponentTeam.length,
          myTeamStarters: matchupData.myTeam.filter(p => p.isStarter).length,
          myTeamBench: matchupData.myTeam.filter(p => !p.isStarter).length,
          opponentTeamStarters: matchupData.opponentTeam.filter(p => p.isStarter).length,
          opponentTeamBench: matchupData.opponentTeam.filter(p => !p.isStarter).length,
          myTeamSlotCount: Object.keys(matchupData.myTeamSlotAssignments).length,
          opponentTeamSlotCount: Object.keys(matchupData.opponentTeamSlotAssignments).length
        });
        setDemoMyTeam(matchupData.myTeam);
        setDemoOpponentTeam(matchupData.opponentTeam);
        setDemoMyTeamSlotAssignments(matchupData.myTeamSlotAssignments);
        setDemoOpponentTeamSlotAssignments(matchupData.opponentTeamSlotAssignments);
        // Only set loading=false for demo/guest users
        if (userLeagueState !== 'active-user') {
          setLoading(false);
          hasInitializedRef.current = true; // Mark initialization complete
        }
      } catch (error) {
        console.error('[Matchup] Error loading demo matchup data:', error);
        console.error('[Matchup] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        // Fallback to static data if loading fails
        console.log('[Matchup] Falling back to static demo data');
        const staticMyTeam = DemoDataService.getDemoMyTeam();
        const staticOpponentTeam = DemoDataService.getDemoOpponentTeam();
        setDemoMyTeam(staticMyTeam);
        setDemoOpponentTeam(staticOpponentTeam);
        // For static fallback, calculate slot assignments
        const calculateSlotAssignments = (starters: MatchupPlayer[]) => {
          const assignments: Record<string, string> = {};
          const getFantasyPosition = (position: string): string => {
            const pos = position?.toUpperCase() || '';
            if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
            if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
            if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
            if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
            if (['G', 'GOALIE'].includes(pos)) return 'G';
            return 'UTIL';
          };
          const playersByPos: Record<string, MatchupPlayer[]> = {
            'C': [], 'LW': [], 'RW': [], 'D': [], 'G': [], 'UTIL': []
          };
          starters.forEach(p => {
            const pos = getFantasyPosition(p.position);
            if (pos !== 'UTIL') playersByPos[pos].push(p);
          });
          ['C', 'LW', 'RW'].forEach(pos => {
            playersByPos[pos].slice(0, 2).forEach((p, i) => {
              assignments[String(p.id)] = `slot-${pos}-${i + 1}`;
            });
          });
          playersByPos['D'].slice(0, 4).forEach((p, i) => {
            assignments[String(p.id)] = `slot-D-${i + 1}`;
          });
          playersByPos['G'].slice(0, 2).forEach((p, i) => {
            assignments[String(p.id)] = `slot-G-${i + 1}`;
          });
          const assignedIds = new Set(Object.keys(assignments));
          const unassigned = starters.filter(p => !assignedIds.has(String(p.id)));
          const utilPlayer = unassigned.find(p => getFantasyPosition(p.position) !== 'G');
          if (utilPlayer) {
            assignments[String(utilPlayer.id)] = 'slot-UTIL';
          }
          return assignments;
        };
        const myStarters = staticMyTeam.filter(p => p.isStarter);
        const oppStarters = staticOpponentTeam.filter(p => p.isStarter);
        setDemoMyTeamSlotAssignments(calculateSlotAssignments(myStarters));
        setDemoOpponentTeamSlotAssignments(calculateSlotAssignments(oppStarters));
        setLoading(false);
        hasInitializedRef.current = true; // Mark initialization complete
      }
    };

    loadDemoMatchup();
  }, [userLeagueState, urlLeagueId, leagueContextLoading]);

  const toHockeyPlayer = (p: MatchupPlayer, seasonStats?: any): HockeyPlayer => {
    // Use season-long stats if provided, otherwise fall back to matchup stats (shouldn't happen)
    const stats = seasonStats || p.stats;
    
    return {
      id: p.id.toString(),
      name: p.name,
      position: p.position,
      number: 0,
      starter: p.isStarter,
      stats: {
        goals: stats.goals ?? 0,
        assists: stats.assists ?? 0,
        points: stats.points ?? (stats.goals ?? 0) + (stats.assists ?? 0),
        plusMinus: stats.plusMinus ?? stats.plus_minus ?? 0,
        shots: stats.shots ?? stats.shotsOnGoal ?? stats.sog ?? 0,
        gamesPlayed: stats.gamesPlayed ?? stats.games_played ?? 0,
        hits: stats.hits ?? 0,
        blockedShots: stats.blockedShots ?? stats.blocks ?? stats.blk ?? 0,
        wins: stats.wins ?? 0,
        losses: stats.losses ?? 0,
        otl: stats.otl ?? 0,
        gaa: stats.gaa ?? 0,
        savePct: stats.savePct ?? stats.save_pct ?? 0,
        shutouts: stats.shutouts ?? 0,
        xGoals: stats.xGoals ?? stats.x_goals ?? 0,
        powerPlayPoints: stats.powerPlayPoints ?? stats.ppp ?? 0,
        shortHandedPoints: stats.shortHandedPoints ?? stats.shp ?? 0,
        pim: stats.pim ?? 0,
        toi: stats.toi ?? (stats.icetime_seconds && (stats.gamesPlayed ?? stats.games_played) ? formatTOIPerGame(stats.icetime_seconds, stats.gamesPlayed ?? stats.games_played ?? 1) : (stats.icetime_seconds ? formatTOI(stats.icetime_seconds) : '0:00'))
      },
      team: p.team,
      teamAbbreviation: p.team,
      status: p.status === 'Yet to Play' ? null : (p.status === 'In Game' ? 'Active' : null),
      image: undefined,
      projectedPoints: 0
    };
  };

  // Helper to format TOI from seconds
  const formatTOI = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Helper to calculate and format TOI per game
  const formatTOIPerGame = (totalSeconds: number, gamesPlayed: number): string => {
    if (!gamesPlayed || gamesPlayed === 0) return '0:00';
    const secondsPerGame = totalSeconds / gamesPlayed;
    return formatTOI(secondsPerGame);
  };

  // Fetch daily stats when a date is selected, or default to today if in matchup week
  // Fetch all matchups for the current week (for matchup viewer dropdown)
  useEffect(() => {
    const fetchAllWeekMatchups = async () => {
      if (!league?.id || userLeagueState !== 'active-user' || !selectedWeek) {
        setAllWeekMatchups([]);
        return;
      }

      try {
        const { data: matchups, error } = await supabase
          .from('matchups')
          .select(`
            *,
            team1:teams!team1_id(team_name),
            team2:teams!team2_id(team_name)
          `)
          .eq('league_id', league.id)
          .eq('week_number', selectedWeek)
          .order('created_at', { ascending: true });

        if (error) {
          console.warn('[Matchup] Error fetching all week matchups:', error);
          return;
        }

        if (matchups) {
          const matchupsWithNames = matchups.map(m => ({
            ...m,
            team1_name: (m.team1 as any)?.team_name || 'Unknown',
            team2_name: (m.team2 as any)?.team_name || (m.team2_id ? 'Unknown' : 'Bye Week'),
          }));
          setAllWeekMatchups(matchupsWithNames);
          
          // If no matchup is selected and user's matchup exists, select it
          if (!selectedMatchupId && currentMatchup) {
            setSelectedMatchupId(currentMatchup.id);
          }
        }
      } catch (error) {
        console.error('[Matchup] Exception fetching all week matchups:', error);
      }
    };

    fetchAllWeekMatchups();
  }, [league?.id, selectedWeek, userLeagueState, currentMatchup?.id]);

  // Fetch stats for all 7 days of the matchup week (for WeeklySchedule day boxes)
  useEffect(() => {
    const fetchAllDailyStats = async () => {
      if (!currentMatchup || userLeagueState !== 'active-user') {
        setDailyStatsByDate(new Map());
        return;
      }

      try {
        // Get all player IDs from both teams
        const allPlayerIds = [
          ...myTeam.map(p => p.id),
          ...opponentTeamPlayers.map(p => p.id)
        ];

        if (allPlayerIds.length === 0) return;

        // Generate all 7 dates in the week
        const weekStart = new Date(currentMatchup.week_start_date);
        const dates: string[] = [];
        for (let i = 0; i < 7; i++) {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + i);
          dates.push(date.toISOString().split('T')[0]);
        }

        // Fetch stats for all 7 days in parallel
        const statsByDate = new Map<string, Map<number, any>>();
        
        await Promise.all(dates.map(async (date) => {
          const { data, error } = await supabase.rpc('get_daily_game_stats', {
            p_player_ids: allPlayerIds,
            p_game_date: date
          });

          if (error) {
            console.warn(`[Matchup] Error fetching stats for ${date}:`, error);
            return;
          }

          // Create map of player_id -> daily stats for this date
          const dayStatsMap = new Map<number, any>();
          (data || []).forEach((row: any) => {
            const player = myTeam.find(p => p.id === row.player_id) || 
                           opponentTeamPlayers.find(p => p.id === row.player_id);
            const isGoalie = player?.position === 'G' || player?.position === 'Goalie' || player?.isGoalie || row.is_goalie;
            
            // Calculate daily total points using league-standard formula
            let dailyTotalPoints = 0;
            if (isGoalie) {
              dailyTotalPoints = 
                (row.wins || 0) * 5 + 
                (row.saves || 0) * 0.2 + 
                (row.shutouts || 0) * 3 - 
                (row.goals_against || 0) * 1;
            } else {
              dailyTotalPoints = 
                (row.goals || 0) * 3 + 
                (row.assists || 0) * 2 + 
                (row.shots_on_goal || 0) * 0.4 + 
                (row.blocks || 0) * 0.4;
            }
            
            dayStatsMap.set(row.player_id, {
              daily_total_points: dailyTotalPoints,
            });
          });

          statsByDate.set(date, dayStatsMap);
        }));

        setDailyStatsByDate(statsByDate);
      } catch (error) {
        console.error('[Matchup] Error fetching all daily stats:', error);
        setDailyStatsByDate(new Map());
      }
    };

    fetchAllDailyStats();
  }, [currentMatchup, myTeam, opponentTeamPlayers, userLeagueState]);

  // Fetch detailed stats for selected date (or today) - for PlayerCard display
  useEffect(() => {
    const fetchDailyStats = async () => {
      if (!currentMatchup || userLeagueState !== 'active-user') {
        setDailyStatsMap(new Map());
        return;
      }

      // Determine which date to fetch stats for
      let dateToFetch = selectedDate;
      
      // If no date selected, default to today if today is in the matchup week
      if (!dateToFetch) {
        const todayStr = getTodayMST();
        const weekStart = currentMatchup.week_start_date;
        const weekEnd = currentMatchup.week_end_date;
        
        if (todayStr >= weekStart && todayStr <= weekEnd) {
          dateToFetch = todayStr;
        } else {
          // Today is not in the matchup week, don't fetch daily stats
          setDailyStatsMap(new Map());
          return;
        }
      }

      try {
        // Get all player IDs from both teams
        const allPlayerIds = [
          ...myTeam.map(p => p.id),
          ...opponentTeamPlayers.map(p => p.id)
        ];

        if (allPlayerIds.length === 0) return;

        // Fetch comprehensive daily game stats using new RPC
        const { data, error } = await supabase.rpc('get_daily_game_stats', {
          p_player_ids: allPlayerIds,
          p_game_date: dateToFetch
        });

        if (error) throw error;

        // Create map of player_id -> comprehensive daily stats
        const statsMap = new Map<number, any>();
        (data || []).forEach((row: any) => {
          // HARD CHECK: Use player position from team arrays for goalie detection
          // This ensures accurate math for "Blowout" games where goalies earn negative points
          const player = myTeam.find(p => p.id === row.player_id) || 
                         opponentTeamPlayers.find(p => p.id === row.player_id);
          const isGoalie = player?.position === 'G' || player?.position === 'Goalie' || player?.isGoalie || row.is_goalie;
          
          // Calculate daily total points using league-standard formula
          // TODO: In future, pull weights from league settings for custom scoring
          let dailyTotalPoints = 0;
          if (isGoalie) {
            // Goalie Formula: W(5), SV(0.2), SO(3), GA(-1)
            dailyTotalPoints = 
              (row.wins || 0) * 5 + 
              (row.saves || 0) * 0.2 + 
              (row.shutouts || 0) * 3 - 
              (row.goals_against || 0) * 1;
          } else {
            // Skater Formula: G(3), A(2), SOG(0.4), BLK(0.4)
            dailyTotalPoints = 
              (row.goals || 0) * 3 + 
              (row.assists || 0) * 2 + 
              (row.shots_on_goal || 0) * 0.4 + 
              (row.blocks || 0) * 0.4;
          }
          
          // Store ALL available stats for comprehensive display
          statsMap.set(row.player_id, {
            // Core stats
            goals: row.goals || 0,
            assists: row.assists || 0,
            points: row.points || 0,
            sog: row.shots_on_goal || 0,
            pim: row.pim || 0,
            plus_minus: row.plus_minus || 0,
            toi_seconds: row.toi_seconds || 0,
            
            // Physical stats
            hits: row.hits || 0,
            blocks: row.blocks || 0,
            
            // Faceoffs
            faceoff_wins: row.faceoff_wins || 0,
            faceoff_losses: row.faceoff_losses || 0,
            faceoff_taken: row.faceoff_taken || 0,
            
            // Possession
            takeaways: row.takeaways || 0,
            giveaways: row.giveaways || 0,
            
            // Power Play breakdown
            ppp: row.ppp || 0,
            ppg: row.ppg || 0,
            ppa: row.ppa || 0,
            
            // Shorthanded breakdown
            shp: row.shp || 0,
            shg: row.shg || 0,
            sha: row.sha || 0,
            
            // Shot metrics (Corsi components)
            shots_missed: row.shots_missed || 0,
            shots_blocked: row.shots_blocked || 0,
            shot_attempts: row.shot_attempts || 0,
            
            // Game context
            gwg: row.gwg || 0,
            otg: row.otg || 0,
            shifts: row.shifts || 0,
            
            // Goalie stats
            wins: row.wins || 0,
            losses: row.losses || 0,
            ot_losses: row.ot_losses || 0,
            saves: row.saves || 0,
            shots_faced: row.shots_faced || 0,
            goals_against: row.goals_against || 0,
            shutouts: row.shutouts || 0,
            save_pct: row.save_pct || 0,
            
            // Calculated values
            daily_total_points: dailyTotalPoints,
            is_goalie: isGoalie,
            
            // Build scoring breakdown for tooltip (same format as stats_breakdown)
            daily_stats_breakdown: isGoalie ? {
              ...(row.wins > 0 ? { wins: { count: row.wins, points: row.wins * 5 } } : {}),
              ...(row.saves > 0 ? { saves: { count: row.saves, points: row.saves * 0.2 } } : {}),
              ...(row.shutouts > 0 ? { shutouts: { count: row.shutouts, points: row.shutouts * 3 } } : {}),
              ...(row.goals_against > 0 ? { goals_against: { count: row.goals_against, points: -(row.goals_against * 1) } } : {}),
            } : {
              ...(row.goals > 0 ? { goals: { count: row.goals, points: row.goals * 3 } } : {}),
              ...(row.assists > 0 ? { assists: { count: row.assists, points: row.assists * 2 } } : {}),
              ...(row.shots_on_goal > 0 ? { shots_on_goal: { count: row.shots_on_goal, points: row.shots_on_goal * 0.4 } } : {}),
              ...(row.blocks > 0 ? { blocks: { count: row.blocks, points: row.blocks * 0.4 } } : {}),
            },
          });
        });

        setDailyStatsMap(statsMap);
      } catch (error) {
        console.error('[Matchup] Error fetching daily stats:', error);
        setDailyStatsMap(new Map());
      }
    };

    fetchDailyStats();
  }, [selectedDate, currentMatchup, myTeam, opponentTeamPlayers, userLeagueState]);

  const handlePlayerClick = async (player: MatchupPlayer) => {
    try {
      // Fetch season-long stats for this player
      const seasonPlayers = await PlayerService.getPlayersByIds([player.id.toString()]);
      const seasonPlayer = seasonPlayers.find(p => Number(p.id) === player.id);
      
      if (seasonPlayer) {
        // Map Player type to stats format for toHockeyPlayer
        const seasonStats = {
          goals: seasonPlayer.goals ?? 0,
          assists: seasonPlayer.assists ?? 0,
          points: seasonPlayer.points ?? 0,
          plusMinus: seasonPlayer.plus_minus ?? 0,
          shots: seasonPlayer.shots ?? 0,
          gamesPlayed: seasonPlayer.games_played ?? 0,
          hits: seasonPlayer.hits ?? 0,
          blockedShots: seasonPlayer.blocks ?? 0,
          xGoals: seasonPlayer.xGoals ?? 0,
          powerPlayPoints: seasonPlayer.ppp ?? 0,
          shortHandedPoints: seasonPlayer.shp ?? 0,
          pim: seasonPlayer.pim ?? 0,
          icetime_seconds: seasonPlayer.icetime_seconds ?? 0,
          gamesPlayed: seasonPlayer.games_played ?? 0,
          wins: seasonPlayer.wins ?? 0,
          saves: seasonPlayer.saves ?? 0,
          shots_faced: seasonPlayer.shots_faced ?? 0,
          goals_against: seasonPlayer.goals_against ?? 0,
          shutouts: seasonPlayer.shutouts ?? 0,
          save_pct: seasonPlayer.save_percentage ?? 0,
          gaa: seasonPlayer.goals_against_average ?? 0
        };
        setSelectedPlayer(toHockeyPlayer(player, seasonStats));
      } else {
        // Fallback: try to fetch directly from player_season_stats
        const DEFAULT_SEASON = 2025;
        const { data: seasonStatsData, error } = await supabase
          .from('player_season_stats')
          .select('*')
          .eq('player_id', player.id)
          .eq('season', DEFAULT_SEASON)
          .single();
        
        if (!error && seasonStatsData) {
          // Map player_season_stats to stats format
          const mappedStats = {
            goals: seasonStatsData.goals ?? 0,
            assists: (seasonStatsData.primary_assists ?? 0) + (seasonStatsData.secondary_assists ?? 0),
            points: seasonStatsData.points ?? 0,
            plusMinus: seasonStatsData.plus_minus ?? seasonStatsData.nhl_plus_minus ?? 0,
            shots: seasonStatsData.shots_on_goal ?? 0,
            gamesPlayed: seasonStatsData.games_played ?? 0,
            hits: seasonStatsData.hits ?? 0,
            blockedShots: seasonStatsData.blocks ?? 0,
            xGoals: seasonStatsData.x_goals ?? 0,
            powerPlayPoints: seasonStatsData.ppp ?? 0,
            shortHandedPoints: seasonStatsData.shp ?? 0,
            pim: seasonStatsData.pim ?? 0,
            icetime_seconds: seasonStatsData.icetime_seconds ?? seasonStatsData.nhl_toi_seconds ?? 0,
            gamesPlayed: seasonStatsData.games_played ?? 0,
            wins: seasonStatsData.wins ?? 0,
            saves: seasonStatsData.saves ?? 0,
            shots_faced: seasonStatsData.shots_faced ?? 0,
            goals_against: seasonStatsData.goals_against ?? 0,
            shutouts: seasonStatsData.shutouts ?? 0,
            save_pct: seasonStatsData.save_pct ?? 0,
            gaa: seasonStatsData.goals_against && seasonStatsData.goalie_gp 
              ? seasonStatsData.goals_against / seasonStatsData.goalie_gp 
              : 0
          };
          setSelectedPlayer(toHockeyPlayer(player, mappedStats));
        } else {
          // Last resort: use matchup stats (shouldn't happen in production)
          console.warn(`[Matchup] Could not fetch season stats for player ${player.id}, using matchup stats`);
          setSelectedPlayer(toHockeyPlayer(player));
        }
      }
    } catch (error) {
      console.error(`[Matchup] Error fetching season stats for player ${player.id}:`, error);
      // Fallback to matchup stats on error
      setSelectedPlayer(toHockeyPlayer(player));
    }
    
    setIsPlayerDialogOpen(true);
  };

  const [updates] = useState<string[]>([
    "Connor McDavid scored a goal! +5 points.",
    "David Pastrnak with an assist! +3 points.",
    "Igor Shesterkin made a save! +0.2 points.",
    "Adam Fox with a power play assist! +4 points."
  ]);

  // Use real data if active user, otherwise demo data
  // CRITICAL: Ensure myTeam is always the user's team (left side)
  // and opponentTeamPlayers is always the opponent (right side)
  // Enrich players with daily stats when a date is selected (or default to today)
  // Always enrich if dailyStatsMap has data (even if selectedDate is null, it might be today's stats)
  const displayMyTeam = useMemo(() => {
    const baseTeam = userLeagueState === 'active-user' ? myTeam : demoMyTeam;
    if (dailyStatsMap.size === 0) {
      return baseTeam;
    }
    // Enrich with daily stats (from selected date or today)
    return baseTeam.map(player => {
      const dailyStats = dailyStatsMap.get(player.id);
      if (!dailyStats) return player;
      
      // Keep weekly total_points unchanged - it's the matchup week total
      return {
        ...player,
        matchupStats: {
          goals: dailyStats.goals || 0,
          assists: dailyStats.assists || 0,
          sog: dailyStats.sog || 0,
          xGoals: dailyStats.xGoals || 0,
        },
        // Update stats for display in statline (G, A, SOG)
        stats: {
          ...player.stats,
          goals: dailyStats.goals || 0,
          assists: dailyStats.assists || 0,
          sog: dailyStats.sog || 0,
          blk: dailyStats.blocks || 0,
          xGoals: dailyStats.xGoals || 0,
        },
        // Add daily total points for the projection bar replacement
        daily_total_points: dailyStats.daily_total_points || 0,
        // Add daily stats breakdown for tooltip hover
        daily_stats_breakdown: dailyStats.daily_stats_breakdown || null,
        // Keep weekly total_points unchanged
        // total_points remains as weekly total
      };
    });
  }, [userLeagueState, myTeam, demoMyTeam, dailyStatsMap]);

  const displayOpponentTeam = useMemo(() => {
    const baseTeam = userLeagueState === 'active-user' ? opponentTeamPlayers : demoOpponentTeam;
    if (dailyStatsMap.size === 0) {
      return baseTeam;
    }
    // Enrich with daily stats (from selected date or today)
    return baseTeam.map(player => {
      const dailyStats = dailyStatsMap.get(player.id);
      if (!dailyStats) return player;
      
      // Keep weekly total_points unchanged - it's the matchup week total
      return {
        ...player,
        matchupStats: {
          goals: dailyStats.goals || 0,
          assists: dailyStats.assists || 0,
          sog: dailyStats.sog || 0,
          xGoals: dailyStats.xGoals || 0,
        },
        // Update stats for display in statline (G, A, SOG)
        stats: {
          ...player.stats,
          goals: dailyStats.goals || 0,
          assists: dailyStats.assists || 0,
          sog: dailyStats.sog || 0,
          blk: dailyStats.blocks || 0,
          xGoals: dailyStats.xGoals || 0,
        },
        // Add daily total points for the projection bar replacement
        daily_total_points: dailyStats.daily_total_points || 0,
        // Add daily stats breakdown for tooltip hover
        daily_stats_breakdown: dailyStats.daily_stats_breakdown || null,
        // Keep weekly total_points unchanged
        // total_points remains as weekly total
      };
    });
  }, [userLeagueState, opponentTeamPlayers, demoOpponentTeam, dailyStatsMap]);
  const displayMyTeamSlotAssignments = useMemo(() =>
    userLeagueState === 'active-user' ? myTeamSlotAssignments : demoMyTeamSlotAssignments,
    [userLeagueState, myTeamSlotAssignments, demoMyTeamSlotAssignments]
  );
  const displayOpponentTeamSlotAssignments = useMemo(() =>
    userLeagueState === 'active-user' ? opponentTeamSlotAssignments : demoOpponentTeamSlotAssignments,
    [userLeagueState, opponentTeamSlotAssignments, demoOpponentTeamSlotAssignments]
  );

  // Define starters BEFORE using them in team points calculations
  const myStarters = useMemo(() => displayMyTeam.filter(p => p.isStarter), [displayMyTeam]);
  const myBench = useMemo(() => displayMyTeam.filter(p => !p.isStarter), [displayMyTeam]);
  const opponentStarters = useMemo(() => displayOpponentTeam.filter(p => p.isStarter), [displayOpponentTeam]);
  const opponentBench = useMemo(() => displayOpponentTeam.filter(p => !p.isStarter), [displayOpponentTeam]);

  // Calculate team totals from daily scores (sum of 7 daily scores)
  // This matches the WeeklySchedule calculation - sum daily totals from starting lineup players
  const myTeamPoints = useMemo(() => {
    if (userLeagueState === 'active-user' && currentMatchup && dailyStatsByDate.size > 0) {
      // Generate all 7 dates in the week
      const weekStart = new Date(currentMatchup.week_start_date);
      let total = 0;
      
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayStats = dailyStatsByDate.get(dateStr);
        if (dayStats) {
          // Sum daily_total_points from starting lineup players for this day
          const dayTotal = myStarters.reduce((sum, player) => {
            const playerStats = dayStats.get(player.id);
            return sum + (playerStats?.daily_total_points ?? 0);
          }, 0);
          total += dayTotal;
        }
      }
      
      return total.toFixed(1);
    }
    // Fallback: sum player points if daily scores not available
    const total = displayMyTeam.reduce((sum, player) => sum + (player.total_points ?? 0), 0);
    return total.toFixed(1);
  }, [userLeagueState, currentMatchup, dailyStatsByDate, myStarters, displayMyTeam]);

  const opponentTeamPoints = useMemo(() => {
    if (userLeagueState === 'active-user' && currentMatchup && dailyStatsByDate.size > 0) {
      // Generate all 7 dates in the week
      const weekStart = new Date(currentMatchup.week_start_date);
      let total = 0;
      
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayStats = dailyStatsByDate.get(dateStr);
        if (dayStats) {
          // Sum daily_total_points from starting lineup players for this day
          const dayTotal = opponentStarters.reduce((sum, player) => {
            const playerStats = dayStats.get(player.id);
            return sum + (playerStats?.daily_total_points ?? 0);
          }, 0);
          total += dayTotal;
        }
      }
      
      return total.toFixed(1);
    }
    // Fallback: sum player points if daily scores not available
    const total = displayOpponentTeam.reduce((sum, player) => sum + (player.total_points ?? 0), 0);
    return total.toFixed(1);
  }, [userLeagueState, currentMatchup, dailyStatsByDate, opponentStarters, displayOpponentTeam]);

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  
  // Calculate daily points - only if matchup has started and has scores
  const hasMatchupData = currentMatchup && 
    (currentMatchup.status === 'in_progress' || currentMatchup.status === 'completed') &&
    (parseFloat(String(currentMatchup.team1_score)) > 0 || parseFloat(String(currentMatchup.team2_score)) > 0);
  


  // Load real matchup data for logged-in users with leagues
  useEffect(() => {
    // CRITICAL: Early exit guards to prevent infinite loops
    
    // Wait for LeagueContext to finish loading before making decisions
    // Note: leagueContextLoading is NOT in dependency array to prevent re-runs
    if (leagueContextLoading) {
      return;
    }
    
    if (!user?.id) {
      console.log('[MATCHUP] No user ID, skipping');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      return;
    }
    
    // If userLeagueState says no league, don't try to load matchup data
    // But also don't freeze - just show the appropriate UI
    if (userLeagueState === 'logged-in-no-league') {
      console.log('[MATCHUP] User has no league, showing league creation CTA - EXITING EARLY');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      loadingRef.current = false; // Release lock
      return;
    }
    
    if (userLeagueState === 'guest') {
      console.log('[MATCHUP] Guest user, skipping matchup load');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      return;
    }
    
    // Only proceed if we're an active user
    if (userLeagueState !== 'active-user') {
      console.log('[MATCHUP] Not active user state:', userLeagueState, '- skipping load');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      return;
    }
    
    // Guard: Don't run if we don't have a league ID and haven't determined one yet
    if (!urlLeagueId && loadingRef.current) {
      console.log('[MATCHUP] No league ID and load in progress, skipping');
      return;
    }
    
    // Check if values actually changed to prevent unnecessary reloads
    const leagueIdChanged = prevLeagueIdRef.current !== urlLeagueId;
    const weekIdChanged = prevWeekIdRef.current !== urlWeekId;
    
    // If values haven't changed, check cache
    if (!leagueIdChanged && !weekIdChanged && urlLeagueId && urlWeekId) {
      if (loadedMatchupDataRef.current && 
          loadedMatchupDataRef.current.leagueId === urlLeagueId &&
          loadedMatchupDataRef.current.weekId === urlWeekId) {
        const age = Date.now() - loadedMatchupDataRef.current.timestamp;
        if (age < CACHE_TTL && !loadingRef.current) {
          console.log('[MATCHUP] Using cached data, skipping reload');
          setLoading(false);
          return;
        }
      }
    }
    
    // Update refs to track current values
    prevLeagueIdRef.current = urlLeagueId;
    prevWeekIdRef.current = urlWeekId;
    
    console.log('[MATCHUP] useEffect triggered - starting load', {
      hasUser: !!user,
      userId: user?.id,
      userLeagueState,
      urlLeagueId,
      urlWeekId,
      leagueIdChanged,
      weekIdChanged,
      loadingRefCurrent: loadingRef.current
    });

    const loadMatchupData = async () => {
      // CRITICAL: Prevent concurrent loads AND infinite loops
      if (loadingRef.current) {
        console.log('[MATCHUP] Load already in progress, skipping duplicate call...');
        return;
      }
      
      // Additional guard: If we've already tried loading and failed, don't retry immediately
      // This prevents infinite retry loops
      if (error && !loading) {
        console.log('[MATCHUP] Previous load failed, not retrying automatically');
        return;
      }
      
      // Guard: Prevent running if we've already processed "no league" state
      if (hasProcessedNoLeague.current && userLeagueState === 'logged-in-no-league') {
        console.log('[MATCHUP] Already processed no-league state, skipping');
        return;
      }
      
      // Set loading state immediately to prevent duplicate calls
      loadingRef.current = true;
      
      // Set up timeout to ensure loading completes within 15 seconds (more aggressive)
      let timeoutId: NodeJS.Timeout | null = null;
      timeoutId = setTimeout(() => {
        console.error('[MATCHUP] Load timeout after 15s - FORCING STOP');
        setError('Loading took too long. Please refresh the page or try again later.');
        setLoading(false);
        loadingRef.current = false; // Force release lock
      }, 15000);
      
      try {
        setLoading(true);
        setError(null);

        // Determine which league to use (from URL or first available)
        let targetLeagueId = urlLeagueId;
        
        if (!targetLeagueId) {
          console.log('[MATCHUP] No leagueId in URL, fetching user leagues...');
          // Get user's leagues if no leagueId in URL
          const { leagues: userLeagues, error: leaguesError } = await LeagueService.getUserLeagues(user.id);
          if (leaguesError) {
            console.error('[MATCHUP] Error fetching user leagues:', leaguesError);
            throw leaguesError;
          }

          if (userLeagues.length === 0) {
            console.error('[MATCHUP] User has no leagues');
            setError('You are not in any leagues');
            setLoading(false);
            loadingRef.current = false;
            return;
          }

          // Use first league and redirect to URL with leagueId
          const currentLeague = userLeagues[0];
          targetLeagueId = currentLeague.id;
          console.log('[MATCHUP] Redirecting to league:', targetLeagueId);
          
          // Redirect to URL with leagueId (and weekId if available) - use window.location to avoid loops
          const weekParam = urlWeekId ? `/${urlWeekId}` : '';
          window.location.href = `/matchup/${targetLeagueId}${weekParam}`;
          return;
        }

        console.log('[MATCHUP] LeagueId from URL:', targetLeagueId);
        // Get league data
        const { leagues: userLeagues, error: leagueError } = await LeagueService.getUserLeagues(user.id);
        if (leagueError) {
          console.error('[MATCHUP] Error fetching leagues for validation:', leagueError);
          throw leagueError;
        }
        
        const currentLeague = userLeagues.find((l: League) => l.id === targetLeagueId);
        if (!currentLeague) {
          console.error('[MATCHUP] League not found in user leagues:', targetLeagueId);
          setError('League not found');
          setLoading(false);
          loadingRef.current = false;
          return;
        }

        console.log('[MATCHUP] Found league:', currentLeague.id, 'draft_status:', currentLeague.draft_status);
        setLeague(currentLeague);

        // Check if draft is completed
        if (currentLeague.draft_status !== 'completed') {
          console.log('[MATCHUP] Draft not completed, cannot view matchups');
          setError('Draft must be completed before viewing matchups');
          setLoading(false);
          loadingRef.current = false;
          return;
        }

        // Update all matchup scores for this league to ensure they're current
        // This uses the EXACT same calculation as the matchup tab (sum of 7 daily scores)
        // Ensures all matchups (user teams AND AI teams) use identical calculation
        try {
          const { error: updateScoresError } = await MatchupService.updateMatchupScores(currentLeague.id);
          if (updateScoresError) {
            console.warn('[MATCHUP] Error updating matchup scores:', updateScoresError);
            // Don't block matchup load if score update fails
          }
        } catch (error) {
          console.warn('[MATCHUP] Exception updating matchup scores:', error);
          // Don't block matchup load if score update fails
        }

        console.log('[MATCHUP] Getting user team for league:', currentLeague.id);
        // Get user's team
        const { team: userTeamData } = await LeagueService.getUserTeam(currentLeague.id, user.id);
        if (!userTeamData) {
          console.error('[MATCHUP] User team not found');
          setError('You do not have a team in this league');
          setLoading(false);
          loadingRef.current = false;
          return;
        }
        console.log('[MATCHUP] Found user team:', userTeamData.id);
        setUserTeam(userTeamData);

        // Calculate first week start date
        const draftCompletionDate = getDraftCompletionDate(currentLeague);
        if (!draftCompletionDate) {
          setError('Could not determine draft completion date');
          setLoading(false);
          return;
        }

        const firstWeek = getFirstWeekStartDate(draftCompletionDate);
        setFirstWeekStart(firstWeek);

        // Get available weeks
        const currentYear = new Date().getFullYear();
        const weeks = getAvailableWeeks(firstWeek, currentYear);
        console.log(`[Matchup] Calculated ${weeks.length} available weeks:`, weeks);
        setAvailableWeeks(weeks);

        // Determine which week to show (from URL or current week)
        let weekToShow: number;
        if (urlWeekId) {
          weekToShow = parseInt(urlWeekId);
          if (isNaN(weekToShow) || !weeks.includes(weekToShow)) {
            // Invalid week in URL, use current week
            const currentWeek = getCurrentWeekNumber(firstWeek);
            weekToShow = weeks.includes(currentWeek) ? currentWeek : weeks[0] || 1;
            window.location.href = `/matchup/${targetLeagueId}/${weekToShow}`;
            return; // Exit early to prevent further execution
          }
        } else {
          // No week in URL, use current week
          const currentWeek = getCurrentWeekNumber(firstWeek);
          weekToShow = weeks.includes(currentWeek) ? currentWeek : weeks[0] || 1;
          window.location.href = `/matchup/${targetLeagueId}/${weekToShow}`;
          return; // Exit early to prevent further execution
        }

        setSelectedWeek(weekToShow);
        
        // Debug: Log week calculation details
        console.log('[Matchup] Week calculation details:', {
          urlWeekId,
          weekToShow,
          weekToShowType: typeof weekToShow,
          firstWeekStart: firstWeek.toISOString(),
          week2StartDate: getWeekStartDate(2, firstWeek).toISOString(),
          week2EndDate: getWeekEndDate(2, firstWeek).toISOString(),
          week2DateLabel: getWeekDateLabel(2, firstWeek),
          availableWeeks: weeks,
          weeksIncludeWeek2: weeks.includes(2)
        });

        // Quick check: Does a matchup exist for this week? If yes, skip generation entirely
        console.log('[Matchup] Checking for existing matchup:', {
          leagueId: currentLeague.id,
          userId: user.id,
          weekNumber: weekToShow,
          weekNumberType: typeof weekToShow
        });
        
        const { matchup: existingMatchup } = await MatchupService.getUserMatchup(
          currentLeague.id,
          user.id,
          weekToShow
        );
        
        console.log('[Matchup] Existing matchup check result:', {
          found: !!existingMatchup,
          matchup: existingMatchup ? {
            id: existingMatchup.id,
            week_number: existingMatchup.week_number,
            week_number_type: typeof existingMatchup.week_number,
            team1_id: existingMatchup.team1_id,
            team2_id: existingMatchup.team2_id
          } : null
        });
        
        if (!existingMatchup) {
          // No matchup found for this week - generate all missing weeks
          console.log('[Matchup] No matchup found for week', weekToShow, '- generating matchups...');
          const { teams: leagueTeams } = await LeagueService.getLeagueTeams(currentLeague.id);
          
          // Check if ANY matchups exist for this league
          const { data: anyMatchups } = await supabase
            .from('matchups')
            .select('week_number')
            .eq('league_id', currentLeague.id)
            .limit(1);
          
          const hasAnyMatchups = anyMatchups && anyMatchups.length > 0;
          
          // If no matchups exist at all, force regenerate ALL weeks
          // Otherwise, generate only missing weeks (which will include this one)
          const forceRegenerate = !hasAnyMatchups;
          
          console.log('[Matchup] Generating matchups with forceRegenerate:', forceRegenerate, 'for week:', weekToShow);
          console.log('[Matchup] Generation parameters:', {
            leagueId: currentLeague.id,
            teamCount: leagueTeams.length,
            teams: leagueTeams.map(t => ({ id: t.id, name: t.team_name || t.id })),
            firstWeekStart: firstWeek.toISOString(),
            forceRegenerate,
            requestedWeek: weekToShow,
            requestedWeekType: typeof weekToShow
          });
          
          const { error: genError } = await MatchupService.generateMatchupsForLeague(
            currentLeague.id, 
            leagueTeams, 
            firstWeek,
            forceRegenerate
          );
          
          if (genError) {
            console.error('[Matchup] Error generating matchups:', genError);
            setError(`Failed to generate matchups: ${genError.message || 'Unknown error'}`);
            setLoading(false);
            return;
          }
          
          console.log('[Matchup] Matchup generation completed successfully');
          
          // Wait longer to ensure database commits complete
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Debug: Check what matchups actually exist in the database BEFORE verification
          const { data: allMatchups, error: checkError } = await supabase
            .from('matchups')
            .select('week_number, team1_id, team2_id, league_id')
            .eq('league_id', currentLeague.id)
            .eq('week_number', weekToShow);
          
          console.log('[Matchup] Debug - All matchups for week', weekToShow, ':', allMatchups);
          
          // Also check ALL weeks in database to see what's actually stored
          const { data: allWeeksMatchups } = await supabase
            .from('matchups')
            .select('week_number')
            .eq('league_id', currentLeague.id);
          
          const uniqueWeeks = new Set(allWeeksMatchups?.map(m => m.week_number) || []);
          console.log('[Matchup] Debug - All week numbers in database:', Array.from(uniqueWeeks).sort((a, b) => a - b));
          console.log('[Matchup] Debug - Requested week', weekToShow, 'exists in database?', uniqueWeeks.has(weekToShow));
          
          // Also check user's team
          const { data: userTeamData } = await supabase
            .from('teams')
            .select('id, team_name, owner_id')
            .eq('league_id', currentLeague.id)
            .eq('owner_id', user.id)
            .maybeSingle();
          
          console.log('[Matchup] Debug - User team:', userTeamData);
          
          if (allMatchups && allMatchups.length > 0) {
            console.log('[Matchup] Debug - Matchups exist but user team not found. User team ID:', userTeamData?.id);
            console.log('[Matchup] Debug - Matchups in week:', allMatchups.map(m => ({
              team1: m.team1_id,
              team2: m.team2_id
            })));
            
            // Check if user's team is in any of these matchups
            const userTeamInMatchups = allMatchups.some(m => 
              m.team1_id === userTeamData?.id || m.team2_id === userTeamData?.id
            );
            console.log('[Matchup] Debug - User team in matchups?', userTeamInMatchups);
          }
          
          // Verify the matchup was created
          const { matchup: verifyMatchup } = await MatchupService.getUserMatchup(
            currentLeague.id,
            user.id,
            weekToShow
          );
          
          if (!verifyMatchup) {
            console.error('[Matchup] Matchup still not found after generation for week', weekToShow);
            
            // If matchups exist but user's team isn't in them, this is a serious issue - FORCE REGENERATE
            if (allMatchups && allMatchups.length > 0 && userTeamData) {
              const userTeamInMatchups = allMatchups.some(m => 
                m.team1_id === userTeamData.id || m.team2_id === userTeamData.id
              );
              
              if (!userTeamInMatchups) {
                console.error('[Matchup] CRITICAL: Week', weekToShow, 'has matchups but user team', userTeamData.id, 'is not in any of them!');
                console.error('[Matchup] FORCING FULL REGENERATION of all matchups...');
                
                // Force delete ALL matchups and regenerate
                await MatchupService.deleteAllMatchupsForLeague(currentLeague.id);
                
                // Get all teams again to ensure we have the complete list
                const { teams: allLeagueTeams } = await LeagueService.getLeagueTeams(currentLeague.id);
                
                // Verify user's team is in the list
                const userTeamInList = allLeagueTeams.some(t => t.id === userTeamData.id);
                if (!userTeamInList) {
                  console.error('[Matchup] CRITICAL: User team is not in the league teams list!');
                  setError(`Your team (${userTeamData.id}) is not found in the league teams. This is a data integrity issue.`);
                  setLoading(false);
                  return;
                }
                
                console.log('[Matchup] Regenerating ALL matchups with complete team list...');
                const { error: regenError } = await MatchupService.generateMatchupsForLeague(
                  currentLeague.id,
                  allLeagueTeams,
                  firstWeek,
                  true // Force regenerate
                );
                
                if (regenError) {
                  console.error('[Matchup] Error during forced regeneration:', regenError);
                  setError(`Failed to regenerate matchups: ${regenError.message || 'Unknown error'}`);
                  setLoading(false);
                  return;
                }
                
                // Wait for database commits
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Verify again
                const { matchup: finalMatchup } = await MatchupService.getUserMatchup(
                  currentLeague.id,
                  user.id,
                  weekToShow
                );
                
                if (!finalMatchup) {
                  console.error('[Matchup] Still no matchup after forced regeneration!');
                  setError(`Failed to generate matchup for week ${weekToShow} after forced regeneration. Please refresh and try again.`);
                  setLoading(false);
                  return;
                }
                
                console.log('[Matchup] Successfully regenerated and verified matchup exists');
                // Matchup now exists, continue with normal flow below
              } else {
                setError(`No matchup found for week ${weekToShow}. The matchup generation may have failed. Please try refreshing the page.`);
                setLoading(false);
                return;
              }
            } else {
              setError(`No matchup found for week ${weekToShow}. The matchup generation may have failed. Please try refreshing the page.`);
              setLoading(false);
              return;
            }
            
            // If we got here after forced regeneration, the matchup should exist now
            // Re-fetch it to continue with normal flow
            const { matchup: regeneratedMatchup } = await MatchupService.getUserMatchup(
              currentLeague.id,
              user.id,
              weekToShow
            );
            
            if (!regeneratedMatchup) {
              console.error('[Matchup] Matchup still not found after forced regeneration!');
              setError(`Failed to generate matchup for week ${weekToShow} after forced regeneration. Please refresh and try again.`);
              setLoading(false);
              return;
            }
            
            console.log('[Matchup] Verified matchup exists after forced regeneration');
          }
          
          console.log('[Matchup] Verified matchup exists for week', weekToShow);
        } else {
          console.log('[Matchup] Matchup already exists for week', weekToShow, '- skipping generation');
        }

        // Load matchup data using unified method
        // If a specific matchup is selected (from dropdown), load that matchup directly
        // Otherwise, use the user's matchup
        const userTimezone = (profile as any)?.timezone || 'America/Denver';
        let matchupDataPromise: Promise<{ data: any; error: any }>;

        if (selectedMatchupId) {
          // Always try to load the selected matchup, even if not in allWeekMatchups
          // This handles cases where the dropdown was changed but allWeekMatchups hasn't updated yet
          console.log('[MATCHUP] Loading selected matchup from dropdown:', selectedMatchupId);
          matchupDataPromise = MatchupService.getMatchupDataById(
            selectedMatchupId,
            user.id,
            userTimezone
          );
        } else {
          console.log('[MATCHUP] STEP 10: Calling getMatchupData for user matchup', {
            leagueId: targetLeagueId,
            userId: user.id,
            weekNumber: weekToShow,
            timezone: userTimezone,
            hasExistingMatchup: !!existingMatchup
          });
          // Use user's matchup
          matchupDataPromise = MatchupService.getMatchupData(
            targetLeagueId,
            user.id,
            weekToShow,
            userTimezone,
            existingMatchup
          );
        }
        
        const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) => {
          setTimeout(() => {
            resolve({ data: null, error: new Error('getMatchupData timed out after 20 seconds') });
          }, 20000);
        });
        
        let { data: matchupData, error: matchupError } = await Promise.race([
          matchupDataPromise,
          timeoutPromise
        ]);

        if (matchupError) {
          console.error('[MATCHUP] Error getting matchup data:', matchupError);
          
          // Enhanced error handling for dropdown selections
          if (selectedMatchupId) {
            console.error('[MATCHUP] Failed to load selected matchup from dropdown:', {
              matchupId: selectedMatchupId,
              error: matchupError,
              errorMessage: matchupError?.message || String(matchupError),
              errorDetails: matchupError
            });
            
            // Don't immediately clear selectedMatchupId - try to get more info first
            const errorMessage = matchupError?.message || String(matchupError) || 'Unknown error';
            
            // Check if it's a specific error we can handle
            if (errorMessage.includes('not found') || errorMessage.includes('Matchup not found')) {
              setError(`Matchup not found. The matchup may have been deleted or doesn't exist.`);
            } else if (errorMessage.includes('Viewing team not found')) {
              setError(`Team data not found for this matchup. The matchup may be incomplete.`);
            } else if (errorMessage.includes('League not found')) {
              setError(`League not found. You may not have access to this league.`);
            } else {
              setError(`Failed to load matchup: ${errorMessage}. Please try refreshing the page.`);
            }
            
            setLoading(false);
            loadingRef.current = false;
            return;
          } else {
            // Original error handling for user's matchup
            if (matchupError?.message?.includes('No matchup found') || matchupError?.message?.includes('timed out')) {
              console.log('[MATCHUP] No matchup found or timeout for week', weekToShow);
              setError(`Failed to load matchup for week ${weekToShow}. ${matchupError.message?.includes('timed out') ? 'Request timed out.' : 'Matchup may need to be generated.'} Please try refreshing the page.`);
              setLoading(false);
              loadingRef.current = false;
              return;
            }
            throw matchupError;
          }
        }
        
        if (!matchupData) {
          console.error('[MATCHUP] No matchup data returned', {
            selectedMatchupId,
            weekToShow,
            targetLeagueId,
            error: matchupError
          });
          
          if (selectedMatchupId) {
            // Don't clear selectedMatchupId - show specific error
            setError(`No matchup data available for the selected matchup. This may be because the matchup data is incomplete or the matchup hasn't been fully generated yet.`);
            setLoading(false);
            loadingRef.current = false;
            return;
          } else {
            setError(`No matchup found for week ${weekToShow}`);
            setLoading(false);
            loadingRef.current = false;
            return;
          }
        }
        
        console.log('[MATCHUP] STEP 11: Matchup data loaded successfully');
        
        // Update cache with loaded data
        if (targetLeagueId && weekToShow) {
          loadedMatchupDataRef.current = {
            leagueId: targetLeagueId,
            weekId: String(weekToShow),
            timestamp: Date.now()
          };
        }

        // Check if this is a playoff week and redirect
        if (matchupData.isPlayoffWeek) {
          window.location.href = `/league/${targetLeagueId}/playoffs`;
          return;
        }

        // Set state from unified data
        setCurrentMatchup(matchupData.matchup);
        setMyTeam(matchupData.userTeam.roster);
        setOpponentTeamPlayers(matchupData.opponentTeam?.roster || []);
        setMyTeamSlotAssignments(matchupData.userTeam.slotAssignments);
        setOpponentTeamSlotAssignments(matchupData.opponentTeam?.slotAssignments || {});
        setMyTeamRecord(matchupData.userTeam.record);
        setOpponentTeamRecord(matchupData.opponentTeam?.record || { wins: 0, losses: 0 });
        setMyDailyPoints(matchupData.userTeam.dailyPoints);
        setOpponentDailyPoints(matchupData.opponentTeam?.dailyPoints || []);

        // Default to null (full lineup view) - user can click a day to see daily stats
        setSelectedDate(null);
        setDailyStatsMap(new Map());
        
        // Set selected matchup ID if not already set
        if (!selectedMatchupId && matchupData.matchup) {
          setSelectedMatchupId(matchupData.matchup.id);
        }

        // Get opponent team object for display
        if (matchupData.opponentTeam) {
          const { teams } = await LeagueService.getLeagueTeams(targetLeagueId);
          const oppTeam = teams.find(t => t.id === matchupData.opponentTeam!.id);
          setOpponentTeam(oppTeam || null);
        } else {
          setOpponentTeam(null);
        }

      } catch (err: any) {
        console.error('[MATCHUP] CRITICAL ERROR loading matchup data:', err);
        console.error('[MATCHUP] Error details:', {
          message: err.message,
          stack: err.stack,
          name: err.name
        });
        
        // Always set error so user sees something - don't hide errors
        const errorMessage = err.message || 'Failed to load matchup data';
        setError(errorMessage);
        
        // Log if it's a timeout for debugging
        if (errorMessage.includes('timeout')) {
          console.error('[MATCHUP] TIMEOUT ERROR - Query took too long');
        }
      } finally {
        // CRITICAL: Always clear timeout and reset state, even if error occurred
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        console.log('[MATCHUP] Finally block - clearing loading state');
        setLoading(false); // Always complete loading
        hasInitializedRef.current = true; // Mark that initial load is complete
        loadingRef.current = false; // Release lock - CRITICAL to prevent freeze
      }
    };

    loadMatchupData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, userLeagueState, urlLeagueId, urlWeekId, selectedMatchupId]);

  // Refresh matchup when page becomes visible (e.g., navigating back from roster page)
  useEffect(() => {
    if (!user?.id || !league?.id || !userTeam?.id || !urlLeagueId || !urlWeekId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !loadingRef.current) {
        // Page became visible - clear cache and reload by triggering URL change
        console.log('[Matchup] Page visible, refreshing matchup data...');
        MatchupService.clearRosterCache(userTeam.id, league.id);
        // Use window.location to avoid React Router navigation loops
        window.location.href = `/matchup/${urlLeagueId}/${urlWeekId}`;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, league?.id, userTeam?.id, urlLeagueId, urlWeekId]);

  // Periodic refresh for in-progress matchups (every 5 minutes)
  // This ensures scores stay current as new game stats are scraped
  useEffect(() => {
    if (!league?.id || userLeagueState !== 'active-user') return;
    if (!currentMatchup || currentMatchup.status !== 'in_progress') return;

    // Update scores immediately, then set up interval
    const updateScores = async () => {
      try {
        const result = await MatchupService.updateMatchupScores(league.id);
        if (result.error) {
          console.warn('[Matchup] Periodic score update had errors:', result.error);
        } else {
          console.log(`[Matchup] Periodic score update completed: ${result.updatedCount || 0} matchups updated`);
        }
      } catch (error) {
        console.warn('[Matchup] Error in periodic score update:', error);
        // Don't throw - allow interval to continue
      }
    };

    // Update immediately (but don't block)
    updateScores().catch(err => {
      console.warn('[Matchup] Initial periodic update failed:', err);
    });

    // Then update every 5 minutes (300000 ms)
    const intervalId = setInterval(() => {
      updateScores().catch(err => {
        console.warn('[Matchup] Periodic update failed:', err);
      });
    }, 300000);

    return () => clearInterval(intervalId);
  }, [league?.id, currentMatchup?.status, userLeagueState]);


  // Handle week selection - updates URL which triggers data reload
  const handleWeekChange = (weekNumber: number) => {
    if (!league?.id) {
      console.warn('[Matchup] handleWeekChange called but league is not set');
      return;
    }
    console.log('[Matchup] handleWeekChange called, navigating to week:', weekNumber, 'for league:', league.id);
    // Use window.location to avoid React Router navigation loops
    window.location.href = `/matchup/${league.id}/${weekNumber}`;
  };
  
  // Refresh matchup data (useful after making lineup changes on roster page)
  const refreshMatchup = () => {
    if (!league?.id || !userTeam?.id || !urlLeagueId || !urlWeekId) return;
    // Clear all caches to force fresh data
    MatchupService.clearRosterCache();
    // Use window.location to avoid React Router navigation loops
    window.location.href = `/matchup/${urlLeagueId}/${urlWeekId}`;
  };

  // Debug: Log render state (using ref counter to prevent spam)
  // MUST be declared before early return to maintain hook order
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  if (renderCountRef.current <= 3) { // Only log first 3 renders
    console.log('[MATCHUP] Component rendering', {
      renderCount: renderCountRef.current,
      loading,
      error,
      userLeagueState,
      hasMyTeam: myTeam.length > 0,
      hasOpponentTeam: opponentTeamPlayers.length > 0
    });
  }

  // Show full-page loading screen IMMEDIATELY - before any other logic
  // This prevents any flash between Suspense fallback and component loading state
  // Use useMemo to compute synchronously on every render
  // Be very conservative - show loading if:
  // 1. LeagueContext is still loading, OR
  // 2. Component loading state is true (and not in "no league" state), OR
  // 3. We haven't initialized yet AND we're not in "no league" state (prevents initial flash)
  // 4. User state is undefined/null (still determining)
  const shouldShowLoading = useMemo(() => {
    // If userLeagueState is undefined, we're still determining state - show loading
    if (userLeagueState === undefined || userLeagueState === null) {
      return true;
    }
    
    // If leagueContext is loading, show loading
    if (leagueContextLoading) {
      return true;
    }
    
    // If we haven't initialized and not in "no league" state, show loading
    if (!hasInitializedRef.current && userLeagueState !== 'logged-in-no-league') {
      return true;
    }
    
    // If component is loading and not in "no league" state, show loading
    if (loading && userLeagueState !== 'logged-in-no-league') {
      return true;
    }
    
    return false;
  }, [leagueContextLoading, loading, userLeagueState]);
  
  // Early return for loading - must be after all hooks are declared
  if (shouldShowLoading) {
    return (
      <LoadingScreen
        character="citrus"
        message="Loading matchup..."
      />
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden w-full">
      {/* Decorative elements to match Home page */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[hsl(var(--vibrant-yellow))] rounded-full opacity-10 blur-3xl -z-10"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-[hsl(var(--vibrant-green))] rounded-full opacity-10 blur-3xl -z-10"></div>

      <Navbar />
      <main className="w-full pt-28 pb-16 m-0 p-0">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px] gap-6 lg:gap-8">
            {/* Main Content - Scrollable - Full Width - Appears first on mobile */}
            <div className="min-w-0 max-h-[calc(100vh-12rem)] overflow-y-auto px-2 lg:px-4 order-1 lg:order-2">
              {/* Header Section - Clean and Professional with Citrus Colors */}
              <div className="mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                  {/* Week Selector */}
                  {userLeagueState === 'active-user' && availableWeeks.length > 0 && firstWeekStart && (
                    <MatchupScheduleSelector
                      currentWeek={selectedWeek}
                      scheduleLength={availableWeeks.length}
                      availableWeeks={availableWeeks}
                      onWeekChange={handleWeekChange}
                      firstWeekStart={firstWeekStart}
                    />
                  )}
                  {/* Matchup Viewer Dropdown - Show all matchups for current week */}
                  {userLeagueState === 'active-user' && allWeekMatchups.length > 0 && (
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-muted-foreground">View Matchup:</label>
                      <Select
                        value={selectedMatchupId || currentMatchup?.id || ''}
                        onValueChange={async (value) => {
                          console.log('[Matchup] Dropdown changed to:', value);
                          setSelectedMatchupId(value);
                          // Reset selected date when switching matchups
                          setSelectedDate(null);
                          // Force reload by clearing current matchup state
                          setCurrentMatchup(null);
                          setMyTeam([]);
                          setOpponentTeamPlayers([]);
                          setLoading(true);
                          // The useEffect will pick up the selectedMatchupId change and reload
                        }}
                      >
                        <SelectTrigger className="w-[280px]">
                          <SelectValue placeholder="Select a matchup" />
                        </SelectTrigger>
                        <SelectContent>
                          {allWeekMatchups.map((matchup) => {
                            const team1Name = matchup.team1_name || 'Unknown';
                            const team2Name = matchup.team2_name || 'Bye Week';
                            const team1Score = parseFloat(String(matchup.team1_score)) || 0;
                            const team2Score = matchup.team2_id ? (parseFloat(String(matchup.team2_score)) || 0) : 0;
                            const isBye = !matchup.team2_id;
                            const isUserMatchup = matchup.id === currentMatchup?.id;
                            
                            // Debug logging: Compare dropdown scores vs matchup tab scores
                            if (isUserMatchup && currentMatchup) {
                              const tabTeam1Score = parseFloat(myTeamPoints) || 0;
                              const tabTeam2Score = parseFloat(opponentTeamPoints) || 0;
                              const scoresMatch = Math.abs(tabTeam1Score - team1Score) < 0.1 && 
                                                  Math.abs(tabTeam2Score - team2Score) < 0.1;
                              
                              if (!scoresMatch) {
                                console.warn('[Matchup] Dropdown score vs Tab score mismatch:', {
                                  matchup_id: matchup.id,
                                  dropdown_team1: team1Score,
                                  dropdown_team2: team2Score,
                                  tab_team1: tabTeam1Score,
                                  tab_team2: tabTeam2Score,
                                  match: scoresMatch,
                                  note: 'Dropdown reads from database, tab calculates on frontend. They should match after score update.'
                                });
                              } else {
                                console.log('[Matchup] Dropdown score vs Tab score match:', {
                                  matchup_id: matchup.id,
                                  team1: team1Score,
                                  team2: team2Score
                                });
                              }
                            }
                            
                            return (
                              <SelectItem key={matchup.id} value={matchup.id}>
                                <div className="flex items-center justify-between w-full">
                                  <span className={isUserMatchup ? 'font-semibold' : ''}>
                                    {team1Name} vs {team2Name}
                                    {isUserMatchup && ' (Your Matchup)'}
                                  </span>
                                  {(team1Score > 0 || team2Score > 0) && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {team1Score.toFixed(1)} - {isBye ? 'BYE' : team2Score.toFixed(1)}
                                    </span>
                                  )}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {(userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') && (
                    <div className="flex gap-1.5 bg-primary/10 p-1 rounded-lg border border-primary/20 flex-wrap">
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-fantasy-primary hover:bg-fantasy-primary/10">Dec 1-7</Button>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium bg-fantasy-primary text-white shadow-sm hover:bg-fantasy-primary/90">Dec 8-14</Button>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-fantasy-primary hover:bg-fantasy-primary/10">Dec 15-21</Button>
                    </div>
                  )}
                </div>
              </div>
          
          {/* Error State - Always show if there's an error */}
          {!loading && error && (
            <div className="text-center py-20">
              <p className="text-destructive text-lg mb-4">{error}</p>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          )}
          
          {/* No League State - Show immediately when detected, don't wait for loading */}
          {/* CRITICAL: Show this even if loading is true, to prevent frozen UI */}
          {userLeagueState === 'logged-in-no-league' && (
            <div className="py-12" style={{ pointerEvents: 'auto' }}>
              <LeagueCreationCTA 
                title="Your Matchup Awaits"
                description="Create your league to start competing in weekly matchups, track your team's performance, and climb the standings."
              />
            </div>
          )}

          {/* Main Content - Show if no error and data is available */}
          {!loading && !error && (
            (userLeagueState === 'guest' && (demoMyTeam.length > 0 || demoOpponentTeam.length > 0)) ||
            (userLeagueState === 'active-user' && (myTeam.length > 0 || opponentTeamPlayers.length > 0)) ||
            (userLeagueState === 'logged-in-no-league' && (demoMyTeam.length > 0 || demoOpponentTeam.length > 0))
          ) && (
            <>
          
          <ScoreCard
            myTeamName={userLeagueState === 'active-user' ? (userTeam?.team_name || 'My Team') : 'Citrus Crushers'}
            myTeamRecord={userLeagueState === 'active-user' ? myTeamRecord : { wins: 7, losses: 3 }}
            opponentTeamName={userLeagueState === 'active-user' ? (opponentTeam?.team_name || 'Bye Week') : 'Thunder Titans'}
            opponentTeamRecord={userLeagueState === 'active-user' ? opponentTeamRecord : { wins: 9, losses: 1 }}
            myTeamPoints={myTeamPoints}
            opponentTeamPoints={opponentTeamPoints}
          />
          
          {/* Weekly Schedule */}
          {userLeagueState === 'active-user' && currentMatchup && (
            <div className="mb-6">
              <WeeklySchedule
                weekStart={currentMatchup.week_start_date}
                weekEnd={currentMatchup.week_end_date}
                myStarters={myStarters}
                opponentStarters={opponentStarters}
                onDayClick={setSelectedDate}
                selectedDate={selectedDate}
                dailyStatsByDate={dailyStatsByDate}
              />
            </div>
          )}

          {/* Main Lineup View */}
          <div className="mt-6 matchup-wrapper" style={{ boxSizing: 'border-box', padding: 0, margin: 0 }}>
            {userLeagueState === 'logged-in-no-league' ? (
              <div className="grid gap-6 lg:gap-8 matchup-grid" style={{ gridTemplateColumns: '1fr 1fr', width: '100%', display: 'grid', boxSizing: 'border-box', margin: 0, padding: 0 }}>
                <LeagueCreationCTA 
                  title="Your Team Here"
                  description="Create your league to start building your roster and competing in matchups."
                  variant="compact"
                />
                <LeagueCreationCTA 
                  title="Opponent Team"
                  description="Create your league to see your matchups and compete against other teams."
                  variant="compact"
                />
              </div>
            ) : (
              <>
                {/* Always show full lineup, with daily stats when a day is selected */}
                <MatchupComparison
                  userStarters={myStarters}
                  opponentStarters={opponentStarters}
                  userBench={myBench}
                  opponentBench={opponentBench}
                  userSlotAssignments={displayMyTeamSlotAssignments}
                  opponentSlotAssignments={displayOpponentTeamSlotAssignments}
                  onPlayerClick={handlePlayerClick}
                  selectedDate={selectedDate}
                />
              </>
            )}
          </div>
          
          <LiveUpdates updates={updates} />
            </>
          )}
          
          {/* Fallback: If nothing else rendered, show a message */}
          {!loading && !error && 
           !(userLeagueState === 'guest' && (demoMyTeam.length > 0 || demoOpponentTeam.length > 0)) &&
           !(userLeagueState === 'active-user' && (myTeam.length > 0 || opponentTeamPlayers.length > 0)) &&
           !(userLeagueState === 'logged-in-no-league' && (demoMyTeam.length > 0 || demoOpponentTeam.length > 0)) &&
           userLeagueState !== 'logged-in-no-league' && (
            <div className="text-center py-20">
              <p className="text-muted-foreground mb-4">No matchup data available.</p>
              <p className="text-sm text-muted-foreground mb-4">This may be because:</p>
              <ul className="text-sm text-muted-foreground mb-4 text-left max-w-md mx-auto">
                <li>• The matchup hasn't been generated yet</li>
                <li>• You don't have a team in this league</li>
                <li>• The draft hasn't been completed</li>
              </ul>
              <div className="space-x-2">
                <Button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = '/';
                  }}
                  variant="outline"
                >
                  Go Home
                </Button>
                <Button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (urlLeagueId) {
                      window.location.href = `/league/${urlLeagueId}`;
                    } else {
                      window.location.reload();
                    }
                  }}
                >
                  {urlLeagueId ? 'View League' : 'Refresh'}
                </Button>
              </div>
            </div>
          )}
            </div>

            {/* Sidebar - At bottom on mobile, left on desktop - World-Class Ad Space */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                {/* Matchup Options Section */}
                <div className="bg-card border rounded-lg p-4 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3 text-foreground">Matchup Options</h3>
                  <div className="space-y-2">
                    <button className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors">
                      View Full Stats
                    </button>
                    <button className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors">
                      Compare Teams
                    </button>
                    <button className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors">
                      Export Matchup
                    </button>
                  </div>
                </div>

                {/* Ad Placeholder 1 - Mobile Optimized */}
                <div className="bg-muted/30 border border-dashed border-muted-foreground/20 rounded-lg p-6 flex flex-col items-center justify-center min-h-[180px] lg:min-h-[200px]">
                  <div className="text-muted-foreground text-xs text-center space-y-2">
                    <div className="w-12 h-12 mx-auto bg-muted rounded flex items-center justify-center mb-2">
                      <span className="text-2xl">📢</span>
                    </div>
                    <p className="font-medium">Ad Space</p>
                    <p className="text-xs opacity-70">300x250</p>
                  </div>
                </div>

                {/* Quick Stats Placeholder */}
                <div className="bg-card border rounded-lg p-4 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3 text-foreground">Quick Stats</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Projected</span>
                      <span className="font-semibold">142.5</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Best Player</span>
                      <span className="font-semibold">Connor McDavid</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Matchup %</span>
                      <span className="font-semibold text-primary">52%</span>
                    </div>
                  </div>
                </div>

                {/* Ad Placeholder 2 - Mobile Optimized */}
                <div className="bg-muted/30 border border-dashed border-muted-foreground/20 rounded-lg p-6 flex flex-col items-center justify-center min-h-[180px] lg:min-h-[200px]">
                  <div className="text-muted-foreground text-xs text-center space-y-2">
                    <div className="w-12 h-12 mx-auto bg-muted rounded flex items-center justify-center mb-2">
                      <span className="text-2xl">📢</span>
                    </div>
                    <p className="font-medium">Ad Space</p>
                    <p className="text-xs opacity-70">300x250</p>
                  </div>
                </div>
              </div>
            </aside>

            {/* Notifications Panel - Right side on desktop, hidden on mobile */}
            {userLeagueState === 'active-user' && league?.id && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-32 h-[calc(100vh-12rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                  <LeagueNotifications leagueId={league.id} />
                </div>
              </aside>
            )}
          </div>
        </div>
        
        <PlayerStatsModal
          player={selectedPlayer}
          isOpen={isPlayerDialogOpen}
          onClose={() => setIsPlayerDialogOpen(false)}
        />
      </main>
      <Footer />
    </div>
  );
};

export default Matchup;
