import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { DemoDataService } from '@/services/DemoDataService';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamCard } from "@/components/matchup/TeamCard";
import { MatchupComparison } from "@/components/matchup/MatchupComparison";
import { MatchupScheduleSelector } from "@/components/matchup/MatchupScheduleSelector";
import { ScoreCard } from "@/components/matchup/ScoreCard";
import { DailyPointsChart } from "@/components/matchup/DailyPointsChart";
import { MatchupHistory } from "@/components/matchup/MatchupHistory";
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
import { Loader2 } from 'lucide-react';
import LoadingScreen from '@/components/LoadingScreen';

const Matchup = () => {
  const { user, profile } = useAuth();
  const { userLeagueState } = useLeague();
  const { leagueId: urlLeagueId, weekId: urlWeekId } = useParams<{ leagueId?: string; weekId?: string }>();
  const navigate = useNavigate();
  
  // Debug: Log URL parameters
  console.log('[Matchup] URL parameters:', { urlLeagueId, urlWeekId });
  const [activeTab, setActiveTab] = useState("lineup");
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false); // Prevent concurrent loads

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

  // Demo data - shown to guests and logged-in users without leagues
  // Load from actual demo rosters instead of static data
  const [demoMyTeam, setDemoMyTeam] = useState<MatchupPlayer[]>([]);
  const [demoOpponentTeam, setDemoOpponentTeam] = useState<MatchupPlayer[]>([]);
  const [demoMyTeamSlotAssignments, setDemoMyTeamSlotAssignments] = useState<Record<string, string>>({});
  const [demoOpponentTeamSlotAssignments, setDemoOpponentTeamSlotAssignments] = useState<Record<string, string>>({});
  
  // Load demo matchup data from actual rosters
  useEffect(() => {
    if (userLeagueState === 'active-user') {
      setDemoMyTeam([]);
      setDemoOpponentTeam([]);
      setDemoMyTeamSlotAssignments({});
      setDemoOpponentTeamSlotAssignments({});
      setLoading(false);
      return;
    }
    
    const loadDemoMatchup = async () => {
      try {
        setLoading(true);
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
        setLoading(false);
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
      }
    };
    
    loadDemoMatchup();
  }, [userLeagueState]);

  const toHockeyPlayer = (p: MatchupPlayer): HockeyPlayer => ({
    id: p.id.toString(),
    name: p.name,
    position: p.position,
    number: 0,
    starter: p.isStarter,
    stats: {
      goals: p.stats.goals,
      assists: p.stats.assists,
      points: p.points,
      plusMinus: 0,
      shots: p.stats.sog,
      gamesPlayed: p.stats.gamesPlayed || 0,
      hits: 0,
      blockedShots: p.stats.blk,
      wins: 0,
      losses: 0,
      otl: 0,
      gaa: 0,
      savePct: 0,
      shutouts: 0
    },
    team: p.team,
    teamAbbreviation: p.team,
    status: p.status === 'Yet to Play' ? null : (p.status === 'In Game' ? 'Active' : null),
    image: undefined,
    projectedPoints: 0
  });

  const handlePlayerClick = (player: MatchupPlayer) => {
    setSelectedPlayer(toHockeyPlayer(player));
    setIsPlayerDialogOpen(true);
  };

  const [updates] = useState<string[]>([
    "Connor McDavid scored a goal! +5 points.",
    "David Pastrnak with an assist! +3 points.",
    "Igor Shesterkin made a save! +0.2 points.",
    "Adam Fox with a power play assist! +4 points."
  ]);

  const getTeamPoints = (team: MatchupPlayer[]) => {
    return team.reduce((sum, player) => sum + player.points, 0).toFixed(1);
  };

  // Use real data if active user, otherwise demo data
  // CRITICAL: Ensure myTeam is always the user's team (left side)
  // and opponentTeamPlayers is always the opponent (right side)
  const displayMyTeam = userLeagueState === 'active-user' ? myTeam : demoMyTeam;
  const displayOpponentTeam = userLeagueState === 'active-user' ? opponentTeamPlayers : demoOpponentTeam;
  const displayMyTeamSlotAssignments = userLeagueState === 'active-user' ? myTeamSlotAssignments : demoMyTeamSlotAssignments;
  const displayOpponentTeamSlotAssignments = userLeagueState === 'active-user' ? opponentTeamSlotAssignments : demoOpponentTeamSlotAssignments;

  // DEBUG: Log team data for verification
  if (user && myTeam.length > 0 && opponentTeamPlayers.length > 0) {
    console.log('Display teams:', {
      myTeamName: userTeam?.team_name,
      myTeamPlayerCount: displayMyTeam.length,
      opponentTeamName: opponentTeam?.team_name,
      opponentTeamPlayerCount: displayOpponentTeam.length,
      myStartersCount: displayMyTeam.filter(p => p.isStarter).length,
      opponentStartersCount: displayOpponentTeam.filter(p => p.isStarter).length
    });
  }

  const myTeamPoints = getTeamPoints(displayMyTeam);
  const opponentTeamPoints = getTeamPoints(displayOpponentTeam);

  const myStarters = displayMyTeam.filter(p => p.isStarter);
  const myBench = displayMyTeam.filter(p => !p.isStarter);
  const opponentStarters = displayOpponentTeam.filter(p => p.isStarter);
  const opponentBench = displayOpponentTeam.filter(p => !p.isStarter);

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  
  // Calculate daily points - only if matchup has started and has scores
  const hasMatchupData = currentMatchup && 
    (currentMatchup.status === 'in_progress' || currentMatchup.status === 'completed') &&
    (parseFloat(String(currentMatchup.team1_score)) > 0 || parseFloat(String(currentMatchup.team2_score)) > 0);
  
  // For demo/non-logged-in users, use empty arrays (will show empty state)
  const displayMyDailyPoints = user ? myDailyPoints : [];
  const displayOpponentDailyPoints = user ? opponentDailyPoints : [];


  // Load real matchup data for logged-in users with leagues
  useEffect(() => {
    if (!user || userLeagueState !== 'active-user') {
      setLoading(false);
      return;
    }

    const loadMatchupData = async () => {
      // Prevent concurrent loads
      if (loadingRef.current) {
        console.log('[Matchup] Load already in progress, skipping duplicate call...');
        return;
      }
      
      try {
        loadingRef.current = true;
        setLoading(true);
        setError(null);

        // Determine which league to use (from URL or first available)
        let targetLeagueId = urlLeagueId;
        
        if (!targetLeagueId) {
          // Get user's leagues if no leagueId in URL
          const { leagues: userLeagues, error: leaguesError } = await LeagueService.getUserLeagues(user.id);
          if (leaguesError) throw leaguesError;

          if (userLeagues.length === 0) {
            setError('You are not in any leagues');
            setLoading(false);
            return;
          }

          // Use first league and redirect to URL with leagueId
          const currentLeague = userLeagues[0];
          targetLeagueId = currentLeague.id;
          
          // Redirect to URL with leagueId (and weekId if available)
          const weekParam = urlWeekId ? `/${urlWeekId}` : '';
          navigate(`/matchup/${targetLeagueId}${weekParam}`, { replace: true });
          return;
        }

        // Get league data
        const { leagues: userLeagues, error: leagueError } = await LeagueService.getUserLeagues(user.id);
        if (leagueError) throw leagueError;
        
        const currentLeague = userLeagues.find((l: League) => l.id === targetLeagueId);
        if (!currentLeague) {
          setError('League not found');
          setLoading(false);
          return;
        }

        setLeague(currentLeague);

        // Check if draft is completed
        if (currentLeague.draft_status !== 'completed') {
          setError('Draft must be completed before viewing matchups');
          setLoading(false);
          return;
        }

        // Get user's team
        const { team: userTeamData } = await LeagueService.getUserTeam(currentLeague.id, user.id);
        if (!userTeamData) {
          setError('You do not have a team in this league');
          setLoading(false);
          return;
        }
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
            navigate(`/matchup/${targetLeagueId}/${weekToShow}`, { replace: true });
          }
        } else {
          // No week in URL, use current week
          const currentWeek = getCurrentWeekNumber(firstWeek);
          weekToShow = weeks.includes(currentWeek) ? currentWeek : weeks[0] || 1;
          navigate(`/matchup/${targetLeagueId}/${weekToShow}`, { replace: true });
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
            setIsInitialLoad(false);
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
                  setIsInitialLoad(false);
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
                  setIsInitialLoad(false);
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
                  setIsInitialLoad(false);
                  return;
                }
                
                console.log('[Matchup] Successfully regenerated and verified matchup exists');
                // Matchup now exists, continue with normal flow below
              } else {
                setError(`No matchup found for week ${weekToShow}. The matchup generation may have failed. Please try refreshing the page.`);
                setLoading(false);
                setIsInitialLoad(false);
                return;
              }
            } else {
              setError(`No matchup found for week ${weekToShow}. The matchup generation may have failed. Please try refreshing the page.`);
              setLoading(false);
              setIsInitialLoad(false);
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
              setIsInitialLoad(false);
              return;
            }
            
            console.log('[Matchup] Verified matchup exists after forced regeneration');
          }
          
          console.log('[Matchup] Verified matchup exists for week', weekToShow);
        } else {
          console.log('[Matchup] Matchup already exists for week', weekToShow, '- skipping generation');
        }

        // Load matchup data using unified method
        const userTimezone = profile?.timezone || 'America/Denver';
        console.log('[Matchup] Calling getMatchupData with:', {
          leagueId: targetLeagueId,
          userId: user.id,
          weekNumber: weekToShow,
          timezone: userTimezone
        });
        const { data: matchupData, error: matchupError } = await MatchupService.getMatchupData(
          targetLeagueId,
          user.id,
          weekToShow,
          userTimezone
        );

        if (matchupError) {
          console.error('[Matchup] Error getting matchup data:', matchupError);
          // If it's a "no matchup found" error, the matchups may not have been generated yet
          if (matchupError.message?.includes('No matchup found')) {
            console.log('[Matchup] No matchup found for week', weekToShow, '- matchups may need to be generated');
            setError(`No matchup found for week ${weekToShow}. Please try refreshing the page.`);
            setLoading(false);
            return;
          }
          throw matchupError;
        }
        if (!matchupData) {
          setError(`No matchup found for week ${weekToShow}`);
          setLoading(false);
          return;
        }

        // Check if this is a playoff week and redirect
        if (matchupData.isPlayoffWeek) {
          navigate(`/league/${targetLeagueId}/playoffs`);
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

        // Get opponent team object for display
        if (matchupData.opponentTeam) {
          const { teams } = await LeagueService.getLeagueTeams(targetLeagueId);
          const oppTeam = teams.find(t => t.id === matchupData.opponentTeam!.id);
          setOpponentTeam(oppTeam || null);
        } else {
          setOpponentTeam(null);
        }

      } catch (err: any) {
        console.error('[Matchup] Error loading matchup data:', err);
        console.error('[Matchup] Error details:', {
          message: err.message,
          stack: err.stack,
          name: err.name
        });
        
        // Only set error if it's not a transient/network error that might resolve on retry
        const errorMessage = err.message || 'Failed to load matchup data';
        const isTransientError = errorMessage.includes('network') || 
                                 errorMessage.includes('timeout') ||
                                 errorMessage.includes('fetch');
        
        if (!isTransientError) {
          setError(errorMessage);
        } else {
          console.log('[Matchup] Transient error detected, will retry on next load');
        }
      } finally {
        setLoading(false);
        setIsInitialLoad(false); // Mark that initial load is complete
        loadingRef.current = false; // Release lock
      }
    };

    loadMatchupData();
  }, [user, userLeagueState, urlLeagueId, urlWeekId, navigate, profile]);

  // Refresh matchup when page becomes visible (e.g., navigating back from roster page)
  useEffect(() => {
    if (!user || !league || !userTeam || !urlLeagueId || !urlWeekId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Page became visible - clear cache and reload by triggering URL change
        console.log('[Matchup] Page visible, refreshing matchup data...');
        MatchupService.clearRosterCache(userTeam.id, league.id);
        // Trigger reload by navigating to same URL
        navigate(`/matchup/${urlLeagueId}/${urlWeekId}`, { replace: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user, league, userTeam, urlLeagueId, urlWeekId, navigate]);


  // Handle week selection - updates URL which triggers data reload
  const handleWeekChange = (weekNumber: number) => {
    if (!league) {
      console.warn('[Matchup] handleWeekChange called but league is not set');
      return;
    }
    console.log('[Matchup] handleWeekChange called, navigating to week:', weekNumber, 'for league:', league.id);
    // Update URL, which will trigger useEffect to reload data
    navigate(`/matchup/${league.id}/${weekNumber}`);
  };
  
  // Refresh matchup data (useful after making lineup changes on roster page)
  const refreshMatchup = () => {
    if (!league || !userTeam || !urlLeagueId || !urlWeekId) return;
    // Clear all caches to force fresh data
    MatchupService.clearRosterCache();
    // Reload by navigating to same URL
    navigate(`/matchup/${urlLeagueId}/${urlWeekId}`, { replace: true });
  };

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
                  {(userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') && (
                    <div className="flex gap-1.5 bg-primary/10 p-1 rounded-lg border border-primary/20 flex-wrap">
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-fantasy-primary hover:bg-fantasy-primary/10">Dec 1-7</Button>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium bg-fantasy-primary text-white shadow-sm hover:bg-fantasy-primary/90">Dec 8-14</Button>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-fantasy-primary hover:bg-fantasy-primary/10">Dec 15-21</Button>
                    </div>
                  )}
                </div>
              </div>
          
          {/* Show LoadingScreen on initial load (route navigation) - Suspense handles the transition */}
          {loading && isInitialLoad && (
            <LoadingScreen
              character="citrus"
              message="Loading NHL Matchups..."
            />
          )}
          
          {loading && !isInitialLoad && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Loading matchup...</p>
            </div>
          )}
          
          {!loading && error && userLeagueState === 'active-user' && (
            <div className="text-center py-20">
              <p className="text-destructive text-lg">{error}</p>
            </div>
          )}
          
          {userLeagueState === 'logged-in-no-league' && !loading && (
            <div className="py-12">
              <LeagueCreationCTA 
                title="Your Matchup Awaits"
                description="Create your league to start competing in weekly matchups, track your team's performance, and climb the standings."
              />
            </div>
          )}

          {!loading && (
            (userLeagueState === 'guest' && (demoMyTeam.length > 0 || demoOpponentTeam.length > 0)) ||
            (userLeagueState === 'active-user' && !error) ||
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
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
            <TabsList className="w-full justify-start border-b-2 border-primary/20 bg-transparent p-0 rounded-none h-auto gap-1">
              <TabsTrigger 
                value="lineup" 
                className="rounded-t-md border-b-3 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:border-fantasy-primary data-[state=active]:text-fantasy-primary data-[state=active]:bg-transparent transition-all hover:text-fantasy-primary/80"
              >
                Lineup
              </TabsTrigger>
              <TabsTrigger 
                value="dailyPoints" 
                className="rounded-t-md border-b-3 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:border-fantasy-secondary data-[state=active]:text-fantasy-secondary data-[state=active]:bg-transparent transition-all hover:text-fantasy-secondary/80"
              >
                Daily Points
              </TabsTrigger>
              <TabsTrigger 
                value="matchupHistory" 
                className="rounded-t-md border-b-3 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:border-fantasy-tertiary data-[state=active]:text-fantasy-tertiary data-[state=active]:bg-transparent transition-all hover:text-fantasy-tertiary/80"
              >
                History
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="lineup" className="mt-6 matchup-wrapper" style={{ boxSizing: 'border-box', padding: 0, margin: 0 }}>
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
                <MatchupComparison
                  userStarters={myStarters}
                  opponentStarters={opponentStarters}
                  userBench={myBench}
                  opponentBench={opponentBench}
                  userSlotAssignments={displayMyTeamSlotAssignments}
                  opponentSlotAssignments={displayOpponentTeamSlotAssignments}
                  onPlayerClick={handlePlayerClick}
                />
              )}
            </TabsContent>
            
            <TabsContent value="dailyPoints" className="mt-8">
              <DailyPointsChart
                dayLabels={dayLabels}
                myDailyPoints={displayMyDailyPoints}
                opponentDailyPoints={displayOpponentDailyPoints}
                hasData={hasMatchupData}
              />
            </TabsContent>
            
            <TabsContent value="matchupHistory" className="mt-8">
              <MatchupHistory
                leagueId={league?.id}
                userTeamId={userTeam?.id}
                opponentTeamId={opponentTeam?.id}
                userTeamName={userTeam?.team_name}
                opponentTeamName={opponentTeam?.team_name}
                firstWeekStart={firstWeekStart}
              />
            </TabsContent>
          </Tabs>
          
          <LiveUpdates updates={updates} />
            </>
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
