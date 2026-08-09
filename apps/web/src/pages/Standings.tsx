import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { HockeyFooter, StormyLoading } from '@/components/citrus2';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import MobileMenuButton from '@/components/MobileMenuButton';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LeagueService, League, Team, getLeagueFormat } from '@/services/LeagueService';
import type { LeagueSettings } from '@/types/leagueTypes';
import { DraftService } from '@/services/DraftService';
import { PlayerService } from '@/services/PlayerService';
import { DemoLeagueService, DEMO_LEAGUE_ID_FOR_GUESTS } from '@/services/DemoLeagueService';
import { MatchupService } from '@/services/MatchupService';
import { CURRENT_SEASON } from '@/utils/seasonConstants';
import { RefreshCw } from 'lucide-react';
import {
  type ScoringFormat,
  type LeagueType,
  SCORING_FORMAT_LABELS,
  FORMAT_HAS_MATCHUPS,
  AVAILABLE_CATEGORIES,
  DEFAULT_ROTO_CATEGORIES,
  extractFormatSettings,
} from '@/types/leagueTypes';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';

import { PlayoffService, type PlayoffPictureTeam, type PlayoffBracket as BracketType } from '@/services/PlayoffService';
import { logger } from '@/utils/logger';
// Citrus decorative imports removed — cleaner layout
import LeagueNotifications from '@/components/matchup/LeagueNotifications';

interface StandingsTeam {
  id: string;
  name: string;
  owner: string;
  logo: string;
  record: { wins: number; losses: number; ties: number };
  points: number;
  pointsFor: number;
  pointsAgainst: number;
  streak: string;
  winPercentage: number;
  last5: { wins: number; losses: number; ties: number };
  gamesPlayed?: number; // For PPG format
  categoryRanks?: Record<string, number>; // For Roto: per-category ranking points
  categoryRecord?: Record<string, { wins: number; losses: number; ties: number }>; // For H2H-Cat
}

