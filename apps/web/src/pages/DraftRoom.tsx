import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { LeagueService, League, Team, LEAGUE_TEAMS_DATA } from '@/services/LeagueService';
import type { LeagueSettings } from '@/types/leagueTypes';
import { DraftService, DraftPick, DraftState, clearDraftCache } from '@/services/DraftService';
import { PlayerService, Player } from '@/services/PlayerService';
import { AuctionDraftService } from '@/services/AuctionDraftService';
import { supabase } from '@/integrations/supabase/client';
import { leagueApi } from '@/api/leagues';
import { playerApi } from '@/api/players';
import { publicApi } from '@/api/public';
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
import { ConnectionStatus } from '@/components/draft/ConnectionStatus';
import { RosterDepthChart } from '@/components/draft/RosterDepthChart';
import { DraftSnapshotView } from '@/components/draft/DraftSnapshotView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Clock, Trophy, History, CheckCircle, Loader2, Zap, Play, Pause, Camera, Trash2, Star, RotateCcw } from 'lucide-react';
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
import { ScoringCalculator, type ScoringSettings } from '@/utils/scoringUtils';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { useToast } from '@/hooks/use-toast';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';

// DraftPick interface is now imported from DraftService
// Team interface is now imported from LeagueService

// Safe sessionStorage helpers — prevent crashes in private/incognito browsing
// where sessionStorage.setItem() throws QuotaExceededError
const ssGet = (key: string): string | null => {
  try { return sessionStorage.getItem(key); } catch { return null; }
};
const ssSet = (key: string, value: string): void => {
  try { sessionStorage.setItem(key, value); } catch { /* private browsing */ }
};
const ssRemove = (key: string): void => {
  try { sessionStorage.removeItem(key); } catch { /* private browsing */ }
};

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
  const { userLeagueState, activeLeagueId, activeLeagueFormat } = useLeague();
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
  // Map of player_id → { projectedFpts, projectedFptsPerGp, gamesRemaining }
  const [projectedFptsMap, setProjectedFptsMap] = useState<Map<string, { total: number; perGp: number; gamesRemaining: number }>>(new Map());
  
  const [draftPhase, setDraftPhase] = useState<DraftPhase>(() => {
    // Restore previous phase from sessionStorage on mount so users who refresh
    // during an active draft don't get stuck on the LOBBY screen while the
    // realtime subscription is still connecting. Tied to leagueId in the cache
    // key so switching leagues doesn't inherit another league's phase.
    try {
      const match = window.location.pathname.match(/\/draft(?:-room)?\/([^/]+)/);
      const lid = match?.[1];
      if (lid) {
        const cached = sessionStorage.getItem(`draft_phase_${lid}`);
        if (cached) {
          const n = parseInt(cached, 10);
          if (Number.isFinite(n) && n >= 0 && n <= 3) return n as DraftPhase;
        }
      }
    } catch { /* sessionStorage disabled (private browsing) — fall through */ }
    return DraftPhase.LOBBY;
  });
  const [timeRemaining, setTimeRemaining] = useState(90); // Will be updated from league settings when loaded
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [pickInProgress, setPickInProgress] = useState(false);
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
  const [activeTab, setActiveTab] = useState<string>(() => {
    try { return sessionStorage.getItem('draftRoomTab') || 'players'; } catch { return 'players'; }
  });
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    try { sessionStorage.setItem('draftRoomTab', tab); } catch { /* quota */ }
  };
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
  const [userAutoDraftEnabled, setUserAutoDraftEnabled] = useState(false);
  // Realtime channel health — surfaces a banner when the draft-pick channel
  // drops so users know their picks may stall. 'connected' = hidden.
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('connected');
  // State-driven confirmation dialog (replaces window.confirm which fails in mobile PWA)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    action: string;
    onConfirm: () => void;
  } | null>(null);

  // Calculate loading state for minimum loading time hook
  const actualLoading = loading || authLoading || (!user && userLeagueState !== 'guest' && userLeagueState !== 'logged-in-no-league');
  const displayLoading = useMinimumLoadingTime(actualLoading, 400);

  // ── Lookup Maps (O(1) instead of O(n) for .find()) ──────────────
  const teamsById = useMemo(() => {
    const map = new Map<string, Team & { owner_name?: string }>();
    teams.forEach(t => map.set(t.id, t));
    return map;
  }, [teams]);

  // Stable array of drafted player IDs — avoids re-creating on every render for child props
  const draftedPlayerIdsArray = useMemo(() => Array.from(draftedPlayerIds), [draftedPlayerIds]);

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
  }, [user, navigate, searchParams, activeLeagueId]);

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

        // Get the demo league via public API (no auth required)
        const leagueResponse = await publicApi.getLeague(DEMO_LEAGUE_ID_FOR_GUESTS);

        if (!leagueResponse.data) {
          logger.error('[DraftRoom] Error loading demo league: no data returned');
          setError('Failed to load demo league. Please try again.');
          setLoading(false);
          return;
        }

        const demoLeague = leagueResponse.data as unknown as League;
        logger.debug('[DraftRoom] Demo league loaded:', demoLeague.id);
        setLeague(demoLeague);
        setIsCommissioner(false); // Guests are never commissioners

        // Get teams from the demo league via public API (no auth required)
        const teamsResponse = await publicApi.getTeams(DEMO_LEAGUE_ID_FOR_GUESTS);
        const demoTeamsData = teamsResponse.data as unknown[] | null;

        if (!demoTeamsData || (demoTeamsData as unknown[]).length === 0) {
          logger.error('[DraftRoom] Error loading demo teams: no teams returned');
          setError('Failed to load demo teams. Please try again.');
          setLoading(false);
          return;
        }
        
        // Map database teams and add owner names from LEAGUE_TEAMS_DATA
        const demoTeams: (Team & { owner_name?: string })[] = (demoTeamsData as unknown as Team[]).map((team, index) => {
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
        
        // Get REAL draft picks via public API (no auth required)
        // Use DemoLeagueService which already wraps the public API endpoints
        const { DemoLeagueService } = await import('@/services/DemoLeagueService');
        const { data: draftPicksData, error: picksError } = await DemoLeagueService.getDemoDraftPicks();

        if (picksError) {
          logger.error('[DraftRoom] Error loading demo draft picks:', picksError);
          setError('Failed to load demo draft picks. Please try again.');
          setLoading(false);
          return;
        }

        const demoPicks: DraftPick[] = (draftPicksData || []) as unknown as DraftPick[];
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
    // Clear stale cache on page load/refresh so we always get fresh state
    clearDraftCache();

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
      const isReturnVisit = ssGet(`draft_phase_${leagueId}`);
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
        if ((leagueError as Error).message?.includes('Access denied') || (leagueError as Error).message?.includes('not a member')) {
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

      // Load user's team early (needed by auction state below)
      const { team: userTeamData } = await LeagueService.getUserTeam(leagueId, user.id);
      setUserTeam(userTeamData);

      // Detect auction draft type
      const draftTypeFromSettings = (leagueData.settings as LeagueSettings)?.draftType;
      if (draftTypeFromSettings === 'auction') {
        setIsAuctionDraft(true);
        const defaultBudget = (leagueData.settings as LeagueSettings)?.auctionBudget ?? 200;
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
            await leagueApi.updateDraftSettings(leagueId, { draft_status: 'not_started' });
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
        // Draft queued/prepared — let ALL users into the draft room immediately.
        // Industry standard: the draft room opens when the commissioner sets it
        // up (queues it). Users browse players, build their queue, check
        // rankings, all BEFORE the commissioner clicks "Start Draft" to begin
        // the timer. Keeping users in LOBBY until in_progress meant they
        // couldn't prepare and felt locked out.
        setDraftState(null);
        setDraftPhase(DraftPhase.ACTIVE);
        ssSet(`draft_phase_${leagueId}`, String(DraftPhase.ACTIVE));
        logger.debug('DraftRoom: Draft queued, entering ACTIVE (pre-draft room)');
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

        // Auto-join: state is pre-loaded above, no reason to force a manual "Join" click.
        // This matches the realtime path (line 1241) and prevents users who arrive
        // during an active draft from being stuck watching the lobby while picks happen.
        setDraftPhase(DraftPhase.ACTIVE);
        ssSet(`draft_phase_${leagueId}`, String(DraftPhase.ACTIVE));
        logger.debug('DraftRoom: Auto-joined in-progress draft on initial load');
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
        ssRemove(`draft_phase_${leagueId}`);
        ssRemove(`draft_timer_${leagueId}`);
        logger.debug('DraftRoom: Draft completed, showing COMPLETED phase');
      } else {
        // Unknown status - default to lobby
        setDraftState(null);
        setDraftPhase(DraftPhase.LOBBY);
        logger.debug('DraftRoom: Unknown draft status, defaulting to LOBBY');
      }

      // Load available players + ROS projections in parallel
      const [allPlayers, rosProjectionsRes] = await Promise.all([
        PlayerService.getAllPlayers(),
        playerApi.getRosProjections(500).catch(() => ({ data: [] }))
      ]);
      setAvailablePlayers(allPlayers);

      // Build projected FPTS lookup map (keyed by string player_id).
      // Recalculate using LEAGUE scoring settings instead of the pre-baked
      // default-scoring totals stored in the DB.
      const projScorer = new ScoringCalculator(leagueData?.scoring_settings as unknown as ScoringSettings | undefined);
      const projMap = new Map<string, { total: number; perGp: number; gamesRemaining: number }>();
      interface RosRow {
        player_id: number; is_goalie?: boolean; games_remaining: number;
        projected_goals?: number; projected_assists?: number; projected_sog?: number;
        projected_blocks?: number; projected_ppp?: number; projected_shp?: number;
        projected_hits?: number; projected_pim?: number;
        projected_wins_ros?: number; projected_saves_ros?: number; projected_shutouts_ros?: number;
        total_projected_points?: number; avg_points_per_game?: number;
      }
      const rosData = (rosProjectionsRes as { data?: RosRow[] }).data;
      if (Array.isArray(rosData)) {
        rosData.forEach((p) => {
          const gr = p.games_remaining || 0;
          let total: number;
          if (p.is_goalie) {
            total = projScorer.calculatePoints(
              { wins: p.projected_wins_ros || 0, saves: p.projected_saves_ros || 0, shutouts: p.projected_shutouts_ros || 0, goals_against: 0 },
              true
            );
          } else {
            total = projScorer.calculatePoints(
              { goals: p.projected_goals || 0, assists: p.projected_assists || 0, shots: p.projected_sog || 0, blocks: p.projected_blocks || 0, hits: p.projected_hits || 0, pim: p.projected_pim || 0, ppp: p.projected_ppp || 0, shp: p.projected_shp || 0 },
              false
            );
          }
          projMap.set(String(p.player_id), {
            total,
            perGp: gr > 0 ? total / gr : 0,
            gamesRemaining: gr,
          });
        });
      }
      setProjectedFptsMap(projMap);

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
  // All other values used inside are either React state setters (guaranteed stable by React),
  // module-level imports, or constants. draftPhase/resolveTeamOrder/teams.length are excluded because
  // loadDraftData sets teams and draftPhase, so including them would cause infinite re-render loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!user && (userLeagueState as string) !== 'guest' && (userLeagueState as string) !== 'logged-in-no-league') {
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


  // Realtime subscription — optimized for instant UI updates on remote clients.
  // When any client makes a pick, every other client must IMMEDIATELY see:
  //   1. Timer reset (<1ms, synchronous setState)
  //   2. New pick in history (optimistic insert from realtime payload)
  //   3. Updated currentPick / currentRound / nextTeamId (computed LOCALLY)
  // A single background fetch reconciles against the server. No loadDraftState
  // round-trip (which would add ~300–800ms of blocking API calls on mobile).
  //
  // Rate-limit the background reconciliation: during autopick bursts the
  // server can emit 6–8 realtime events in a few seconds. Without this
  // gate each event triggered two parallel API calls — with 4 clients
  // subscribed that's ~50 superfluous fetches per burst, which was the
  // client-side lag source observed during the canary.
  const lastReconcileAtRef = useRef<number>(0);
  const RECONCILE_MIN_INTERVAL_MS = 1500;

  useEffect(() => {
    if (!leagueId || !user?.id) return;

    const unsubscribe = DraftService.subscribeToDraftPicks(
      leagueId,
      user.id,
      async (newPick) => {
      logger.debug('DraftRoom: New pick received via realtime:', newPick);

      // Ignore own picks — handlePlayerDraft already updated local state optimistically,
      // and reprocessing here would cause double-counting or visual flicker.
      const alreadyHave = draftHistoryRef.current.some(p => p.id === newPick.id || p.player_id === newPick.player_id);
      if (alreadyHave) {
        logger.debug('DraftRoom: Pick already in local history, skipping');
        return;
      }

      // Play a subtle sound when another team picks
      if (newPick.team_id !== userTeamRef.current?.id) {
        playOpponentPickSound();
      }

      // ── INSTANT VISUAL UPDATES (all synchronous, no network) ────────
      // 1. Timer reset — all clients see countdown restart immediately
      const optimisticTimerStart = new Date().toISOString();
      setLeague(prev => prev ? {
        ...prev,
        settings: { ...prev.settings, timerStartedAt: optimisticTimerStart }
      } : null);

      if (!draftTimerStartedRef.current) {
        setDraftTimerStarted(true);
        draftTimerStartedRef.current = true;
      }

      // 2. Append the new pick to history (from the realtime payload itself — no fetch!)
      const nextHistory = [...draftHistoryRef.current, newPick];
      setDraftHistory(nextHistory);
      setDraftedPlayerIds(prev => {
        const next = new Set(prev);
        next.add(newPick.player_id);
        return next;
      });

      // 3. Compute next draft state LOCALLY (handles snake reversal)
      const currentTeams = teamsRef.current;
      const currentLeague = leagueRef.current;
      if (currentTeams.length > 0 && currentLeague) {
        const totalPicks = nextHistory.length;
        const newCurrentPick = totalPicks + 1;
        const newCurrentRound = Math.floor(totalPicks / currentTeams.length) + 1;
        const draftType = ((currentLeague.settings as LeagueSettings)?.draftType || 'snake') as string;
        const isLinear = draftType === 'linear';

        const boardOrder = orderedTeamsForBoardRef.current.length > 0
          ? orderedTeamsForBoardRef.current
          : currentTeams;
        let nextTeamId: string | null = null;
        if (boardOrder.length > 0) {
          const pickIndexInRound = totalPicks % currentTeams.length;
          const isReversedRound = !isLinear && newCurrentRound % 2 === 0;
          const roundOrder = isReversedRound ? [...boardOrder].reverse() : boardOrder;
          nextTeamId = roundOrder[pickIndexInRound]?.id || null;
        }

        setDraftState(prev => ({
          currentRound: newCurrentRound,
          currentPick: newCurrentPick,
          totalPicks,
          nextTeamId,
          isComplete: false,
          sessionId: newPick.draft_session_id || prev?.sessionId || '',
        }));

        // Reset the local countdown immediately (don't wait for server pickTimeLimit roundtrip)
        setTimeRemaining(pickTimeLimitRef.current || 90);
      }

      // ── BACKGROUND RECONCILIATION (non-blocking, rate-limited) ──────
      // Fetch the authoritative league state in the background to sync
      // timerStartedAt / pickTimeLimit. Do NOT await — UI already updated above.
      // Also fetch picks in case we missed any (rare but possible on reconnect).
      //
      // Rate-limit: skip if another reconciliation fired within the last
      // RECONCILE_MIN_INTERVAL_MS. The local state updates above already
      // reflect the pick; reconciliation is a safety net for missed events,
      // not a blocking requirement for UI correctness.
      const now = Date.now();
      if (now - lastReconcileAtRef.current < RECONCILE_MIN_INTERVAL_MS) {
        logger.debug('DraftRoom: skipping reconcile (rate-limited)');
        return;
      }
      lastReconcileAtRef.current = now;
      Promise.all([
        leagueApi.getLeague(leagueId),
        DraftService.getDraftPicks(leagueId, user.id),
      ]).then(([freshLeagueRes, picksResult]) => {
        const freshLeague = freshLeagueRes.data as League | null;
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
        // Reconcile picks if server has more than we do (caught up via realtime replay)
        const serverPicks = picksResult.picks.filter(p => !p.deleted_at);
        if (serverPicks.length > draftHistoryRef.current.length) {
          logger.debug('DraftRoom: Reconciling picks from server', {
            local: draftHistoryRef.current.length,
            server: serverPicks.length
          });
          setDraftHistory(serverPicks);
          setDraftedPlayerIds(new Set(serverPicks.map(p => p.player_id)));
        }
      }).catch(err => logger.debug('DraftRoom: Background reconciliation error (non-critical):', err));
      },
      undefined,
      (status) => {
        // Surface channel health to the UI. Polling (see effect below)
        // continues regardless, so even 'disconnected' is degraded, not
        // broken — but the user needs to know picks are not instant.
        setRealtimeStatus(status);
      },
    );

    return () => {
      unsubscribe();
    };
  // Supabase realtime subscription: only re-subscribe when channel identity changes (leagueId, user?.id).
  // All state is read via refs to avoid stale closures without re-subscribing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, user?.id]);

  // POLLING FALLBACK: safety net in case Supabase realtime drops.
  // Realtime handles the fast path; polling only catches missed events.
  // 8s base + random jitter (0-2s) to avoid thundering-herd across 12 clients.
  // (Was 5s fixed — with 12 clients that's 144 req/min. Now ~80 req/min.)
  useEffect(() => {
    if (draftPhase !== DraftPhase.ACTIVE || !leagueId || !user?.id) return;

    const POLL_BASE_MS = 2000;
    const POLL_JITTER_MS = 500;
    let pollTimeout: ReturnType<typeof setTimeout>;

    const schedulePoll = () => {
      const delay = POLL_BASE_MS + Math.random() * POLL_JITTER_MS;
      pollTimeout = setTimeout(doPoll, delay);
    };

    const doPoll = async () => {
      try {
        // Fetch picks and league in parallel to minimize latency
        const [picksResult, freshLeagueRes] = await Promise.all([
          DraftService.getDraftPicks(leagueId, user.id),
          leagueApi.getLeague(leagueId),
        ]);

        const activePicks = picksResult.picks.filter(p => !p.deleted_at);

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

        const freshLeague = freshLeagueRes.data as League | null;

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
            ssRemove(`draft_phase_${leagueId}`);
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
      // Schedule next poll (recursive setTimeout with jitter instead of fixed setInterval)
      schedulePoll();
    };

    schedulePoll();

    return () => clearTimeout(pollTimeout);
  // Polling interval: only recreate when phase or identity changes. loadDraftState is not memoized —
  // including it would cause interval recreation on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPhase, leagueId, user?.id]);

  // Resync timer, draft state, and teams when page becomes visible again
  // (phone sleep/wake, tab switch, app backgrounded). The setInterval timer
  // self-corrects via Date.now(), but fetching fresh league data ensures we
  // catch picks made while the device was asleep and update timerStartedAt.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !leagueId || !user) return;
      logger.debug('DraftRoom: Page visible again, resyncing');

      // Reload teams (in case names changed in another tab)
      LeagueService.getLeagueTeamsWithOwners(leagueId).then(({ teams: teamsData, error: teamsError }) => {
        if (!teamsError && teamsData) {
          setTeams(teamsData);
        }
      });

      // During active draft: resync league settings (timer) + picks + draft state
      if (draftPhaseRef.current === DraftPhase.ACTIVE) {
        clearDraftCache();
        // Fetch fresh league data so timerStartedAt is current
        leagueApi.getLeague(leagueId).then(res => {
          const freshLeague = res.data as League | null;
          if (freshLeague) {
            setLeague(prev => prev ? {
              ...prev,
              settings: freshLeague.settings || prev.settings,
              draft_status: freshLeague.draft_status || prev.draft_status
            } : null);
          }
        });
        // Fetch fresh picks in case we missed any while asleep
        DraftService.getDraftPicks(leagueId, user.id).then(({ picks }) => {
          const activePicks = picks.filter(p => !p.deleted_at);
          setDraftHistory(activePicks);
          setDraftedPlayerIds(new Set(activePicks.map(p => p.player_id)));
        });
        // Reload draft state (currentPick, currentRound, etc.)
        loadDraftState();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  // leagueId/user for identity; loadDraftState excluded (not memoized) — accessed via closure
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, user]);

  // Keep refs in sync with state for realtime callbacks (avoids stale closures)
  useEffect(() => { pickTimeLimitRef.current = draftSettings.pickTimeLimit; }, [draftSettings.pickTimeLimit]);
  useEffect(() => { draftTimerStartedRef.current = draftTimerStarted; }, [draftTimerStarted]);
  useEffect(() => { userTeamRef.current = userTeam; }, [userTeam]);
  useEffect(() => { teamsRef.current = teams; }, [teams]);
  useEffect(() => { leagueRef.current = league; }, [league]);
  useEffect(() => { orderedTeamsForBoardRef.current = orderedTeamsForBoard; }, [orderedTeamsForBoard]);
  useEffect(() => { draftHistoryRef.current = draftHistory; }, [draftHistory]);

  // Persist draft phase and timer state to sessionStorage for tab/page navigation resilience
  useEffect(() => {
    if (leagueId && draftPhase) {
      ssSet(`draft_phase_${leagueId}`, draftPhase);
    }
  }, [draftPhase, leagueId]);
  useEffect(() => {
    if (leagueId) {
      ssSet(`draft_timer_${leagueId}`, String(draftTimerStarted));
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
    let auctionCloseInProgress = false;

    const tick = async () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
      setAuctionTimeRemaining(remaining);

      // Timer expired — auto-close the nomination (guard against concurrent calls)
      if (remaining <= 0 && leagueId && auctionSessionId && nomination.id && !auctionCloseInProgress) {
        auctionCloseInProgress = true;
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

    // Poll bid history with jitter to avoid thundering herd.
    // Was 3s fixed (240 req/nomination across 12 clients). Now ~5-7s with jitter.
    const loadBidHistory = async () => {
      if (!nomination.id) return;
      const bids = await AuctionDraftService.getBidHistory(nomination.id);
      setAuctionState(prev => prev ? { ...prev, bidHistory: bids.map(b => ({ team_id: b.team_id, bid_amount: b.bid_amount, created_at: b.created_at || '' })) } : prev);
    };
    loadBidHistory();
    let bidTimeout: ReturnType<typeof setTimeout>;
    const scheduleBidPoll = () => {
      const delay = 5000 + Math.random() * 2000; // 5-7s with jitter
      bidTimeout = setTimeout(async () => {
        await loadBidHistory();
        scheduleBidPoll();
      }, delay);
    };
    scheduleBidPoll();

    return () => { clearInterval(interval); clearTimeout(bidTimeout); };
  // Auction timer: re-creates interval when nomination changes (?.id, ?.expires_at).
  // auctionState.currentNomination is accessed via ?.id and ?.expires_at granularly.
  // userTeam.id is excluded to avoid restarting timer on team state updates.
  // toast is stable from useToast but excluded to keep deps minimal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
          const updatedLeague = payload.new as League & { settings: LeagueSettings & { timerStartedAt?: string | null; pickTimeLimit?: number } };
          logger.debug('DraftRoom: League status changed via realtime:', updatedLeague.draft_status);

          // Update local league state (including settings with timerStartedAt)
          // Use functional updater to avoid stale closure over `league`
          setLeague(prev => prev ? {
            ...prev,
            draft_status: updatedLeague.draft_status,
            draft_rounds: updatedLeague.draft_rounds || prev.draft_rounds,
            settings: updatedLeague.settings || prev.settings,
            scheduled_draft_time: updatedLeague.scheduled_draft_time ?? prev.scheduled_draft_time
          } : null);

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
          if (updatedLeague.draft_status === 'not_started' && draftPhaseRef.current !== DraftPhase.LOBBY) {
            logger.debug('DraftRoom: Draft was reset, returning to lobby');
            setDraftPhase(DraftPhase.LOBBY);
            setDraftState(null);
            setDraftHistory([]);
            setDraftedPlayerIds(new Set());
            setDraftTimerStarted(false);
            draftTimerStartedRef.current = false;
            ssRemove(`draft_phase_${leagueId}`);
            ssRemove(`draft_timer_${leagueId}`);
          }

          // When commissioner queues the draft, let everyone into the room
          // immediately — don't wait for "Start Draft" (in_progress). This
          // matches ESPN/Yahoo/Sleeper where the draft room opens early so
          // users can browse players, build their queue, and prepare.
          if (updatedLeague.draft_status === 'queued' && draftPhaseRef.current === DraftPhase.LOBBY) {
            logger.debug('DraftRoom: Draft queued by commissioner, auto-entering draft room');
            setDraftPhase(DraftPhase.ACTIVE);
            ssSet(`draft_phase_${leagueId}`, String(DraftPhase.ACTIVE));
          }

          // When draft starts, pre-load state but stay in LOBBY with join banner.
          // Use refs to read latest teams/league — this effect only re-subscribes on
          // leagueId/user.id changes, so direct closure reads would be stale.
          if (updatedLeague.draft_status === 'in_progress' && draftPhaseRef.current !== DraftPhase.ACTIVE) {
            logger.debug('DraftRoom: Draft started by commissioner, pre-loading state for join');

            const currentTeams = teamsRef.current;
            const currentLeague = leagueRef.current;

            // Pre-load draft state + order in PARALLEL so the Join button is ready instantly
            try {
              const [stateRes, orderRes] = await Promise.all([
                DraftService.getDraftState(
                  leagueId,
                  currentTeams,
                  updatedLeague.draft_rounds || currentLeague?.draft_rounds || 21,
                  user.id
                ),
                DraftService.getDraftOrder(leagueId, user.id, 1),
              ]);

              if (stateRes.state) {
                setDraftState(stateRes.state);
              }

              if (orderRes.order && orderRes.order.team_order && orderRes.order.team_order.length > 0) {
                const orderedTeams = orderRes.order.team_order
                  .map((id: string) => currentTeams.find(t => t.id === id))
                  .filter((t): t is (Team & { owner_name?: string }) => t !== undefined);
                if (orderedTeams.length > 0 && orderedTeams.length === currentTeams.length) {
                  setOrderedTeamsForBoard(orderedTeams);
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
            // Auto-join the active draft — don't force users to find a "Join" button.
            // Pre-loaded state is ready; transition immediately so nobody misses picks.
            setDraftPhase(DraftPhase.ACTIVE);
            ssSet(`draft_phase_${leagueId}`, String(DraftPhase.ACTIVE));
            logger.debug('DraftRoom: Auto-joined active draft via realtime');
          }

          // Handle draft completion (use ref to avoid stale closure)
          if (updatedLeague.draft_status === 'completed' && draftPhaseRef.current !== DraftPhase.COMPLETED) {
            logger.debug('DraftRoom: Draft completed via realtime');
            setDraftPhase(DraftPhase.COMPLETED);
            ssRemove(`draft_phase_${leagueId}`);
            ssRemove(`draft_timer_${leagueId}`);
          }
        }
      )
      .subscribe((status) => {
        // Exponential backoff reconnection — matches the draft picks channel.
        // Without this, a dropped league status channel silently dies and the
        // draft timer desynchronizes across clients.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const label = status === 'CHANNEL_ERROR' ? 'error' : 'timeout';
          logger.warn(`League status subscription ${label} for league ${leagueId}, reconnecting...`);
          let attempt = 0;
          const maxAttempts = 5;
          const tryReconnect = () => {
            if (attempt >= maxAttempts) {
              logger.error(`League status subscription failed after ${maxAttempts} attempts for league ${leagueId}`);
              return;
            }
            const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
            attempt++;
            const tid = setTimeout(() => {
              logger.log(`League status reconnect attempt ${attempt} for league ${leagueId}`);
              supabase.removeChannel(channel);
              channel.subscribe((retryStatus) => {
                if (retryStatus === 'SUBSCRIBED') {
                  logger.log(`League status reconnected for league ${leagueId}`);
                } else if (retryStatus === 'CHANNEL_ERROR' || retryStatus === 'TIMED_OUT') {
                  tryReconnect();
                }
              });
            }, delay);
            reconnectTimeouts.push(tid);
          };
          tryReconnect();
        }
      });

    const reconnectTimeouts: ReturnType<typeof setTimeout>[] = [];

    return () => {
      reconnectTimeouts.forEach(clearTimeout);
      reconnectTimeouts.length = 0;
      supabase.removeChannel(channel);
    };
  // Supabase realtime subscription: league, draftPhase, teams, and resolveTeamOrder are accessed
  // via refs/functional-updaters to prevent re-subscribing on state changes (causes missed events).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, user?.id]);

  const loadDraftState = async (retryCount: number = 0, skipStatusCheck: boolean = false): Promise<DraftState | null> => {
    if (!leagueId || !league) {
      logger.log('loadDraftState: Missing leagueId or league', { leagueId, league: !!league });
      return null;
    }

    // CRITICAL: Don't load draft state if draft hasn't started
    // skipStatusCheck allows handleBeginDraft to bypass this when the status
    // was just changed to 'in_progress' but the React state hasn't committed yet.
    if (!skipStatusCheck && league?.draft_status === 'not_started') {
      logger.log('loadDraftState: Draft not started, clearing draft state');
      setDraftState(null);
      return null;
    }

    if (!teams || teams.length === 0) {
      logger.log('loadDraftState: No teams loaded yet, skipping');
      // Retry after a short delay if teams aren't loaded yet
      if (retryCount < 3) {
        return await loadDraftState(retryCount + 1, skipStatusCheck);
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
        league.draft_rounds || 21,
        user?.id
      );

      if (error) {
        logger.error('loadDraftState: Error loading draft state', error);
        // If draft order doesn't exist, retry a few times (might be still initializing)
        if ((error as Error).message?.includes('not initialized') || (error as Error).message?.includes('not found')) {
          if (retryCount < 5) {
            logger.log(`loadDraftState: Draft order not found, retrying (${retryCount + 1}/5)...`);
            await new Promise(resolve => setTimeout(resolve, 500));
            return await loadDraftState(retryCount + 1, skipStatusCheck);
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
          const safeRound = Number.isFinite(state.currentRound) && state.currentRound >= 1 ? state.currentRound : 1;
          const { order } = await DraftService.getDraftOrder(leagueId, user.id, safeRound, state.sessionId);
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
            const safeRound2 = Number.isFinite(state.currentRound) && state.currentRound >= 1 ? state.currentRound : 1;
            const { order } = await DraftService.getDraftOrder(leagueId, user.id, safeRound2, state.sessionId);
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

      // Set up orderedTeamsForBoard based on draft order (round 1).
      // Skip if already populated — the round-1 order never changes mid-draft,
      // so caching it eliminates one API call on every loadDraftState call.
      if (state && teams && teams.length > 0 && orderedTeamsForBoard.length === 0) {
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
        return await loadDraftState(retryCount + 1, skipStatusCheck);
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
  // Safety valve: auto-reset pickInProgress after 20s even if `finally` never
  // fires (browser crash, hung promise, etc.). Without this, the Draft button
  // stays permanently disabled and the user has to reload the entire page.
  const pickLockTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track which pick number we last auto-drafted for to prevent duplicate attempts
  const lastAutoPickedNumberRef = useRef<number>(0);
  // Refs for stale closure prevention in realtime subscription callbacks
  const pickTimeLimitRef = useRef(draftSettings.pickTimeLimit);
  const draftTimerStartedRef = useRef(false);
  const userTeamRef = useRef(userTeam);
  const teamsRef = useRef<(Team & { owner_name?: string })[]>([]);
  const leagueRef = useRef<League | null>(null);
  const orderedTeamsForBoardRef = useRef<(Team & { owner_name?: string })[]>([]);
  const draftHistoryRef = useRef<DraftPick[]>([]);
  // Track pending retry timeouts from handleStartDraft for cleanup on unmount
  const startDraftRetryRef = useRef<NodeJS.Timeout | null>(null);
  // Ref for handleAutoDraft to avoid stale closures in timer intervals
  const handleAutoDraftRef = useRef<() => void>(() => {});

  // Reusable AudioContext for turn notifications (avoids creating/leaking new contexts)
  // Initialized lazily on first user gesture (click/tap) to satisfy iOS Safari requirement
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevIsMyTurnRef = useRef(false);

  // Warm up AudioContext on the first user interaction so it's ready for turn notifications.
  // iOS Safari blocks AudioContext creation unless triggered by a user gesture.
  useEffect(() => {
    const warmUp = () => {
      if (audioCtxRef.current) return;
      try {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        // Resume immediately (required by some browsers even after gesture)
        if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
      } catch { /* AudioContext not supported */ }
    };
    document.addEventListener('click', warmUp, { once: true });
    document.addEventListener('touchstart', warmUp, { once: true });
    return () => {
      document.removeEventListener('click', warmUp);
      document.removeEventListener('touchstart', warmUp);
    };
  }, []);

  // Notify user when it becomes their turn — audio chime, browser notification, tab title flash
  useEffect(() => {
    const isMyTurn = !!(currentTeam && user && currentTeam.owner_id === user.id && draftPhase === DraftPhase.ACTIVE);
    if (isMyTurn && !prevIsMyTurnRef.current) {
      // Audio chime: two-tone C5 (523 Hz) then E5 (659 Hz)
      try {
        const ctx = audioCtxRef.current;
        if (ctx) {
          if (ctx.state === 'suspended') ctx.resume();
          [523, 659].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.25);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.15);
            osc.stop(ctx.currentTime + i * 0.15 + 0.25);
          });
        }
      } catch { /* AudioContext not available */ }

      // Browser Notification API — works even when tab is backgrounded
      try {
        if ('Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification("It's Your Turn!", {
              body: "You're on the clock — make your pick!",
              tag: 'draft-turn',
              requireInteraction: true,
            });
          } else if (Notification.permission === 'default') {
            Notification.requestPermission().then((perm) => {
              if (perm === 'granted') {
                new Notification("It's Your Turn!", {
                  body: "You're on the clock — make your pick!",
                  tag: 'draft-turn',
                  requireInteraction: true,
                });
              }
            });
          }
        }
      } catch { /* Notification API not available */ }

      // Tab title flash — visible when tab is in background
      const originalTitle = document.title;
      document.title = "\uD83D\uDFE2 Your Turn \u2014 Citrus Draft";
      const restoreTitle = () => {
        document.title = originalTitle;
        document.removeEventListener('visibilitychange', onVisible);
      };
      const onVisible = () => {
        if (document.visibilityState === 'visible') restoreTitle();
      };
      document.addEventListener('visibilitychange', onVisible);
    } else if (!isMyTurn && prevIsMyTurnRef.current) {
      // Turn ended — restore title if it was flashing
      if (document.title.includes('Your Turn')) {
        document.title = 'Citrus Fantasy Sports';
      }
    }
    prevIsMyTurnRef.current = isMyTurn;
  }, [currentTeam, user, draftPhase]);

  // Play a subtle tick sound when an opponent makes a pick (so users know the draft is moving)
  const playOpponentPickSound = useCallback(() => {
    try {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      // Single low pop: G4 (392 Hz), quieter than the turn chime
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 392;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // AudioContext not available
    }
  }, []);

  // Keyboard shortcuts for the active draft phase
  useEffect(() => {
    if (draftPhase !== DraftPhase.ACTIVE) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.key === ' ' || e.key === 'Enter') && selectedPlayer && currentTeam?.owner_id === user?.id && !pickInProgress) {
        e.preventDefault();
        handlePlayerDraft(selectedPlayer);
      } else if (e.key === 'Escape' && selectedPlayer) {
        e.preventDefault();
        setSelectedPlayer(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // handlePlayerDraft is not memoized — accessed via closure; selectedPlayer change triggers re-creation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPhase, selectedPlayer, currentTeam, user, pickInProgress]);

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

      // Ensure draft state is loaded — skipStatusCheck=true because the league
      // draft_status may still read 'not_started' in the React closure even though
      // handleStartDraft already set it to 'in_progress'.
      let currentDraftState = draftState;
      if (!currentDraftState) {
        currentDraftState = await loadDraftState(0, true);
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
      try {
        await leagueApi.updateSettings(leagueId, {
          settings: {
            ...(league?.settings || {}),
            timerStartedAt
          }
        });
      } catch (updateErr) {
        logger.error('Error saving timerStartedAt:', updateErr);
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
  const userAutoDraftEnabledRef = useRef(userAutoDraftEnabled);
  const isCommissionerRef = useRef(isCommissioner);
  useEffect(() => { draftPhaseRef.current = draftPhase; }, [draftPhase]);
  useEffect(() => { currentTeamRef.current = currentTeam; }, [currentTeam]);
  useEffect(() => { userAutoDraftEnabledRef.current = userAutoDraftEnabled; }, [userAutoDraftEnabled]);
  useEffect(() => { isCommissionerRef.current = isCommissioner; }, [isCommissioner]);

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

    // Don't run timer if draft isn't active. We intentionally do NOT check
    // draftState or currentTeamRef here — those can be transiently null during
    // pick transitions and killing the interval causes the timer to freeze for
    // non-commissioner clients that never restart it.
    if (draftPhaseRef.current !== DraftPhase.ACTIVE) {
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

    const timerStartMs = new Date(timerStartedAt as string | number).getTime();
    const currentTeamSnap = currentTeamRef.current;
    const isAITeam = currentTeamSnap ? !currentTeamSnap.owner_id : false;

    // For AI teams or human users with auto-draft enabled, auto-pick after 1.5 seconds
    if (currentTeamSnap) {
      const isUserAutoPicking = !isAITeam && userAutoDraftEnabledRef.current && currentTeamSnap.owner_id === user?.id;
      if (isAITeam || isUserAutoPicking) {
        autoPickTimeoutRef.current = setTimeout(() => {
          handleAutoDraftRef.current();
        }, 1500);
      }
    }

    // Track if we already triggered auto-draft for this timer cycle
    let autoTriggered = false;

    // Calculate remaining time from server timestamp every second
    const updateTimer = () => {
      const elapsedSec = Math.floor((Date.now() - timerStartMs) / 1000);
      const remaining = Math.max(0, timeLimit - elapsedSec);

      // Prevent cosmetic glitch: if remaining is 0 or negative but this is a
      // stale timerStartedAt (currentPick changed but timerStartedAt hasn't
      // updated yet), show the full time limit instead of flashing 0:00
      if (remaining <= 0 && !autoTriggered) {
        const elapsed = Date.now() - timerStartMs;
        const farPastExpiry = elapsed > (timeLimit + 5) * 1000;
        // Re-read ref inside interval — currentTeam may have updated
        const currentTeamNow = currentTeamRef.current;
        const isAITeamNow = currentTeamNow ? !currentTeamNow.owner_id : false;
        if (farPastExpiry && !isAITeamNow) {
          // Timer is >5s past expiry — this is likely a stale timestamp during
          // pick transition. Show full time until new timerStartedAt arrives.
          setTimeRemaining(timeLimit);
          return;
        }
      }

      setTimeRemaining(remaining);

      if (remaining <= 0 && !autoTriggered) {
        // Re-read ref inside interval for current state
        const currentTeamNow = currentTeamRef.current;
        const isAITeamNow = currentTeamNow ? !currentTeamNow.owner_id : false;
        if (!isAITeamNow) {
          // Time expired for human team — only commissioner triggers auto-draft
          // to prevent multiple clients racing. Non-commissioners keep the interval
          // running so the timer naturally restarts when a new timerStartedAt arrives
          // via realtime subscription after the commissioner's auto-pick.
          autoTriggered = true;
          if (isCommissionerRef.current) {
            handleAutoDraftRef.current();
          }
        }
      }
    };

    updateTimer(); // Initial calculation
    // 500ms is smooth enough for a countdown but 50% less CPU than 1000ms.
    // The timer reads Date.now() on each tick so display accuracy is unaffected.
    timerIntervalRef.current = setInterval(updateTimer, 500);
    timerRunningRef.current = true;

    return cleanup;
  // Timer interval: dependencies intentionally scoped to timerStartedAt + pickTimeLimit only.
  // currentPick was removed from deps because every realtime pick event bumps currentPick,
  // which was tearing down and recreating the interval mid-second — causing visible stutter
  // and occasional freezes observed during the canary. The interval computes elapsed time
  // via Date.now() each tick, so it stays accurate without re-instantiation. draftPhase,
  // currentTeam, and handleAutoDraft are all accessed via stable refs inside updateTimer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.settings?.timerStartedAt, draftSettings.pickTimeLimit]);

  // When user enables auto-draft mid-turn, immediately trigger auto-pick
  useEffect(() => {
    if (!userAutoDraftEnabled) return;
    if (draftPhase !== DraftPhase.ACTIVE || !currentTeam || !user) return;
    if (currentTeam.owner_id !== user.id) return;
    // It's the user's turn and they just enabled auto-draft — pick immediately
    if (!autoPickInProgressRef.current) {
      autoPickTimeoutRef.current = setTimeout(() => {
        handleAutoDraftRef.current();
      }, 1500);
    }
    return () => {
      if (autoPickTimeoutRef.current) {
        clearTimeout(autoPickTimeoutRef.current);
        autoPickTimeoutRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAutoDraftEnabled]);

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
  // handleStartDraft is not memoized and draftSettings changes on every settings update.
  // Including them would cause the scheduled timeout to be reset unnecessarily.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCommissioner, league?.scheduled_draft_time, league?.draft_status, draftPhase]);

  const handlePlayerDraft = async (player: Player, isAutoDraft: boolean = false) => {
    // Prevent double-click / concurrent picks
    if (pickInProgress && !isAutoDraft) return;

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

    // Lock AFTER all validation — early returns above must NOT hold the lock
    // or the UI gets permanently stuck (April 10 incident root cause).
    setPickInProgress(true);

    // Safety valve: auto-unlock after 20s even if `finally` never fires.
    // The API client has a 15s timeout + up to 2 retries (each 15s + backoff),
    // so 20s covers the happy path. If we're still locked at 20s, something
    // catastrophically failed and the user needs the button back.
    if (pickLockTimerRef.current) clearTimeout(pickLockTimerRef.current);
    pickLockTimerRef.current = setTimeout(() => {
      setPickInProgress(false);
      pickLockTimerRef.current = null;
    }, 20_000);

    // Optimistic update: show the pick immediately in the UI before the API call
    const previousSelectedPlayer = selectedPlayer;
    setDraftedPlayerIds(prev => new Set([...prev, player.id]));
    setSelectedPlayer(null);

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
        const msg = (error as any)?.message || (error as any)?.details || (error as any)?.hint || JSON.stringify(error);
        throw new Error(msg);
      }

      logger.log('Draft pick successful:', pick);

      // Success feedback
      if (!isAutoDraft) {
        toast({ title: `${player.full_name} drafted!`, description: `Round ${effectiveDraftState.currentRound}, Pick ${effectiveDraftState.currentPick}` });
      }

      // ── OPTIMISTIC LOCAL STATE UPDATE ──────────────────────────────
      // Instead of 3+ sequential API calls (getDraftPicks + getDraftState +
      // getDraftOrder), compute next state locally. Eliminates ~600ms-1.5s
      // of round-trip latency per pick.

      // 1. Append pick to history locally (no API call)
      const optimisticPick: DraftPick = {
        id: (pick as unknown as Record<string, unknown>)?.id as string || crypto.randomUUID(),
        league_id: leagueId,
        team_id: effectiveCurrentTeam.id,
        player_id: player.id,
        round_number: effectiveDraftState.currentRound,
        pick_number: effectiveDraftState.currentPick,
        picked_at: new Date().toISOString(),
        draft_session_id: effectiveDraftState.sessionId,
        deleted_at: null,
      };
      const newHistory = [...draftHistory, optimisticPick];
      setDraftHistory(newHistory);
      // draftedPlayerIds already updated optimistically above (line 1802)

      // 2. Restart timer immediately (no API call)
      const newTimerStartedAt = new Date().toISOString();
      setLeague(prev => prev ? {
        ...prev,
        settings: { ...prev.settings, timerStartedAt: newTimerStartedAt }
      } : null);
      if (!draftTimerStarted) {
        setDraftTimerStarted(true);
      }

      // 3. Compute next draft state locally (no API call)
      const newTotalPicks = newHistory.length;
      const newCurrentPick = newTotalPicks + 1;
      const newCurrentRound = Math.floor(newTotalPicks / teams.length) + 1;
      const draftType = ((league?.settings as LeagueSettings)?.draftType || 'snake') as string;
      const isLinear = draftType === 'linear';

      if (isComplete || newCurrentRound > draftSettings.rounds) {
        // Draft complete
        setLeague(prev => prev ? { ...prev, draft_status: 'completed' } : null);
        setDraftPhase(DraftPhase.COMPLETED);
        await loadDraftData();
        return;
      }

      // Compute next team from local board order (handles snake reversal)
      let nextTeamId: string | null = null;
      const boardOrder = orderedTeamsForBoard.length > 0 ? orderedTeamsForBoard : teams;
      if (boardOrder.length > 0) {
        const pickIndexInRound = newTotalPicks % teams.length;
        const isReversedRound = !isLinear && newCurrentRound % 2 === 0;
        const roundOrder = isReversedRound ? [...boardOrder].reverse() : boardOrder;
        nextTeamId = roundOrder[pickIndexInRound]?.id || null;
      }

      const optimisticState: DraftState = {
        currentRound: newCurrentRound,
        currentPick: newCurrentPick,
        totalPicks: newTotalPicks,
        nextTeamId,
        isComplete: false,
        sessionId: effectiveDraftState.sessionId,
      };
      setDraftState(optimisticState);
      setTimeRemaining(draftSettings.pickTimeLimit);
      timerRunningRef.current = false;
      lastPickNumberRef.current = 0;

      // 4. If next team is AI, schedule auto-pick immediately
      if (nextTeamId && isCommissioner) {
        const nextTeam = teams.find(t => t.id === nextTeamId);
        if (nextTeam && !nextTeam.owner_id) {
          if (autoPickTimeoutRef.current) clearTimeout(autoPickTimeoutRef.current);
          autoPickInProgressRef.current = false;
          autoPickTimeoutRef.current = setTimeout(() => {
            handleAutoDraftRef.current();
          }, 1500);
        }
      }

      // 5. Background reconciliation — non-blocking sync with server
      // Ensures we catch any missed picks from other clients
      clearDraftCache();
      Promise.all([
        DraftService.getDraftPicks(leagueId, user?.id || ''),
        leagueApi.getLeague(leagueId),
      ]).then(([picksResult, leagueResult]) => {
        const serverPicks = picksResult.picks.filter(p => !p.deleted_at);
        // Only update if server has different data (e.g., another client picked simultaneously)
        if (serverPicks.length !== newHistory.length) {
          setDraftHistory(serverPicks);
          setDraftedPlayerIds(new Set(serverPicks.map(p => p.player_id)));
        }
        const freshLeague = leagueResult.data as League | null;
        if (freshLeague) {
          setLeague(prev => prev ? {
            ...prev,
            settings: freshLeague.settings || prev.settings,
            draft_status: freshLeague.draft_status || prev.draft_status,
          } : null);
        }
      }).catch(err => logger.debug('Background reconciliation error (non-critical):', err));
    } catch (error: unknown) {
      logger.error('handlePlayerDraft error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorName = error instanceof Error ? error.name : '';

      // Silently handle race condition errors - another client/trigger already handled this pick
      const isRaceCondition = errorMessage.includes('already taken') || errorMessage.includes('already drafted');
      const isStalePickNumber = errorMessage.includes('Pick number already used');
      if (isRaceCondition) {
        logger.log('handlePlayerDraft: Pick already handled, reloading state');
        await loadDraftState();
      } else if (isStalePickNumber) {
        // Client had stale draftState (realtime didn't deliver the other team's
        // pick in time). Refresh from server and auto-retry with correct pick number.
        logger.log('handlePlayerDraft: Stale pick number — refreshing state and retrying');
        setDraftedPlayerIds(prev => { const s = new Set(prev); s.delete(player.id); return s; });
        if (!isAutoDraft) {
          toast({ title: "Syncing draft...", description: "Catching up with the latest picks. Retrying..." });
        }
        try {
          const [freshPicks, freshLeagueRes] = await Promise.all([
            DraftService.getDraftPicks(leagueId, user?.id || ''),
            leagueApi.getLeague(leagueId),
          ]);
          const serverPicks = freshPicks.picks.filter((p: DraftPick) => !p.deleted_at);
          setDraftHistory(serverPicks);
          setDraftedPlayerIds(new Set(serverPicks.map((p: DraftPick) => p.player_id)));
          const freshLeague = freshLeagueRes.data as League | null;
          if (freshLeague) {
            setLeague(prev => prev ? { ...prev, settings: freshLeague.settings || prev.settings, draft_status: freshLeague.draft_status || prev.draft_status } : null);
          }

          // Compute correct pick number from fresh server state
          const totalPicks = serverPicks.length;
          const retryPick = totalPicks + 1;
          const retryRound = Math.floor(totalPicks / teams.length) + 1;
          const sessionId = effectiveDraftState.sessionId;

          // Check if this player was already drafted in the refreshed state
          if (serverPicks.some((p: DraftPick) => p.player_id === player.id)) {
            toast({ title: "Player Already Drafted", description: `${player.full_name} was just drafted by another team.`, variant: "destructive" });
          } else {
            // Figure out whose turn it actually is now
            const draftType = ((league?.settings as LeagueSettings)?.draftType || 'snake') as string;
            const isLinear = draftType === 'linear';
            const boardOrder = orderedTeamsForBoardRef.current.length > 0 ? orderedTeamsForBoardRef.current : teams;
            const pickIdx = totalPicks % teams.length;
            const isReversedRound = !isLinear && retryRound % 2 === 0;
            const roundOrder = isReversedRound ? [...boardOrder].reverse() : boardOrder;
            const actualNextTeam = roundOrder[pickIdx];

            // Only retry if it's still this user's turn (or commissioner)
            if (actualNextTeam && (actualNextTeam.owner_id === user?.id || isCommissioner)) {
              setDraftedPlayerIds(prev => new Set([...prev, player.id]));
              const { pick: retryResult, error: retryErr } = await DraftService.makePick(
                leagueId, actualNextTeam.id, player.id, retryRound, retryPick, sessionId, teams.length
              );
              if (retryErr) {
                setDraftedPlayerIds(prev => { const s = new Set(prev); s.delete(player.id); return s; });
                toast({ title: "Error", description: `Retry failed: ${(retryErr as any)?.message || retryErr}`, variant: "destructive" });
              } else {
                toast({ title: `${player.full_name} drafted!`, description: `Round ${retryRound}, Pick ${retryPick}` });
                // Trigger a full reconciliation after successful retry
                clearDraftCache();
                const [rPicks] = await Promise.all([DraftService.getDraftPicks(leagueId, user?.id || '')]);
                const rServerPicks = rPicks.picks.filter((p: DraftPick) => !p.deleted_at);
                setDraftHistory(rServerPicks);
                setDraftedPlayerIds(new Set(rServerPicks.map((p: DraftPick) => p.player_id)));
              }
            } else {
              toast({ title: "Not Your Turn", description: "The draft advanced — it's another team's turn now." });
            }
          }
        } catch (retryError) {
          logger.error('handlePlayerDraft: Auto-retry failed:', retryError);
          toast({ title: "Error", description: "Could not sync draft state. Please refresh the page.", variant: "destructive" });
        }
      } else {
        // Rollback optimistic update on non-race-condition errors
        setDraftedPlayerIds(prev => {
          const rolled = new Set(prev);
          rolled.delete(player.id);
          return rolled;
        });
        if (previousSelectedPlayer?.id === player.id) {
          setSelectedPlayer(previousSelectedPlayer);
        }
        if (!isAutoDraft) {
          // Show user-friendly messages for common failure modes
          const isTimeout = errorName === 'TimeoutError' || errorName === 'AbortError' || errorMessage.includes('timed out');
          const isNetwork = errorMessage === 'Failed to fetch' || errorMessage.includes('Network');
          const userMsg = isTimeout
            ? 'Pick timed out. Please try again — the server may be busy.'
            : isNetwork
              ? 'Network error. Check your connection and try again.'
              : `Failed to draft player: ${errorMessage}`;
          toast({ title: "Error", description: userMsg, variant: "destructive" });
        }
      }
      // Don't throw - let draft continue
    } finally {
      setPickInProgress(false);
      if (pickLockTimerRef.current) {
        clearTimeout(pickLockTimerRef.current);
        pickLockTimerRef.current = null;
      }
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

      // Freshness check: verify server-side pick count before autopicking.
      // The user's manual pick might be in-flight (retrying after 429/503).
      // Without this check, the commissioner's autopick races the user's
      // retry and the user gets autopicked while actively trying to pick.
      try {
        const { picks } = await DraftService.getDraftPicks(leagueId, user?.id || '');
        const serverPickCount = picks.filter(p => !p.deleted_at).length;
        if (serverPickCount >= draftState.currentPick) {
          logger.log('handleAutoDraft: Server already has pick #' + draftState.currentPick + ', skipping autopick');
          autoPickInProgressRef.current = false;
          await loadDraftState();
          return;
        }
      } catch {
        // If freshness check fails, proceed with autopick — better to pick
        // than to stall the entire draft waiting for a health check.
      }

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

    // Strategy 2: Fantasy points + positional need (applies to ALL teams, not just AI)
    if (!selectedPlayer) {
      // Calculate fantasy points for each undrafted player
      const scorer = new ScoringCalculator(league?.scoring_settings as unknown as ScoringSettings | undefined);
      const calcFpts = (p: Player): number => {
        const isGoalie = p.position === 'G';
        return scorer.calculatePoints(
          isGoalie
            ? { wins: p.wins || 0, saves: p.saves || 0, shutouts: p.shutouts || 0, goals_against: p.goals_against || 0 }
            : { goals: p.goals || 0, assists: p.assists || 0, shots: p.shots || 0, blocks: p.blocks || 0, hits: p.hits || 0, pim: p.pim || 0, ppp: p.ppp || 0, shp: p.shp || 0 },
          isGoalie
        );
      };

      // Get what this team has already drafted to determine positional need
      const teamPicks = draftHistory.filter(p => p.team_id === currentTeam.id && !p.deleted_at);
      const teamPlayerIds = teamPicks.map(p => p.player_id);
      const teamPlayers = availablePlayers.filter(p => teamPlayerIds.includes(p.id));

      // Read league position configuration. Two formats are supported:
      //   'individual' → C / LW / RW / D / G (and maybe UTIL)
      //   'forward'    → F / D / G           (C, LW, RW all collapse into F)
      // Default to individual if settings are missing. This used to be hard-
      // coded to C/LW/RW/D/G, which meant "forward format" leagues had
      // autopick misbehaving because their rosterSlots['C'] was undefined.
      const leagueSettings = (league?.settings as LeagueSettings) || {};
      const positionType: 'individual' | 'forward' =
        leagueSettings.positionType === 'forward' ? 'forward' : 'individual';
      const leagueRosterSlots = leagueSettings.rosterSlots || {};

      // Normalize a player's raw position (from NHL data) to the league's
      // position-format key. In a 'forward' league, C/LW/RW all count toward
      // the F slot. Used for both counting drafted picks and scoring candidates.
      const toLeaguePos = (rawPos: string | undefined): string => {
        const p = rawPos || (positionType === 'forward' ? 'F' : 'C');
        if (positionType === 'forward' && (p === 'C' || p === 'LW' || p === 'RW')) return 'F';
        return p;
      };

      // Count positions already drafted (normalized to league format)
      const positionCounts: Record<string, number> = {};
      teamPlayers.forEach(p => {
        const pos = toLeaguePos(p.position);
        positionCounts[pos] = (positionCounts[pos] || 0) + 1;
      });

      // Build the starting-needs map from whatever positions the league
      // actually defined in rosterSlots (plus sensible fallbacks by format).
      const startingNeeds: Record<string, number> = {};
      const configuredPositions = positionType === 'forward'
        ? ['F', 'D', 'G']
        : ['C', 'LW', 'RW', 'D', 'G'];
      const fallbackNeeds: Record<string, number> = positionType === 'forward'
        ? { F: 6, D: 4, G: 2 }
        : { C: 2, LW: 2, RW: 2, D: 4, G: 2 };
      for (const pos of configuredPositions) {
        const slotCount = leagueRosterSlots[pos];
        startingNeeds[pos] = typeof slotCount === 'number' && slotCount > 0
          ? slotCount
          : (fallbackNeeds[pos] || 0);
      }

      // Check which starting positions still have empty slots
      const unfilledPositions = new Set<string>();
      for (const [pos, need] of Object.entries(startingNeeds)) {
        if ((positionCounts[pos] || 0) < need) unfilledPositions.add(pos);
      }

      // Bench awareness: once all STARTERS are filled, autopick was falling
      // back to raw FPTS with no position awareness — so it would keep
      // picking the highest-FPTS player regardless of whether the team
      // already had 4 RWs. This made picks look "random" to users.
      //
      // After starters are full, allow each position to continue being picked
      // up to starters + reasonable depth (1-2 extra for skaters, +2 for D,
      // +1 for G). Also respects UTIL and BN slots implicitly by letting
      // positions keep receiving picks beyond the strict starter count.
      const allStartersFull = unfilledPositions.size === 0;
      if (allStartersFull) {
        const depthBonus: Record<string, number> = positionType === 'forward'
          ? { F: 4, D: 2, G: 1 }
          : { C: 1, LW: 1, RW: 1, D: 2, G: 1 };
        for (const pos of configuredPositions) {
          const cap = (startingNeeds[pos] || 0) + (depthBonus[pos] || 1);
          if ((positionCounts[pos] || 0) < cap) unfilledPositions.add(pos);
        }
      }

      // Score each undrafted player: FPTS is primary, positional need adds a 15% boost.
      // Map the player's raw position to the league's format BEFORE checking need,
      // otherwise a 'forward' league's autopick can never match C/LW/RW players
      // against its F-only startingNeeds.
      const scored = undraftedPlayers.map(p => {
        const fpts = calcFpts(p);
        const leaguePos = toLeaguePos(p.position);
        const needsPosition = unfilledPositions.has(leaguePos);
        const score = needsPosition ? fpts * 1.15 : fpts;
        return { player: p, fpts, score };
      });

      scored.sort((a, b) => b.score - a.score);
      if (scored.length > 0) {
        selectedPlayer = scored[0].player;
        logger.log('handleAutoDraft: Picking by FPTS + positional need', {
          team: currentTeam.team_name,
          player: selectedPlayer.full_name,
          fpts: scored[0].fpts.toFixed(1),
          boosted: unfilledPositions.has(toLeaguePos(selectedPlayer.position)),
          position: selectedPlayer.position,
          leaguePosition: toLeaguePos(selectedPlayer.position),
          positionFormat: positionType,
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
  const handleUndoLastPick = () => {
    if (!leagueId || !isCommissioner) return;
    setConfirmDialog({
      title: 'Undo Last Pick?',
      description: 'This will remove the most recent draft pick and reset the timer for the restored turn.',
      action: 'Undo Pick',
      onConfirm: executeUndoLastPick,
    });
  };
  const executeUndoLastPick = async () => {
    if (!leagueId || !isCommissioner) return;
    try {
      const { undone, error: undoError } = await DraftService.undoLastPick(leagueId, user.id);
      if (undoError || !undone) {
        logger.error('handleUndoLastPick error:', undoError);
        toast({ title: "Error", description: `Failed to undo pick: ${(undoError as any)?.message || 'No picks to undo'}`, variant: "destructive" });
        return;
      }

      logger.log('Undo successful, pick removed:', undone.player_id);

      // Reload picks and draft state
      const { picks } = await DraftService.getDraftPicks(leagueId, user.id);
      const activePicks = picks.filter(p => !p.deleted_at);
      setDraftHistory(activePicks);
      setDraftedPlayerIds(new Set(activePicks.map(p => p.player_id)));

      // Reset timer for the restored pick — update DB so ALL clients resync
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

      // Publish a fresh timerStartedAt to DB so all clients restart their countdown
      const newTimerStartedAt = new Date().toISOString();
      await leagueApi.updateSettings(leagueId, {
        settings: { ...(league?.settings || {}), timerStartedAt: newTimerStartedAt }
      });
      setLeague(prev => prev ? {
        ...prev,
        settings: { ...prev.settings, timerStartedAt: newTimerStartedAt }
      } : prev);

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
        toast({ title: "Error", description: `Failed to delete draft: ${(resetError as any).message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      logger.log('Nuclear draft delete complete for league:', leagueId);

      // Clear all sessionStorage for this league
      ssRemove(`draft_phase_${leagueId}`);
      ssRemove(`draft_timer_${leagueId}`);

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
        toast({ title: "Error", description: "Failed to add AI teams. Please try again.", variant: "destructive" });
        return;
      }

      toast({ title: "AI Teams Added", description: "AI teams have been added to your league." });
      // Reload teams after adding AI teams
      await loadDraftData();
    } catch (err) {
      logger.error('Exception adding AI teams:', err);
      toast({ title: "Error", description: "Failed to add AI teams. Please try again.", variant: "destructive" });
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!leagueId || !isCommissioner || !user?.id) {
      logger.error('[DraftRoom] Cannot delete team - missing requirements:', { leagueId, isCommissioner, userId: user?.id });
      throw new Error('Cannot delete team: Missing league ID, commissioner status, or user ID');
    }

    try {
      const { success, error } = await LeagueService.deleteTeam(teamId, leagueId, user.id);
      if (error) {
        logger.error('[DraftRoom] Error from deleteTeam service:', error);
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
      logger.error('[DraftRoom] Exception deleting team:', err);
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
      await leagueApi.updateDraftSettings(leagueId, { scheduled_draft_time: scheduledTime });

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

  const handleTeamsCountChange = async (count: number) => {
    if (!leagueId || !isCommissioner) return;
    if (count < teams.length) {
      toast({ title: "Error", description: `Cannot set max teams below ${teams.length} (current team count).`, variant: "destructive" });
      return;
    }

    try {
      await leagueApi.updateDraftSettings(leagueId, { teams_count: count });

      // Update local league state
      if (league) {
        setLeague({
          ...league,
          settings: { ...(league.settings || {}), teamsCount: count }
        });
      }

      toast({ title: "Teams Updated", description: `Max teams set to ${count}.` });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: "Error", description: `Failed to update teams count: ${errorMessage}`, variant: "destructive" });
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
        await leagueApi.updateSettings(leagueId, {
          settings: {
            ...(league.settings || {}),
            pickTimeLimit: settings.pickTimeLimit,
            draftOrder: settings.draftOrder
          }
        });
      }

      // Initialize draft order
      const draftRounds = settings.rounds || league?.draft_rounds || 21;
      
        // Determine which order to use: effectiveOrder > settings custom order > customDraftOrder (button) > randomized order > none
        const orderToUse = settings.effectiveOrder
          || (settings.draftOrder === 'custom' && settings.customOrder ? settings.customOrder : undefined)
          || customDraftOrder
          || randomizedTeamOrder
          || undefined;
        
        const leagueDraftType = (league?.settings as LeagueSettings)?.draftType || 'snake';
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
          toast({ title: "Error", description: `Failed to prepare draft: ${(retryError as any).message || 'Unknown error'}. Please try resetting the draft.`, variant: "destructive" });
          return;
        }
      }

      // Set league status to 'queued' (ready to start)
      try {
        await leagueApi.updateDraftSettings(leagueId, { draft_status: 'queued' });
      } catch (leagueStatusErr) {
        const leagueStatusError = leagueStatusErr instanceof Error ? leagueStatusErr : new Error('Unknown error');
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
        // Transition to ACTIVE immediately — don't wait on network. The draft board
        // falls back to `teams` when `orderedTeamsForBoard` is empty, and loadDraftState
        // will populate state in the background.
        setDraftPhase(DraftPhase.ACTIVE);

        // Parallelize all fetches — previously these were sequential, causing 3+ round trips
        // before the user saw anything. Don't gate the draft-order call on sessionId —
        // the server query returns the latest round-1 order regardless.
        try {
          const [stateRes, orderRes, picksRes] = await Promise.all([
            DraftService.getDraftState(leagueId, teams, league.draft_rounds || 21, user?.id),
            DraftService.getDraftOrder(leagueId, user?.id || '', 1),
            DraftService.getDraftPicks(leagueId, user?.id || ''),
          ]);

          if (stateRes.state) {
            setDraftState(stateRes.state);
          }

          if (orderRes.order && orderRes.order.team_order && orderRes.order.team_order.length > 0) {
            const orderedTeams = resolveTeamOrder(orderRes.order.team_order);
            if (orderedTeams.length === teams.length) {
              setOrderedTeamsForBoard(orderedTeams);
            }
          }

          // Auto-start timer if picks already exist
          const activeRejoinPicks = picksRes.picks.filter((p: DraftPick) => !p.deleted_at);
          if (activeRejoinPicks.length > 0) {
            setDraftHistory(activeRejoinPicks);
            setDraftedPlayerIds(new Set(activeRejoinPicks.map(p => p.player_id)));
            setDraftTimerStarted(true);
            draftTimerStartedRef.current = true;
          }
        } catch (rejoinErr) {
          logger.error('Non-commissioner rejoin: error loading draft data:', rejoinErr);
          // loadDraftState will retry via polling fallback
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

      // Parallelize all fetches — 3 sequential round-trips was causing a visible delay
      // when rejoining on mobile.
      try {
        const [stateRes, orderRes, picksRes] = await Promise.all([
          DraftService.getDraftState(leagueId, teams, league.draft_rounds || 21, user?.id),
          DraftService.getDraftOrder(leagueId, user?.id || '', 1),
          DraftService.getDraftPicks(leagueId, user?.id || ''),
        ]);

        if (stateRes.state) {
          setDraftState(stateRes.state);
        }

        if (orderRes.order && orderRes.order.team_order && orderRes.order.team_order.length > 0) {
          const orderedTeams = resolveTeamOrder(orderRes.order.team_order);
          if (orderedTeams.length === teams.length) {
            setOrderedTeamsForBoard(orderedTeams);
          }
        }

        // Auto-start timer if picks already exist (otherwise commissioner sees "Start Draft Timer" button)
        const activeRejoinPicks = picksRes.picks.filter((p: DraftPick) => !p.deleted_at);
        if (activeRejoinPicks.length > 0) {
          setDraftHistory(activeRejoinPicks);
          setDraftedPlayerIds(new Set(activeRejoinPicks.map(p => p.player_id)));
          setDraftTimerStarted(true);
          draftTimerStartedRef.current = true;
        }
      } catch (rejoinErr) {
        logger.error('Commissioner rejoin: error loading draft data:', rejoinErr);
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

      const startDraftType = (league?.settings as LeagueSettings)?.draftType || 'snake';
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
        toast({ title: "Error", description: `Failed to initialize draft order: ${(initError as any).message || 'Unknown error'}. Please try preparing the draft first.`, variant: "destructive" });
        return;
      }

      // Update league status to in_progress and save draft settings + rounds
      try {
        await leagueApi.updateSettings(leagueId, {
          draft_status: 'in_progress',
          draft_rounds: settings.rounds,
          settings: {
            ...(league?.settings || {}),
            pickTimeLimit: settings.pickTimeLimit,
            draftOrder: settings.draftOrder
          }
        } as Record<string, unknown>);
      } catch (leagueStatusErr) {
        const leagueStatusError = leagueStatusErr instanceof Error ? leagueStatusErr : new Error('Unknown error');
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
          const updatedLeagueRes = await leagueApi.getLeague(leagueId);
          const updatedLeague = updatedLeagueRes.data as League | null;

          if (updatedLeague?.draft_status === 'in_progress') {
            const loadedState = await loadDraftState(0, true);
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
      const { timerStartedAt: _, ...settingsWithoutTimer } = currentSettings as LeagueSettings & { timerStartedAt?: string | null };
      await leagueApi.updateSettings(leagueId, {
        settings: { ...settingsWithoutTimer, timerStartedAt: null }
      });
      setLeague(prev => prev ? {
        ...prev,
        settings: { ...settingsWithoutTimer, timerStartedAt: null }
      } : null);
    }
  };

  // Handle continuing/resuming the draft timer - sets new timerStartedAt in DB
  const handleContinueDraft = async () => {
    // Use return value from loadDraftState — React state won't be committed yet
    let state = draftState;
    if (!state && leagueId) {
      state = await loadDraftState(0, true);
    }

    // If we still don't have state, try one more time with a delay
    if (!state) {
      await new Promise(resolve => setTimeout(resolve, 500));
      state = draftState; // Check if React committed in the meantime
    }

    if (!state) {
      toast({ title: "Error", description: "Cannot continue draft: draft state not ready. Please try again.", variant: "destructive" });
      return;
    }

    // Set new timerStartedAt in DB - all clients will start counting from this point
    const timerStartedAt = new Date().toISOString();
    if (leagueId) {
      await leagueApi.updateSettings(leagueId, {
        settings: { ...(league?.settings || {}), timerStartedAt }
      });
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

  const handleCleanupDraft = () => {
    if (!leagueId) return;
    setConfirmDialog({
      title: 'Reset Draft Session?',
      description: 'This will reset the draft and start a fresh session. Old draft data will remain in the database but will be ignored.',
      action: 'Reset Draft',
      onConfirm: () => executeCleanupDraft(),
    });
  };
  const executeCleanupDraft = async () => {
    if (!leagueId) return;
    try {
      logger.log('Resetting draft - starting fresh session');
      
      // Just reset the league status to 'not_started' - don't try to delete old data
      // Old draft sessions will remain but won't be used
      try {
        await leagueApi.updateDraftSettings(leagueId, { draft_status: 'not_started' });
      } catch (statusErr) {
        const statusError = statusErr instanceof Error ? statusErr : new Error('Unknown error');
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

  const handleDeleteAllDrafts = () => {
    if (!isCommissioner) return;
    setConfirmDialog({
      title: 'Delete ALL Draft Data?',
      description: 'WARNING: This will permanently delete ALL draft data from ALL leagues in the database. This cannot be undone!',
      action: 'Yes, Delete Everything',
      onConfirm: () => executeDeleteAllDrafts(),
    });
  };
  const executeDeleteAllDrafts = async () => {
    if (!isCommissioner) return;
    try {
      logger.log('Starting deletion of ALL draft data...');
      
      const { error } = await DraftService.deleteAllDraftData();
      if (error) {
        logger.error('Error deleting all draft data:', error);
        toast({ title: "Error", description: `Failed to delete all draft data: ${(error as any).message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      logger.log('All draft data deleted successfully');
      
      // Reset local state and reload data instead of full page reload
      resetDraftLocalState();
      setDraftPhase(DraftPhase.LOBBY);
      await loadDraftData();
      
      toast({ title: "Success", description: "All draft data has been deleted successfully." });
      
    } catch (error: unknown) {
      logger.error('Error deleting all draft data:', error);
      toast({ title: "Error", description: `Failed to delete all draft data: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: "destructive" });
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

  const handleResetDraft = () => {
    if (!leagueId || !isCommissioner) return;
    setConfirmDialog({
      title: 'Reset Draft?',
      description: 'This will permanently delete all draft data and start fresh. This action cannot be undone.',
      action: 'Reset Draft',
      onConfirm: () => executeResetDraft(),
    });
  };
  const executeResetDraft = async () => {
    if (!leagueId || !isCommissioner) return;
    try {
      logger.log('Starting draft reset for league:', leagueId);
      
      // Reset local state first to prevent any UI updates during deletion
      resetDraftLocalState();
      
      // Use hard delete to completely clear draft data
      const { error } = await DraftService.hardDeleteDraft(leagueId);
      if (error) {
        logger.error('Error resetting draft:', error);
        toast({ title: "Error", description: `Failed to reset draft: ${(error as any).message || 'Unknown error'}`, variant: "destructive" });
        return;
      }

      logger.log('Draft data deleted successfully, verifying reset...');
      
      // Verify the league status was updated
      try {
        const verifyRes = await leagueApi.getLeague(leagueId);
        const updatedLeague = verifyRes.data as League | null;
        logger.log('League status after reset:', updatedLeague?.draft_status);

        // If status wasn't updated, update it manually
        if (updatedLeague?.draft_status !== 'not_started') {
          logger.log('League status not updated, fixing it...');
          await leagueApi.updateDraftSettings(leagueId, { draft_status: 'not_started' });
        }
      } catch (verifyError) {
        logger.error('Error verifying league status:', verifyError);
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
  const handleAddToQueue = useCallback((playerId: string) => {
    setDraftQueue(prev =>
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  }, []);

  // Watchlist handlers
  const handleToggleWatchlist = useCallback((playerId: string) => {
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
  }, []);

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

  // Memoize DraftBoard teams prop to avoid re-creating objects every render
  const draftBoardTeams = useMemo(() => {
    return (orderedTeamsForBoard.length > 0 ? orderedTeamsForBoard : teams).map(t => ({
      id: t.id,
      name: t.team_name,
      owner: t.owner_name || (t.owner_id ? 'User' : 'AI'),
      color: '#7CB518',
      picks: teamPicksMap.get(t.id) || []
    }));
  }, [orderedTeamsForBoard, teams, teamPicksMap]);

  // Handle player click to open stats modal
  const handlePlayerClick = useCallback((playerId: string) => {
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
        eligible_positions: player.eligible_positions || [player.position],
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
          ? new ScoringCalculator().calculatePointsPerGame({
              goals: player.goals || 0, assists: player.assists || 0, shots: player.shots || 0,
              blocks: player.blocks || 0, hits: player.hits || 0, pim: player.pim || 0,
              ppp: player.ppp || 0, shp: player.shp || 0
            }, false, player.games_played)
          : 0
      };

      setSelectedPlayerForStats(hockeyPlayer);
      setIsPlayerDialogOpen(true);
    } catch (error) {
      logger.error('Error loading player stats:', error);
    }
  }, [playersById]);

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
      if (!sessionId && user?.id) {
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
      picks: [] as unknown[],
    }));
  }, [teams]);

  // If no league param in URL but we have an active league, redirect with the league param
  if (!leagueId && activeLeagueId) {
    return <Navigate to={`/draft-room?league=${activeLeagueId}`} replace />;
  }

  // Redirect pool leagues to their pool page
  const _leagueType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_leagueType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_leagueType!, activeLeagueId)} replace />;
  }

  // ALWAYS render something - never return null
  return (
    <div className="min-h-screen bg-[#D4E8B8] relative touch-manipulation overflow-x-clip">
      {/* Realtime connection banner — surfaces when the draft-pick channel
          drops so users know their draft isn't silently stalled.
          'connected' is the quiescent state; we don't render anything. */}
      {realtimeStatus === 'reconnecting' && (
        <div className="sticky top-0 z-50 bg-amber-500 text-black text-sm font-semibold px-4 py-2 text-center shadow-md pt-[env(safe-area-inset-top)]">
          Reconnecting to draft — your picks may be delayed for a few seconds.
        </div>
      )}
      {realtimeStatus === 'disconnected' && (
        <div className="sticky top-0 z-50 bg-red-600 text-white text-sm font-semibold px-4 py-2 text-center shadow-md pt-[env(safe-area-inset-top)]">
          Lost connection to draft. Refresh the page to reconnect. Your picks will not arrive in real time until you do.
        </div>
      )}
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">Draft Room</h1>
        </div>
      </div>

      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            {/* Main Content - Scrollable - Appears first on mobile */}
            <div className="min-w-0 overflow-y-visible lg:overflow-y-auto lg:overflow-x-hidden lg:max-h-[calc(100dvh-7rem)] px-0 sm:px-2 lg:px-2 order-1 lg:order-1">
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
                <CardTitle className="text-citrus-forest">Draft Room</CardTitle>
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
          <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8 overflow-x-hidden">
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
                onTeamsCountChange={isCommissioner ? handleTeamsCountChange : undefined}
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
                  {/* Left: Round/Pick + Team + Connection */}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs md:text-sm text-muted-foreground flex items-center gap-2">
                      <span>R{draftState?.currentRound || 1} • Pick {draftState?.currentPick || 1}/{(teams?.length || 0) * (draftSettings?.rounds || 21)}</span>
                      {leagueId && <ConnectionStatus leagueId={leagueId} />}
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

                  {/* Right: Draft button + Auto-draft toggle */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {userLeagueState === 'active-user' && (
                      <>
                        {selectedPlayer && currentTeam?.owner_id === user?.id && !userAutoDraftEnabled && (
                          <Button
                            variant="default"
                            size="sm"
                            className="text-xs md:text-sm"
                            disabled={pickInProgress}
                            onClick={() => handlePlayerDraft(selectedPlayer)}
                          >
                            {pickInProgress ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Drafting...</> : 'Draft'}
                          </Button>
                        )}
                        <button
                          onClick={() => setUserAutoDraftEnabled(prev => !prev)}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-full font-semibold text-xs md:text-sm transition-all border-2',
                            userAutoDraftEnabled
                              ? 'bg-green-600 border-green-600 text-white shadow-md shadow-green-600/30'
                              : 'bg-muted border-border text-muted-foreground hover:border-green-500 hover:text-green-600'
                          )}
                        >
                          <Zap className={cn('h-3.5 w-3.5 md:h-4 md:w-4', userAutoDraftEnabled && 'fill-white')} />
                          {userAutoDraftEnabled ? 'AUTO ON' : 'Auto'}
                        </button>
                      </>
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

                {/* Mobile draft-order bar — next picks at a glance so users don't need to switch tabs */}
                {teams.length > 1 && draftState && (
                  <div className="flex items-center gap-1 mt-1.5 overflow-x-auto text-xs lg:hidden pb-0.5 scrollbar-styled">
                    <span className="text-muted-foreground flex-shrink-0 text-[10px]">Next:</span>
                    {(() => {
                      const boardOrder = orderedTeamsForBoard.length > 0 ? orderedTeamsForBoard : teams;
                      const teamsCount = boardOrder.length;
                      const draftType = ((league?.settings as LeagueSettings)?.draftType || 'snake') as string;
                      const isLinear = draftType === 'linear';
                      const picks: { team: typeof boardOrder[0]; isCurrent: boolean }[] = [];
                      for (let i = 0; i < Math.min(6, teamsCount * 2); i++) {
                        const pickNum = (draftState.currentPick || 1) + i;
                        const round = Math.floor((pickNum - 1) / teamsCount) + 1;
                        const pickInRound = (pickNum - 1) % teamsCount;
                        const isReversed = !isLinear && round % 2 === 0;
                        const roundOrder = isReversed ? [...boardOrder].reverse() : boardOrder;
                        const team = roundOrder[pickInRound];
                        if (team) picks.push({ team, isCurrent: i === 0 });
                      }
                      return picks.map((p, i) => (
                        <span
                          key={i}
                          className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap flex-shrink-0',
                            p.isCurrent
                              ? 'bg-primary text-primary-foreground'
                              : p.team.owner_id === user?.id
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {p.team.team_name.length > 10 ? p.team.team_name.slice(0, 10) + '…' : p.team.team_name}
                        </span>
                      ));
                    })()}
                  </div>
                )}

                {/* Row 2: Player spotlight — selected player, queued player, or last pick */}
                {selectedPlayer ? (
                  <div className="mt-2 flex items-center gap-2 bg-primary/10 border-2 border-primary/30 rounded-lg px-3 py-2.5 shadow-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge className="text-[10px] flex-shrink-0 bg-primary text-primary-foreground">{selectedPlayer.position}</Badge>
                        <span className="font-bold text-sm md:text-base truncate cursor-pointer hover:text-primary hover:underline" onClick={() => handlePlayerClick(selectedPlayer.id)}>{selectedPlayer.full_name}</span>
                        <span className="text-xs text-muted-foreground flex-shrink-0">{selectedPlayer.team}</span>
                      </div>
                      {/* Full stat line — scrollable on mobile */}
                      <div className="flex items-center gap-2 mt-1.5 overflow-x-auto text-[11px] md:text-xs pb-0.5 scrollbar-styled">
                        {selectedPlayer.position === 'G' ? (
                          <>
                            <span className="flex-shrink-0 font-bold text-primary">{selectedPlayer.wins || 0}W</span>
                            <span className="text-muted-foreground/40">|</span>
                            <span className="flex-shrink-0">{selectedPlayer.losses || 0}L</span>
                            <span className="flex-shrink-0">{selectedPlayer.goals_against_average ? selectedPlayer.goals_against_average.toFixed(2) : '0.00'} GAA</span>
                            <span className="flex-shrink-0">{selectedPlayer.save_percentage ? (selectedPlayer.save_percentage * 100).toFixed(1) : '0.0'}%</span>
                            <span className="flex-shrink-0">{selectedPlayer.saves || 0} SV</span>
                            <span className="flex-shrink-0">{selectedPlayer.shutouts || 0} SO</span>
                          </>
                        ) : (
                          <>
                            <span className="flex-shrink-0 font-bold text-primary">{selectedPlayer.points} PTS</span>
                            <span className="text-muted-foreground/40">|</span>
                            <span className="flex-shrink-0">{selectedPlayer.goals}G</span>
                            <span className="flex-shrink-0">{selectedPlayer.assists}A</span>
                            <span className="flex-shrink-0">{selectedPlayer.plus_minus > 0 ? '+' : ''}{selectedPlayer.plus_minus}</span>
                            <span className="flex-shrink-0">{selectedPlayer.ppp || 0} PPP</span>
                            <span className="flex-shrink-0">{selectedPlayer.shp || 0} SHP</span>
                            <span className="flex-shrink-0">{selectedPlayer.shots} SOG</span>
                            <span className="flex-shrink-0">{selectedPlayer.hits} HIT</span>
                            <span className="flex-shrink-0">{selectedPlayer.blocks} BLK</span>
                            <span className="flex-shrink-0">{selectedPlayer.pim || 0} PIM</span>
                          </>
                        )}
                      </div>
                    </div>
                    {currentTeam?.owner_id === user?.id && userLeagueState === 'active-user' && (
                      <Button
                        onClick={(e) => { e.stopPropagation(); handlePlayerDraft(selectedPlayer); }}
                        size="sm"
                        className="flex-shrink-0 relative z-20 bg-primary hover:bg-primary/90 font-bold px-4"
                        disabled={pickInProgress || draftedPlayerIds.has(selectedPlayer.id)}
                      >
                        {draftedPlayerIds.has(selectedPlayer.id) ? 'Taken' : pickInProgress ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Drafting...</> : 'Draft'}
                      </Button>
                    )}
                  </div>
                ) : (() => {
                  // Show next queued player if available (gives the nav bar purpose)
                  const nextQueuedPlayer = draftQueue
                    .filter(id => !draftedPlayerIds.has(id))
                    .map(id => playersById.get(id))
                    .find(p => p !== undefined);
                  const mostRecent = draftHistory.length > 0 ? draftHistory[draftHistory.length - 1] : null;
                  const lastPlayer = mostRecent ? playersById.get(mostRecent.player_id) : null;
                  const lastTeam = mostRecent ? teamsById.get(mostRecent.team_id) : null;

                  return (
                    <div className="mt-2 flex items-center gap-3 bg-muted/20 border border-border/40 rounded-lg px-3 py-2.5">
                      {nextQueuedPlayer ? (
                        <>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <Star className="h-3.5 w-3.5 fill-fantasy-tertiary text-fantasy-tertiary flex-shrink-0" />
                              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide flex-shrink-0">Up Next</span>
                              <Badge variant="outline" className="text-[10px] flex-shrink-0">{nextQueuedPlayer.position}</Badge>
                              <span className="font-bold text-sm truncate cursor-pointer hover:text-primary hover:underline" onClick={() => handlePlayerClick(nextQueuedPlayer.id)}>{nextQueuedPlayer.full_name}</span>
                              <span className="text-xs text-muted-foreground flex-shrink-0">{nextQueuedPlayer.team}</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] md:text-xs text-muted-foreground">
                              {nextQueuedPlayer.position === 'G' ? (
                                <span>{nextQueuedPlayer.wins || 0}W • {nextQueuedPlayer.goals_against_average?.toFixed(2) || '0.00'} GAA • {nextQueuedPlayer.save_percentage ? (nextQueuedPlayer.save_percentage * 100).toFixed(1) : '0.0'}%</span>
                              ) : (
                                <span>{nextQueuedPlayer.points} PTS • {nextQueuedPlayer.goals}G • {nextQueuedPlayer.assists}A</span>
                              )}
                            </div>
                          </div>
                          {currentTeam?.owner_id === user?.id && userLeagueState === 'active-user' && (
                            <Button
                              onClick={() => { setSelectedPlayer(nextQueuedPlayer); }}
                              variant="outline"
                              size="sm"
                              className="flex-shrink-0 text-xs"
                            >
                              Select
                            </Button>
                          )}
                        </>
                      ) : lastPlayer && lastTeam ? (
                        <div className="flex items-center gap-2 text-xs md:text-sm w-full">
                          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Last Pick</span>
                          <Badge variant="outline" className="text-[10px]">{lastPlayer.position}</Badge>
                          <span className="font-semibold truncate cursor-pointer hover:text-primary hover:underline" onClick={() => handlePlayerClick(lastPlayer.id)}>{lastPlayer.full_name}</span>
                          <span className="text-muted-foreground hidden sm:inline">to {lastTeam.team_name}</span>
                          <span className="text-muted-foreground ml-auto flex-shrink-0">R{mostRecent!.round_number}</span>
                        </div>
                      ) : (
                        <div className="text-center w-full py-1">
                          <p className="text-xs text-muted-foreground">Click a player below to select them for drafting</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

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
            <div className={`w-full max-w-full px-2 sm:px-4 py-3 sm:py-6 pb-20 sm:pb-6 ${isCommissioner && (draftHistory?.length || 0) > 0 ? '!pb-32 sm:!pb-6' : ''}`}>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-6" style={{ minWidth: 0 }}>
                {/* Main Draft Area */}
                <div className="lg:col-span-3" style={{ minWidth: 0 }}>
                  <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-3 sm:space-y-6" style={{ minWidth: 0 }}>
                    {/* Mobile: 4 tabs (includes Roster). Desktop: 3 tabs (Roster in sidebar) */}
                    <TabsList className="grid w-full grid-cols-4 lg:grid-cols-3 h-11 sm:h-10">
                      <TabsTrigger value="players" className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm px-1 sm:px-3">
                        <Users className="h-4 w-4 flex-shrink-0" />
                        <span className="hidden min-[360px]:inline">Players</span>
                      </TabsTrigger>
                      <TabsTrigger value="board" className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm px-1 sm:px-3">
                        <Trophy className="h-4 w-4 flex-shrink-0" />
                        <span className="hidden min-[360px]:inline">Board</span>
                      </TabsTrigger>
                      <TabsTrigger value="history" className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm px-1 sm:px-3">
                        <History className="h-4 w-4 flex-shrink-0" />
                        <span className="hidden min-[360px]:inline">History</span>
                      </TabsTrigger>
                      <TabsTrigger value="roster" className="flex items-center justify-center gap-1 text-xs px-1 lg:hidden">
                        <Star className="h-4 w-4 flex-shrink-0" />
                        <span className="hidden min-[360px]:inline">Roster</span>
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
                                  // Pull league-configured auction settings instead of hardcoding.
                                  // Was silently forcing opening-bid=$1 and 30s nomination timer regardless
                                  // of what the commissioner chose at creation.
                                  const auctionSettings = (league?.settings as LeagueSettings) || {};
                                  const openingBid = auctionSettings.auctionMinBid ?? 1;
                                  const nominationSeconds = auctionSettings.auctionNominationTime ?? 30;
                                  const result = await AuctionDraftService.nominatePlayer(
                                    leagueId,
                                    auctionSessionId,
                                    userTeam.id,
                                    String(selectedPlayer.id),
                                    selectedPlayer.full_name,
                                    openingBid,
                                    nominationSeconds,
                                  );
                                  if (result.success && result.nomination) {
                                    toast({ title: 'Player Nominated', description: `${selectedPlayer.full_name} is up for bidding!` });
                                    setAuctionNominationId(result.nomination.id || null);
                                    setBidAmount(openingBid + 1); // Set to minimum overbid
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
                    <TabsContent value="players" className="space-y-0" style={{ minWidth: 0 }}>
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
                        draftedPlayers={draftedPlayerIdsArray}
                        isDraftActive={draftPhase === DraftPhase.ACTIVE}
                        availablePlayers={availablePlayers}
                        onAddToQueue={handleAddToQueue}
                        onToggleWatchlist={handleToggleWatchlist}
                        queue={draftQueue}
                        watchlist={watchlist}
                        scoringSettings={league?.scoring_settings as unknown as ScoringSettings | undefined}
                        projectedFptsMap={projectedFptsMap}
                      />
                    </TabsContent>

                    {/* Lazy load other tabs - only render when active */}
                     {activeTab === 'board' && (
                       <TabsContent value="board" className="space-y-0">
                         <DraftBoard
                           teams={draftBoardTeams}
                           draftHistory={transformedDraftHistory}
                           currentPick={draftState?.currentPick || 1}
                           currentRound={draftState?.currentRound || 1}
                           totalRounds={league?.draft_rounds || draftSettings.rounds || 21}
                           onPlayerClick={handlePlayerClick}
                           draftType={((league?.settings as LeagueSettings)?.draftType || 'snake') as 'snake' | 'linear'}
                         />
                       </TabsContent>
                     )}

                    {activeTab === 'history' && (
                      <TabsContent value="history" className="space-y-0">
                        <DraftHistory
                          draftHistory={transformedDraftHistory}
                          onPlayerClick={handlePlayerClick}
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
                              positionType={(league?.settings as LeagueSettings)?.positionType === 'forward' ? 'forward' : 'individual'}
                              rosterSlots={(league?.settings as LeagueSettings)?.rosterSlots}
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
                              disabled={pickInProgress || draftedPlayerIds.has(selectedPlayer.id)}
                            >
                              {draftedPlayerIds.has(selectedPlayer.id) ? 'Already Drafted' : pickInProgress ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Drafting...</> : 'Draft This Player'}
                            </Button>
                          </Card>
                        )}

                        {/* Draft Queue on mobile — always visible so users discover the star-queue mechanic */}
                        {(
                          <DraftQueue
                            queue={draftQueue}
                            players={availablePlayers}
                            draftedPlayers={draftedPlayerIdsArray}
                            onQueueChange={handleQueueChange}
                            onDraftFromQueue={handleDraftFromQueue}
                            isDraftActive={draftPhase === DraftPhase.ACTIVE}
                            isYourTurn={currentTeam?.owner_id === user?.id}
                            leagueId={leagueId || undefined}
                            currentPick={draftState?.currentPick}
                            totalPicks={teams.length * draftSettings.rounds}
                          />
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
                                onSkipPick={isCommissioner ? handleAutoDraft : undefined}
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
                      </TabsContent>
                    )}
                  </Tabs>
                </div>

                {/* Right Sidebar - Teams (hidden on mobile, shown on lg+) */}
                <div className="hidden lg:block lg:col-span-1 space-y-4">
                  {/* Teams Selector */}
                  <Card>
                    <CardHeader>
                      <CardTitle>View Team Roster</CardTitle>
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
                            positionType={(league?.settings as LeagueSettings)?.positionType === 'forward' ? 'forward' : 'individual'}
                            rosterSlots={(league?.settings as LeagueSettings)?.rosterSlots}
                          />
                        );
                      })()}
                    </CardContent>
                  </Card>
                  
                  {/* User's Roster Depth Chart — only when the dropdown above
                      isn't already showing the user's own team. Otherwise the
                      same roster rendered twice (once in "View Team Roster"
                      card, once here). */}
                  {userTeam && selectedTeamId && selectedTeamId !== userTeam.id && (
                    <RosterDepthChart
                      draftedPlayers={userDraftedPlayers}
                      draftPicks={draftHistory}
                      currentRound={draftState?.currentRound || 1}
                      totalRounds={draftSettings.rounds}
                      availablePlayers={availablePlayers.filter(p => !draftedPlayerIds.has(p.id))}
                      onAddToQueue={handleAddToQueue}
                      positionType={(league?.settings as LeagueSettings)?.positionType === 'forward' ? 'forward' : 'individual'}
                      rosterSlots={(league?.settings as LeagueSettings)?.rosterSlots}
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
                        disabled={pickInProgress || draftedPlayerIds.has(selectedPlayer.id)}
                      >
                        {draftedPlayerIds.has(selectedPlayer.id) ? 'Already Drafted' : pickInProgress ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Drafting...</> : 'Draft This Player'}
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

                  {/* Draft Queue — always visible so users discover the star-queue mechanic */}
                  {(
                    <DraftQueue
                      queue={draftQueue}
                      players={availablePlayers}
                      draftedPlayers={draftedPlayerIdsArray}
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
                          onSkipPick={isCommissioner ? handleAutoDraft : undefined}
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

                </div>
              </div>
            </div>

            {/* Floating Commissioner Toolbar - mobile: full-width bottom bar, desktop: floating buttons */}
            {isCommissioner && draftPhase === DraftPhase.ACTIVE && (draftHistory?.length || 0) > 0 && (
              <>
                {/* Mobile: Fixed bottom bar spanning full width */}
                <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t shadow-[0_-2px_10px_rgba(0,0,0,0.1)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-[10px] font-semibold text-destructive uppercase tracking-wide flex-shrink-0">Commish</span>
                    {/* Undo Last Pick */}
                    {draftHistory.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 px-3 text-xs"
                        onClick={handleUndoLastPick}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Undo Pick
                      </Button>
                    )}
                    {/* Pause / Resume */}
                    {league?.settings?.timerStartedAt ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-9 px-3 text-xs"
                        onClick={handlePauseDraft}
                      >
                        <Pause className="h-3.5 w-3.5 mr-1.5" />
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-9 px-3 text-xs"
                        onClick={handleContinueDraft}
                      >
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                        Resume
                      </Button>
                    )}
                  </div>
                </div>
                {/* Desktop: Floating buttons in bottom-right corner */}
                <div className="hidden sm:flex fixed bottom-4 right-4 z-50 items-center gap-2">
                  {/* Undo Last Pick */}
                  {draftHistory.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shadow-lg bg-card h-10 px-4 text-sm"
                      onClick={handleUndoLastPick}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Undo Pick
                    </Button>
                  )}
                  {/* Pause / Resume */}
                  {league?.settings?.timerStartedAt ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="shadow-lg h-10 px-4 text-sm"
                      onClick={handlePauseDraft}
                    >
                      <Pause className="h-4 w-4 mr-2" />
                      Pause Draft
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="shadow-lg h-10 px-4 text-sm"
                      onClick={handleContinueDraft}
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Continue Draft
                    </Button>
                  )}
                </div>
              </>
            )}
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
              {/* Demo State CTA - removed (disabled) */}
              
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
                           teams={draftBoardTeams}
                           draftHistory={transformedDraftHistory}
                           currentPick={draftState?.currentPick || 1}
                           currentRound={draftState?.currentRound || 1}
                           totalRounds={league?.draft_rounds || draftSettings.rounds || 21}
                           onPlayerClick={handlePlayerClick}
                           draftType={((league?.settings as LeagueSettings)?.draftType || 'snake') as 'snake' | 'linear'}
                        />
                     </CardContent>
                  </Card>
            
            {isCommissioner && (
               <div className="fixed bottom-4 left-4">
               </div>
            )}

            {/* Show Pause/Continue buttons for in-progress drafts - Disabled in demo state */}
            {isCommissioner && userLeagueState === 'active-user' && (draftPhase as string) === DraftPhase.ACTIVE && (draftHistory?.length || 0) > 0 && (
              <div className="fixed bottom-4 right-4 z-50">
                {league?.settings?.timerStartedAt ? (
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

            {/* Left Sidebar - Hidden on desktop during draft to maximize player table space */}
            <aside className="w-full lg:hidden order-2 lg:order-1">
              <div className="space-y-4">
                <AdSpace size="300x250" label="Draft Sponsor" />
                <AdSpace size="300x250" label="Fantasy Partner" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && (activeLeagueId || leagueId) && (
              <aside className="hidden lg:block order-2">
                <div className="lg:sticky lg:top-24 h-[calc(100dvh-7rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
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

      {/* Reusable confirmation dialog (replaces window.confirm for mobile compatibility) */}
      <AlertDialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmDialog?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DraftRoom;
