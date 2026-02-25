import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { LeagueService, League, Team, LEAGUE_TEAMS_DATA } from '@/services/LeagueService';
import { DraftService, DraftPick, DraftState } from '@/services/DraftService';
import { PlayerService, Player } from '@/services/PlayerService';
import { AuctionDraftService } from '@/services/AuctionDraftService';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { DraftLobby } from '@/components/draft/DraftLobby';
import { DraftBoard } from '@/components/draft/DraftBoard';
import { PlayerPool } from '@/components/draft/PlayerPool';
import { TeamRosters } from '@/components/draft/TeamRosters';
import { DraftTimer } from '@/components/draft/DraftTimer';
import { DraftControls } from '@/components/draft/DraftControls';
import { DraftHistory } from '@/components/draft/DraftHistory';
import { DraftQueue } from '@/components/draft/DraftQueue';
import { RosterDepthChart } from '@/components/draft/RosterDepthChart';
import { DraftSnapshotView } from '@/components/draft/DraftSnapshotView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Clock, Trophy, History, CheckCircle, Loader2, Zap, Play, Pause, Camera, Trash2, Star } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import LoadingScreen from '@/components/LoadingScreen';
import { useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { useToast } from '@/hooks/use-toast';

// DraftPick interface is now imported from DraftService
// Team interface is now imported from LeagueService

interface DraftSettings {
  rounds: number;
  pickTimeLimit: number;
  draftOrder: 'standard' | 'serpentine' | 'custom';
  scoringFormat: 'standard' | 'points' | 'categories';
  customOrder?: string[]; // Optional custom team order
  effectiveOrder?: string[]; // The actual team order from DraftLobby (randomized/custom/default)
}

enum DraftPhase {
  LOBBY = 'lobby',
  ACTIVE = 'active',
  COMPLETED = 'completed'
}

const DraftRoom = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { userLeagueState, activeLeagueId } = useLeague();
  const { toast } = useToast();
  const leagueId = searchParams.get('league');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<(Team & { owner_name?: string })[]>([]);
  const [userTeam, setUserTeam] = useState<Team | null>(null);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [draftHistory, setDraftHistory] = useState<DraftPick[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);
  const [draftedPlayerIds, setDraftedPlayerIds] = useState<Set<string>>(new Set());
  
  const [draftPhase, setDraftPhase] = useState<DraftPhase>(DraftPhase.LOBBY);
  const [timeRemaining, setTimeRemaining] = useState(90); // Will be updated from league settings when loaded
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [isAuctionDraft, setIsAuctionDraft] = useState(false);
  const [auctionSessionId, setAuctionSessionId] = useState<string | null>(null);
  const [auctionNominationId, setAuctionNominationId] = useState<string | null>(null);
  const [auctionState, setAuctionState] = useState<{
    budgets: Array<{ team_id: string; team_name: string; remaining_budget: number; players_won: number }>;
    currentNomination: { id: string; player_id: string; player_name: string; current_high_bid: number; current_high_bidder_team_id: string | null; expires_at: string } | null;
    myBudget: number;
    isMyTurnToNominate: boolean;
    bidHistory?: Array<{ team_id: string; bid_amount: number; created_at: string }>;
  } | null>(null);
  const [bidAmount, setBidAmount] = useState(1);
  const [auctionTimeRemaining, setAuctionTimeRemaining] = useState<number | null>(null);
  const [draftSettings, setDraftSettings] = useState<DraftSettings>({
    rounds: 21, // Will be updated from league settings
    pickTimeLimit: 90,
    draftOrder: 'serpentine',
    scoringFormat: 'standard'
  });
  const [draftQueue, setDraftQueue] = useState<string[]>([]);
  const [randomizedTeamOrder, setRandomizedTeamOrder] = useState<string[] | null>(null);
  const [customDraftOrder, setCustomDraftOrder] = useState<string[] | null>(null);
  const [activeTab, setActiveTab] = useState<string>('players');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [orderedTeamsForBoard, setOrderedTeamsForBoard] = useState<(Team & { owner_name?: string })[]>([]);
  const [draftTimerStarted, setDraftTimerStarted] = useState(false);
  const [selectedPlayerForStats, setSelectedPlayerForStats] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [snapshotData, setSnapshotData] = useState<any>(null);
  const [snapshotCreatedAt, setSnapshotCreatedAt] = useState<string | undefined>(undefined);
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  // Calculate loading state for minimum loading time hook
  const actualLoading = loading || authLoading || (!user && userLeagueState !== 'guest' && userLeagueState !== 'logged-in-no-league');
  const displayLoading = useMinimumLoadingTime(actualLoading, 800);

  // ── Lookup Maps (O(1) instead of O(n) for .find()) ──────────────
  const teamsById = useMemo(() => {
    const map = new Map<string, Team & { owner_name?: string }>();
    teams.forEach(t => map.set(t.id, t));
    return map;
  }, [teams]);

  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    availablePlayers.forEach(p => map.set(p.id, p));
    return map;
  }, [availablePlayers]);

  // Helper: resolve team_order IDs to team objects via Map (O(n) total)
  const resolveTeamOrder = useCallback((teamOrder: string[]) => {
    return teamOrder
      .map((id: string) => teamsById.get(id))
      .filter((t): t is (Team & { owner_name?: string }) => t !== undefined);
  }, [teamsById]);

  // Memoize loadUserLeague to prevent infinite loops
  const loadUserLeague = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { leagues, error } = await LeagueService.getUserLeagues(user.id);
      
      if (error) {
        setError('Failed to load your leagues. Please try again.');
        setLoading(false);
        return;
      }

      if (leagues.length === 0) {
        navigate('/create-league');
        return;
      }

      // Use activeLeagueId from context if available, otherwise fall back to first league
      const targetLeague = activeLeagueId
        ? leagues.find(l => l.id === activeLeagueId) || leagues[0]
        : leagues[0];
      // Update URL using searchParams to avoid race condition
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set('league', targetLeague.id);
      navigate(`/draft-room?${newSearchParams.toString()}`, { replace: true });
    } catch (error: unknown) {
      setError('Failed to load your leagues. Please try again.');
      setLoading(false);
    }
  }, [user, navigate, searchParams]);

  /**
   * Generate demo draft picks for all 10 demo teams
   * Simulates a completed draft with realistic player distribution
   */
  const generateDemoDraftPicks = useCallback(async (): Promise<DraftPick[]> => {
    const allPlayers = await PlayerService.getAllPlayers();
    // Sort players by value (points) for realistic draft simulation
    const sortedPlayers = [...allPlayers].sort((a, b) => (b.points || 0) - (a.points || 0));
    
    const demoPicks: DraftPick[] = [];
    const rounds = 21;
    const teamsCount = 10;
    let playerIndex = 0;
    
    // Snake draft: Round 1 goes 1->10, Round 2 goes 10->1, etc.
    for (let round = 1; round <= rounds; round++) {
      const isOddRound = round % 2 === 1;
      const teamOrder = isOddRound 
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        : [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
      
      for (let teamIndex = 0; teamIndex < teamsCount; teamIndex++) {
        const teamId = teamOrder[teamIndex];
        const pickNumber = (round - 1) * teamsCount + teamIndex + 1;
        
        // Find next available player
        while (playerIndex < sortedPlayers.length && demoPicks.some(p => p.player_id === sortedPlayers[playerIndex].id)) {
          playerIndex++;
        }
        
        if (playerIndex < sortedPlayers.length) {
          const player = sortedPlayers[playerIndex];
          demoPicks.push({
            id: `demo-pick-${pickNumber}`,
            league_id: 'demo-league-id',
            round_number: round,
            pick_number: pickNumber,
            team_id: String(teamId),
            player_id: player.id,
            picked_at: new Date(Date.now() - (210 - pickNumber) * 30000).toISOString(), // Simulate picks over time
            draft_session_id: 'demo-session-id'
          });
          playerIndex++;
        }
      }
    }
    
    return demoPicks;
  }, []);

  // Memoize loadDraftData to prevent infinite loops
  const loadDraftData = useCallback(async () => {
    // ═══════════════════════════════════════════════════════════════════
    // DEMO STATE: Load REAL demo league from database (read-only)
    // Same approach as Matchup and Roster pages
    // ═══════════════════════════════════════════════════════════════════
    if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
      try {
        setLoading(true);
        setError(null);
        
        logger.debug('[DraftRoom] Loading REAL demo league for guest/no-league user');
        
        // Import DEMO_LEAGUE_ID_FOR_GUESTS
        const { DEMO_LEAGUE_ID_FOR_GUESTS } = await import('@/services/DemoLeagueService');
        const { COLUMNS } = await import('@/utils/queryColumns');
        
        // Get the demo league from database
        const { data: demoLeagueData, error: leagueError } = await supabase
          .from('leagues')
          .select(COLUMNS.LEAGUE)
          .eq('id' as any, DEMO_LEAGUE_ID_FOR_GUESTS as any)
          .maybeSingle();
        
        if (leagueError || !demoLeagueData) {
          logger.error('[DraftRoom] Error loading demo league:', leagueError);
          setError('Failed to load demo league. Please try again.');
          setLoading(false);
          return;
        }
        
        const demoLeague = demoLeagueData as League;
        logger.debug('[DraftRoom] Demo league loaded:', demoLeague.id);
        setLeague(demoLeague);
        setIsCommissioner(false); // Guests are never commissioners
        
        // Get teams from the demo league
        const { data: demoTeamsData, error: teamsError } = await supabase
          .from('teams')
          .select(COLUMNS.TEAM)
          .eq('league_id' as any, DEMO_LEAGUE_ID_FOR_GUESTS as any)
          .order('created_at', { ascending: true });
        
        if (teamsError || !demoTeamsData || demoTeamsData.length === 0) {
          logger.error('[DraftRoom] Error loading demo teams:', teamsError);
          setError('Failed to load demo teams. Please try again.');
          setLoading(false);
          return;
        }
        
        // Map database teams and add owner names from LEAGUE_TEAMS_DATA
        const demoTeams: (Team & { owner_name?: string })[] = (demoTeamsData as any[]).map((team, index) => {
          const teamData = LEAGUE_TEAMS_DATA[index];
          return {
            ...team,
            owner_name: teamData?.owner || 'Demo Owner'
          };
        });
        
        setTeams(demoTeams);
        logger.debug('[DraftRoom] Loaded', demoTeams.length, 'demo teams');
        
        // Set user team to first team (or Team 3 if we can identify it)
        const userDemoTeam = demoTeams[0] || null;
        setUserTeam(userDemoTeam);
        
        // Get REAL draft picks from database
        const { data: draftPicksData, error: picksError } = await supabase
          .from('draft_picks')
          .select('*')
          .eq('league_id' as any, DEMO_LEAGUE_ID_FOR_GUESTS as any)
          .is('deleted_at', null)
          .order('pick_number', { ascending: true });
        
        if (picksError) {
          logger.error('[DraftRoom] Error loading demo draft picks:', picksError);
          setError('Failed to load demo draft picks. Please try again.');
          setLoading(false);
          return;
        }
        
        const demoPicks: DraftPick[] = (draftPicksData || []) as DraftPick[];
        logger.debug('[DraftRoom] Loaded', demoPicks.length, 'demo draft picks');
        
        setDraftHistory(demoPicks);
        setDraftedPlayerIds(new Set(demoPicks.map(p => p.player_id)));
        
        // Create demo draft state (completed)
        const demoDraftState: DraftState = {
          currentRound: demoLeague.draft_rounds || 21,
          currentPick: demoPicks.length,
          totalPicks: demoTeams.length * (demoLeague.draft_rounds || 21),
          nextTeamId: null,
          isComplete: true,
          sessionId: demoPicks[0]?.draft_session_id || 'demo-session-id'
        };
        setDraftState(demoDraftState);
        setDraftPhase(DraftPhase.COMPLETED);
        
        // Load available players
        const allPlayers = await PlayerService.getAllPlayers();
        setAvailablePlayers(allPlayers);
        
        // Set draft settings
        setDraftSettings({
          rounds: demoLeague.draft_rounds || 21,
          pickTimeLimit: 90,
          draftOrder: 'serpentine',
          scoringFormat: 'standard'
        });
        
        logger.debug('[DraftRoom] Demo draft loaded successfully');
        setLoading(false);
        return;
      } catch (error: unknown) {
        logger.error('[DraftRoom] Error loading demo draft:', error);
        setError('Failed to load demo draft. Please try again.');
        setLoading(false);
        return;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // ACTIVE USER STATE: Load real draft data
    // ═══════════════════════════════════════════════════════════════════
    if (!leagueId || !user) {
      logger.debug('DraftRoom: Cannot load draft data - missing leagueId or user', { leagueId, hasUser: !!user });
      setLoading(false);
      if (!leagueId) {
        setError('No league ID provided. Please select a league.');
      }
      return;
    }

    try {
      // Only show loading screen on initial load, not on return visits
      const isReturnVisit = sessionStorage.getItem(`draft_phase_${leagueId}`);
      if (!isReturnVisit) {
        setLoading(true);
      }
      setError(null);
      logger.debug('DraftRoom: loadDraftData starting for league:', leagueId);

      // Load league (with membership validation)
      const { league: leagueData, error: leagueError } = await LeagueService.getLeague(leagueId, user.id);
      if (leagueError) {
        logger.error('DraftRoom: Error loading league:', leagueError);
        // Check if it's an access denied error
        if (leagueError.message?.includes('Access denied') || leagueError.message?.includes('not a member')) {
          navigate('/gm-office');
          return;
        }
        throw leagueError;
      }
      if (!leagueData) {
        logger.error('DraftRoom: League not found');
        throw new Error('League not found');
      }

      // Guard: only fantasy leagues have drafts
      const leagueTypeFromSettings = (leagueData.settings as Record<string, unknown>)?.leagueType;
      if (leagueTypeFromSettings && leagueTypeFromSettings !== 'fantasy') {
        navigate('/gm-office');
        return;
      }

      logger.debug('DraftRoom: League loaded:', leagueData);
      setLeague(leagueData);
      setIsCommissioner(leagueData.commissioner_id === user.id);
      
      // Detect auction draft type
      const draftTypeFromSettings = (leagueData.settings as any)?.draftType;
      if (draftTypeFromSettings === 'auction') {
        setIsAuctionDraft(true);
        const defaultBudget = (leagueData.settings as any)?.auctionBudget ?? 200;
        setAuctionState({
          budgets: [],
          currentNomination: null,
          myBudget: defaultBudget,
          isMyTurnToNominate: false,
        });

        // Load live auction state if draft is in progress
        if (leagueData.draft_status === 'in_progress') {
          try {
            const { sessionId: activeSessionId } = await DraftService.getActiveDraftSession(leagueId, user.id);
            if (activeSessionId) {
              setAuctionSessionId(activeSessionId);
              const aState = await AuctionDraftService.getAuctionState(leagueId, activeSessionId);
              if (aState) {
                const myBudgetEntry = aState.budgets.find(b => b.team_id === userTeamData?.id);
                const currentNominator = aState.nomination_order[aState.current_nominator_index];
                // Get team names for budget display
                const budgetsWithNames = aState.budgets.map(b => {
                  const team = (teamsData || []).find(t => t.id === b.team_id);
                  return {
                    team_id: b.team_id,
                    team_name: team?.team_name || b.team_id.slice(0, 8),
                    remaining_budget: b.remaining_budget,
                    players_won: b.players_won,
                  };
                });
                setAuctionState({
                  budgets: budgetsWithNames,
                  currentNomination: aState.current_nomination ? {
                    id: aState.current_nomination.id || '',
                    player_id: aState.current_nomination.player_id,
                    player_name: aState.current_nomination.player_name,
                    current_high_bid: aState.current_nomination.current_high_bid,
                    current_high_bidder_team_id: aState.current_nomination.current_high_bidder_team_id,
                    expires_at: aState.current_nomination.expires_at,
                  } : null,
                  myBudget: myBudgetEntry?.remaining_budget ?? defaultBudget,
                  isMyTurnToNominate: currentNominator === userTeamData?.id && !aState.current_nomination,
                });
                if (aState.current_nomination?.id) {
                  setAuctionNominationId(aState.current_nomination.id);
                }
              }
            }
          } catch (auctionErr) {
            logger.error('DraftRoom: Error loading auction state:', auctionErr);
          }
        }
      }

      // Update draft settings with league's draft_rounds and pickTimeLimit
      setDraftSettings(prev => ({
        ...prev,
        rounds: leagueData.draft_rounds || 21,
        // Load pickTimeLimit from league settings if available, otherwise use default
        pickTimeLimit: leagueData.settings?.pickTimeLimit || prev.pickTimeLimit || 90
      }));
      
      // Update timeRemaining if draft is in progress and we have a saved pickTimeLimit
      if (leagueData.draft_status === 'in_progress' && leagueData.settings?.pickTimeLimit) {
        setTimeRemaining(leagueData.settings.pickTimeLimit);
      }

      // Phase will be determined AFTER loading all data below
      // Don't set phase prematurely - we need to check for active draft data first
      logger.debug('DraftRoom: Draft status from DB:', leagueData.draft_status);

      // Load teams with owner information
      const { teams: teamsData, error: teamsError } = await LeagueService.getLeagueTeamsWithOwners(leagueId);
      if (teamsError) {
        logger.error('DraftRoom: Error loading teams:', teamsError);
        throw teamsError;
      }
      logger.debug('DraftRoom: Teams loaded:', teamsData?.length || 0, 'teams');
      setTeams(teamsData || []);

      // Load user's team
      const { team: userTeamData } = await LeagueService.getUserTeam(leagueId, user.id);
      setUserTeam(userTeamData);

      // Load draft picks (only active session, not deleted)
      // Check if there are actually any active draft picks/orders to determine if draft exists
      let hasActiveDraftData = false;
      if (leagueData.draft_status !== 'not_started') {
        const { picks } = await DraftService.getDraftPicks(leagueId, user.id);
        // Filter out any picks that might be soft-deleted
        const activePicks = picks.filter(p => !p.deleted_at);
        if (activePicks.length > 0) {
          hasActiveDraftData = true;
          setDraftHistory(activePicks);
          setDraftedPlayerIds(new Set(activePicks.map(p => p.player_id)));
          logger.debug('DraftRoom: Loaded', activePicks.length, 'active draft picks');
        } else {
          // No picks found — but check if draft_order exists (draft started but no picks yet)
          const { order: existingDraftOrder } = await DraftService.getDraftOrder(leagueId, user.id, 1);
          if (existingDraftOrder) {
            // Draft order exists — draft is genuinely in progress, just no picks yet
            hasActiveDraftData = true;
            setDraftHistory([]);
            setDraftedPlayerIds(new Set());
            logger.debug('DraftRoom: No picks yet, but draft order exists — draft is in progress');
          } else {
            // No picks AND no draft order — status is truly stale, reset
            logger.debug('DraftRoom: Draft status is', leagueData.draft_status, 'but no picks or draft order found - treating as not started');
            setDraftHistory([]);
            setDraftedPlayerIds(new Set());
            await supabase
              .from('leagues')
              .update({ draft_status: 'not_started' })
              .eq('id', leagueId);
            setLeague({ ...leagueData, draft_status: 'not_started' });
          }
        }
      } else {
        // Draft not started - ensure no picks are loaded
        setDraftHistory([]);
        setDraftedPlayerIds(new Set());
        logger.debug('DraftRoom: Draft not started, cleared draft history');
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE DETERMINATION: Based on draft_status and actual data
      // Uses LOCAL variables (not React state) to avoid stale closure issues
      // ═══════════════════════════════════════════════════════════════════
      if (leagueData.draft_status === 'not_started') {
        // Draft not started - show lobby
        setDraftState(null);
        setDraftPhase(DraftPhase.LOBBY);
        logger.debug('DraftRoom: Draft not started, showing LOBBY');
      } else if (leagueData.draft_status === 'queued') {
        // Draft queued/prepared but not started - show lobby
        setDraftState(null);
        setDraftPhase(DraftPhase.LOBBY);
        logger.debug('DraftRoom: Draft queued, showing LOBBY');
      } else if (leagueData.draft_status === 'in_progress') {
        // Draft is IN PROGRESS - show LOBBY with "join active draft" banner
        // Users click to join rather than auto-joining
        logger.debug('DraftRoom: Draft in progress, showing LOBBY with join banner');

        // Pre-load draft state so it's ready when user clicks "Join"
        try {
          const { state: loadedState, error: stateError } = await DraftService.getDraftState(
            leagueId,
            teamsData || [],
            leagueData.draft_rounds || 21,
            user.id
          );

          if (!stateError && loadedState) {
            setDraftState(loadedState);

            // Pre-load ordered teams for board
            if (loadedState.sessionId) {
              try {
                const { order: boardOrder } = await DraftService.getDraftOrder(
                  leagueId, user.id, 1, loadedState.sessionId
                );
                if (boardOrder && boardOrder.team_order && boardOrder.team_order.length > 0) {
                  const orderedTeams = resolveTeamOrder(boardOrder.team_order);
                  if (orderedTeams.length === (teamsData || []).length) {
                    setOrderedTeamsForBoard(orderedTeams);
                  } else {
                    setOrderedTeamsForBoard(teamsData || []);
                  }
                } else {
                  setOrderedTeamsForBoard(teamsData || []);
                }
              } catch (boardErr) {
                logger.error('DraftRoom: Error loading draft order for board:', boardErr);
                setOrderedTeamsForBoard(teamsData || []);
              }
            }
          }
        } catch (draftStateError) {
          logger.error('DraftRoom: Error pre-loading draft state:', draftStateError);
        }

        // Derive timer state from server (timerStartedAt in league.settings)
        if (leagueData.settings?.timerStartedAt) {
          setDraftTimerStarted(true);
          draftTimerStartedRef.current = true;
        }

        // Check if user was previously in ACTIVE phase (returning from another page/tab)
        const cachedPhase = sessionStorage.getItem(`draft_phase_${leagueId}`);
        if (cachedPhase === DraftPhase.ACTIVE) {
          // Auto-resume to ACTIVE phase without requiring lobby click
          setDraftPhase(DraftPhase.ACTIVE);
          logger.debug('DraftRoom: Auto-resuming to ACTIVE phase from sessionStorage');
        } else {
          // Show LOBBY - user clicks "Join Draft" to enter ACTIVE phase
          setDraftPhase(DraftPhase.LOBBY);
          logger.debug('DraftRoom: Showing LOBBY with join banner for user:', user.id);
        }
      } else if (leagueData.draft_status === 'completed') {
        // Draft completed
        if (hasActiveDraftData) {
          try {
            const { state: completedState } = await DraftService.getDraftState(
              leagueId,
              teamsData || [],
              leagueData.draft_rounds || 21,
              user.id
            );
            if (completedState) {
              setDraftState(completedState);
              // Set up orderedTeamsForBoard
              if (completedState.sessionId) {
                const { order: completedOrder } = await DraftService.getDraftOrder(
                  leagueId, user.id, 1, completedState.sessionId
                );
                if (completedOrder && completedOrder.team_order) {
                  const orderedTeams = resolveTeamOrder(completedOrder.team_order);
                  if (orderedTeams.length === (teamsData || []).length) {
                    setOrderedTeamsForBoard(orderedTeams);
                  } else {
                    setOrderedTeamsForBoard(teamsData || []);
                  }
                }
              }
            }
          } catch (completedError) {
            logger.error('DraftRoom: Error loading completed draft state:', completedError);
          }
        }
        setDraftPhase(DraftPhase.COMPLETED);
        // Clear cached phase on completion
        sessionStorage.removeItem(`draft_phase_${leagueId}`);
        sessionStorage.removeItem(`draft_timer_${leagueId}`);
        logger.debug('DraftRoom: Draft completed, showing COMPLETED phase');
      } else {
        // Unknown status - default to lobby
        setDraftState(null);
        setDraftPhase(DraftPhase.LOBBY);
        logger.debug('DraftRoom: Unknown draft status, defaulting to LOBBY');
      }

      // Load available players
      const allPlayers = await PlayerService.getAllPlayers();
      setAvailablePlayers(allPlayers);
      
      logger.debug('DraftRoom: All data loaded successfully', {
        draftPhase,
        teamsCount: teams.length,
        hasLeague: !!leagueData
      });
      
      // Only set loading to false after all data is loaded
      setLoading(false);

    } catch (error: unknown) {
      logger.error('DraftRoom: Error loading draft data:', error);
      const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error)) || 'Failed to load draft data';
      setError(errorMessage);
      setLoading(false);
      // Ensure draftPhase is set even on error
      setDraftPhase(DraftPhase.LOBBY);
      // Don't redirect on error - show error message instead
    }
  }, [leagueId, user, navigate, userLeagueState, generateDemoDraftPicks]);

  useEffect(() => {
    // Wait for auth to finish loading before proceeding
    if (authLoading) {
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // DEMO STATE: Allow guests to view demo draft room
    // ═══════════════════════════════════════════════════════════════════
    if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
      loadDraftData();
      return;
    }

    // Don't redirect guests - they should see demo draft room
    if (!user && userLeagueState !== 'guest' && userLeagueState !== 'logged-in-no-league') {
      // Small delay to ensure component has rendered loading state
      const timer = setTimeout(() => {
        navigate('/auth');
      }, 100);
      return () => clearTimeout(timer);
    }

    if (!leagueId) {
      loadUserLeague();
      return;
    }

    loadDraftData();
  }, [leagueId, user, authLoading, userLeagueState, loadDraftData, loadUserLeague, navigate]);


  // Debounced realtime subscription to reduce lag
  useEffect(() => {
    if (!leagueId || !user?.id) return;

    let updateTimeout: NodeJS.Timeout;
    
    const unsubscribe = DraftService.subscribeToDraftPicks(leagueId, user.id, async (newPick) => {
      logger.debug('DraftRoom: New pick received via realtime:', newPick);

      // Debounce rapid updates - wait 50ms for batched processing (fast enough to feel real-time)
      clearTimeout(updateTimeout);
      updateTimeout = setTimeout(async () => {
        // Reload all picks to ensure we have the latest state
        const { picks } = await DraftService.getDraftPicks(leagueId, user.id);
        const activePicks = picks.filter(p => !p.deleted_at);

        setDraftHistory(activePicks);
        setDraftedPlayerIds(new Set(activePicks.map(p => p.player_id)));

        // Auto-start timer when picks exist (for ALL users)
        if (activePicks.length >= 1 && !draftTimerStartedRef.current) {
          setDraftTimerStarted(true);
          draftTimerStartedRef.current = true;
        }

        // Reload league to get updated timerStartedAt (set after each pick)
        // This drives the server-timestamp-based timer for all clients
        const { data: freshLeague } = await supabase
          .from('leagues')
          .select('settings, draft_rounds, draft_status')
          .eq('id', leagueId)
          .single();
        if (freshLeague) {
          setLeague(prev => prev ? {
            ...prev,
            settings: freshLeague.settings || prev.settings,
            draft_rounds: freshLeague.draft_rounds || prev.draft_rounds,
            draft_status: freshLeague.draft_status || prev.draft_status
          } : null);
          if (freshLeague.settings?.pickTimeLimit) {
            setDraftSettings(prev => ({ ...prev, pickTimeLimit: freshLeague.settings.pickTimeLimit }));
          }
        }

        // Reload draft state to update current pick/round/nextTeam
        await loadDraftState();
      }, 50);
    });

    return () => {
      clearTimeout(updateTimeout);
      unsubscribe();
    };
  }, [leagueId, user?.id]);

  // POLLING FALLBACK: safety net in case Supabase realtime drops.
  // Realtime handles the fast path; polling only catches missed events.
  // PERF: 15s interval (was 5s) — reduces 12 queries/min to 4.
  useEffect(() => {
    if (draftPhase !== DraftPhase.ACTIVE || !leagueId || !user?.id) return;

    const pollInterval = setInterval(async () => {
      try {
        // Reload picks
        const { picks } = await DraftService.getDraftPicks(leagueId, user.id);
        const activePicks = picks.filter(p => !p.deleted_at);

        // Only update state if picks actually changed (avoid unnecessary re-renders)
        let picksChanged = false;
        setDraftHistory(prev => {
          if (prev.length !== activePicks.length) { picksChanged = true; return activePicks; }
          const prevLast = prev[prev.length - 1];
          const newLast = activePicks[activePicks.length - 1];
          if (prevLast?.id !== newLast?.id) { picksChanged = true; return activePicks; }
          return prev;
        });
        // Only rebuild Set when picks actually changed
        if (picksChanged) {
          setDraftedPlayerIds(new Set(activePicks.map(p => p.player_id)));
        }

        // Reload league for timerStartedAt and settings
        const { data: freshLeague } = await supabase
          .from('leagues')
          .select('settings, draft_rounds, draft_status')
          .eq('id', leagueId)
          .single();

        if (freshLeague) {
          setLeague(prev => {
            if (!prev) return prev;
            // PERF: Shallow compare key fields instead of JSON.stringify
            const timerChanged = prev.settings?.timerStartedAt !== freshLeague.settings?.timerStartedAt;
            const limitChanged = prev.settings?.pickTimeLimit !== freshLeague.settings?.pickTimeLimit;
            const statusChanged = prev.draft_status !== freshLeague.draft_status;
            if (!timerChanged && !limitChanged && !statusChanged) return prev;
            return {
              ...prev,
              settings: freshLeague.settings || prev.settings,
              draft_rounds: freshLeague.draft_rounds || prev.draft_rounds,
              draft_status: freshLeague.draft_status || prev.draft_status
            };
          });

          if (freshLeague.settings?.pickTimeLimit) {
            setDraftSettings(prev => {
              if (prev.pickTimeLimit === freshLeague.settings.pickTimeLimit) return prev;
              return { ...prev, pickTimeLimit: freshLeague.settings.pickTimeLimit };
            });
          }

          // Derive timer started from server
          if (freshLeague.settings?.timerStartedAt && !draftTimerStartedRef.current) {
            setDraftTimerStarted(true);
            draftTimerStartedRef.current = true;
          }

          // Detect draft reset during active phase (nuclear delete by commissioner)
          if (freshLeague.draft_status === 'not_started') {
            logger.log('Polling: Draft was reset, returning to lobby');
            setDraftPhase(DraftPhase.LOBBY);
            setDraftState(null);
            setDraftHistory([]);
            setDraftedPlayerIds(new Set());
            setDraftTimerStarted(false);
            draftTimerStartedRef.current = false;
            sessionStorage.removeItem(`draft_phase_${leagueId}`);
            return; // Skip further processing
          }
        }

        // Only reload draft state if picks changed (skip redundant call when realtime already handled it)
        if (picksChanged) {
          await loadDraftState();
        }
      } catch (err) {
        // Silent fail - polling is best-effort
        logger.debug('DraftRoom: Poll error (non-critical):', err);
      }
    }, 15000);

    return () => clearInterval(pollInterval);
  }, [draftPhase, leagueId, user?.id]);

  // Reload teams when page becomes visible again (e.g., user changed team name in another tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && leagueId && user) {
        logger.debug('DraftRoom: Page visible again, reloading teams');
        // Reload teams to get updated team names
        LeagueService.getLeagueTeamsWithOwners(leagueId).then(({ teams: teamsData, error: teamsError }) => {
          if (!teamsError && teamsData) {
            logger.debug('DraftRoom: Teams reloaded:', teamsData.length, 'teams');
            setTeams(teamsData);
          }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [leagueId, user]);

  // Keep refs in sync with state for realtime callbacks (avoids stale closures)
  useEffect(() => { pickTimeLimitRef.current = draftSettings.pickTimeLimit; }, [draftSettings.pickTimeLimit]);
  useEffect(() => { draftTimerStartedRef.current = draftTimerStarted; }, [draftTimerStarted]);

  // Persist draft phase and timer state to sessionStorage for tab/page navigation resilience
  useEffect(() => {
    if (leagueId && draftPhase) {
      sessionStorage.setItem(`draft_phase_${leagueId}`, draftPhase);
    }
  }, [draftPhase, leagueId]);
  useEffect(() => {
    if (leagueId) {
      sessionStorage.setItem(`draft_timer_${leagueId}`, String(draftTimerStarted));
    }
  }, [draftTimerStarted, leagueId]);

  // Auction Draft: Timer countdown + auto-close expired nominations + bid history polling
  useEffect(() => {
    if (!isAuctionDraft || !auctionState?.currentNomination || draftPhase !== DraftPhase.ACTIVE) {
      setAuctionTimeRemaining(null);
      return;
    }

    const nomination = auctionState.currentNomination;
    const expiresAt = new Date(nomination.expires_at).getTime();

    const tick = async () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
      setAuctionTimeRemaining(remaining);

      // Timer expired — auto-close the nomination
      if (remaining <= 0 && leagueId && auctionSessionId && nomination.id) {
        const closeResult = await AuctionDraftService.closeNomination(leagueId, auctionSessionId, nomination.id);
        if (closeResult.success) {
          toast({ title: 'Nomination Closed', description: closeResult.winner_team_id ? `Sold for $${closeResult.amount}!` : 'No bids — player returned to pool.' });
          // Refresh auction state to advance to next nominator
          const refreshed = await AuctionDraftService.getAuctionState(leagueId, auctionSessionId);
          if (refreshed) {
            const myBudget = refreshed.budgets.find(b => b.team_id === userTeam?.id);
            const isMyTurn = userTeam?.id ? refreshed.nomination_order[refreshed.current_nominator_index] === userTeam.id : false;
            setAuctionState(prev => prev ? {
              ...prev,
              currentNomination: refreshed.current_nomination ? {
                id: refreshed.current_nomination.id || '',
                player_id: refreshed.current_nomination.player_id,
                player_name: refreshed.current_nomination.player_name,
                current_high_bid: refreshed.current_nomination.current_high_bid,
                current_high_bidder_team_id: refreshed.current_nomination.current_high_bidder_team_id,
                expires_at: refreshed.current_nomination.expires_at,
              } : null,
              myBudget: myBudget?.remaining_budget ?? prev.myBudget,
              isMyTurnToNominate: isMyTurn,
              bidHistory: [],
            } : prev);
          }
        }
      }
    };

    // Tick immediately, then every second
    tick();
    const interval = setInterval(tick, 1000);

    // Also poll bid history every 3 seconds for real-time transparency
    const loadBidHistory = async () => {
      if (!nomination.id) return;
      const bids = await AuctionDraftService.getBidHistory(nomination.id);
      setAuctionState(prev => prev ? { ...prev, bidHistory: bids.map(b => ({ team_id: b.team_id, bid_amount: b.bid_amount, created_at: b.created_at || '' })) } : prev);
    };
    loadBidHistory();
    const bidPoll = setInterval(loadBidHistory, 3000);

    return () => { clearInterval(interval); clearInterval(bidPoll); };
  }, [isAuctionDraft, auctionState?.currentNomination?.id, auctionState?.currentNomination?.expires_at, draftPhase, leagueId, auctionSessionId]);

  // Real-time subscription to league status changes
  // This allows non-commissioner members to auto-transition when the draft starts
  useEffect(() => {
    if (!leagueId || !user?.id) return;

    const channel = supabase
      .channel(`league_status:${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leagues',
          filter: `id=eq.${leagueId}`
        },
        async (payload) => {
          const updatedLeague = payload.new as any;
          logger.debug('DraftRoom: League status changed via realtime:', updatedLeague.draft_status);

          // Update local league state (including settings with timerStartedAt)
          if (league) {
            setLeague({
              ...league,
              draft_status: updatedLeague.draft_status,
              draft_rounds: updatedLeague.draft_rounds || league.draft_rounds,
              settings: updatedLeague.settings || league.settings,
              scheduled_draft_time: updatedLeague.scheduled_draft_time ?? league.scheduled_draft_time
            });
          }

          // Derive draftTimerStarted from server state for ALL clients
          if (updatedLeague.settings?.timerStartedAt && !draftTimerStartedRef.current) {
            setDraftTimerStarted(true);
            draftTimerStartedRef.current = true;
          } else if (!updatedLeague.settings?.timerStartedAt && draftTimerStartedRef.current) {
            setDraftTimerStarted(false);
            draftTimerStartedRef.current = false;
          }

          // Sync pickTimeLimit from server
          if (updatedLeague.settings?.pickTimeLimit) {
            setDraftSettings(prev => ({
              ...prev,
              pickTimeLimit: updatedLeague.settings.pickTimeLimit
            }));
          }

          // Handle draft reset (nuclear delete by commissioner)
          if (updatedLeague.draft_status === 'not_started' && draftPhase !== DraftPhase.LOBBY) {
            logger.debug('DraftRoom: Draft was reset, returning to lobby');
            setDraftPhase(DraftPhase.LOBBY);
            setDraftState(null);
            setDraftHistory([]);
            setDraftedPlayerIds(new Set());
            setDraftTimerStarted(false);
            draftTimerStartedRef.current = false;
            sessionStorage.removeItem(`draft_phase_${leagueId}`);
            sessionStorage.removeItem(`draft_timer_${leagueId}`);
          }

          // When draft starts, pre-load state but stay in LOBBY with join banner
          if (updatedLeague.draft_status === 'in_progress' && draftPhase !== DraftPhase.ACTIVE) {
            logger.debug('DraftRoom: Draft started by commissioner, showing join banner in lobby');

            // Pre-load draft state so it's ready when user clicks "Join"
            try {
              const { state: joinState } = await DraftService.getDraftState(
                leagueId,
                teams,
                updatedLeague.draft_rounds || league?.draft_rounds || 21,
                user.id
              );

              if (joinState) {
                setDraftState(joinState);
                if (joinState.sessionId) {
                  try {
                    const { order: joinOrder } = await DraftService.getDraftOrder(
                      leagueId, user.id, 1, joinState.sessionId
                    );
                    if (joinOrder && joinOrder.team_order && joinOrder.team_order.length > 0) {
                      const orderedTeams = resolveTeamOrder(joinOrder.team_order);
                      if (orderedTeams.length === teams.length) {
                        setOrderedTeamsForBoard(orderedTeams);
                      }
                    }
                  } catch (orderErr) {
                    logger.error('DraftRoom: Error loading draft order:', orderErr);
                  }
                }
              }

              if (updatedLeague.settings?.pickTimeLimit) {
                setDraftSettings(prev => ({
                  ...prev,
                  pickTimeLimit: updatedLeague.settings.pickTimeLimit
                }));
              }
            } catch (joinError) {
              logger.error('DraftRoom: Error pre-loading draft state:', joinError);
            }
            // Stay in LOBBY - user clicks "Join Draft Room" to enter ACTIVE
          }

          // Handle draft completion
          if (updatedLeague.draft_status === 'completed' && draftPhase !== DraftPhase.COMPLETED) {
            logger.debug('DraftRoom: Draft completed via realtime');
            setDraftPhase(DraftPhase.COMPLETED);
            sessionStorage.removeItem(`draft_phase_${leagueId}`);
            sessionStorage.removeItem(`draft_timer_${leagueId}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // PERF: Only re-subscribe when identifiers change — not on every teams/league object update.
  // teams and league are accessed via refs/closures inside the callback, not as reactive deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, user?.id, draftPhase]);

  const loadDraftState = async (retryCount: number = 0): Promise<DraftState | null> => {
    if (!leagueId || !league) {
      logger.log('loadDraftState: Missing leagueId or league', { leagueId, league: !!league });
      return null;
    }

    // CRITICAL: Don't load draft state if draft hasn't started
    if (league?.draft_status === 'not_started') {
      logger.log('loadDraftState: Draft not started, clearing draft state');
      setDraftState(null);
      return null;
    }

    if (!teams || teams.length === 0) {
      logger.log('loadDraftState: No teams loaded yet, skipping');
      // Retry after a short delay if teams aren't loaded yet
      if (retryCount < 3) {
        return await loadDraftState(retryCount + 1);
      }
      return null;
    }

    logger.log('loadDraftState: Loading draft state', { 
      leagueId, 
      teamsCount: teams?.length || 0, 
      rounds: league?.draft_rounds || 21, 
      status: league?.draft_status || 'not_started',
      retryCount 
    });
    
    try {
      const { state, error } = await DraftService.getDraftState(
        leagueId,
        teams,
        league.draft_rounds,
        user?.id
      );

      if (error) {
        logger.error('loadDraftState: Error loading draft state', error);
        // If draft order doesn't exist, retry a few times (might be still initializing)
        if (error.message?.includes('not initialized') || error.message?.includes('not found')) {
          if (retryCount < 5) {
            logger.log(`loadDraftState: Draft order not found, retrying (${retryCount + 1}/5)...`);
            await new Promise(resolve => setTimeout(resolve, 500));
            return await loadDraftState(retryCount + 1);
          } else {
            logger.log('loadDraftState: Draft order not found after max retries, clearing state');
            setDraftState(null);
            return null;
          }
        }
        // For other errors, clear state
        setDraftState(null);
        return null;
      }

      // Validate the draft state - if it shows a pick number that's too high, it's stale
      if (state && state.currentPick > 0) {
        const totalExpectedPicks = (teams?.length || 0) * (league?.draft_rounds || 21);
        if (state.currentPick > totalExpectedPicks) {
          logger.warn('loadDraftState: Draft state shows invalid pick number, clearing state', {
            currentPick: state.currentPick,
            totalExpected: totalExpectedPicks
          });
          setDraftState(null);
          return null;
        }
      }

      // CRITICAL: Verify nextTeamId exists and matches a team
      if (state && !state.nextTeamId) {
        logger.warn('loadDraftState: nextTeamId is null, trying to fix...');
        // Try to get the first team from draft order
        try {
          const { order } = await DraftService.getDraftOrder(leagueId, user.id, state.currentRound, state.sessionId);
          if (order && order.team_order && order.team_order.length > 0) {
            const pickIndex = (state.currentPick - 1) % (teams?.length || 1);
            const correctTeamId = order.team_order[pickIndex];
            if (correctTeamId) {
              logger.log('loadDraftState: Fixed null nextTeamId', { new: correctTeamId });
              state.nextTeamId = correctTeamId;
            }
          }
        } catch (err) {
          logger.error('loadDraftState: Error fixing null nextTeamId', err);
        }
      }

      // Verify the state has a valid nextTeamId that matches a team
      if (state && state.nextTeamId) {
        const teamExists = teams.find(t => t.id === state.nextTeamId);
        if (!teamExists) {
          logger.warn('loadDraftState: nextTeamId in state does not match any team', {
            nextTeamId: state.nextTeamId,
            teamIds: teams?.map(t => t.id) || []
          });
          // Try to fix by getting the draft order for current round
          try {
            const { order } = await DraftService.getDraftOrder(leagueId, user.id, state.currentRound, state.sessionId);
            if (order && order.team_order && order.team_order.length > 0) {
              // DraftOrder has team_order array with team IDs
              const pickIndex = (state.currentPick - 1) % (teams?.length || 1);
              const correctTeamId = order.team_order[pickIndex];
              if (correctTeamId) {
                logger.log('loadDraftState: Correcting nextTeamId', { old: state.nextTeamId, new: correctTeamId });
                state.nextTeamId = correctTeamId;
              } else {
                logger.error('loadDraftState: Could not find correct team ID from draft order');
                setDraftState(null);
                return null;
              }
            } else {
              logger.error('loadDraftState: Draft order has no team_order');
              setDraftState(null);
              return null;
            }
          } catch (err) {
            logger.error('loadDraftState: Error correcting nextTeamId', err);
            setDraftState(null);
            return null;
          }
        }
      }

      // Set up orderedTeamsForBoard based on draft order (round 1)
      if (state && teams && teams.length > 0) {
        try {
          const { order } = await DraftService.getDraftOrder(leagueId, user.id, 1, state.sessionId);
          if (order && order.team_order && order.team_order.length > 0) {
            // Map team IDs to team objects in the correct order
            const orderedTeams = resolveTeamOrder(order.team_order);
            
            if (orderedTeams.length === teams.length) {
              setOrderedTeamsForBoard(orderedTeams);
              logger.log('loadDraftState: Set orderedTeamsForBoard', { count: orderedTeams.length });
            } else {
              logger.warn('loadDraftState: Ordered teams length mismatch', {
                ordered: orderedTeams.length,
                total: teams.length
              });
              // Fallback to teams in original order
              setOrderedTeamsForBoard(teams);
            }
          } else {
            // Fallback to teams in original order if no draft order
            setOrderedTeamsForBoard(teams);
          }
        } catch (err) {
          logger.error('loadDraftState: Error loading draft order for board', err);
          // Fallback to teams in original order
          setOrderedTeamsForBoard(teams);
        }
      } else if (state && !state.nextTeamId && !state.isComplete) {
        // Draft is not complete but nextTeamId is null - this is an error
        logger.error('loadDraftState: Draft state has null nextTeamId but draft is not complete');
        setDraftState(null);
        return null;
      }

      logger.log('loadDraftState: Draft state loaded successfully', state);
      setDraftState(state);
      return state; // Return the state so caller can use it immediately
    } catch (err: unknown) {
      logger.error('loadDraftState: Exception loading draft state', err);
      // Retry if we haven't exceeded max retries
      if (retryCount < 3) {
        return await loadDraftState(retryCount + 1);
      } else {
        setDraftState(null);
        return null;
      }
    }
  };

  const currentTeam = useMemo(() => {
    if (!draftState?.nextTeamId || teamsById.size === 0) return null;
    return teamsById.get(draftState.nextTeamId) || null;
  }, [draftState?.nextTeamId, teamsById]);

  // Track the last pick number to prevent unnecessary timer resets
  const lastPickNumberRef = useRef<number>(0);
  // Track if timer is currently running to prevent multiple starts
  const timerRunningRef = useRef<boolean>(false);
  // Track the current timer interval ID for cleanup
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Track the current auto-pick timeout ID for cleanup
  const autoPickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Guard against concurrent auto-draft calls (race condition prevention)
  const autoPickInProgressRef = useRef<boolean>(false);
  // Track which pick number we last auto-drafted for to prevent duplicate attempts
  const lastAutoPickedNumberRef = useRef<number>(0);
  // Refs for stale closure prevention in realtime subscription callbacks
  const pickTimeLimitRef = useRef(draftSettings.pickTimeLimit);
  const draftTimerStartedRef = useRef(false);
  // Track pending retry timeouts from handleStartDraft for cleanup on unmount
  const startDraftRetryRef = useRef<NodeJS.Timeout | null>(null);
  // Ref for handleAutoDraft to avoid stale closures in timer intervals
  const handleAutoDraftRef = useRef<() => void>(() => {});

  // Handler to start the draft timer (commissioner only)
  // Saves timerStartedAt to DB so ALL clients can sync their timers
  const handleBeginDraft = async () => {
    if (!isCommissioner) return;

    try {
      // Ensure draft phase is ACTIVE
      if (draftPhase !== DraftPhase.ACTIVE) {
        setDraftPhase(DraftPhase.ACTIVE);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Ensure draft state is loaded
      let currentDraftState = draftState;
      if (!currentDraftState) {
        currentDraftState = await loadDraftState();
        if (!currentDraftState) {
          toast({ title: "Error", description: "Cannot start draft: draft state could not be loaded. Please try starting the draft first.", variant: "destructive" });
          return;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 300));

      const teamToPick = currentDraftState?.nextTeamId && teams && teams.length > 0
        ? teams.find(t => t.id === currentDraftState.nextTeamId) || null
        : null;

      if (!teamToPick) {
        toast({ title: "Error", description: "Cannot start draft: draft state not ready. Please try starting the draft first.", variant: "destructive" });
        return;
      }

      // Save timerStartedAt to DB - this is the SERVER TIMESTAMP that ALL clients use
      const timerStartedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('leagues')
        .update({
          settings: {
            ...(league?.settings || {}),
            timerStartedAt
          }
        })
        .eq('id', leagueId);

      if (updateError) {
        logger.error('Error saving timerStartedAt:', updateError);
        toast({ title: "Error", description: "Failed to start timer. Please try again.", variant: "destructive" });
        return;
      }

      // Update local state
      if (league) {
        setLeague({ ...league, settings: { ...league.settings, timerStartedAt } });
      }

      timerRunningRef.current = false;
      lastPickNumberRef.current = 0;

      logger.log('Starting draft timer for team:', teamToPick.team_name);
      setDraftTimerStarted(true);

    } catch (error: unknown) {
      logger.error('Error starting draft timer:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: "Error", description: `Failed to start draft timer: ${errorMessage}`, variant: "destructive" });
    }
  };

  // Keep handleAutoDraftRef current to avoid stale closures in timer intervals
  useEffect(() => { handleAutoDraftRef.current = handleAutoDraft; });

  // SERVER-TIMESTAMP-BASED TIMER
  // All clients compute remaining time from league.settings.timerStartedAt
  // This ensures perfect sync across commissioner and all members
  //
  // PERF: Only depends on timerStartedAt and pickTimeLimit to avoid unnecessary
  // interval recreation. Other values accessed via refs to prevent stale closures.
  const draftPhaseRef = useRef(draftPhase);
  const currentTeamRef = useRef(currentTeam);
  useEffect(() => { draftPhaseRef.current = draftPhase; }, [draftPhase]);
  useEffect(() => { currentTeamRef.current = currentTeam; }, [currentTeam]);

  useEffect(() => {
    const cleanup = () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (autoPickTimeoutRef.current) {
        clearTimeout(autoPickTimeoutRef.current);
        autoPickTimeoutRef.current = null;
      }
      if (startDraftRetryRef.current) {
        clearTimeout(startDraftRetryRef.current);
        startDraftRetryRef.current = null;
      }
      timerRunningRef.current = false;
    };

    const timerStartedAt = league?.settings?.timerStartedAt;
    const timeLimit = draftSettings.pickTimeLimit;

    // Don't run timer if not in active draft with valid state
    if (draftPhaseRef.current !== DraftPhase.ACTIVE || !draftState || !currentTeamRef.current) {
      cleanup();
      if (!timerStartedAt) {
        setTimeRemaining(timeLimit);
      }
      return cleanup;
    }

    // No server timestamp yet = commissioner hasn't started the timer
    if (!timerStartedAt) {
      setTimeRemaining(timeLimit);
      return cleanup;
    }

    const timerStartMs = new Date(timerStartedAt).getTime();
    const isAITeam = !currentTeamRef.current.owner_id;

    // For AI teams, auto-pick after 2 seconds
    if (isAITeam) {
      autoPickTimeoutRef.current = setTimeout(() => {
        handleAutoDraftRef.current();
      }, 2000);
    }

    // Track if we already triggered auto-draft for this timer cycle
    let autoTriggered = false;

    // Calculate remaining time from server timestamp every second
    const updateTimer = () => {
      const elapsedSec = Math.floor((Date.now() - timerStartMs) / 1000);
      const remaining = Math.max(0, timeLimit - elapsedSec);
      setTimeRemaining(remaining);

      if (remaining <= 0 && !isAITeam && !autoTriggered) {
        // Time expired for human team - auto-draft (only once per timer cycle)
        autoTriggered = true;
        cleanup();
        handleAutoDraftRef.current();
      }
    };

    updateTimer(); // Initial calculation
    timerIntervalRef.current = setInterval(updateTimer, 1000);
    timerRunningRef.current = true;

    return cleanup;
    // Only recreate interval when the server timestamp changes (new pick) or time limit changes
  }, [league?.settings?.timerStartedAt, draftSettings.pickTimeLimit, draftState?.currentPick]);

  // Auto-start draft at scheduled time (commissioner only)
  // PERF: Uses a single setTimeout to the exact scheduled time instead of
  // polling every 5 seconds. Saves ~12 interval fires per minute.
  useEffect(() => {
    if (!isCommissioner || !league?.scheduled_draft_time || draftPhase !== DraftPhase.LOBBY) return;
    if (league?.draft_status === 'in_progress' || league?.draft_status === 'completed') return;

    const scheduledTime = new Date(league.scheduled_draft_time).getTime();
    const now = Date.now();
    const msUntilStart = scheduledTime - now;

    if (msUntilStart <= 0) {
      // Already past scheduled time — start immediately
      logger.log('Scheduled draft time already passed, auto-starting draft');
      handleStartDraft(draftSettings);
      return;
    }

    // Set a single timeout for the exact moment
    logger.log(`Draft scheduled in ${Math.round(msUntilStart / 1000)}s`);
    const timeout = setTimeout(() => {
      logger.log('Scheduled draft time reached, auto-starting draft');
      handleStartDraft(draftSettings);
    }, msUntilStart);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCommissioner, league?.scheduled_draft_time, league?.draft_status, draftPhase]);

  const handlePlayerDraft = async (player: Player, isAutoDraft: boolean = false) => {
    // ⚠️ DEMO STATE: Disable all draft actions
    if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
      if (userLeagueState === 'guest') {
        navigate('/auth');
      } else {
        navigate('/create-league');
      }
      return;
    }
    
    logger.log('handlePlayerDraft called:', { 
      leagueId, 
      draftState, 
      currentTeam, 
      user: user?.id,
      player: player.full_name,
      isAutoDraft
    });

    if (!leagueId) {
      toast({ title: "Error", description: "League ID is missing. Please refresh the page.", variant: "destructive" });
      logger.error('handlePlayerDraft: Missing leagueId');
      return;
    }

    // If draft state is null, try to load it and use it directly
    let effectiveDraftState = draftState;
    let effectiveCurrentTeam = currentTeam;
    
    if (!effectiveDraftState) {
      logger.log('handlePlayerDraft: Draft state is null, attempting to load...');
      
      // Load draft state and get it directly (the function now returns the state)
      const loadedState = await loadDraftState();
      
      if (!loadedState) {
        // State didn't load - show error
        toast({ title: "Error", description: "Draft state not loaded. Please ensure the draft has been started. If you just started the draft, please wait a moment and try again.", variant: "destructive" });
        logger.error('handlePlayerDraft: Missing draftState after load attempt');
        return;
      }
      
      logger.log('handlePlayerDraft: Draft state loaded successfully');
      setDraftState(loadedState);
      effectiveDraftState = loadedState;
      
      // Calculate current team from loaded state
      effectiveCurrentTeam = loadedState.nextTeamId
        ? teams.find(t => t.id === loadedState.nextTeamId) || null
        : null;
        
      if (!effectiveCurrentTeam) {
        toast({ title: "Error", description: "Current team not found after loading draft state. Please try again.", variant: "destructive" });
        logger.error('handlePlayerDraft: Missing currentTeam after loading state', {
          nextTeamId: loadedState.nextTeamId,
          teams: teams.map(t => ({ id: t.id, name: t.team_name }))
        });
        return;
      }
    }
    
    // Use effective state and team for the rest of the function
    if (!effectiveDraftState) {
      toast({ title: "Error", description: "Draft state not available. Please try again.", variant: "destructive" });
      return;
    }
    
    if (!effectiveCurrentTeam) {
      toast({ title: "Error", description: "Current team not found. Please try again.", variant: "destructive" });
      return;
    }

    // For auto-draft (time expired or AI team), skip user checks
    if (!isAutoDraft) {
      if (!user) {
        toast({ title: "Error", description: "User not authenticated. Please log in again.", variant: "destructive" });
        logger.error('handlePlayerDraft: Missing user');
        return;
      }

      // Check if it's user's turn
      if (effectiveCurrentTeam.owner_id !== user.id && !isCommissioner) {
        toast({ title: "Not Your Turn", description: "It's not your turn to draft!", variant: "destructive" });
        return;
      }
    }

    // Check if player is already drafted
    if (draftedPlayerIds.has(player.id)) {
      toast({ title: "Player Unavailable", description: "This player has already been drafted!", variant: "destructive" });
      return;
    }

    try {
      logger.log('Making draft pick:', {
        leagueId,
        teamId: effectiveCurrentTeam.id,
        playerId: player.id,
        round: effectiveDraftState.currentRound,
        pick: effectiveDraftState.currentPick
      });

      const { pick, error, isComplete } = await DraftService.makePick(
        leagueId,
        effectiveCurrentTeam.id,
        player.id,
        effectiveDraftState.currentRound,
        effectiveDraftState.currentPick,
        effectiveDraftState.sessionId,
        teams.length // Pass teams count for completion detection
      );

      if (error) {
        logger.error('DraftService.makePick error:', error);
        // Extract message from various error formats (Supabase errors aren't Error instances)
        const msg = error?.message || error?.details || error?.hint || JSON.stringify(error);
        throw new Error(msg);
      }

      logger.log('Draft pick successful:', pick);

      // Update local state immediately
      setDraftedPlayerIds(prev => new Set([...prev, player.id]));
      setSelectedPlayer(null);

      // Reload all picks to ensure sync
      const { picks } = await DraftService.getDraftPicks(leagueId, user.id);
      const activePicks = picks.filter(p => !p.deleted_at);
      setDraftHistory(activePicks);
      setDraftedPlayerIds(new Set(activePicks.map(p => p.player_id)));

      // Update timerStartedAt in DB so ALL clients reset their countdown
      const newTimerStartedAt = new Date().toISOString();
      await supabase
        .from('leagues')
        .update({
          settings: {
            ...(league?.settings || {}),
            timerStartedAt: newTimerStartedAt
          }
        })
        .eq('id', leagueId);

      // Update local league state
      setLeague(prev => prev ? {
        ...prev,
        settings: { ...prev.settings, timerStartedAt: newTimerStartedAt }
      } : null);

      // Auto-start timer on first pick
      if (!draftTimerStarted) {
        setDraftTimerStarted(true);
      }

      // Check if draft is complete
      // NOTE: DraftService.makePick already handles completion logic (status update, roster sync, matchup generation)
      // We only need to update local state and show the completion screen here
      if (isComplete || activePicks.length >= teams.length * draftSettings.rounds) {
        // Update local state only - DraftService.makePick handles the rest
        setLeague(prev => prev ? { ...prev, draft_status: 'completed' } : null);
        
        // Show congratulations screen
        setDraftPhase(DraftPhase.COMPLETED);
        
        // Reload data to ensure rosters are available
        await loadDraftData();
        return; // Exit early, don't reload draft state
      }

      // Reset timer and reload draft state
      setTimeRemaining(draftSettings.pickTimeLimit);
      // Reset timer refs to allow timer to restart for next pick
      timerRunningRef.current = false;
      lastPickNumberRef.current = 0;
      await loadDraftState();
    } catch (error: unknown) {
      logger.error('handlePlayerDraft error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Silently handle race condition errors - another client/trigger already handled this pick
      const isRaceCondition = errorMessage.includes('already taken') || errorMessage.includes('already drafted');
      if (isRaceCondition) {
        logger.log('handlePlayerDraft: Pick already handled, reloading state');
        await loadDraftState();
      } else if (!isAutoDraft) {
        toast({ title: "Error", description: `Failed to draft player: ${errorMessage}`, variant: "destructive" });
      }
      // Don't throw - let draft continue
    }
  };

  const handleAutoDraft = async () => {
    try {
      if (!leagueId || !draftState || !currentTeam) {
        logger.error('handleAutoDraft: Missing required data');
        return;
      }

      // Only commissioner triggers auto-picks to prevent multiple clients racing
      if (!isCommissioner) {
        logger.log('handleAutoDraft: Skipping - only commissioner auto-picks');
        return;
      }

      // Prevent concurrent auto-draft calls (race condition guard)
      // Set flags FIRST before any async work to prevent two calls slipping through
      if (autoPickInProgressRef.current) {
        logger.log('handleAutoDraft: Skipping - auto-pick already in progress');
        return;
      }
      // Skip if we already attempted this exact pick number (timer effect fires multiple times per pick)
      if (draftState.currentPick === lastAutoPickedNumberRef.current) {
        logger.log('handleAutoDraft: Skipping - already attempted pick #' + draftState.currentPick);
        return;
      }
      autoPickInProgressRef.current = true;
      lastAutoPickedNumberRef.current = draftState.currentPick;

    // Get available (undrafted) players
    const undraftedPlayers = availablePlayers.filter(
      player => !draftedPlayerIds.has(player.id)
    );

    if (undraftedPlayers.length === 0) {
      logger.error('handleAutoDraft: No available players to draft');
      autoPickInProgressRef.current = false;
      return;
    }

    let selectedPlayer: Player | null = null;
    let pickedFromQueue = false;

    // Strategy 1: If it's a human team with a queue, pick from queue first
    const isHumanTeam = currentTeam.owner_id !== null;
    if (isHumanTeam && draftQueue.length > 0) {
      // Try to pick the first available player from the queue
      for (const queuedPlayerId of draftQueue) {
        const queuedPlayer = undraftedPlayers.find(p => p.id === queuedPlayerId);
        if (queuedPlayer) {
          selectedPlayer = queuedPlayer;
          pickedFromQueue = true;
          logger.log('handleAutoDraft: Picking from queue', {
            team: currentTeam.team_name,
            player: selectedPlayer.full_name,
            queueLength: draftQueue.length
          });
          break;
        }
      }
    }

    // Strategy 2: AI teams pick by positional need, then best available
    if (!selectedPlayer) {
      const isAITeam = !currentTeam.owner_id;

      if (isAITeam) {
        // Get what this AI team has already drafted
        const teamPicks = draftHistory.filter(p => p.team_id === currentTeam.id && !p.deleted_at);
        const teamPlayerIds = teamPicks.map(p => p.player_id);
        const teamPlayers = availablePlayers.filter(p => teamPlayerIds.includes(p.id));

        // Count positions already drafted
        const positionCounts: Record<string, number> = {};
        teamPlayers.forEach(p => {
          const pos = p.position || 'F';
          positionCounts[pos] = (positionCounts[pos] || 0) + 1;
        });

        // Ideal roster composition: 6C, 6LW, 6RW, 6D, 3G = needs spread across positions
        // Simplified: prioritize positions with fewest picks relative to need
        const positionNeeds: Record<string, number> = {
          'C': 4, 'LW': 3, 'RW': 3, 'D': 6, 'G': 2,
          // Fallback for combined forward positions
          'F': 3, 'W': 3
        };

        // Find position with biggest need gap
        let bestNeedPosition: string | null = null;
        let biggestGap = -Infinity;
        for (const [pos, need] of Object.entries(positionNeeds)) {
          const have = positionCounts[pos] || 0;
          const gap = need - have;
          if (gap > 0 && gap > biggestGap) {
            // Check if there are available players at this position
            const availableAtPos = undraftedPlayers.filter(p => p.position === pos);
            if (availableAtPos.length > 0) {
              biggestGap = gap;
              bestNeedPosition = pos;
            }
          }
        }

        if (bestNeedPosition) {
          // Pick the best available player at the needed position
          const posPlayers = undraftedPlayers
            .filter(p => p.position === bestNeedPosition)
            .sort((a, b) => (b.points || 0) - (a.points || 0));
          if (posPlayers.length > 0) {
            selectedPlayer = posPlayers[0];
            logger.log('handleAutoDraft: AI picking by positional need', {
              team: currentTeam.team_name,
              position: bestNeedPosition,
              player: selectedPlayer.full_name,
              points: selectedPlayer.points
            });
          }
        }
      }

      // Fallback: pick highest points player regardless of position
      if (!selectedPlayer) {
        selectedPlayer = undraftedPlayers.sort((a, b) => (b.points || 0) - (a.points || 0))[0];
        logger.log('handleAutoDraft: Picking best available player', {
          team: currentTeam.team_name,
          player: selectedPlayer?.full_name,
          points: selectedPlayer?.points,
          isAI: !currentTeam.owner_id
        });
      }
    }

    if (!selectedPlayer) {
      logger.error('handleAutoDraft: Could not select a player');
      autoPickInProgressRef.current = false;
      return;
    }

      // Draft the selected player (mark as auto-draft to bypass user checks)
      await handlePlayerDraft(selectedPlayer, true);

      // Remove from queue if it was picked from queue
      if (pickedFromQueue && selectedPlayer.id) {
        setDraftQueue(prev => prev.filter(id => id !== selectedPlayer!.id));
      }
    } catch (error) {
      logger.error('handleAutoDraft error:', error);
      // Don't show alert for pick-number-already-taken - another client already handled it
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      if (!errMsg.includes('already taken') && !errMsg.includes('already drafted')) {
        setError(`Auto-draft failed: ${errMsg}`);
      }
    } finally {
      autoPickInProgressRef.current = false;
    }
  };

  // Undo the last draft pick (commissioner only)
  const handleUndoLastPick = async () => {
    if (!leagueId || !isCommissioner) return;

    const confirmed = confirm('Are you sure you want to undo the last pick?');
    if (!confirmed) return;

    try {
      const { undone, error: undoError } = await DraftService.undoLastPick(leagueId, user.id);
      if (undoError || !undone) {
        logger.error('handleUndoLastPick error:', undoError);
        toast({ title: "Error", description: `Failed to undo pick: ${undoError?.message || 'No picks to undo'}`, variant: "destructive" });
        return;
      }

      logger.log('Undo successful, pick removed:', undone.player_id);

      // Reload picks and draft state
      const { picks } = await DraftService.getDraftPicks(leagueId, user.id);
      const activePicks = picks.filter(p => !p.deleted_at);
      setDraftHistory(activePicks);
      setDraftedPlayerIds(new Set(activePicks.map(p => p.player_id)));

      // Reset timer for the restored pick
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (autoPickTimeoutRef.current) {
        clearTimeout(autoPickTimeoutRef.current);
        autoPickTimeoutRef.current = null;
      }
      timerRunningRef.current = false;
      lastPickNumberRef.current = 0;
      setTimeRemaining(draftSettings.pickTimeLimit);

      await loadDraftState();
    } catch (error) {
      logger.error('handleUndoLastPick error:', error);
      toast({ title: "Error", description: `Failed to undo pick: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: "destructive" });
    }
  };

  const handleNuclearDeleteDraft = async () => {
    if (!leagueId || !isCommissioner) return;

    try {
      const { error: resetError } = await DraftService.resetDraft(leagueId);
      if (resetError) {
        logger.error('Nuclear delete draft error:', resetError);
        toast({ title: "Error", description: `Failed to delete draft: ${resetError.message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      logger.log('Nuclear draft delete complete for league:', leagueId);

      // Clear all sessionStorage for this league
      sessionStorage.removeItem(`draft_phase_${leagueId}`);
      sessionStorage.removeItem(`draft_timer_${leagueId}`);

      // Force a full page reload to get completely clean React state
      // Surgical state updates are unreliable because polling, realtime,
      // and various useEffects can overwrite them within seconds
      window.location.reload();
    } catch (error) {
      logger.error('Nuclear delete draft exception:', error);
      toast({ title: "Error", description: `Failed to delete draft: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: "destructive" });
    }
  };

  const handleAddAITeams = async () => {
    if (!leagueId || !isCommissioner || !league) return;

    try {
      const maxTeams = league.settings?.teamsCount || 12;
      const { error } = await LeagueService.simulateLeagueFill(leagueId, maxTeams);
      if (error) {
        logger.error('Error adding AI teams:', error);
        return;
      }

      // Reload teams after adding AI teams
      await loadDraftData();
    } catch (err) {
      logger.error('Exception adding AI teams:', err);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!leagueId || !isCommissioner || !user?.id) {
      console.error('[DraftRoom] Cannot delete team - missing requirements:', { leagueId, isCommissioner, userId: user?.id });
      throw new Error('Cannot delete team: Missing league ID, commissioner status, or user ID');
    }

    try {
      const { success, error } = await LeagueService.deleteTeam(teamId, leagueId, user.id);
      if (error) {
        console.error('[DraftRoom] Error from deleteTeam service:', error);
        logger.error('Error deleting team:', error);
        throw error;
      }

      if (success) {
        // Reload teams after deleting
        await loadDraftData();
        logger.log('Team deleted successfully, reloaded draft data');
      } else {
        throw new Error('Delete operation returned success=false but no error');
      }
    } catch (err) {
      console.error('[DraftRoom] Exception deleting team:', err);
      logger.error('Exception deleting team:', err);
      throw err;
    }
  };

  const handleRandomizeOrder = () => {
    if (!teams || teams.length === 0) return;
    
    // Don't allow randomizing if draft is in progress
    if (draftHistory.length > 0) {
      toast({ title: "Draft In Progress", description: "Cannot randomize draft order once the draft has started. Please reset the draft first.", variant: "destructive" });
      return;
    }
    
    // Create a shuffled copy of team IDs
    const teamIds = teams.map(t => t.id);
    const shuffled = [...teamIds];
    
    // Fisher-Yates shuffle algorithm
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    setRandomizedTeamOrder(shuffled);
    // Clear custom draft order when randomizing to ensure randomized order takes priority
    setCustomDraftOrder(null);
    // Clear any custom order settings to ensure randomized order takes priority
    setDraftSettings(prev => {
      if (prev.draftOrder === 'custom') {
        return { ...prev, draftOrder: 'serpentine' };
      }
      return prev;
    });
    logger.log('handleRandomizeOrder: Randomized order', shuffled);
  };

  // Schedule draft - commissioner sets a future time for the draft
  const handleScheduleDraft = async (scheduledTime: string | null) => {
    if (!leagueId || !isCommissioner) return;

    try {
      const { error: updateError } = await supabase
        .from('leagues')
        .update({ scheduled_draft_time: scheduledTime } as any)
        .eq('id', leagueId);

      if (updateError) {
        logger.error('Error updating scheduled draft time:', updateError);
        toast({ title: "Error", description: `Failed to schedule draft: ${updateError.message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      // Update local league state
      if (league) {
        setLeague({ ...league, scheduled_draft_time: scheduledTime });
      }

      logger.log('handleScheduleDraft: Draft time updated to', scheduledTime);
    } catch (error: unknown) {
      logger.error('handleScheduleDraft: Error scheduling draft', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: "Error", description: `Failed to schedule draft: ${errorMessage}`, variant: "destructive" });
    }
  };

  // Prepare draft - initializes draft order but doesn't start yet
  const handlePrepareDraft = async (settings: DraftSettings) => {
    // ⚠️ DEMO STATE: Disable all draft actions
    if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
      if (userLeagueState === 'guest') {
        navigate('/auth');
      } else {
        navigate('/create-league');
      }
      return;
    }
    
    if (!leagueId || !isCommissioner) return;

    try {
      logger.log('handlePrepareDraft: Preparing draft', { leagueId, settings, teamsCount: teams.length });
      
      setDraftSettings(settings);
      setTimeRemaining(settings.pickTimeLimit);

      // Save pickTimeLimit to league settings for persistence
      if (league) {
        await supabase
          .from('leagues')
          .update({
            settings: {
              ...(league.settings || {}),
              pickTimeLimit: settings.pickTimeLimit,
              draftOrder: settings.draftOrder
            }
          })
          .eq('id', leagueId);
      }

      // Initialize draft order
      const draftRounds = settings.rounds || league?.draft_rounds || 21;
      
        // Determine which order to use: effectiveOrder > settings custom order > customDraftOrder (button) > randomized order > none
        const orderToUse = settings.effectiveOrder
          || (settings.draftOrder === 'custom' && settings.customOrder ? settings.customOrder : undefined)
          || customDraftOrder
          || randomizedTeamOrder
          || undefined;
        
        const leagueDraftType = (league?.settings as any)?.draftType || 'snake';
        const { error: initError } = await DraftService.initializeDraftOrder(
          leagueId,
          user.id,
          teams,
          draftRounds,
          false,
          orderToUse,
          leagueDraftType
        );

      if (initError) {
        logger.error('handlePrepareDraft: Error initializing draft order', initError);
        // Try cleanup and retry
        const { error: cleanupError } = await DraftService.hardDeleteDraft(leagueId);
        if (cleanupError) {
          logger.error('handlePrepareDraft: Cleanup failed:', cleanupError);
        }

        const { error: retryError } = await DraftService.initializeDraftOrder(
          leagueId,
          user.id,
          teams,
          draftRounds,
          true,
          orderToUse,
          leagueDraftType
        );
        
        if (retryError) {
          toast({ title: "Error", description: `Failed to prepare draft: ${retryError.message || 'Unknown error'}. Please try resetting the draft.`, variant: "destructive" });
          return;
        }
      }

      // Set league status to 'queued' (ready to start)
      const { error: leagueStatusError } = await supabase
        .from('leagues')
        .update({ draft_status: 'queued' as any })
        .eq('id', leagueId);
      
      if (leagueStatusError) {
        logger.error('Error updating league status to queued:', leagueStatusError);
        toast({ title: "Error", description: `Failed to queue draft: ${leagueStatusError.message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      // Update local league state
      if (league) {
        setLeague({ ...league, draft_status: 'queued' });
      }

      logger.log('handlePrepareDraft: Draft queued successfully');
      toast({ title: "Success", description: "Draft prepared and queued! Click \"Start Draft\" when everyone is ready." });
      
      // Reload data to show updated status
      await loadDraftData();
    } catch (error: unknown) {
      logger.error('handlePrepareDraft: Error preparing draft', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: "Error", description: `Failed to prepare draft: ${errorMessage}`, variant: "destructive" });
    }
  };

  // Actually start the draft - begins the draft instance
  // Also used by non-commissioners to rejoin an in-progress draft
  const handleStartDraft = async (settings: DraftSettings) => {
    // ⚠️ DEMO STATE: Disable all draft actions
    if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
      if (userLeagueState === 'guest') {
        navigate('/auth');
      } else {
        navigate('/create-league');
      }
      return;
    }
    
    if (!leagueId) return;
    
    // Non-commissioners can rejoin an in-progress draft (but not start a new one)
    if (!isCommissioner) {
      if (league?.draft_status === 'in_progress') {
        logger.log('Non-commissioner rejoining in-progress draft');
        setDraftPhase(DraftPhase.ACTIVE);
        // Load draft state
        const { state: rejoinState } = await DraftService.getDraftState(
          leagueId, teams, league.draft_rounds || 21, user?.id
        );
        if (rejoinState) {
          setDraftState(rejoinState);
          // Set up ordered teams for board
          if (rejoinState.sessionId) {
            const { order: rejoinOrder } = await DraftService.getDraftOrder(leagueId, user.id, 1, rejoinState.sessionId);
            if (rejoinOrder && rejoinOrder.team_order) {
              const orderedTeams = resolveTeamOrder(rejoinOrder.team_order);
              if (orderedTeams.length === teams.length) {
                setOrderedTeamsForBoard(orderedTeams);
              }
            }
          }
        }
        // Auto-start timer if picks already exist
        const { picks: rejoinPicks } = await DraftService.getDraftPicks(leagueId, user.id);
        const activeRejoinPicks = rejoinPicks.filter((p: DraftPick) => !p.deleted_at);
        if (activeRejoinPicks.length > 0) {
          setDraftTimerStarted(true);
          draftTimerStartedRef.current = true;
        }
        return;
      }
      // Non-commissioners can't start a new draft
      return;
    }

    // Commissioner rejoining an in-progress draft (not starting a new one)
    if (league?.draft_status === 'in_progress') {
      logger.log('Commissioner rejoining in-progress draft');
      setDraftPhase(DraftPhase.ACTIVE);
      // Load draft state
      const { state: rejoinState } = await DraftService.getDraftState(
        leagueId, teams, league.draft_rounds || 21, user?.id
      );
      if (rejoinState) {
        setDraftState(rejoinState);
        if (rejoinState.sessionId) {
          const { order: rejoinOrder } = await DraftService.getDraftOrder(leagueId, user.id, 1, rejoinState.sessionId);
          if (rejoinOrder && rejoinOrder.team_order) {
            const orderedTeams = rejoinOrder.team_order
              .map((teamId: string) => teams.find(t => t.id === teamId))
              .filter((t: any): t is (Team & { owner_name?: string }) => t !== undefined);
            if (orderedTeams.length === teams.length) {
              setOrderedTeamsForBoard(orderedTeams);
            }
          }
        }
      }
      // Auto-start timer if picks already exist (otherwise commissioner sees "Start Draft Timer" button)
      const { picks: rejoinPicks } = await DraftService.getDraftPicks(leagueId, user.id);
      const activeRejoinPicks = rejoinPicks.filter((p: DraftPick) => !p.deleted_at);
      if (activeRejoinPicks.length > 0) {
        setDraftTimerStarted(true);
        draftTimerStartedRef.current = true;
      }
      return;
    }

    try {
      logger.log('handleStartDraft: Starting draft', { leagueId, settings, teamsCount: teams.length });
      
      setDraftSettings(settings);
      setTimeRemaining(settings.pickTimeLimit);

      // Always (re)initialize draft order when starting a draft.
      // This ensures the randomized/custom order from the lobby is actually used,
      // rather than stale order rows from a previous draft attempt.
      const draftRounds = settings.rounds || league?.draft_rounds || 21;
      // Priority: effectiveOrder from DraftLobby (most reliable) > settings.customOrder > local state > none
      const orderToUse = settings.effectiveOrder
        || (settings.draftOrder === 'custom' && settings.customOrder ? settings.customOrder : undefined)
        || customDraftOrder
        || randomizedTeamOrder
        || undefined;

      logger.log('handleStartDraft: Initializing draft order', {
        hasEffectiveOrder: !!settings.effectiveOrder,
        hasCustomOrder: !!orderToUse,
        orderLength: orderToUse?.length,
        orderFirstTeam: orderToUse?.[0],
        draftRounds
      });

      const startDraftType = (league?.settings as any)?.draftType || 'snake';
      const { error: initError } = await DraftService.initializeDraftOrder(
        leagueId,
        user.id,
        teams,
        draftRounds,
        true, // resetExisting=true to always delete old orders and create fresh ones
        orderToUse,
        startDraftType
      );

      if (initError) {
        toast({ title: "Error", description: `Failed to initialize draft order: ${initError.message || 'Unknown error'}. Please try preparing the draft first.`, variant: "destructive" });
        return;
      }

      // Update league status to in_progress and save draft settings + rounds
      const { error: leagueStatusError } = await supabase
        .from('leagues')
        .update({
          draft_status: 'in_progress',
          draft_rounds: settings.rounds,
          settings: {
            ...(league?.settings || {}),
            pickTimeLimit: settings.pickTimeLimit,
            draftOrder: settings.draftOrder
          }
        })
        .eq('id', leagueId);
      
      if (leagueStatusError) {
        logger.error('Error updating league status:', leagueStatusError);
        toast({ title: "Error", description: `Failed to start draft: ${leagueStatusError.message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      // Update local league state with saved settings and rounds
      if (league) {
        setLeague({
          ...league,
          draft_status: 'in_progress',
          draft_rounds: settings.rounds,
          settings: {
            ...(league.settings || {}),
            pickTimeLimit: settings.pickTimeLimit,
            draftOrder: settings.draftOrder
          }
        });
      }

      // Set draft phase to active
      setDraftPhase(DraftPhase.ACTIVE);
      
      // Clear any old draft state and reset timer started flag
      setDraftState(null);
      setDraftHistory([]);
      setDraftedPlayerIds(new Set());
      setDraftTimerStarted(false); // Reset so commissioner must click "Start Draft Timer"

      // Load draft state immediately and keep retrying until it works
      // Uses ref-tracked timeouts so unmount can cancel pending retries
      const loadStateAfterStart = async (retryCount: number = 0) => {
        try {
          // Verify draft order exists
          const { order: verifyOrder, error: orderError } = await DraftService.getDraftOrder(leagueId, user.id, 1);

          if (orderError || !verifyOrder) {
            if (retryCount < 10) {
              logger.log(`Draft order not found, retrying (${retryCount + 1}/10)...`);
              startDraftRetryRef.current = setTimeout(() => loadStateAfterStart(retryCount + 1), 500);
              return;
            } else {
              logger.error('Draft order not found after max retries');
              return;
            }
          }

          // Load draft state
          const { data: updatedLeague } = await supabase
            .from('leagues')
            .select('draft_status')
            .eq('id', leagueId)
            .single();

          if (updatedLeague?.draft_status === 'in_progress') {
            const loadedState = await loadDraftState();
            if (loadedState) {
              logger.log('Draft state loaded successfully after start');
            } else if (retryCount < 10) {
              startDraftRetryRef.current = setTimeout(() => loadStateAfterStart(retryCount + 1), 500);
            }
          }
        } catch (stateError: unknown) {
          logger.error('Error loading draft state after start:', stateError);
          if (retryCount < 10) {
            startDraftRetryRef.current = setTimeout(() => loadStateAfterStart(retryCount + 1), 500);
          }
        }
      };

      // Start loading state immediately
      startDraftRetryRef.current = setTimeout(() => loadStateAfterStart(0), 500);

      // SOC 2 CC7.2: Audit log draft start
      import('@/services/AuditService').then(({ AuditService }) => 
        AuditService.logDraftEvent('DRAFT_START', leagueId, { teamsCount: teams.length, rounds: settings.rounds })
      ).catch(() => {});

      logger.log('handleStartDraft: Draft started successfully');
    } catch (error: unknown) {
      logger.error('handleStartDraft: Error starting draft', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: "Error", description: `Failed to start draft: ${errorMessage}`, variant: "destructive" });
    }
  };

  // Handle pausing the draft timer
  // Handle pausing the draft timer - clears timerStartedAt in DB
  const handlePauseDraft = async () => {
    logger.log('Pausing draft timer');
    setDraftTimerStarted(false);
    // Clear any running timers
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (autoPickTimeoutRef.current) {
      clearTimeout(autoPickTimeoutRef.current);
      autoPickTimeoutRef.current = null;
    }
    timerRunningRef.current = false;

    // Clear timerStartedAt in DB so all clients stop their timers
    if (leagueId) {
      const currentSettings = league?.settings || {};
      const { timerStartedAt: _, ...settingsWithoutTimer } = currentSettings as any;
      await supabase
        .from('leagues')
        .update({ settings: { ...settingsWithoutTimer, timerStartedAt: null } })
        .eq('id', leagueId);
      setLeague(prev => prev ? {
        ...prev,
        settings: { ...settingsWithoutTimer, timerStartedAt: null }
      } : null);
    }
  };

  // Handle continuing/resuming the draft timer - sets new timerStartedAt in DB
  const handleContinueDraft = async () => {
    if (!draftState || !currentTeam) {
      if (!draftState && leagueId) {
        await loadDraftState();
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (!draftState || !currentTeam) {
      toast({ title: "Error", description: "Cannot continue draft: draft state not ready. Please try again.", variant: "destructive" });
      return;
    }

    // Set new timerStartedAt in DB - all clients will start counting from this point
    const timerStartedAt = new Date().toISOString();
    if (leagueId) {
      await supabase
        .from('leagues')
        .update({ settings: { ...(league?.settings || {}), timerStartedAt } })
        .eq('id', leagueId);
      setLeague(prev => prev ? {
        ...prev,
        settings: { ...prev.settings, timerStartedAt }
      } : null);
    }

    timerRunningRef.current = false;
    lastPickNumberRef.current = 0;
    setDraftTimerStarted(true);
  };

  const handleToggleDraft = () => {
    if (draftPhase === DraftPhase.ACTIVE) {
      setDraftPhase(DraftPhase.LOBBY);
    } else if (draftPhase === DraftPhase.LOBBY) {
      setDraftPhase(DraftPhase.ACTIVE);
    }
  };

  const handleCleanupDraft = async () => {
    if (!leagueId) return;
    
    try {
      const confirmed = window.confirm(
        'This will reset the draft and start a fresh draft session. Old draft data will remain in the database but will be ignored. Continue?'
      );
      if (!confirmed) return;

      logger.log('Resetting draft - starting fresh session');
      
      // Just reset the league status to 'not_started' - don't try to delete old data
      // Old draft sessions will remain but won't be used
      const { error: statusError } = await supabase
        .from('leagues')
        .update({ draft_status: 'not_started' })
        .eq('id', leagueId);
      
      if (statusError) {
        logger.error('Error resetting league status:', statusError);
        toast({ title: "Error", description: `Failed to reset draft: ${statusError.message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      // Reset all local state
      resetDraftLocalState();
      setDraftState(null);
      
      // Update local league state
      if (league) {
        setLeague({ ...league, draft_status: 'not_started' });
      }
      
      // Reload draft data - this will see draft_status is 'not_started' and won't load old state
      setDraftPhase(DraftPhase.LOBBY);
      await loadDraftData();
      
      logger.log('Draft reset complete - ready for fresh start');
      toast({ title: "Success", description: "Draft reset complete! You can now start a fresh draft. When you click \"Start Draft\", a new draft session will be created." });
      
    } catch (error: unknown) {
      logger.error('Error resetting draft:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: "Error", description: `Failed to reset draft: ${errorMessage}`, variant: "destructive" });
    }
  };

  const handleDeleteAllDrafts = async () => {
    if (!isCommissioner) return;
    
    try {
      const confirmed = window.confirm(
        '⚠️ WARNING: This will permanently delete ALL draft data from ALL leagues in the database. This cannot be undone!\n\nAre you absolutely sure you want to continue?'
      );
      if (!confirmed) return;

      const doubleConfirm = window.confirm(
        'This is your last chance. This will delete EVERYTHING. Type OK to confirm.'
      );
      if (!doubleConfirm) return;

      logger.log('Starting deletion of ALL draft data...');
      
      const { error } = await DraftService.deleteAllDraftData();
      if (error) {
        logger.error('Error deleting all draft data:', error);
        toast({ title: "Error", description: `Failed to delete all draft data: ${error.message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      logger.log('All draft data deleted successfully');
      
      // Reset local state and reload data instead of full page reload
      resetDraftLocalState();
      setDraftPhase(DraftPhase.LOBBY);
      await loadDraftData();
      
      toast({ title: "Success", description: "All draft data has been deleted successfully." });
      
    } catch (error: any) {
      logger.error('Error deleting all draft data:', error);
      toast({ title: "Error", description: `Failed to delete all draft data: ${error.message || 'Unknown error'}`, variant: "destructive" });
    }
  };

  // Helper function to reset all draft-related local state
  const resetDraftLocalState = () => {
    setDraftHistory([]);
    setDraftedPlayerIds(new Set());
    setDraftState(null); // CRITICAL: Clear draft state
    setDraftPhase(DraftPhase.LOBBY);
    setDraftQueue([]);
    setTimeRemaining(draftSettings.pickTimeLimit);
    setSelectedPlayer(null);
    lastPickNumberRef.current = 0;
    setDraftTimerStarted(false); // Reset timer started flag
    // Also clear randomized order if any
    setRandomizedTeamOrder(null);
  };

  const handleResetDraft = async () => {
    if (!leagueId || !isCommissioner) return;
    
    const confirmed = confirm(
      'Are you sure you want to reset the draft? This will permanently delete all draft data and start fresh.'
    );
    
    if (!confirmed) return;

    try {
      logger.log('Starting draft reset for league:', leagueId);
      
      // Reset local state first to prevent any UI updates during deletion
      resetDraftLocalState();
      
      // Use hard delete to completely clear draft data
      const { error } = await DraftService.hardDeleteDraft(leagueId);
      if (error) {
        logger.error('Error resetting draft:', error);
        toast({ title: "Error", description: `Failed to reset draft: ${error.message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      logger.log('Draft data deleted successfully, verifying reset...');
      
      // Verify the league status was updated
      const { data: updatedLeague, error: verifyError } = await supabase
        .from('leagues')
        .select('draft_status')
        .eq('id', leagueId)
        .single();
      
      if (verifyError) {
        logger.error('Error verifying league status:', verifyError);
      } else {
        logger.log('League status after reset:', updatedLeague?.draft_status);
        
        // If status wasn't updated, update it manually
        if (updatedLeague?.draft_status !== 'not_started') {
          logger.log('League status not updated, fixing it...');
          await supabase
            .from('leagues')
            .update({ draft_status: 'not_started' })
            .eq('id', leagueId);
        }
      }
      
      // Update local league object
      if (league) {
        setLeague({ ...league, draft_status: 'not_started' });
      }
      
      // Small delay to ensure all database operations are committed
      await new Promise(resolve => setTimeout(resolve, 500));
      
      logger.log('Reset complete, reloading draft data...');
      
      // Instead of page reload, just reload the draft data and reset state
      // This prevents auth redirect issues
      resetDraftLocalState();
      setDraftPhase(DraftPhase.LOBBY);
      setDraftState(null); // CRITICAL: Ensure draft state is null
      // Reload data - this will see draft_status is 'not_started' and won't load old state
      await loadDraftData();
      
    } catch (error: unknown) {
      logger.error('Error resetting draft:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: "Error", description: `Failed to reset draft: ${errorMessage}`, variant: "destructive" });
    }
  };

  // Queue handlers
  const handleAddToQueue = (playerId: string) => {
    if (!draftQueue.includes(playerId)) {
      setDraftQueue(prev => [...prev, playerId]);
    } else {
      // Remove from queue if already in it
      setDraftQueue(prev => prev.filter(id => id !== playerId));
    }
  };

  // Watchlist handlers
  const handleToggleWatchlist = (playerId: string) => {
    setWatchlist(prev => {
      const newWatchlist = new Set(prev);
      if (newWatchlist.has(playerId)) {
        newWatchlist.delete(playerId);
        LeagueService.removeFromWatchlist(playerId);
      } else {
        newWatchlist.add(playerId);
        LeagueService.addToWatchlist(playerId);
      }
      return newWatchlist;
    });
  };

  // Load watchlist on mount
  useEffect(() => {
    if (user) {
      const savedWatchlist = LeagueService.getWatchlist();
      setWatchlist(savedWatchlist);
    }
  }, [user]);

  const handleQueueChange = (newQueue: string[]) => {
    setDraftQueue(newQueue);
  };

  const handleDraftFromQueue = async (playerId: string) => {
    const player = availablePlayers.find(p => p.id === playerId);
    if (player) {
      await handlePlayerDraft(player);
      setDraftQueue(prev => prev.filter(id => id !== playerId));
    }
  };

  // Memoize expensive data transformations (O(n) via Maps, was O(n²) via .find())
  const transformedDraftHistory = useMemo(() => {
    return draftHistory.map(p => {
      const player = playersById.get(p.player_id);
      return {
        id: p.id,
        teamId: p.team_id,
        teamName: teamsById.get(p.team_id)?.team_name || '',
        playerId: p.player_id,
        playerName: player?.full_name || 'Unknown Player',
        position: player?.position || '',
        round: p.round_number,
        pick: p.pick_number,
        timestamp: new Date(p.picked_at).getTime(),
      };
    });
  }, [draftHistory, playersById, teamsById]);

  // Memoize team picks map for faster lookups
  const teamPicksMap = useMemo(() => {
    const map = new Map<string, typeof transformedDraftHistory>();
    teams.forEach(t => {
      map.set(t.id, transformedDraftHistory.filter(p => p.teamId === t.id));
    });
    return map;
  }, [teams, transformedDraftHistory]);

  // Handle player click to open stats modal
  const handlePlayerClick = async (playerId: string) => {
    try {
      // Get player data from cached Map (no network call needed)
      const player = playersById.get(playerId);
      
      if (!player) {
        logger.error('Player not found:', playerId);
        return;
      }
      
      // Convert to HockeyPlayer format
      // Uses the same stat mapping as Matchup tab to ensure consistency
      const hockeyPlayer: HockeyPlayer = {
        id: player.id,
        name: player.full_name,
        position: player.position,
        number: parseInt(player.jersey_number || '0'),
        starter: false,
        stats: {
          gamesPlayed: player.games_played || 0,
          goals: player.goals || 0,
          assists: player.assists || 0,
          points: player.points || 0,
          plusMinus: player.plus_minus || 0,
          shots: player.shots || 0,
          hits: player.hits || 0,
          blockedShots: player.blocks || 0,
          xGoals: player.xGoals || 0,
          powerPlayPoints: player.ppp || 0,
          shortHandedPoints: player.shp || 0,
          pim: player.pim || 0,
          // Goalie stats
          wins: player.wins || 0,
          losses: player.losses || 0,
          otl: player.ot_losses || 0,
          gaa: player.goals_against_average || 0,
          savePct: player.save_percentage || 0,
          shutouts: player.shutouts || 0,
          saves: player.saves || 0,
          goalsAgainst: player.goals_against || 0
        },
        team: player.team,
        teamAbbreviation: player.team,
        status: player.status === 'injured' ? 'IR' : null,
        image: player.headshot_url || undefined,
        projectedPoints: player.games_played > 0
          ? ((player.goals || 0) * 3 + (player.assists || 0) * 2 + (player.shots || 0) * 0.4 + (player.blocks || 0) * 0.5 + (player.hits || 0) * 0.2 + (player.pim || 0) * 0.5) / player.games_played
          : 0
      };
      
      setSelectedPlayerForStats(hockeyPlayer);
      setIsPlayerDialogOpen(true);
    } catch (error) {
      logger.error('Error loading player stats:', error);
    }
  };

  // Handle saving/viewing draft snapshot
  const handleViewDraftSnapshot = async () => {
    if (!leagueId) {
      logger.error('Missing league ID for snapshot');
      return;
    }

    try {
      setSavingSnapshot(true);

      // Get session ID from draftState or from draft picks
      let sessionId = draftState?.sessionId;
      if (!sessionId && draftHistory.length > 0) {
        sessionId = draftHistory[0].draft_session_id || undefined;
      }
      
      // If still no session ID, try to get active session
      if (!sessionId) {
        const { sessionId: activeSessionId } = await DraftService.getActiveDraftSession(leagueId, user.id);
        sessionId = activeSessionId;
      }

      if (!sessionId) {
        logger.error('Could not determine draft session ID');
        toast({ title: "Error", description: "Unable to save draft snapshot. Draft session not found.", variant: "destructive" });
        setSavingSnapshot(false);
        return;
      }

      // Check if snapshot already exists
      const { snapshot } = await DraftService.getDraftSnapshot(leagueId);
      
      if (snapshot) {
        // Use existing snapshot
        setSnapshotData(snapshot.snapshot_data);
        setSnapshotCreatedAt(snapshot.created_at);
        setIsSnapshotModalOpen(true);
        setSavingSnapshot(false);
        return;
      }

      // Prepare teams data for snapshot
      const teamsForSnapshot = (orderedTeamsForBoard.length > 0 ? orderedTeamsForBoard : teams).map(t => ({
        id: t.id,
        name: t.team_name,
        owner: t.owner_id ? 'Owner' : 'AI',
        color: '#7CB518',
      }));

      // Save new snapshot
      const { snapshotId, error } = await DraftService.saveDraftSnapshot(
        leagueId,
        sessionId,
        teamsForSnapshot,
        transformedDraftHistory,
        {
          rounds: league?.draft_rounds || draftSettings.rounds || 21,
          draftOrder: draftSettings.draftOrder,
          completedAt: new Date().toISOString(),
        }
      );

      if (error) {
        logger.error('Error saving snapshot:', error);
        toast({ title: "Error", description: "Failed to save draft snapshot. Please try again.", variant: "destructive" });
        setSavingSnapshot(false);
        return;
      }

      // Fetch the saved snapshot to get full data including created_at
      if (snapshotId) {
        const { snapshot: savedSnapshot } = await DraftService.getDraftSnapshot(leagueId);
        if (savedSnapshot) {
          setSnapshotData(savedSnapshot.snapshot_data);
          setSnapshotCreatedAt(savedSnapshot.created_at);
          setIsSnapshotModalOpen(true);
        }
      }

      setSavingSnapshot(false);
    } catch (error) {
      logger.error('Error handling draft snapshot:', error);
      toast({ title: "Error", description: "Failed to save draft snapshot. Please try again.", variant: "destructive" });
      setSavingSnapshot(false);
    }
  };

  // Get user's drafted players (O(n) via Map, was O(n²) via .find())
  const userDraftedPlayers = useMemo(() => {
    if (!userTeam) return [];
    return draftHistory
      .filter(p => p.team_id === userTeam.id)
      .map(pick => playersById.get(pick.player_id))
      .filter((p): p is Player => p !== undefined);
  }, [draftHistory, userTeam, playersById]);

  // Pre-map teams for lobby so we don't create new objects every render
  const lobbyTeams = useMemo(() => {
    if (!teams || teams.length === 0) return [];
    return teams.map(t => ({
      id: t.id,
      name: t.team_name || 'Unnamed Team',
      owner: (t as { owner_name?: string }).owner_name || (t.owner_id ? 'User' : 'AI Team'),
      color: '#7CB518',
      picks: [] as any[],
    }));
  }, [teams]);

  // ALWAYS render something - never return null
  return (
    <div className="min-h-screen bg-[#D4E8B8] relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Draft Room</h1>
        </div>
      </div>

      <main className="w-full lg:pt-20 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            {/* Main Content - Scrollable - Appears first on mobile */}
            <div className="min-w-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto px-0 sm:px-2 lg:px-6 order-1 lg:order-2">
        {/* Loading State - Show if loading or auth is loading, but NOT for demo state */}
        {displayLoading && (
          <LoadingScreen
            character="kiwi"
            message={authLoading ? 'Checking Authentication...' : !user && userLeagueState !== 'guest' && userLeagueState !== 'logged-in-no-league' ? 'Redirecting to Login...' : 'Loading Draft Room...'}
          />
        )}

        {/* Error State */}
        {!loading && !authLoading && error && (
          <div className="container mx-auto px-4 py-20">
            <Card className="max-w-2xl mx-auto">
              <CardHeader>
                <CardTitle className="text-destructive">Error Loading Draft Room</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">{error}</p>
                <div className="flex gap-2">
                  <Button onClick={() => loadDraftData()}>Retry</Button>
                  <Button variant="outline" onClick={() => navigate(`/league/${leagueId}`)}>
                    Back to League Dashboard
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* LOBBY PHASE - Default to LOBBY if phase is not ACTIVE or COMPLETED */}
        {!loading && !authLoading && !error && draftPhase !== DraftPhase.ACTIVE && draftPhase !== DraftPhase.COMPLETED && (
          <div className="container mx-auto px-4 py-8">
            {teams && Array.isArray(teams) && teams.length > 0 && league ? (
              <DraftLobby
                teams={lobbyTeams}
                onStartDraft={handleStartDraft}
                onPrepareDraft={handlePrepareDraft}
                isCommissioner={isCommissioner}
                isDraftQueued={league?.draft_status === 'queued'}
                hasExistingDraft={league?.draft_status === 'in_progress'}
                currentPick={draftState?.currentPick || 0}
                totalPicks={(teams?.length || 0) * (league?.draft_rounds || 21)}
                onRandomizeOrder={handleRandomizeOrder}
                randomizedOrder={randomizedTeamOrder}
                customDraftOrder={customDraftOrder}
                onCustomOrderChange={(order) => {
                  setCustomDraftOrder(order);
                  // Clear randomized order when custom order is set
                  if (order) {
                    setRandomizedTeamOrder(null);
                  }
                }}
                leagueDraftRounds={league?.draft_rounds || 21}
                leaguePickTimeLimit={league?.settings?.pickTimeLimit}
                onResetDraft={handleResetDraft}
                onAddAITeams={handleAddAITeams}
                onDeleteTeam={handleDeleteTeam}
                leagueId={leagueId}
                maxTeams={league?.settings?.teamsCount || 12}
                joinCode={league?.join_code}
                leagueName={league?.name}
                scheduledDraftTime={league?.scheduled_draft_time}
                onScheduleDraft={isCommissioner ? handleScheduleDraft : undefined}
              />
            ) : null}
          </div>
        )}

        {/* Removed conflicting Loader2 spinner - main LoadingScreen handles all loading states */}

        {/* ACTIVE PHASE */}
        {!loading && !authLoading && !error && draftPhase === DraftPhase.ACTIVE && (
          <>
            {/* Show "Start Draft Timer" button if commissioner and no picks made yet - Disabled in demo state */}
            {isCommissioner && userLeagueState === 'active-user' && (draftHistory?.length || 0) === 0 && !league?.settings?.timerStartedAt && (
              <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6">
                <Card className="border-2 border-primary bg-primary/5">
                  <CardContent className="p-4 sm:p-6 text-center">
                    <h2 className="text-xl sm:text-2xl font-bold mb-2">Ready to Begin?</h2>
                    <p className="text-sm sm:text-base text-muted-foreground mb-4 sm:mb-6">
                      All teams are ready. Start the draft timer for the first pick.
                    </p>
                    <Button
                      onClick={handleBeginDraft}
                      size="lg"
                      className="bg-primary hover:bg-primary/90 text-base sm:text-lg px-6 sm:px-8 py-4 sm:py-6"
                    >
                      <Play className="h-5 w-5 mr-2" />
                      Start Draft
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Sticky Draft Header - Mobile-first compact design */}
            <div className="bg-card border-b sticky top-0 z-30 shadow-sm">
              <div className="px-3 py-2 md:container md:mx-auto md:px-4 md:py-3">
                {/* Row 1: Pick info + Timer + Action */}
                <div className="flex items-center justify-between gap-2">
                  {/* Left: Round/Pick + Team */}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs md:text-sm text-muted-foreground">
                      R{draftState?.currentRound || 1} • Pick {draftState?.currentPick || 1}/{(teams?.length || 0) * (draftSettings?.rounds || 21)}
                    </div>
                    {currentTeam && (
                      <div className="font-semibold text-sm md:text-lg truncate">
                        {currentTeam.team_name}
                        {currentTeam.owner_id === user?.id && (
                          <span className="ml-1 text-primary text-xs font-normal">(You)</span>
                        )}
                        {!currentTeam.owner_id && (
                          <span className="ml-1 text-orange-600 text-xs font-normal">(AI)</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Center: Timer */}
                  <div className="flex-shrink-0">
                    <DraftTimer
                      timeRemaining={timeRemaining}
                      isActive={draftPhase === DraftPhase.ACTIVE && !!currentTeam}
                      totalTime={draftSettings.pickTimeLimit}
                    />
                  </div>

                  {/* Right: Draft/Auto button */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {currentTeam?.owner_id === user?.id && userLeagueState === 'active-user' && (
                      <Button
                        variant="default"
                        size="sm"
                        className="text-xs md:text-sm"
                        onClick={selectedPlayer ? () => handlePlayerDraft(selectedPlayer) : handleAutoDraft}
                        disabled={!selectedPlayer && draftQueue.length === 0}
                      >
                        {selectedPlayer ? 'Draft' : 'Auto'}
                      </Button>
                    )}
                    {(userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => userLeagueState === 'guest' ? navigate('/auth') : navigate('/create-league')}
                      >
                        {userLeagueState === 'guest' ? 'Sign Up' : 'Create League'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Row 2: Selected player / recent pick (collapsible on mobile) */}
                {selectedPlayer ? (
                  <div className="mt-2 flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] flex-shrink-0">{selectedPlayer.position}</Badge>
                        <span className="font-bold text-sm truncate">{selectedPlayer.full_name}</span>
                        <span className="text-xs text-muted-foreground flex-shrink-0">{selectedPlayer.team}</span>
                      </div>
                      {/* Compact stat pills - scrollable on mobile to see ALL stats */}
                      <div className="flex items-center gap-1.5 mt-1 overflow-x-auto text-[10px] md:text-xs pb-0.5 scrollbar-styled">
                        {selectedPlayer.position === 'G' ? (
                          <>
                            <span className="flex-shrink-0 font-bold text-sm">{selectedPlayer.wins || 0}W</span>
                            <span className="text-muted-foreground">|</span>
                            <span className="flex-shrink-0">{selectedPlayer.losses || 0}L</span>
                            <span className="flex-shrink-0">{selectedPlayer.goals_against_average ? selectedPlayer.goals_against_average.toFixed(2) : '0.00'} GAA</span>
                            <span className="flex-shrink-0">{selectedPlayer.save_percentage ? (selectedPlayer.save_percentage * 100).toFixed(1) : '0.0'}%</span>
                            <span className="flex-shrink-0">{selectedPlayer.saves || 0}SV</span>
                            <span className="flex-shrink-0">{selectedPlayer.shutouts || 0}SO</span>
                          </>
                        ) : (
                          <>
                            <span className="flex-shrink-0 font-bold text-sm">{selectedPlayer.points} PTS</span>
                            <span className="text-muted-foreground">|</span>
                            <span className="flex-shrink-0">{selectedPlayer.goals}G</span>
                            <span className="flex-shrink-0">{selectedPlayer.assists}A</span>
                            <span className="flex-shrink-0">{selectedPlayer.plus_minus > 0 ? '+' : ''}{selectedPlayer.plus_minus}</span>
                            <span className="flex-shrink-0">{selectedPlayer.ppp || 0}PPP</span>
                            <span className="flex-shrink-0">{selectedPlayer.shp || 0}SHP</span>
                            <span className="flex-shrink-0">{selectedPlayer.shots}SOG</span>
                            <span className="flex-shrink-0">{selectedPlayer.hits}HIT</span>
                            <span className="flex-shrink-0">{selectedPlayer.blocks}BLK</span>
                            <span className="flex-shrink-0">{selectedPlayer.pim || 0}PIM</span>
                          </>
                        )}
                      </div>
                    </div>
                    {currentTeam?.owner_id === user?.id && userLeagueState === 'active-user' && (
                      <Button
                        onClick={(e) => { e.stopPropagation(); handlePlayerDraft(selectedPlayer); }}
                        size="sm"
                        className="flex-shrink-0 relative z-20 text-xs"
                        disabled={draftedPlayerIds.has(selectedPlayer.id)}
                      >
                        {draftedPlayerIds.has(selectedPlayer.id) ? 'Taken' : 'Draft'}
                      </Button>
                    )}
                  </div>
                ) : draftHistory.length > 0 ? (
                  (() => {
                    const mostRecent = draftHistory[draftHistory.length - 1];
                    const player = availablePlayers.find(p => p.id === mostRecent.player_id);
                    const team = teams.find(t => t.id === mostRecent.team_id);
                    if (!player || !team) return null;
                    return (
                      <div className="mt-2 flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-1.5 text-xs md:text-sm">
                        <span className="text-muted-foreground">Last:</span>
                        <span className="font-semibold truncate">{player.full_name}</span>
                        <span className="text-muted-foreground hidden sm:inline">to {team.team_name}</span>
                        <span className="text-muted-foreground">R{mostRecent.round_number}</span>
                      </div>
                    );
                  })()
                ) : null}

                {/* Queue badges - only show on desktop or if queue has items */}
                {draftQueue.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">Queue:</span>
                    {draftQueue.slice(0, 3).map((playerId) => {
                      const player = availablePlayers.find(p => p.id === playerId);
                      if (!player || draftedPlayerIds.has(playerId)) return null;
                      return (
                        <Badge key={playerId} variant="outline" className="text-[10px]">
                          {player.full_name.split(' ').pop()}
                        </Badge>
                      );
                    })}
                    {draftQueue.length > 3 && (
                      <Badge variant="outline" className="text-[10px]">+{draftQueue.length - 3}</Badge>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Draft Content */}
            <div className="container mx-auto px-2 sm:px-4 py-3 sm:py-6">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-6">
                {/* Main Draft Area */}
                <div className="lg:col-span-3">
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3 sm:space-y-6">
                    {/* Mobile: 4 tabs (includes Roster). Desktop: 3 tabs (Roster in sidebar) */}
                    <TabsList className="grid w-full grid-cols-4 lg:grid-cols-3 h-9 sm:h-10">
                      <TabsTrigger value="players" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-1 sm:px-3">
                        <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        <span className="hidden sm:inline">Players</span>
                        <span className="sm:hidden">Players</span>
                      </TabsTrigger>
                      <TabsTrigger value="board" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-1 sm:px-3">
                        <Trophy className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        Board
                      </TabsTrigger>
                      <TabsTrigger value="history" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-1 sm:px-3">
                        <History className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        History
                      </TabsTrigger>
                      <TabsTrigger value="roster" className="flex items-center gap-1 text-xs px-1 lg:hidden">
                        <Star className="h-3.5 w-3.5" />
                        Roster
                      </TabsTrigger>
                    </TabsList>

                    {/* Auction Draft Bidding Panel */}
                    {isAuctionDraft && auctionState && draftPhase === DraftPhase.ACTIVE && (
                      <div className="mb-4 p-4 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-bold text-sm flex items-center gap-2">
                            <span className="text-amber-600">$</span> Auction Draft
                          </h3>
                          <Badge variant="outline" className="text-xs font-bold">
                            Budget: ${auctionState.myBudget}
                          </Badge>
                        </div>

                        {auctionState.currentNomination ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-background border">
                              <div>
                                <div className="font-bold">{auctionState.currentNomination.player_name}</div>
                                <div className="text-xs text-muted-foreground">
                                  Current bid: <span className="font-bold text-amber-600">${auctionState.currentNomination.current_high_bid}</span>
                                </div>
                                <div className={`text-[10px] font-bold ${(auctionTimeRemaining ?? 99) <= 10 ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`}>
                                  {auctionTimeRemaining !== null ? `${auctionTimeRemaining}s remaining` : `Expires: ${new Date(auctionState.currentNomination.expires_at).toLocaleTimeString()}`}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={auctionState.currentNomination.current_high_bid + 1}
                                  max={auctionState.myBudget}
                                  value={bidAmount}
                                  onChange={(e) => setBidAmount(Math.max(1, parseInt(e.target.value) || 1))}
                                  className="w-20 h-8 text-center text-sm border rounded px-2"
                                />
                                <Button
                                  size="sm"
                                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold"
                                  disabled={bidAmount <= auctionState.currentNomination.current_high_bid || bidAmount > auctionState.myBudget}
                                  onClick={async () => {
                                    if (!auctionState.currentNomination?.id || !userTeam?.id || !leagueId) return;
                                    const result = await AuctionDraftService.placeBid(
                                      leagueId,
                                      auctionState.currentNomination.id,
                                      userTeam.id,
                                      bidAmount
                                    );
                                    if (result.success) {
                                      toast({ title: 'Bid Placed', description: `You bid $${bidAmount}` });
                                      // Refresh auction state
                                      if (auctionSessionId) {
                                        const refreshed = await AuctionDraftService.getAuctionState(leagueId, auctionSessionId);
                                        if (refreshed) {
                                          const myBudget = refreshed.budgets.find(b => b.team_id === userTeam.id);
                                          setAuctionState(prev => prev ? {
                                            ...prev,
                                            currentNomination: refreshed.current_nomination ? {
                                              id: refreshed.current_nomination.id || '',
                                              player_id: refreshed.current_nomination.player_id,
                                              player_name: refreshed.current_nomination.player_name,
                                              current_high_bid: refreshed.current_nomination.current_high_bid,
                                              current_high_bidder_team_id: refreshed.current_nomination.current_high_bidder_team_id,
                                              expires_at: refreshed.current_nomination.expires_at,
                                            } : null,
                                            myBudget: myBudget?.remaining_budget ?? prev.myBudget,
                                          } : prev);
                                        }
                                      }
                                    } else {
                                      toast({ title: 'Bid Failed', description: result.error || 'Could not place bid', variant: 'destructive' });
                                    }
                                  }}
                                >
                                  Bid ${bidAmount}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-4 text-sm text-muted-foreground">
                            {auctionState.isMyTurnToNominate && selectedPlayer ? (
                              <Button
                                className="bg-amber-500 hover:bg-amber-600 text-white font-bold"
                                onClick={async () => {
                                  if (!leagueId || !auctionSessionId || !userTeam?.id || !selectedPlayer) return;
                                  const result = await AuctionDraftService.nominatePlayer(
                                    leagueId,
                                    auctionSessionId,
                                    userTeam.id,
                                    String(selectedPlayer.id),
                                    selectedPlayer.full_name,
                                    1, // opening bid
                                    30  // timer seconds
                                  );
                                  if (result.success && result.nomination) {
                                    toast({ title: 'Player Nominated', description: `${selectedPlayer.full_name} is up for bidding!` });
                                    setAuctionNominationId(result.nomination.id || null);
                                    setBidAmount(2); // Set to minimum overbid
                                    // Refresh auction state
                                    const refreshed = await AuctionDraftService.getAuctionState(leagueId, auctionSessionId);
                                    if (refreshed) {
                                      const myBudget = refreshed.budgets.find(b => b.team_id === userTeam.id);
                                      setAuctionState(prev => prev ? {
                                        ...prev,
                                        currentNomination: refreshed.current_nomination ? {
                                          id: refreshed.current_nomination.id || '',
                                          player_id: refreshed.current_nomination.player_id,
                                          player_name: refreshed.current_nomination.player_name,
                                          current_high_bid: refreshed.current_nomination.current_high_bid,
                                          current_high_bidder_team_id: refreshed.current_nomination.current_high_bidder_team_id,
                                          expires_at: refreshed.current_nomination.expires_at,
                                        } : null,
                                        myBudget: myBudget?.remaining_budget ?? prev.myBudget,
                                        isMyTurnToNominate: false,
                                      } : prev);
                                    }
                                  } else {
                                    toast({ title: 'Error', description: result.error || 'Could not nominate player', variant: 'destructive' });
                                  }
                                }}
                              >
                                Nominate {selectedPlayer.full_name}
                              </Button>
                            ) : auctionState.isMyTurnToNominate ? (
                              <>
                                <p className="font-medium text-amber-600">Your turn to nominate!</p>
                                <p className="text-xs mt-1">Select a player below to nominate them for bidding.</p>
                              </>
                            ) : (
                              <>
                                <p className="font-medium">Waiting for nomination...</p>
                                <p className="text-xs mt-1">Another team is selecting a player to nominate.</p>
                              </>
                            )}
                          </div>
                        )}

                        {/* Bid History — real-time transparency */}
                        {auctionState.bidHistory && auctionState.bidHistory.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-amber-200">
                            <div className="text-xs font-semibold text-muted-foreground mb-2">Bid History</div>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {auctionState.bidHistory.map((bid, i) => {
                                const teamName = auctionState.budgets.find(b => b.team_id === bid.team_id)?.team_name || 'Unknown';
                                return (
                                  <div key={i} className={`flex justify-between text-xs p-1.5 rounded ${i === 0 ? 'bg-amber-100 dark:bg-amber-900/30 font-bold' : 'bg-muted/30'}`}>
                                    <span className="truncate">{teamName}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-amber-600">${bid.bid_amount}</span>
                                      {bid.created_at && <span className="text-muted-foreground">{new Date(bid.created_at).toLocaleTimeString()}</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Budget overview for all teams */}
                        {auctionState.budgets.length > 0 && (
                          <div className="mt-3 pt-3 border-t">
                            <div className="text-xs font-semibold text-muted-foreground mb-2">Team Budgets</div>
                            <div className="grid grid-cols-2 gap-1">
                              {auctionState.budgets.map(b => (
                                <div key={b.team_id} className="flex justify-between text-xs p-1 rounded bg-muted/30">
                                  <span className="truncate">{b.team_name}</span>
                                  <span className="font-bold">${b.remaining_budget}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Always render players tab */}
                    <TabsContent value="players" className="space-y-0">
                      <PlayerPool
                        onPlayerSelect={setSelectedPlayer}
                        onPlayerDraft={isAuctionDraft ? (player) => {
                          // In auction mode, selecting a player queues them for nomination
                          setSelectedPlayer(player);
                          if (auctionState?.isMyTurnToNominate) {
                            toast({ title: 'Player Selected', description: `Click "Nominate ${player.full_name}" above to start bidding.` });
                          } else {
                            toast({ title: 'Player Selected', description: `${player.full_name} selected. You can nominate when it's your turn.` });
                          }
                        } : handlePlayerDraft}
                        selectedPlayer={selectedPlayer}
                        draftedPlayers={Array.from(draftedPlayerIds)}
                        isDraftActive={draftPhase === DraftPhase.ACTIVE}
                        availablePlayers={availablePlayers}
                        onAddToQueue={handleAddToQueue}
                        onToggleWatchlist={handleToggleWatchlist}
                        queue={draftQueue}
                        watchlist={watchlist}
                      />
                    </TabsContent>

                    {/* Lazy load other tabs - only render when active */}
                     {activeTab === 'board' && (
                       <TabsContent value="board" className="space-y-0">
                         <DraftBoard 
                           teams={(orderedTeamsForBoard.length > 0 ? orderedTeamsForBoard : teams).map(t => ({
                             id: t.id,
                             name: t.team_name,
                             owner: (t as any).owner_name || (t.owner_id ? 'User' : 'AI'),
                             color: '#7CB518',
                             picks: teamPicksMap.get(t.id) || []
                           }))}
                           draftHistory={transformedDraftHistory}
                           currentPick={draftState?.currentPick || 1}
                           currentRound={draftState?.currentRound || 1}
                           totalRounds={league?.draft_rounds || draftSettings.rounds || 21}
                           onPlayerClick={handlePlayerClick}
                           draftType={((league?.settings as any)?.draftType || 'snake') as 'snake' | 'linear'}
                         />
                       </TabsContent>
                     )}

                    {activeTab === 'history' && (
                      <TabsContent value="history" className="space-y-0">
                        <DraftHistory
                          draftHistory={transformedDraftHistory}
                        />
                      </TabsContent>
                    )}

                    {/* Mobile-only Roster tab (mirrors sidebar content) */}
                    {activeTab === 'roster' && (
                      <TabsContent value="roster" className="space-y-3 lg:hidden">
                        {/* Team selector */}
                        <Card className="p-3">
                          <Select
                            value={selectedTeamId || userTeam?.id || ''}
                            onValueChange={setSelectedTeamId}
                          >
                            <SelectTrigger className="text-sm">
                              <SelectValue placeholder="Select team" />
                            </SelectTrigger>
                            <SelectContent>
                              {teams.map(team => (
                                <SelectItem key={team.id} value={team.id}>
                                  {team.team_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Card>

                        {/* Selected team roster */}
                        {(() => {
                          const teamIdToShow = selectedTeamId || userTeam?.id;
                          if (!teamIdToShow) return null;
                          const selectedTeam = teams.find(t => t.id === teamIdToShow);
                          if (!selectedTeam) return null;
                          const teamPicks = transformedDraftHistory.filter(p => p.teamId === teamIdToShow);
                          const teamPlayers = teamPicks.map(p => availablePlayers.find(ap => ap.id === p.playerId)).filter((p): p is Player => p !== undefined);
                          return (
                            <RosterDepthChart
                              draftedPlayers={teamPlayers}
                              draftPicks={draftHistory}
                              currentRound={draftState?.currentRound || 1}
                              totalRounds={draftSettings.rounds}
                            />
                          );
                        })()}

                        {/* Draft from selected player */}
                        {currentTeam?.owner_id === user?.id && selectedPlayer && (
                          <Card className="p-4 border-2 border-fantasy-primary shadow-lg bg-card">
                            <div className="text-center mb-3">
                              <div className="text-lg font-bold">{selectedPlayer.full_name}</div>
                              <div className="text-xs text-muted-foreground flex items-center justify-center gap-2">
                                <Badge variant="outline">{selectedPlayer.position}</Badge>
                                <span>{selectedPlayer.team}</span>
                                <span className="font-semibold text-fantasy-primary">{selectedPlayer.points} PTS</span>
                              </div>
                            </div>
                            <Button
                              onClick={(e) => { e.stopPropagation(); handlePlayerDraft(selectedPlayer); }}
                              className="w-full bg-fantasy-primary hover:bg-fantasy-primary/90 py-4"
                              size="lg"
                              disabled={draftedPlayerIds.has(selectedPlayer.id)}
                            >
                              {draftedPlayerIds.has(selectedPlayer.id) ? 'Already Drafted' : 'Draft This Player'}
                            </Button>
                          </Card>
                        )}

                        {/* Commissioner controls on mobile */}
                        {isCommissioner && (
                          <details className="group">
                            <summary className="cursor-pointer text-sm font-semibold mb-2 p-2 bg-muted/50 rounded hover:bg-muted/70 transition-colors text-destructive">
                              Commissioner Controls
                            </summary>
                            <div className="mt-2 space-y-2">
                              <DraftControls
                                isDraftActive={!!league?.settings?.timerStartedAt}
                                onPause={handlePauseDraft}
                                onContinue={handleContinueDraft}
                                canPause={!!league?.settings?.timerStartedAt && draftPhase === DraftPhase.ACTIVE}
                                canContinue={!league?.settings?.timerStartedAt && draftPhase === DraftPhase.ACTIVE}
                                onUndoLastPick={isCommissioner ? handleUndoLastPick : undefined}
                                canUndo={isCommissioner && draftHistory.length > 0}
                                pickTimeLimit={draftSettings.pickTimeLimit}
                              />
                            </div>
                          </details>
                        )}
                      </TabsContent>
                    )}
                  </Tabs>
                </div>

                {/* Right Sidebar - Teams (hidden on mobile, shown on lg+) */}
                <div className="hidden lg:block lg:col-span-1 space-y-4">
                  {/* Teams Selector */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Teams</CardTitle>
                      <Select 
                        value={selectedTeamId || userTeam?.id || ''} 
                        onValueChange={setSelectedTeamId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select team" />
                        </SelectTrigger>
                        <SelectContent>
                          {teams.map(team => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.team_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardHeader>
                    <CardContent>
                      {/* Show roster for selected team */}
                      {(() => {
                        const teamIdToShow = selectedTeamId || userTeam?.id;
                        if (!teamIdToShow) return null;
                        
                        const selectedTeam = teams.find(t => t.id === teamIdToShow);
                        if (!selectedTeam) return null;
                        
                        const teamPicks = transformedDraftHistory.filter(p => p.teamId === teamIdToShow);
                        const teamPlayers = teamPicks.map(p => {
                          const player = availablePlayers.find(ap => ap.id === p.playerId);
                          return player;
                        }).filter((p): p is Player => p !== undefined);
                        
                        return (
                          <RosterDepthChart
                            draftedPlayers={teamPlayers}
                            draftPicks={draftHistory}
                            currentRound={draftState?.currentRound || 1}
                            totalRounds={draftSettings.rounds}
                          />
                        );
                      })()}
                    </CardContent>
                  </Card>
                  
                  {/* User's Roster Depth Chart */}
                  {userTeam && (
                    <RosterDepthChart
                      draftedPlayers={userDraftedPlayers}
                      draftPicks={draftHistory}
                      currentRound={draftState?.currentRound || 1}
                      totalRounds={draftSettings.rounds}
                      availablePlayers={availablePlayers.filter(p => !draftedPlayerIds.has(p.id))}
                      onAddToQueue={handleAddToQueue}
                    />
                  )}
                  
                  {/* Prominent Draft Button - Only show when it's user's turn and player selected */}
                  {currentTeam?.owner_id === user?.id && selectedPlayer && (
                    <Card className="p-6 border-2 border-fantasy-primary shadow-lg bg-card">
                      <div className="text-center mb-4">
                        <div className="text-xl font-bold mb-1">{selectedPlayer.full_name}</div>
                        <div className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                          <Badge variant="outline">{selectedPlayer.position}</Badge>
                          <span>•</span>
                          <span>{selectedPlayer.team}</span>
                          <span>•</span>
                          <span className="font-semibold text-fantasy-primary">{selectedPlayer.points} PTS</span>
                        </div>
                      </div>
                      <Button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayerDraft(selectedPlayer);
                        }}
                        className="w-full bg-fantasy-primary hover:bg-fantasy-primary/90 text-lg py-6 relative z-20 pointer-events-auto"
                        size="lg"
                        disabled={draftedPlayerIds.has(selectedPlayer.id)}
                      >
                        {draftedPlayerIds.has(selectedPlayer.id) ? 'Already Drafted' : 'Draft This Player'}
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full mt-2"
                        onClick={() => setSelectedPlayer(null)}
                      >
                        Cancel
                      </Button>
                    </Card>
                  )}

                  {/* Simplified Queue - only show if items exist */}
                  {draftQueue.length > 0 && (
                    <DraftQueue
                      queue={draftQueue}
                      players={availablePlayers}
                      draftedPlayers={Array.from(draftedPlayerIds)}
                      onQueueChange={handleQueueChange}
                      onDraftFromQueue={handleDraftFromQueue}
                      isDraftActive={draftPhase === DraftPhase.ACTIVE}
                      isYourTurn={currentTeam?.owner_id === user?.id}
                      leagueId={leagueId || undefined}
                      currentPick={draftState?.currentPick}
                      totalPicks={teams.length * draftSettings.rounds}
                    />
                  )}

                  {/* Commissioner Controls - Collapsible */}
                  {isCommissioner && (
                    <details className="group">
                      <summary className="cursor-pointer text-sm font-semibold mb-2 p-2 bg-muted/50 rounded hover:bg-muted/70 transition-colors text-destructive">
                        Commissioner Controls
                      </summary>
                      <div className="mt-2 space-y-2">
                        <DraftControls
                          isDraftActive={!!league?.settings?.timerStartedAt}
                          onPause={handlePauseDraft}
                          onContinue={handleContinueDraft}
                          canPause={!!league?.settings?.timerStartedAt && draftPhase === DraftPhase.ACTIVE}
                          canContinue={!league?.settings?.timerStartedAt && draftPhase === DraftPhase.ACTIVE}
                          onUndoLastPick={isCommissioner ? handleUndoLastPick : undefined}
                          canUndo={isCommissioner && draftHistory.length > 0}
                          pickTimeLimit={draftSettings.pickTimeLimit}
                        />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" className="w-full">
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Draft &amp; Start Over
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Draft Completely?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete ALL draft picks, reset the draft order, and return everyone to the lobby. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleNuclearDeleteDraft}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Yes, Delete Everything
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </details>
                  )}

                  {/* Floating Pause/Continue button for active drafts */}
                  {isCommissioner && draftPhase === DraftPhase.ACTIVE && (draftHistory?.length || 0) > 0 && (
                    <div className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-50">
                      {!!league?.settings?.timerStartedAt ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="shadow-lg sm:h-10 sm:px-4 sm:text-sm"
                          onClick={handlePauseDraft}
                        >
                          <Pause className="h-4 w-4 mr-1 sm:mr-2" />
                          <span className="hidden sm:inline">Pause Draft</span>
                          <span className="sm:hidden">Pause</span>
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="shadow-lg sm:h-10 sm:px-4 sm:text-sm"
                          onClick={handleContinueDraft}
                        >
                          <Play className="h-4 w-4 mr-1 sm:mr-2" />
                          <span className="hidden sm:inline">Continue Draft</span>
                          <span className="sm:hidden">Resume</span>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* COMPLETED PHASE - DRAFT SUMMARY */}
        {!loading && !error && draftPhase === DraftPhase.COMPLETED && (
          <div className="container mx-auto px-4 py-8">
            <Card className="max-w-2xl mx-auto text-center p-8 mb-8">
              <div className="inline-flex items-center justify-center p-4 bg-green-100 text-green-700 rounded-full mb-6">
                <CheckCircle className="h-12 w-12" />
              </div>
              <h1 className="text-4xl font-bold mb-4">Congratulations!</h1>
              <p className="text-xl text-muted-foreground mb-6">
                The draft is complete! Your rosters are now locked and ready for the season.
              </p>
              {/* Demo State CTA - Hidden from public */}
              {false && userLeagueState === 'logged-in-no-league' && (
                <div className="max-w-3xl mx-auto mb-8">
                  <LeagueCreationCTA
                    title="Your Draft Awaits"
                    description="Create your league to start drafting players, building your team, and competing with friends."
                  />
                </div>
              )}
              
              <div className="flex gap-4 justify-center flex-wrap">
                {/* Disable navigation buttons in demo state */}
                {userLeagueState === 'active-user' ? (
                  <>
                <Button onClick={() => navigate(`/roster?league=${leagueId}`)}>
                  View My Roster
                </Button>
                <Button variant="outline" onClick={() => navigate(`/standings?league=${leagueId}`)}>
                  View Standings
                </Button>
                <Button 
                  variant="default" 
                  onClick={handleViewDraftSnapshot}
                  disabled={savingSnapshot}
                  className="bg-fantasy-primary hover:bg-fantasy-primary/90"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  {savingSnapshot ? 'Saving...' : 'View Draft Results'}
                </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={() => navigate('/auth')}>
                      Sign Up to Create Your League
                    </Button>
                    <Button variant="outline" onClick={() => navigate('/standings')}>
                      View Standings
                    </Button>
                  </>
                )}
              </div>
            </Card>

                  <Card className="card-citrus border-none shadow-md">
                     <CardHeader>
                        <CardTitle>Draft Board Results</CardTitle>
                     </CardHeader>
                     <CardContent>
                        <DraftBoard 
                           teams={(orderedTeamsForBoard.length > 0 ? orderedTeamsForBoard : teams).map(t => ({
                             id: t.id,
                             name: t.team_name,
                             owner: t.owner_id ? 'Owner' : 'AI',
                             color: '#7CB518',
                             picks: teamPicksMap.get(t.id) || []
                           }))}
                           draftHistory={transformedDraftHistory}
                           currentPick={draftState?.currentPick || 1}
                           currentRound={draftState?.currentRound || 1}
                           totalRounds={league?.draft_rounds || draftSettings.rounds || 21}
                           onPlayerClick={handlePlayerClick}
                           draftType={((league?.settings as any)?.draftType || 'snake') as 'snake' | 'linear'}
                        />
                     </CardContent>
                  </Card>
            
            {isCommissioner && (
               <div className="fixed bottom-4 left-4">
               </div>
            )}

            {/* Show Pause/Continue buttons for in-progress drafts - Disabled in demo state */}
            {isCommissioner && userLeagueState === 'active-user' && draftPhase === DraftPhase.ACTIVE && (draftHistory?.length || 0) > 0 && (
              <div className="fixed bottom-4 right-4 z-50">
                {!!league?.settings?.timerStartedAt ? (
                  <Button
                    size="lg"
                    variant="destructive"
                    className="shadow-lg"
                    onClick={handlePauseDraft}
                  >
                    <Pause className="h-5 w-5 mr-2" />
                    Pause Draft
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="shadow-lg"
                    onClick={handleContinueDraft}
                  >
                    <Play className="h-5 w-5 mr-2" />
                    Continue Draft
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                <AdSpace size="300x250" label="Draft Sponsor" />
                <AdSpace size="300x250" label="Fantasy Partner" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && (activeLeagueId || leagueId) && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId || leagueId || ''} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <Footer />
      
      {/* Player Stats Modal */}
      <PlayerStatsModal
        player={selectedPlayerForStats}
        isOpen={isPlayerDialogOpen}
        onClose={() => setIsPlayerDialogOpen(false)}
      />
      
      {/* Draft Snapshot View Modal */}
      <DraftSnapshotView
        isOpen={isSnapshotModalOpen}
        onClose={() => setIsSnapshotModalOpen(false)}
        snapshotData={snapshotData}
        createdAt={snapshotCreatedAt}
      />
      
      {/* ABSOLUTE FALLBACK - Only render if LOBBY condition matched but data is missing */}
      {!loading && !authLoading && user && !error && 
       draftPhase !== DraftPhase.ACTIVE && 
       draftPhase !== DraftPhase.COMPLETED &&
       (!league || !teams || !Array.isArray(teams) || teams.length === 0) && (
        <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
          <Card className="max-w-md mx-4">
            <CardHeader>
              <CardTitle>Unexpected State</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The draft room is in an unexpected state. Please refresh the page.
              </p>
              <div className="text-xs font-mono bg-muted p-3 rounded space-y-1">
                <p>Loading: {String(loading)}</p>
                <p>Auth Loading: {String(authLoading)}</p>
                <p>Has User: {String(!!user)}</p>
                <p>Error: {String(error || 'null')}</p>
                <p>Draft Phase: {String(draftPhase)}</p>
                <p>Has League: {String(!!league)}</p>
                <p>Teams: {teams?.length || 0}</p>
                <p>League ID: {leagueId || 'null'}</p>
              </div>
              <Button onClick={() => window.location.reload()} className="w-full">
                Refresh Page
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default DraftRoom;