const Standings = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, activeLeague, isChangingLeague } = useLeague();
  const { toast } = useToast();
  const [season, setSeason] = useState(String(CURRENT_SEASON));
  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<StandingsTeam[]>([]);
  const [leagueTeams, setLeagueTeams] = useState<(Team & { owner_name?: string })[]>([]);
  const [leagueFormat, setLeagueFormat] = useState<{ leagueType: LeagueType; scoringFormat: ScoringFormat; playoffTeams: number }>({ leagueType: 'fantasy', scoringFormat: 'h2h-points', playoffTeams: 6 });
  const [leagueCategories, setLeagueCategories] = useState<string[]>([]);
  const [playoffPictureTeams, setPlayoffPictureTeams] = useState<PlayoffPictureTeam[]>([]);
  const [playoffBracket, setPlayoffBracket] = useState<BracketType | null>(null);
  const [playoffPictureLoaded, setPlayoffPictureLoaded] = useState(false);
  const hasInitializedRef = useRef(false);
  const navigate = useNavigate();

  // Derived format flags
  const hasMatchups = FORMAT_HAS_MATCHUPS[leagueFormat.scoringFormat] ?? true;
  const isRoto = leagueFormat.scoringFormat === 'roto';
  const isPPG = leagueFormat.scoringFormat === 'points-per-game';
  const isSeasonPoints = leagueFormat.scoringFormat === 'total-points' || isPPG;
  const isPool = leagueFormat.leagueType !== 'fantasy';
  const isCategories = leagueFormat.scoringFormat === 'h2h-categories';

  // Auto-complete matchups and load standings
  useEffect(() => {
    // Skip if league is changing
    if (isChangingLeague) {
      return;
    }
    
    const loadStandings = async () => {
      // Initialize loading state
      setLoading(true);
      
      try {
        // State 1: Guest - show REAL demo league data from database
        // State 2: Logged in, no league - show REAL demo league data (will show CTAs in UI)
        if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
          // Load demo league data via service
          const { data: demoLeagueData, error: leagueError } = await DemoLeagueService.getDemoLeague();

          if (leagueError || !demoLeagueData) {
            logger.error('[Standings] Error loading demo league:', leagueError);
            setTeams([]);
            setLoading(false);
            return;
          }

          const demoLeague = demoLeagueData as League;

          // Get teams from the demo league
          const { data: demoTeamsData, error: teamsError } = await DemoLeagueService.getDemoTeams();

          if (teamsError || (demoTeamsData as unknown[]).length === 0) {
            logger.error('[Standings] Error loading demo teams:', teamsError);
            setTeams([]);
            setLoading(false);
            return;
          }

          const demoTeamsFromDb = demoTeamsData as Team[];

          // Get draft picks for calculating team stats
          const { data: draftPicksData } = await DemoLeagueService.getDemoDraftPicks();

          const draftPicks = draftPicksData as Array<{ team_id: string; player_id: string }>;
          
          // Get all players
          const allPlayers = await PlayerService.getAllPlayers();
          
          // Calculate team standings from real data
          const teamStats = await LeagueService.calculateTeamStandings(
            DEMO_LEAGUE_ID_FOR_GUESTS,
            demoTeamsFromDb,
            draftPicks,
            allPlayers
          );
          
          // Get owner names from LEAGUE_TEAMS_DATA
          const { LEAGUE_TEAMS_DATA } = await import('@/services/LeagueService');
          
          // Convert to standings format with real calculated stats
          const standingsTeams: StandingsTeam[] = demoTeamsFromDb.map((team, index) => {
            const stats = teamStats[team.id] || {
              pointsFor: 0,
              pointsAgainst: 0,
              wins: 0,
              losses: 0,
              ties: 0,
              streak: '-',
              last5: { wins: 0, losses: 0, ties: 0 }
            };

            const teamData = LEAGUE_TEAMS_DATA[index];

            const totalGames = (stats.wins || 0) + (stats.losses || 0) + (stats.ties || 0);
            const winPercentage = totalGames > 0
              ? ((stats.wins || 0) / totalGames) * 100
              : 0;

            return {
              id: team.id,
              name: team.team_name,
              owner: teamData?.owner || 'Demo Owner',
              logo: team.team_name.substring(0, 2).toUpperCase(),
              record: { wins: stats.wins, losses: stats.losses, ties: stats.ties || 0 },
              points: stats.pointsFor,
              pointsFor: parseFloat((stats.pointsFor || 0).toFixed(1)),
              pointsAgainst: parseFloat((stats.pointsAgainst || 0).toFixed(1)),
              streak: stats.streak || '-',
              winPercentage: winPercentage !== undefined && !isNaN(winPercentage) ? parseFloat(winPercentage.toFixed(1)) : 0,
              last5: { wins: stats.last5?.wins || 0, losses: stats.last5?.losses || 0, ties: stats.last5?.ties || 0 },
            };
          });

          setTeams(standingsTeams);
          setLoading(false);
          return;
        }

        // State 3: Active user - load real data
        if (userLeagueState === 'active-user' && user) {
          // Get user's leagues first
          const { leagues: userLeagues, error: leaguesError } = await LeagueService.getUserLeagues(user.id);
          if (leaguesError) throw leaguesError;

          if (userLeagues.length === 0) {
            // This shouldn't happen if userLeagueState is 'active-user', but handle gracefully
            setTeams([]);
            setLeagues([]);
            setLoading(false);
            return;
          }

          setLeagues(userLeagues);
          // Use activeLeagueId from LeagueContext (no local selectedLeagueId state needed)
          const leagueToUse = activeLeagueId || userLeagues[0].id;

          // CRITICAL: Auto-complete matchups and update scores BEFORE calculating standings
          // We MUST wait for scores to be updated before calculating standings
          // Otherwise standings will use old/wrong scores from the database
          // NOTE: If auto_complete_matchups fails, we still proceed with standings calculation
          // to ensure the page renders even if the RPC has issues
          try {
            // First, auto-complete matchups (this also updates scores for completed weeks)
            const { error: autoCompleteError } = await MatchupService.autoCompleteMatchups();
            if (autoCompleteError) {
              // Don't block standings load if auto-complete fails - continue with score updates and standings calculation
            }
            
            // CRITICAL: Update all matchup scores and WAIT for completion
            // This uses the EXACT same calculation as the matchup tab (sum of 7 daily scores)
            // We MUST wait for this to complete before calculating standings
            const { error: updateScoresError, updatedCount } = await MatchupService.updateMatchupScores(leagueToUse);
            if (updateScoresError) {
              logger.error('[Standings] Failed to update matchup scores:', updateScoresError);
              // Still show standings, but they may be outdated
            }
          } catch (error) {
            logger.error('[Standings] Exception updating scores:', error);
            // Still show standings, but they may be outdated
          }

          // Get league to check draft status and format
          const { league: leagueData, error: leagueError } = await LeagueService.getLeague(leagueToUse, user.id);
          if (leagueError) throw leagueError;

          // Detect league format for conditional rendering
          if (leagueData) {
            const fmt = getLeagueFormat(leagueData);
            const playoffTeams = (leagueData.settings as LeagueSettings)?.playoffTeams ?? 6;
            setLeagueFormat({ leagueType: fmt.leagueType, scoringFormat: fmt.scoringFormat, playoffTeams });
          }

          // Get teams for selected league with owner information
          const { teams: leagueTeamsData, error: teamsError } = await LeagueService.getLeagueTeamsWithOwners(leagueToUse);
          if (teamsError) throw teamsError;

          // Store league teams for user team checking
          setLeagueTeams(leagueTeamsData);

          // Only calculate stats if draft is completed
          let teamStats: Record<string, { pointsFor: number; pointsAgainst: number; wins: number; losses: number; ties?: number; streak?: string; last5?: { wins: number; losses: number; ties?: number }; gamesPlayed?: number; categoryRanks?: Record<string, number>; categoryRecord?: Record<string, { wins: number; losses: number; ties: number }> }> = {};

          if (leagueData && leagueData.draft_status === 'completed') {
            // Get draft picks for this league to calculate team stats
            const { picks: draftPicks } = await DraftService.getDraftPicks(leagueToUse, user.id);

            if (draftPicks && draftPicks.length > 0) {
              // Get all players to calculate points
              const allPlayers = await PlayerService.getAllPlayers();

              // Choose data path based on scoring format
              const fmt = getLeagueFormat(leagueData);
              const fmtSettings = extractFormatSettings(leagueData.settings || {});
              const isNonMatchup = !FORMAT_HAS_MATCHUPS[fmt.scoringFormat];

              // Build category metadata for H2H-Cat and Roto
              const categoryMeta: Record<string, { higherIsBetter: boolean }> = {};
              AVAILABLE_CATEGORIES.forEach(c => {
                categoryMeta[c.id] = { higherIsBetter: c.higherIsBetter };
              });
              const leagueCats = fmtSettings.categories || [...DEFAULT_ROTO_CATEGORIES];
              setLeagueCategories(leagueCats);
              const leagueCategories = leagueCats;

              if (fmt.scoringFormat === 'h2h-categories') {
                // H2H Categories: each stat is a separate W/L/T
                teamStats = await LeagueService.calculateCategoryStandings(
                  leagueToUse,
                  leagueTeamsData,
                  leagueCategories,
                  categoryMeta
                );
              } else if (fmt.scoringFormat === 'roto') {
                // Roto: season-long category rankings summed
                teamStats = await LeagueService.calculateRotoStandingsFromDB(
                  leagueToUse,
                  leagueTeamsData,
                  draftPicks,
                  allPlayers,
                  leagueCategories,
                  categoryMeta
                );
              } else if (isNonMatchup) {
                // Total Points / PPG: no matchups, just cumulative points
                teamStats = await LeagueService.calculateSeasonPointsStandings(
                  leagueToUse,
                  leagueTeamsData,
                  draftPicks,
                  allPlayers
                );
              } else {
                // H2H Points / Best Ball: use matchup-based standings
                teamStats = await LeagueService.calculateTeamStandings(
                  leagueToUse,
                  leagueTeamsData,
                  draftPicks,
                  allPlayers
                );
              }
            }
          }

          // Convert database teams to standings format with calculated stats
          const standingsTeams: StandingsTeam[] = leagueTeamsData.map((team, index) => {
            const stats = teamStats[team.id] || {
              pointsFor: 0,
              pointsAgainst: 0,
              wins: 0,
              losses: 0,
              ties: 0,
              streak: '-',
              last5: { wins: 0, losses: 0, ties: 0 },
              gamesPlayed: 0,
            };

            // Calculate win percentage (ties count as half a win)
            const totalGames = (stats.wins || 0) + (stats.losses || 0) + ((stats.ties as number) || 0);
            const winPercentage = totalGames > 0
              ? (((stats.wins || 0) + ((stats.ties as number) || 0) * 0.5) / totalGames) * 100
              : 0;

            // For PPG: use gamesPlayed from season standings if available
            const gp = stats.gamesPlayed || totalGames || 0;

            return {
              id: team.id,
              name: team.team_name,
              owner: (team as { owner_name?: string }).owner_name || (team.owner_id ? 'User' : 'AI Team'),
              logo: team.team_name.substring(0, 2).toUpperCase(),
              record: { wins: stats.wins, losses: stats.losses, ties: (stats.ties as number) || 0 },
              points: stats.pointsFor,
              pointsFor: parseFloat((stats.pointsFor || 0).toFixed(1)),
              pointsAgainst: parseFloat((stats.pointsAgainst || 0).toFixed(1)),
              streak: stats.streak || '-',
              winPercentage: winPercentage !== undefined && !isNaN(winPercentage) ? parseFloat(winPercentage.toFixed(1)) : 0,
              last5: { wins: stats.last5?.wins || 0, losses: stats.last5?.losses || 0, ties: stats.last5?.ties || 0 },
              gamesPlayed: gp,
              categoryRanks: stats.categoryRanks || undefined,
              categoryRecord: stats.categoryRecord || undefined,
            } as StandingsTeam;
          });

          setTeams(standingsTeams);

          // Load playoff picture data (non-blocking)
          // Use local fmt variable since hasMatchups uses state that may not be updated yet
          const localHasMatchups = leagueData ? (FORMAT_HAS_MATCHUPS[getLeagueFormat(leagueData).scoringFormat] ?? true) : true;
          if (localHasMatchups && leagueToUse) {
            PlayoffService.getPlayoffPicture(leagueToUse).then(({ picture }) => {
              if (picture?.teams) setPlayoffPictureTeams(picture.teams);
              setPlayoffPictureLoaded(true);
            }).catch(() => setPlayoffPictureLoaded(true));

            PlayoffService.getBracket(leagueToUse).then(({ bracket: b }) => {
              if (b) setPlayoffBracket(b);
            }).catch(() => {});
          }
        } else {
          // No user or wrong state - set loading to false and show empty teams
          setTeams([]);
          setLeagues([]);
        }
      } catch (err: unknown) {
        logger.error('[Standings] Error loading standings:', err);
        toast({
          title: 'Unable to Load Standings',
          description: 'Please try refreshing the page.',
          variant: 'default',
        });
        // Fallback to empty teams on error - ensure component still renders
        setTeams([]);
        setLeagues([]);
      } finally {
        // CRITICAL: Always set loading to false to ensure component renders
        // Even if there were errors, we want to show the standings (or empty state)
        setLoading(false);
      }
    };

    // Only run if userLeagueState is defined (not loading)
    if (userLeagueState !== undefined) {
      loadStandings();
    } else {
      // If userLeagueState is still loading, keep loading state
      setLoading(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadStandings is inline; listed deps are the actual triggers for data refresh
  }, [user?.id, toast, userLeagueState, activeLeagueId]);

  // Animation observer setup
  // CRITICAL: Force animate class immediately for standings content to ensure visibility
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate');
          }
        });
      },
      { threshold: 0.1 }
    );

    const animatedElements = document.querySelectorAll('.animated-element');
    animatedElements.forEach(el => {
      observer.observe(el);
      // CRITICAL FIX: Immediately add animate class to ensure visibility
      // The IntersectionObserver might not trigger if elements are already in viewport
      // This prevents the opacity-0 issue that makes content invisible
      setTimeout(() => {
        el.classList.add('animate');
      }, 50);
    });

    return () => {
      animatedElements.forEach(el => observer.unobserve(el));
    };
  }, [teams.length]); // Re-run when teams change to ensure new elements get animated
  
  // Sort teams by format-appropriate criteria (memoized)
  const sortedTeams = useMemo(() => [...teams].sort((a, b) => {
    // PPG: sort by average points per game (efficiency), not total
    if (isPPG) {
      const aGP = a.gamesPlayed || (a.record.wins + a.record.losses + a.record.ties) || 1;
      const bGP = b.gamesPlayed || (b.record.wins + b.record.losses + b.record.ties) || 1;
      const aPPG = a.pointsFor / aGP;
      const bPPG = b.pointsFor / bGP;
      if (bPPG !== aPPG) return bPPG - aPPG;
      return b.pointsFor - a.pointsFor; // Tiebreak by total points
    }
    // For season-long formats (roto, total points), sort by total points
    if (isRoto || isSeasonPoints) {
      return b.points - a.points;
    }
    // For H2H formats, sort by wins first, then by points
    if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
    return b.points - a.points;
  }), [teams, isRoto, isSeasonPoints, isPPG]);

  const selectedLeague = leagues.find(l => l.id === activeLeagueId);
  
  // Early return for loading - must be after all hooks are declared
  // CRITICAL: If teams exist, NEVER show LoadingScreen - content must render
  // This prevents the component from being stuck in loading state
  // UPDATED: More explicit check - only show LoadingScreen if we truly have no data
  // ABSOLUTE RULE: If teams.length > 0, NEVER show LoadingScreen, always render content
  const shouldShowLoadingScreen = teams.length === 0 && leagues.length === 0 && loading;
  
  // Apply minimum display time to prevent flash
  const displayLoading = useMinimumLoadingTime(shouldShowLoadingScreen, 800);

  // Redirect pool leagues to their pool page's standings tab
  if (isPool && activeLeagueId && leagueFormat.leagueType) {
    return <Navigate to={getPoolRoute(leagueFormat.leagueType, activeLeagueId, 'standings')} replace />;
  }
  
  if (displayLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F1F15]">
        <StormyLoading message="Loading the standings…" />
      </div>
    );
  }
  
  // CRITICAL: If we reach here, we MUST render content (even if loading is still true but we have data)
  // This ensures content is always visible when data exists
  // Force render content if we have teams, regardless of loading state

  return (
    <div className="min-h-screen bg-[#0F1F15] relative">
      {/* Desktop Navbar - Hidden on mobile */}
      <div className="hidden lg:block">
        <Navbar />
      </div>

      {/* MOBILE: Compact header with league context */}
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">Standings</h1>
          <div className="flex items-center gap-1">
            {(activeLeague?.name || leagueTeams.length > 0) && (
              <span className="text-xs font-jbmono text-white/45 truncate max-w-[120px]">
                {activeLeague?.name}{leagueTeams.length > 0 ? ` \u2022 ${leagueTeams.length} teams` : ''}
              </span>
            )}
            <MobileMenuButton />
          </div>
        </div>
      </div>

      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          {/* Desktop: Grid / Mobile: Single column */}
          <div className={cn(
            "flex flex-col lg:grid lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2",
            userLeagueState === 'active-user' && activeLeagueId
              ? "lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px]"
              : "lg:grid-cols-[200px_1fr] xl:grid-cols-[220px_1fr]"
          )}>
            {/* Scene hero — Lemon at the top of the league standings */}
            <div className="lg:col-start-2 lg:col-span-1 px-3 lg:px-6 pt-4 lg:pt-2 mb-6 order-0">
              <div className="relative w-full aspect-[24/9] sm:aspect-[28/9] rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
                <img
                  src="/mascots/scene-standings.webp"
                  alt="Lemon raising both arms on the championship podium with a leaderboard floating beside him"
                  className="w-full h-full object-cover"
                  loading="eager"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: 'linear-gradient(to top, rgba(15,31,21,0.85) 0%, transparent 45%)' }}
                />
                <div className="absolute bottom-4 left-5 sm:bottom-6 sm:left-8 z-10 max-w-[80%]">
                  <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-1.5 font-bold">
                    ✦ League Standings
                  </div>
                  <h1 className="font-sans font-black text-[1.5rem] sm:text-[2rem] md:text-[2.5rem] tracking-[-0.025em] text-pastel-cream leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                    Climb the <span className="text-pastel-orange">leaderboard</span>.
                  </h1>
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="min-w-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto px-3 lg:px-6 order-1 lg:order-2">
          
          {userLeagueState === 'logged-in-no-league' && (
            <div className="max-w-3xl mx-auto mb-12">
              <LeagueCreationCTA 
                title="Your Standings Awaits"
                description="Create your league to start tracking your team's position, competing for the top spot, and climbing the rankings."
              />
            </div>
          )}
          
          <div className="flex flex-col md:flex-row items-center justify-between max-w-5xl mx-auto mb-8">
            <div className="mb-4 md:mb-0 animated-element animate">
              <h2 className="text-2xl font-bold text-pastel-cream">
                {userLeagueState === 'active-user' && selectedLeague ? selectedLeague.name : 'CitrusSports League'}
              </h2>
              <p className="text-white/55">
                {leagueFormat.scoringFormat !== 'h2h-points' && (
                  <span className="inline-flex items-center gap-1.5 mr-2 px-2 py-0.5 rounded-full text-xs font-bold bg-pastel-orange/15 text-pastel-orange-soft ring-1 ring-pastel-orange/30">
                    {SCORING_FORMAT_LABELS[leagueFormat.scoringFormat]}
                  </span>
                )}
                Regular Season Standings
              </p>
              {/* League selector removed - use global Navbar selector instead */}
            </div>
            
            <div className="flex items-center space-x-4 animated-element animate">
              <div className="w-40">
                <Select defaultValue={season} onValueChange={setSeason}>
                  <SelectTrigger className="w-full bg-[#1A2A20] rounded-full border-white/15 text-pastel-cream hover:border-pastel-orange/40 transition-colors">
                    <SelectValue placeholder="Select Season" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]">
                    {Array.from({ length: 3 }, (_, i) => CURRENT_SEASON - 2 + i).map(year => (
                      <SelectItem key={year} value={String(year)}>{year} Season</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {userLeagueState === 'active-user' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-white/15 bg-[#1A2A20] text-pastel-cream hover:bg-pastel-orange/10 hover:border-pastel-orange/40 hover:text-pastel-orange-soft"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      // Auto-complete matchups
                      if (activeLeagueId) {
                        await MatchupService.autoCompleteMatchups();
                      }
                      // Reload standings
                      window.location.reload();
                    } catch (error) {
                      logger.error('[Standings] Error refreshing:', error);
                      toast({
                        title: "Refresh Didn't Take",
                        description: "Couldn't refresh the standings — try again in a moment.",
                        variant: 'destructive',
                      });
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  Refresh
                </Button>
              )}
              <Button variant="outline" size="sm" className="rounded-full border-white/15 bg-[#1A2A20] text-pastel-cream hover:bg-pastel-orange/10 hover:border-pastel-orange/40 hover:text-pastel-orange-soft">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export
              </Button>
            </div>
          </div>
          
          <Card className="max-w-5xl mx-auto overflow-hidden bg-[#1A2A20] !border-white/10 ring-1 ring-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] p-0" style={{ visibility: 'visible', opacity: 1 }}>
            <div className="overflow-x-auto" style={{ visibility: 'visible', opacity: 1 }}>
              <Table style={{ visibility: 'visible', opacity: 1 }}>
                <thead className="bg-black/20 border-b border-white/10">
                  <tr className="text-left">
                    <th className="px-3 sm:px-6 py-3 sm:py-4 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Rank</th>
                    <th className="px-3 sm:px-6 py-3 sm:py-4 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Team</th>
                    {hasMatchups && (
                      <>
                        <th className="px-3 sm:px-6 py-3 sm:py-4 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-center">
                          {isCategories ? 'Cat W-L-T' : 'Record'}
                        </th>
                        <th className="px-3 sm:px-6 py-3 sm:py-4 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-center">Win %</th>
                      </>
                    )}
                    <th className="px-3 sm:px-6 py-3 sm:py-4 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-right">
                      {isRoto ? 'Roto Pts' : isCategories ? 'Total PF' : 'PF'}
                    </th>
                    {hasMatchups && (
                      <th className="px-3 sm:px-6 py-3 sm:py-4 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-right">PA</th>
                    )}
                    {isSeasonPoints && (
                      <th className="px-3 sm:px-6 py-3 sm:py-4 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-right">PPG</th>
                    )}
                    {hasMatchups && (
                      <>
                        <th className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-center">Streak</th>
                        <th className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-center">Last 5</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5" style={{ visibility: 'visible', opacity: 1 }}>
                  {sortedTeams.length === 0 ? (
                    <tr style={{ visibility: 'visible', opacity: 1 }}>
                      <td colSpan={hasMatchups ? 8 : (isSeasonPoints ? 4 : 3)} className="px-3 sm:px-6 py-12 text-center" style={{ visibility: 'visible', opacity: 1 }}>
                        <div className="flex flex-col items-center gap-3">
                          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">
                            ✦ Preseason
                          </div>
                          <p className="text-pastel-cream font-bold text-base">The league is still filling up.</p>
                          <p className="text-[13px] text-white/55 max-w-xs">Standings will light up as soon as the roster locks and week 1 puck drops.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sortedTeams.map((team, index) => {
                      // Check if it's user's team by comparing with user's ID from teams data
                      const isUserTeam = user && leagueTeams.some(t => t.id === team.id && t.owner_id === user.id);
                    
                    return (
                      <tr
                        key={team.id}
                        className={`${isUserTeam ? 'bg-pastel-orange/10 ring-1 ring-pastel-orange/20' : 'hover:bg-white/5 cursor-pointer'} transition-colors`}
                        style={{ visibility: 'visible', opacity: 1 }}
                        onClick={() => navigate(`/team/${team.id}`)}
                      >
                        <td className="px-3 sm:px-6 py-3 sm:py-4 font-medium">
                          <div className="flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold tabular-nums ${(hasMatchups && index < leagueFormat.playoffTeams) ? 'bg-pastel-orange text-[#581E00]' : 'text-white/45 bg-white/5'}`}>
                              {index + 1}
                            </span>
                            {hasMatchups && index < leagueFormat.playoffTeams && (() => {
                              const ppTeam = playoffPictureTeams.find(p => p.team_id === team.id);
                              if (ppTeam?.clinch_status === 'clinched') {
                                return <span className="text-xs font-bold text-pastel-sage-soft tracking-tight" title="Clinched playoff berth">x</span>;
                              }
                              return <span className="text-xs font-bold text-pastel-orange-soft tracking-tight">PO</span>;
                            })()}
                            {hasMatchups && index >= leagueFormat.playoffTeams && (() => {
                              const ppTeam = playoffPictureTeams.find(p => p.team_id === team.id);
                              if (ppTeam?.clinch_status === 'eliminated') {
                                return <span className="text-xs font-bold text-red-400 tracking-tight" title="Eliminated from playoff contention">e</span>;
                              }
                              return null;
                            })()}
                            {/* Roto: Co-champion label when tied at 1st */}
                            {isRoto && index === 0 && sortedTeams.length > 1 && sortedTeams[1].points === team.points && (
                              <span className="text-[10px] font-bold text-pastel-orange-soft bg-pastel-orange/15 ring-1 ring-pastel-orange/30 px-1.5 py-0.5 rounded font-jbmono uppercase tracking-wider">CO-CHAMP</span>
                            )}
                            {isRoto && index > 0 && sortedTeams[0].points === team.points && (
                              <span className="text-[10px] font-bold text-pastel-orange-soft bg-pastel-orange/15 ring-1 ring-pastel-orange/30 px-1.5 py-0.5 rounded font-jbmono uppercase tracking-wider">CO-CHAMP</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4" style={{ visibility: 'visible', opacity: 1 }}>
                          <div className="flex items-center gap-3" style={{ visibility: 'visible', opacity: 1 }}>
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-xs font-bold text-pastel-cream ring-1 ring-white/15 shadow-sm" style={{ visibility: 'visible', opacity: 1 }}>
                              {team.logo}
                            </div>
                            <div style={{ visibility: 'visible', opacity: 1 }}>
                              <div className={`font-bold ${isUserTeam ? 'text-pastel-orange' : 'text-pastel-cream'}`} style={{ visibility: 'visible', opacity: 1, color: isUserTeam ? undefined : 'inherit' }}>
                                {team.name}
                                {isUserTeam && <span className="ml-2 text-[9px] bg-pastel-orange/20 text-pastel-orange-soft ring-1 ring-pastel-orange/40 px-1.5 py-0.5 rounded-md font-jbmono uppercase tracking-wider font-bold">YOU</span>}
                              </div>
                              <div className="text-xs text-white/45" style={{ visibility: 'visible', opacity: 1 }}>{team.owner}</div>
                            </div>
                          </div>
                        </td>
                        {hasMatchups && (
                          <>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-center font-medium" style={{ visibility: 'visible', opacity: 1 }}>
                              {team.record.wins}-{team.record.losses}{team.record.ties > 0 ? `-${team.record.ties}` : ''}
                            </td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-center text-white/55 tabular-nums" style={{ visibility: 'visible', opacity: 1 }}>
                              {(team.winPercentage ?? 0).toFixed(1)}%
                            </td>
                          </>
                        )}
                        <td className="px-3 sm:px-6 py-3 sm:py-4 text-right font-bold tabular-nums" style={{ visibility: 'visible', opacity: 1 }}>
                          {team.pointsFor.toFixed(1)}
                        </td>
                        {hasMatchups && (
                          <td className="px-3 sm:px-6 py-3 sm:py-4 text-right font-medium tabular-nums text-white/55" style={{ visibility: 'visible', opacity: 1 }}>
                            {team.pointsAgainst.toFixed(1)}
                          </td>
                        )}
                        {isSeasonPoints && (
                          <td className="px-3 sm:px-6 py-3 sm:py-4 text-right font-medium tabular-nums text-white/55" style={{ visibility: 'visible', opacity: 1 }}>
                            {team.pointsFor > 0
                              ? (team.pointsFor / Math.max(1, team.gamesPlayed || (team.record.wins + team.record.losses + team.record.ties) || 1)).toFixed(1)
                              : '0.0'}
                          </td>
                        )}
                        {hasMatchups && (
                          <>
                            <td className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4 text-center" style={{ visibility: 'visible', opacity: 1 }}>
                              <span className={`inline-flex px-2.5 py-1 text-xs font-bold rounded-full border ${
                                team.streak.startsWith('W')
                                  ? 'bg-pastel-sage/20 text-pastel-sage-soft border-pastel-sage/30'
                                  : team.streak.startsWith('L')
                                  ? 'bg-red-500/15 text-red-300 border-red-500/30'
                                  : 'bg-white/5 text-white/55 border-white/10'
                              }`} style={{ visibility: 'visible', opacity: 1 }}>
                                {team.streak}
                              </span>
                            </td>
                            <td className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4 text-center text-white/55 font-medium tabular-nums" style={{ visibility: 'visible', opacity: 1 }}>
                              {team.last5.wins}-{team.last5.losses}{team.last5.ties > 0 ? `-${team.last5.ties}` : ''}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                  )}
                </tbody>
              </Table>
            </div>
          </Card>
          
          {/* Per-Category Roto Breakdown */}
          {isRoto && leagueCategories.length > 0 && sortedTeams.some(t => t.categoryRanks) && (
            <Card className="max-w-5xl mx-auto mt-6 overflow-hidden bg-[#1A2A20] !border-white/10 ring-1 ring-white/10 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] p-0">
              <CardHeader className="bg-pastel-orange/10 pb-3 border-b border-white/10">
                <CardTitle className="text-sm font-bold text-pastel-cream">Category Rankings</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <thead className="bg-black/20 border-b border-white/10">
                    <tr>
                      <th className="px-4 py-3 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-left">Team</th>
                      {leagueCategories.map(cat => {
                        const catDef = AVAILABLE_CATEGORIES.find(c => c.id === cat);
                        return (
                          <th key={cat} className="px-3 py-3 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-center" title={catDef?.name}>
                            {catDef?.abbreviation || cat}
                          </th>
                        );
                      })}
                      <th className="px-4 py-3 font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft font-bold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {sortedTeams.map((team) => {
                      const isUserTeam = user && leagueTeams.some(t => t.id === team.id && t.owner_id === user.id);
                      return (
                        <tr key={team.id} className={isUserTeam ? 'bg-pastel-orange/10' : 'hover:bg-white/5'}>
                          <td className="px-4 py-2 text-sm font-bold truncate max-w-[140px] text-pastel-cream">{team.name}</td>
                          {leagueCategories.map(cat => {
                            const rank = team.categoryRanks?.[cat];
                            const maxRank = sortedTeams.length;
                            const isTop = rank !== undefined && rank >= maxRank - 0.5;
                            return (
                              <td key={cat} className={`px-3 py-2 text-center text-sm tabular-nums ${isTop ? 'font-bold text-pastel-orange' : 'text-white/55'}`}>
                                {rank !== undefined ? rank.toFixed(1) : '-'}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 text-right text-sm font-bold tabular-nums text-pastel-cream">{team.pointsFor.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </Card>
          )}

          <div className="max-w-5xl mx-auto mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-[#1A2A20] !border-white/10 ring-1 ring-white/10 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] p-0 overflow-hidden h-full">
              <CardHeader className="bg-pastel-orange/10 pb-4 border-b border-white/10">
                <CardTitle className="text-lg font-bold text-pastel-cream flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-pastel-orange/15 ring-1 ring-pastel-orange/30 flex items-center justify-center text-pastel-orange">🏆</span>
                  {hasMatchups ? 'Playoff Picture' : 'Top Contenders'}
                  {playoffBracket && (
                    <span
                      className="ml-auto text-xs font-bold text-pastel-orange-soft hover:text-pastel-orange cursor-pointer hover:underline transition-colors"
                      onClick={() => activeLeagueId && navigate(`/league/${activeLeagueId}/playoffs`)}
                    >
                      View Bracket →
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 bg-[#1A2A20]">
                <div className="space-y-2">
                  {/* Use playoff picture data if available, otherwise fall back to sorted teams */}
                  {(playoffPictureLoaded && playoffPictureTeams.length > 0 ? playoffPictureTeams : sortedTeams.map((t, idx) => ({
                    team_id: t.id,
                    team_name: t.name,
                    rank: idx + 1,
                    wins: t.record.wins,
                    losses: t.record.losses,
                    ties: t.record.ties,
                    pf: t.pointsFor,
                    pa: t.pointsAgainst,
                    clinch_status: 'in_contention' as const,
                    magic_number: 0,
                  }))).map((team, i) => {
                    const isInPlayoffZone = hasMatchups && i < leagueFormat.playoffTeams;
                    const isBubble = hasMatchups && (i === leagueFormat.playoffTeams - 1 || i === leagueFormat.playoffTeams);
                    const clinchStatus = (team as PlayoffPictureTeam).clinch_status;
                    const magicNum = (team as PlayoffPictureTeam).magic_number;

                    return (
                      <div
                        key={team.team_id}
                        className={cn(
                          'flex items-center justify-between p-2.5 rounded-lg transition-colors',
                          isInPlayoffZone ? 'bg-pastel-sage/15 hover:bg-pastel-sage/25 ring-1 ring-pastel-sage/25' : 'bg-white/[0.03] hover:bg-white/5',
                          isBubble && 'border-l-2 border-pastel-orange/60',
                          clinchStatus === 'clinched' && 'bg-pastel-sage/20 border-l-2 border-pastel-sage',
                          clinchStatus === 'eliminated' && 'bg-red-500/10 opacity-60',
                          i === leagueFormat.playoffTeams - 1 && hasMatchups && 'border-b-2 border-dashed border-pastel-orange/40 rounded-b-none pb-3 mb-1',
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className={cn(
                            'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 tabular-nums',
                            isInPlayoffZone ? 'bg-pastel-orange text-[#581E00]' : 'text-white/55 bg-white/10',
                          )}>
                            {i + 1}
                          </div>
                          <div className="font-bold text-sm truncate text-pastel-cream">{team.team_name}</div>
                          {/* Clinch/elimination badges */}
                          {clinchStatus === 'clinched' && (
                            <span className="text-[9px] font-bold text-pastel-sage-soft bg-pastel-sage/15 ring-1 ring-pastel-sage/30 px-1.5 py-0.5 rounded shrink-0 font-jbmono uppercase tracking-wider">
                              CLINCHED
                            </span>
                          )}
                          {clinchStatus === 'eliminated' && (
                            <span className="text-[9px] font-bold text-red-300 bg-red-500/15 ring-1 ring-red-500/30 px-1.5 py-0.5 rounded shrink-0 font-jbmono uppercase tracking-wider">
                              ELIMINATED
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Magic number */}
                          {hasMatchups && clinchStatus === 'in_contention' && magicNum > 0 && isInPlayoffZone && (
                            <span className="text-[10px] font-bold text-pastel-orange-soft bg-pastel-orange/15 ring-1 ring-pastel-orange/30 px-1.5 py-0.5 rounded" title="Magic number to clinch">
                              M{magicNum}
                            </span>
                          )}
                          <div className="text-xs font-bold bg-[#0F1F15] ring-1 ring-white/15 text-pastel-cream px-2 py-1 rounded-md tabular-nums">
                            {hasMatchups
                              ? `${team.wins}-${team.losses}${team.ties > 0 ? `-${team.ties}` : ''}`
                              : `${team.pf?.toFixed?.(1) ?? '0.0'} pts`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <div className="flex items-center justify-between text-xs text-white/55">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-pastel-orange animate-pulse"></div>
                        {hasMatchups ? `Top ${leagueFormat.playoffTeams} qualify` : `Ranked by ${isRoto ? 'roto points' : 'total points'}`}
                      </div>
                      {hasMatchups && activeLeagueId && (
                        <button
                          className="font-bold text-pastel-orange-soft hover:text-pastel-orange hover:underline transition-colors"
                          onClick={() => navigate(`/league/${activeLeagueId}/playoffs`)}
                        >
                          Bracket →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-[#1A2A20] !border-white/10 ring-1 ring-white/10 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] p-0 overflow-hidden h-full">
              <CardHeader className="bg-pastel-orange/10 pb-4 border-b border-white/10">
                <CardTitle className="text-lg font-bold text-pastel-cream flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-pastel-orange/15 ring-1 ring-pastel-orange/30 flex items-center justify-center text-pastel-orange">🔥</span>
                  Points Leaders
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 bg-[#1A2A20]">
                <div className="space-y-3">
                  {[...teams].sort((a, b) => b.points - a.points).slice(0, 5).map((team) => (
                    <div key={team.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors ring-1 ring-transparent hover:ring-pastel-orange/30">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-white/10 ring-1 ring-white/15 flex items-center justify-center text-[10px] font-bold text-pastel-cream">
                          {team.logo}
                        </div>
                        <div className="font-bold text-sm text-pastel-cream">{team.name}</div>
                      </div>
                      <div className="font-bold text-pastel-orange tabular-nums">{team.points.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
              </div>
              </div>

            {/* Left Sidebar - Hidden on mobile */}
            <aside className="hidden lg:block w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                {/* Sleeper-style standings tips tile — replaces legacy AdSpace */}
                <div className="bg-[#1A2A20] ring-1 ring-pastel-orange/30 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-3">
                    ✦ Standings legend
                  </div>
                  <ul className="space-y-2 text-[11px] text-white/70 leading-relaxed">
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> W-L-T from head-to-head matchups</li>
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> PF / PA tracks total points scored / against</li>
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Streak shows current win or loss run</li>
                  </ul>
                </div>
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      {/* Footer - Hidden on mobile */}
      <div className="hidden lg:block">
        <HockeyFooter />
      </div>
    </div>
  );
};

export default Standings;
