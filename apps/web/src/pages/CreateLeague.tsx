import { userMessage } from '@/lib/userMessage';
import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  HockeyFooter,
  CupIcon,
  CrossedSticksIcon,
  PuckIcon,
  ScoreboardIcon,
  XGModelIcon,
  SlateIcon,
  DraftIcon,
  PickemIcon,
  SurvivorIcon,
  BracketIcon,
  RangeIcon,
  ShiftIcon,
  MaskIcon,
  NetIcon,
} from '@/components/citrus2';
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { useLeague } from "@/contexts/LeagueContext";
import { LeagueService } from "@/services/LeagueService";
import { supabase } from "@/integrations/supabase/client";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Trophy, CheckCircle, AlertCircle, UserPlus,
  Copy, Sparkles, Target, Shield, BarChart3,
  Crown, DollarSign, Shuffle, ArrowDown, Bot, FileEdit,
  ChevronDown, ChevronUp, Info, Lock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@citrus/shared";
import WaitlistSignup from "@/components/WaitlistSignup";
import {
  type LeagueType,
  type ScoringFormat,
  type DraftType,
  type PickemFormat,
  LEAGUE_TYPE_LABELS,
  LEAGUE_TYPE_DESCRIPTIONS,
  SCORING_FORMAT_LABELS,
  SCORING_FORMAT_DESCRIPTIONS,
  DRAFT_TYPE_LABELS,
  DRAFT_TYPE_DESCRIPTIONS,
  FORMAT_HAS_MATCHUPS,
  AVAILABLE_CATEGORIES,
  DEFAULT_ROTO_CATEGORIES,
  getDefaultSettings,
  requiresDraft,
  requiresRoster,
  usesPointValues,
  hasWaivers,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_FDG_ROSTER_SLOTS,
} from "@/types/leagueTypes";

// ============================================================================
// LEAGUE TYPE CARD ICONS — custom hockey iconography from citrus2
// ============================================================================
const LEAGUE_TYPE_ICONS: Record<LeagueType, React.ReactNode> = {
  'fantasy':                  <CrossedSticksIcon className="w-8 h-8" strokeWidth={1.75} />,
  'pickem':                   <PickemIcon className="w-8 h-8" strokeWidth={1.75} />,
  'survivor':                 <SurvivorIcon className="w-8 h-8" strokeWidth={1.75} />,
  'confidence-pool':          <XGModelIcon className="w-8 h-8" strokeWidth={1.75} />,
  'playoff-bracket-pickem':   <BracketIcon className="w-8 h-8" strokeWidth={1.75} />,
  'playoff-confidence-pool':  <XGModelIcon className="w-8 h-8" strokeWidth={1.75} />,
  'playoff-roster-pool':      <ScoreboardIcon className="w-8 h-8" strokeWidth={1.75} />,
};

const DRAFT_TYPE_ICONS: Record<DraftType, React.ReactNode> = {
  'snake':    <Shuffle className="h-5 w-5" />,
  'linear':   <ArrowDown className="h-5 w-5" />,
  'auction':  <DollarSign className="h-5 w-5" />,
  'autopick': <Bot className="h-5 w-5" />,
  'offline':  <DraftIcon className="h-5 w-5" strokeWidth={2} />,
};

// ============================================================================
// STAT DEFINITIONS (reusable across formats)
// ============================================================================
const DEFAULT_LEAGUE_STATS = [
  { id: "g", name: "Goals", points: 3, default: true, category: "Offense", enabled: true },
  { id: "a", name: "Assists", points: 2, default: true, category: "Offense", enabled: true },
  { id: "ppp", name: "Power Play Points", points: 1, default: true, category: "Offense", enabled: true },
  { id: "shg", name: "Shorthanded Points", points: 2, default: true, category: "Offense", enabled: true },
  { id: "sog", name: "Shots on Goal", points: 0.4, default: true, category: "Offense", enabled: true },
  { id: "blk", name: "Blocks", points: 0.5, default: true, category: "Defense", enabled: true },
  { id: "hit", name: "Hits", points: 0.2, default: true, category: "Defense", enabled: true },
  { id: "pim", name: "Penalty Minutes", points: 0.5, default: true, category: "Defense", enabled: true },
  { id: "pm", name: "Plus/Minus", points: 0.5, default: true, category: "Defense", enabled: true },
  { id: "w", name: "Wins", points: 4, default: true, category: "Goalie", enabled: true },
  { id: "so", name: "Shutouts", points: 3, default: true, category: "Goalie", enabled: true },
  { id: "sv", name: "Saves", points: 0.2, default: true, category: "Goalie", enabled: true },
  { id: "ga", name: "Goals Against", points: -1, default: true, category: "Goalie", enabled: true },
];

// ============================================================================
// SECTION HEADER COMPONENT
// ============================================================================
const SectionHeader = ({ title, subtitle, badge }: { title: string; subtitle: string; badge?: React.ReactNode }) => (
  <div className="flex items-center justify-between mb-6">
    <div>
      <h3 className="font-calistoga text-xl text-pastel-cream leading-none">{title}</h3>
      <p className="text-white/55 text-sm mt-1.5">{subtitle}</p>
    </div>
    {badge}
  </div>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const CreateLeague = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { refreshLeagues, setActiveLeagueId } = useLeague();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultTab, setDefaultTab] = useState<"create" | "join">("create");

  // ---- Core Settings ----
  const [leagueName, setLeagueName] = useState("");
  const [leagueType, setLeagueType] = useState<LeagueType>("playoff-bracket-pickem");
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>("h2h-points");
  const [draftType, setDraftType] = useState<DraftType>("snake");
  const [teamsCount, setTeamsCount] = useState("12");
  const [draftRounds, setDraftRounds] = useState("21");
  const [pickTimeLimit, setPickTimeLimit] = useState("90");

  // ---- Auction Draft Settings ----
  const [auctionBudget, setAuctionBudget] = useState("200");
  const [auctionMinBid, setAuctionMinBid] = useState("1");
  const [auctionNominationTime, setAuctionNominationTime] = useState("30");

  // ---- Season Settings ----
  const [playoffTeams, setPlayoffTeams] = useState("6");
  const [playoffWeeks, setPlayoffWeeks] = useState("3");
  const [tradeDeadlineWeek, setTradeDeadlineWeek] = useState("0");

  // ---- Keeper / Dynasty Settings ----
  const [keeperEnabled, setKeeperEnabled] = useState(false);
  const [keeperCount, setKeeperCount] = useState("3");
  const [keeperPenalty, setKeeperPenalty] = useState<'none' | 'round-cost' | 'round-escalation'>('none');
  const [dynastyMode, setDynastyMode] = useState(false);

  // ---- Best Ball Setting ----
  const [bestBallEnabled, setBestBallEnabled] = useState(false);

  // ---- Category / Roto Settings ----
  const [selectedCategories, setSelectedCategories] = useState<string[]>([...DEFAULT_ROTO_CATEGORIES]);
  const [minGoalieGames, setMinGoalieGames] = useState("3");

  // ---- Pool Settings ----
  const [pickemFormat, setPickemFormat] = useState<PickemFormat>("straight-up");
  const [picksPerWeek, setPicksPerWeek] = useState("10");
  const [survivorLives, setSurvivorLives] = useState("1");
  const [confidenceMaxPoints, setConfidenceMaxPoints] = useState("10");
  const [pickDeadline, setPickDeadline] = useState<'per-game' | 'first-game'>('per-game');
  // Default playoff roster lock: April 21, 2026 at 8:00 PM UTC (Round 1 Game 1 estimate)
  const [playoffLockDeadline, setPlayoffLockDeadline] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 4); d.setHours(20, 0, 0, 0);
    return d.toISOString().slice(0, 16); // yyyy-mm-ddThh:mm format for datetime-local
  });
  const [tiebreaker, setTiebreaker] = useState<'none' | 'total-points' | 'most-upsets'>('none');
  const [allowRepeatTeams, setAllowRepeatTeams] = useState(false);
  const [poolVisibility, setPoolVisibility] = useState<'private' | 'public'>('private');
  // Bracket pickem: round-by-round (picks unlock per round) vs full-bracket
  // (all picks locked in before R1 Game 1, March Madness style).
  const [bracketPickMode, setBracketPickMode] = useState<'round-by-round' | 'full-bracket'>('round-by-round');

  // ---- Waiver Settings ----
  const [waiverSettings, setWaiverSettings] = useState({
    waiver_process_time: '02:00:00',
    waiver_period_hours: 48,
    waiver_game_lock: true,
    waiver_type: 'rolling' as 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings',
    allow_trades_during_games: true,
    faab_budget: 100,
  });

  // ---- Transaction Limit Settings (industry standard: ESPN/Yahoo/Sleeper) ----
  const [weeklyAddLimit, setWeeklyAddLimit] = useState("0");
  const [seasonAddLimit, setSeasonAddLimit] = useState("0");

  // ---- Position Type ----
  const [positionType, setPositionType] = useState<'individual' | 'forward'>('individual');

  // ---- Roster Slot Configuration ----
  const [rosterSlots, setRosterSlots] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    DEFAULT_ROSTER_SLOTS.forEach(s => { defaults[s.slot] = s.count; });
    return defaults;
  });

  // ---- Scoring Stats ----
  const [leagueStats, setLeagueStats] = useState([...DEFAULT_LEAGUE_STATS]);

  // ---- Join League ----
  const [joinCode, setJoinCode] = useState("");
  const [teamNameForJoin, setTeamNameForJoin] = useState("");

  // ---- Collapsible sections ----
  const [showAdvancedSeason, setShowAdvancedSeason] = useState(false);

  // Read query params
  useEffect(() => {
    const tab = searchParams.get('tab');
    const code = searchParams.get('code');
    const type = searchParams.get('type');
    if (tab === 'join') setDefaultTab('join');
    if (code) setJoinCode(code);
    // ?type=playoff → default to bracket pickem (most common playoff format)
    if (type === 'playoff') {
      setLeagueType('playoff-bracket-pickem');
    }
  }, [searchParams]);

  // Auto-join if share link has ?code= AND user is logged in.
  // Previously users clicked an invite link, landed on the join tab with
  // code pre-filled, and had to hit "Join" manually. Now it fires automatically.
  const autoJoinFiredRef = useRef(false);
  useEffect(() => {
    const code = searchParams.get('code');
    if (code && user && !autoJoinFiredRef.current && !loading) {
      autoJoinFiredRef.current = true;
      setJoinCode(code);
      setDefaultTab('join');
      // Pass the code EXPLICITLY so we don't race with setJoinCode().
      // Previously handleJoinLeague read joinCode from closure which
      // could be empty if state hadn't committed yet.
      setTimeout(() => handleJoinLeague(code), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);

  // Reset format settings and smart defaults when league type changes
  useEffect(() => {
    if (leagueType === 'fantasy') {
      setScoringFormat('h2h-points');
      setDraftType('snake');
      setTeamsCount('12');
    } else if (leagueType === 'pickem' || leagueType === 'confidence-pool') {
      setTeamsCount('20');
    } else if (leagueType === 'survivor') {
      setTeamsCount('30');
    } else if (leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool' || leagueType === 'playoff-roster-pool') {
      setScoringFormat('total-points');
      setTeamsCount('20');
    }
  }, [leagueType]);

  // Auto-enable best ball when scoring format is best-ball
  useEffect(() => {
    if (scoringFormat === 'best-ball') {
      setBestBallEnabled(true);
    } else {
      setBestBallEnabled(false);
    }
  }, [scoringFormat]);

  // Confidence Pool: max confidence points should match picks per week
  // (you assign values 1 through N for N picks, each used once)
  useEffect(() => {
    if (leagueType === 'confidence-pool') {
      setConfidenceMaxPoints(picksPerWeek);
    }
  }, [picksPerWeek, leagueType]);

  // Derived state
  const isFantasy = leagueType === 'fantasy';
  const isPool = !isFantasy;
  // Playoff roster pools also need full scoring customization
  // (dynamic scoring per league — same engine fantasy uses)
  const isPlayoffRosterPool = leagueType === 'playoff-roster-pool';
  const showPointValues = (isFantasy && usesPointValues(scoringFormat)) || isPlayoffRosterPool;
  const showCategories = isFantasy && (scoringFormat === 'h2h-categories' || scoringFormat === 'roto');
  const showMatchupSettings = isFantasy && FORMAT_HAS_MATCHUPS[scoringFormat];
  const showDraftSettings = requiresDraft(leagueType);
  const showWaiverSettings = hasWaivers(leagueType);
  const isAuction = draftType === 'auction';

  const statsByCategory = useMemo(() => ({
    Offense: leagueStats.filter(s => s.category === "Offense"),
    Defense: leagueStats.filter(s => s.category === "Defense"),
    Goalie: leagueStats.filter(s => s.category === "Goalie"),
  }), [leagueStats]);

  // ---- Handlers ----
  const handleStatToggle = (id: string) => {
    setLeagueStats(prev => prev.map(stat =>
      stat.id === id ? { ...stat, enabled: !stat.enabled } : stat
    ));
  };

  const handleStatPointsChange = (id: string, value: string) => {
    const numValue = parseFloat(value);
    setLeagueStats(prev => prev.map(stat =>
      stat.id === id ? { ...stat, points: isNaN(numValue) ? 0 : numValue } : stat
    ));
  };

  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(c => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const handleCreateLeague = async () => {
    if (!user) {
      setError("You must be logged in to create a league");
      navigate("/auth");
      return;
    }

    if (!leagueName.trim()) {
      setError("League name is required");
      return;
    }

    const count = parseInt(teamsCount);
    if (isNaN(count) || count < 2 || count > 100) {
      setError("Number of teams/participants must be between 2 and 100");
      return;
    }

    // Validate roster has at least 1 slot for fantasy leagues
    if (leagueType === 'fantasy') {
      const totalSlots = Object.values(rosterSlots).reduce((sum, count) => sum + (count || 0), 0);
      if (totalSlots < 1) {
        setError("Roster must have at least 1 position slot");
        return;
      }
    }

    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const enabledStats = leagueStats.filter(s => s.enabled);

      // Build settings object — ONLY include fields relevant to this league type
      const settings: Record<string, unknown> = {
        leagueType,
        teamsCount: parseInt(teamsCount),
      };

      if (isFantasy) {
        // Fantasy-specific settings
        settings.scoringFormat = scoringFormat;
        settings.draftType = draftType;
        settings.stats = enabledStats;
        settings.pickTimeLimit = parseInt(pickTimeLimit);
        settings.rosterSlots = rosterSlots;
        settings.positionType = positionType;

        // Season settings
        settings.playoffTeams = parseInt(playoffTeams);
        settings.playoffWeeks = parseInt(playoffWeeks);
        settings.tradeDeadlineWeek = parseInt(tradeDeadlineWeek);

        // Keeper / Dynasty
        settings.keeperEnabled = keeperEnabled;
        if (keeperEnabled) {
          settings.keeperCount = parseInt(keeperCount);
          settings.keeperPenalty = keeperPenalty;
          settings.dynastyMode = dynastyMode;
        }

        // Best Ball
        settings.bestBallEnabled = bestBallEnabled;

        // Category / Roto settings (only for category-based formats)
        if (showCategories) {
          settings.categories = selectedCategories;
          settings.minGoalieGames = parseInt(minGoalieGames);
        }

        // Auction settings (only for auction drafts)
        if (draftType === 'auction') {
          settings.auctionBudget = parseInt(auctionBudget);
          settings.auctionMinBid = parseInt(auctionMinBid);
          settings.auctionNominationTime = parseInt(auctionNominationTime);
        }

        // Waiver/transaction settings (persisted in settings AND dedicated columns)
        settings.waiver_type = waiverSettings.waiver_type;
        settings.waiver_process_time = waiverSettings.waiver_process_time;
        settings.waiver_period_hours = waiverSettings.waiver_period_hours;
        settings.waiver_game_lock = waiverSettings.waiver_game_lock;
        settings.allow_trades_during_games = waiverSettings.allow_trades_during_games;
        settings.faabBudget = waiverSettings.faab_budget;
        settings.weeklyAddLimit = parseInt(weeklyAddLimit) || 0;
        settings.seasonAddLimit = parseInt(seasonAddLimit) || 0;
      } else {
        // Pool-specific settings — only what this pool type needs
        settings.scoringFormat = 'total-points';
        settings.draftType = 'none';
        settings.poolVisibility = poolVisibility;
        settings.pickDeadline = pickDeadline;
        settings.tiebreaker = tiebreaker;

        if (leagueType === 'pickem') {
          settings.pickemFormat = pickemFormat;
          settings.picksPerWeek = parseInt(picksPerWeek);
        } else if (leagueType === 'survivor') {
          settings.survivorLives = parseInt(survivorLives);
          settings.allowRepeatTeams = allowRepeatTeams;
        } else if (leagueType === 'confidence-pool') {
          settings.picksPerWeek = parseInt(picksPerWeek);
          settings.confidenceMaxPoints = parseInt(confidenceMaxPoints);
        } else if (leagueType === 'playoff-bracket-pickem') {
          settings.playoffBracketPointsPerRound = { r1: 2, r2: 4, r3: 8, scf: 16 };
          settings.playoffGamesPickBonus = 1;
          settings.playoffBracketPickMode = bracketPickMode;
          // Commissioner-selected pick lock deadline (ISO string)
          settings.playoffRosterLockedAt = new Date(playoffLockDeadline).toISOString();
        } else if (leagueType === 'playoff-confidence-pool') {
          settings.playoffConfidenceVariant = 'cumulative';
          settings.playoffRosterLockedAt = new Date(playoffLockDeadline).toISOString();
        } else if (leagueType === 'playoff-roster-pool') {
          settings.playoffRosterSize = 17;
          settings.playoffPositionRequirements = { F: 9, D: 6, G: 2 };
          settings.playoffMaxPlayersPerTeam = 3;
          // Commissioner-selected roster lock deadline
          settings.playoffRosterLockedAt = new Date(playoffLockDeadline).toISOString();
        }
      }

      // Playoff roster pools ALWAYS need scoring_settings (for ScoringCalculator).
      // Force default fantasy scoring if user didn't explicitly customize.
      const forceScoring = leagueType === 'playoff-roster-pool';
      // CRITICAL: if a stat is DISABLED by the commissioner, its point weight
      // must be 0 so ScoringCalculator contributes zero for that stat.
      // Previously we returned the default point value regardless of enabled flag,
      // which meant disabling hits/blocks/etc did nothing — FPTS still included them.
      const ptsFor = (id: string): number => {
        const stat = leagueStats.find(s => s.id === id);
        if (!stat || !stat.enabled) return 0;
        return stat.points;
      };
      // Build scoring_settings JSONB (for points-based formats)
      const scoringSettings = (showPointValues || forceScoring) ? {
        skater: {
          goals: ptsFor('g'),
          assists: ptsFor('a'),
          power_play_points: ptsFor('ppp'),
          short_handed_points: ptsFor('shg'),
          shots_on_goal: ptsFor('sog'),
          blocks: ptsFor('blk'),
          hits: ptsFor('hit'),
          penalty_minutes: ptsFor('pim'),
          plus_minus: ptsFor('pm')
        },
        goalie: {
          wins: ptsFor('w'),
          shutouts: ptsFor('so'),
          saves: ptsFor('sv'),
          goals_against: ptsFor('ga')
        }
      } : undefined;

      // Calculate roster size from slot configuration
      const rosterSize = isFantasy
        ? Object.values(rosterSlots).reduce((sum, count) => sum + count, 0)
        : 0;

      const { league, team, error: createError } = await LeagueService.createLeague(
        leagueName.trim(),
        user.id,
        isFantasy ? rosterSize : 0,
        isFantasy ? parseInt(draftRounds) : 0,
        settings,
        scoringSettings,
        isFantasy ? waiverSettings : undefined
      );

      if (createError) throw createError;
      if (!league) throw new Error("Failed to create league");

      await refreshLeagues();

      toast({
        title: "League Created!",
        description: `${league.name} has been created successfully.`,
      });

      setLoading(false);

      // Route to the appropriate page based on league type
      if (leagueType === 'pickem') {
        navigate(`/pool/pickem?league=${league.id}`);
      } else if (leagueType === 'survivor') {
        navigate(`/pool/survivor?league=${league.id}`);
      } else if (leagueType === 'confidence-pool') {
        navigate(`/pool/confidence?league=${league.id}`);
      } else if (leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool' || leagueType === 'playoff-roster-pool') {
        // Playoff pools → always land on the Hub (dashboard) after creation
        navigate(`/pool/playoff-hub?league=${league.id}`);
      } else {
        navigate(`/league/${league.id}?league=${league.id}`);
      }
    } catch (err: unknown) {
      // Extract message from ApiError, native Error, or generic object
      let errorMessage = "Failed to create league";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null) {
        const e = err as { message?: string; error?: string; details?: string };
        errorMessage = e.message || e.error || e.details || JSON.stringify(err).slice(0, 200);
      } else if (typeof err === 'string') {
        errorMessage = err;
      }
      logger.error('League creation failed:', { leagueType, err });
      setError(errorMessage);
      setLoading(false);

      toast({
        title: "Error Creating League",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleJoinLeague = async (codeOverride?: string) => {
    if (!user) {
      setError("Sign in first, then jump into the league.");
      navigate("/auth");
      return;
    }

    // Defensive code resolution: explicit arg → local state → URL query →
    // browser location (triple fallback). Fixes the 'Join code is required'
    // error that fired when the Input was controlled but state hadn't
    // committed yet, or when the URL had ?code= but a re-render cleared
    // joinCode state. ALL three sources are checked before giving up.
    let resolvedCode = (codeOverride ?? '').trim();
    if (!resolvedCode) resolvedCode = (joinCode ?? '').trim();
    if (!resolvedCode) resolvedCode = (searchParams.get('code') ?? '').trim();
    if (!resolvedCode && typeof window !== 'undefined') {
      try {
        resolvedCode = (new URLSearchParams(window.location.search).get('code') ?? '').trim();
      } catch { /* fall through */ }
    }

    if (!resolvedCode) {
      setError("Add a join code first — check your invite link.");
      return;
    }
    const effectiveCode = resolvedCode;

    setLoading(true);
    setError(null);

    // Shared route-to-pool helper so both success AND "already a member"
    // paths land the user in the same place.
    const routeToLeague = (
      leagueId: string,
      settings: Record<string, unknown> | null | undefined,
    ) => {
      const joinedLeagueType = settings?.leagueType as string | undefined;
      if (joinedLeagueType === 'pickem') {
        navigate(`/pool/pickem?league=${leagueId}`);
      } else if (joinedLeagueType === 'survivor') {
        navigate(`/pool/survivor?league=${leagueId}`);
      } else if (joinedLeagueType === 'confidence-pool') {
        navigate(`/pool/confidence?league=${leagueId}`);
      } else if (
        joinedLeagueType === 'playoff-bracket-pickem' ||
        joinedLeagueType === 'playoff-confidence-pool' ||
        joinedLeagueType === 'playoff-roster-pool'
      ) {
        navigate(`/pool/playoff-hub?league=${leagueId}`);
      } else {
        navigate(`/league/${leagueId}?league=${leagueId}`);
      }
    };

    try {
      const { league, team, error: joinError } = await LeagueService.joinLeagueByCode(
        effectiveCode,
        user.id,
        teamNameForJoin.trim() || undefined
      );

      if (joinError) throw joinError;
      if (!league || !team) throw new Error("Couldn't join that league — try again in a moment.");

      // Refresh the league list, THEN pin the newly joined league as the
      // active one BEFORE navigating. Without this, LeagueContext can
      // briefly show the user's old league (activeLeague lags the URL),
      // which is why users reported "joined but got dumped in a different
      // league / GM Office".
      await refreshLeagues();
      setActiveLeagueId(league.id);

      toast({
        title: "Joined League!",
        description: `Welcome to ${league.name}! Your team "${team.team_name}" has been created.`,
      });

      setLoading(false);
      routeToLeague(league.id, league.settings as Record<string, unknown> | null);
    } catch (err: unknown) {
      const errorMessage = userMessage(err, "Couldn't join that league — try again in a moment.");

      // "Already a member" is a success case — the first attempt actually
      // joined (even if the response looked glitchy). Redirect them to the
      // pool page instead of showing a scary error toast.
      const isAlreadyMember =
        /already have a team/i.test(errorMessage) ||
        /already (a )?member/i.test(errorMessage) ||
        /already joined/i.test(errorMessage);

      // Safety net for older server code or race conditions. With the
      // idempotent RPC this path shouldn't trigger — a successful retry
      // returns 200 with the existing team. But if it does, present it
      // as a normal successful join (no scary toast) so the user just
      // sees "Joined League!" and lands on the pool page.
      if (isAlreadyMember) {
        try {
          await refreshLeagues();
          const { data: leagueRow } = await supabase
            .from('leagues')
            .select('id, name, settings')
            .eq('join_code', effectiveCode)
            .maybeSingle();

          setLoading(false);
          toast({
            title: "Joined League!",
            description: leagueRow?.name
              ? `Welcome to ${leagueRow.name}!`
              : "You're in — taking you to the pool now.",
          });

          if (leagueRow?.id) {
            setActiveLeagueId(leagueRow.id);
            routeToLeague(
              leagueRow.id,
              leagueRow.settings as Record<string, unknown> | null,
            );
          } else {
            // T11a link fix (2026-08-09): `/leagues` route does not
            // exist. If leagueRow.id is missing (join succeeded but no
            // row returned — unlikely), fall back to home which shows
            // the user's league landing after auth.
            navigate('/');
          }
          return;
        } catch {
          // Fall through to generic error toast below
        }
      }

      setError(errorMessage);
      setLoading(false);

      toast({
        title: "Can't Join Right Now",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream relative">
      {/* Decorative Background — pastel-orange + sage halos in citrus2 voice */}
      <div aria-hidden="true" className="absolute top-0 right-0 w-96 h-96 bg-pastel-orange/10 rounded-full blur-3xl -z-10 pointer-events-none"></div>
      <div aria-hidden="true" className="absolute bottom-0 left-0 w-96 h-96 bg-pastel-sage/10 rounded-full blur-3xl -z-10 pointer-events-none"></div>

      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">Create League</h1>
        </div>
      </div>

      <main className="lg:pt-32 lg:pb-20 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] px-4">
        <div className="container mx-auto max-w-4xl">

          <div className="mb-8 text-left">
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5 flex items-center gap-2">
              <CupIcon className="w-3.5 h-3.5" strokeWidth={2} />
              ✦ Opening Night
            </div>
            <h1 className="font-calistoga text-3xl sm:text-4xl md:text-5xl text-pastel-cream leading-none mb-2">
              Create or join a league.
            </h1>
            <p className="text-sm sm:text-base text-white/55">
              Spin up a fresh league for your group, or jump into a friend&rsquo;s with an invite code.
            </p>
          </div>

          {/* Testing Phase Banner — only for season-long fantasy */}
          {searchParams.get('type') === 'all' && (
          <Alert className="mb-6 bg-pastel-orange/15 ring-1 ring-pastel-orange/40 border-0 text-pastel-cream rounded-2xl shadow-[0_8px_24px_-12px_rgba(255,168,87,0.3)]">
            <Sparkles className="h-4 w-4 text-pastel-orange" />
            <AlertDescription className="text-pastel-cream">
              <span className="font-bold text-pastel-orange-soft">We&rsquo;re in testing phase.</span>{' '}
              Your league will be filled with AI teams so you can experience the full platform. Try the complete draft experience and draft against AI opponents.
              <span className="block mt-2 text-sm text-white/70">
                Sign up for the waitlist to be notified when full service launches with real multiplayer leagues.
              </span>
            </AlertDescription>
          </Alert>
          )}

          {/* Waitlist Signup */}
          <div className="mb-6">
            <WaitlistSignup source="create_league_page" variant="compact" />
          </div>

          <Card className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] overflow-hidden">
            <CardContent className="p-4 sm:p-8">
              <Tabs defaultValue={defaultTab} value={defaultTab} onValueChange={(v) => setDefaultTab(v as "create" | "join")} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-8 bg-[#0F1F15] ring-1 ring-white/10 p-1 rounded-xl">
                  <TabsTrigger
                    value="create"
                    className="flex items-center gap-2 text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
                  >
                    <CupIcon className="w-4 h-4" strokeWidth={2} />
                    Create League
                  </TabsTrigger>
                  <TabsTrigger
                    value="join"
                    className="flex items-center gap-2 text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
                  >
                    <UserPlus className="w-4 h-4" />
                    Join League
                  </TabsTrigger>
                </TabsList>

                {/* ============================================================ */}
                {/* CREATE LEAGUE TAB                                            */}
                {/* ============================================================ */}
                <TabsContent value="create" className="space-y-8 animate-fade-in">
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  {/* ======================================================== */}
                  {/* SECTION 1: LEAGUE TYPE SELECTION                          */}
                  {/* ======================================================== */}
                  <div>
                    <SectionHeader
                      title={searchParams.get('type') === 'all' ? "Choose Your League Type" : "Choose Your Playoff Pool Format"}
                      subtitle={searchParams.get('type') === 'all' ? "Select the format that fits your group" : "Pick how your playoff pool will work"}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {(Object.keys(LEAGUE_TYPE_LABELS) as LeagueType[])
                        .filter(type => {
                          const isPlayoffType = type === 'playoff-bracket-pickem' || type === 'playoff-confidence-pool' || type === 'playoff-roster-pool';
                          // ?type=all shows everything (backdoor for testing season-long)
                          if (searchParams.get('type') === 'all') return true;
                          // Default: only show playoff types (we're in playoff season)
                          return isPlayoffType;
                        })
                        .map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setLeagueType(type)}
                          className={`relative text-left rounded-2xl p-5 transition-all duration-200 ${
                            leagueType === type
                              ? 'bg-pastel-orange/15 ring-2 ring-pastel-orange/50 shadow-[0_8px_24px_-8px_rgba(255,168,87,0.4)]'
                              : 'bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/30 hover:bg-white/[0.08]'
                          }`}
                        >
                          {leagueType === type && (
                            <div className="absolute top-3 right-3">
                              <CheckCircle className="w-5 h-5 text-pastel-orange" />
                            </div>
                          )}
                          <div className={`mb-3 ${leagueType === type ? 'text-pastel-orange' : 'text-pastel-orange/60'}`}>
                            {LEAGUE_TYPE_ICONS[type]}
                          </div>
                          <h4 className="font-calistoga text-lg text-pastel-cream mb-1.5 leading-tight">{LEAGUE_TYPE_LABELS[type]}</h4>
                          <p className="text-xs text-white/55 leading-relaxed">
                            {LEAGUE_TYPE_DESCRIPTIONS[type]}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ======================================================== */}
                  {/* SECTION 2: LEAGUE NAME + BASIC INFO                      */}
                  {/* ======================================================== */}
                  <div className="border-t border-white/10 pt-6 space-y-6">
                    <div className="space-y-3">
                      <Label htmlFor="league-name" className="text-base">League Name</Label>
                      <Input
                        id="league-name"
                        placeholder={isFantasy ? "e.g. The Frozen Pond" : "e.g. Office Hockey Pool"}
                        className="h-12 text-lg"
                        value={leagueName}
                        onChange={(e) => setLeagueName(e.target.value)}
                      />
                    </div>

                    {/* Teams Count - always visible */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <Label htmlFor="teams-count" className="text-base">
                          {isPool ? 'Max Participants' : 'Number of Teams'}
                        </Label>
                        <Input
                          id="teams-count"
                          type="number"
                          min={isPool ? 2 : 2}
                          max={isPool ? 100 : 50}
                          value={teamsCount}
                          onChange={(e) => setTeamsCount(e.target.value)}
                          className="h-12"
                          placeholder={isPool ? '2–100' : '2–50'}
                        />
                        <p className="text-xs text-white/55">
                          {isPool ? 'Any number from 2 to 100' : 'Any number from 2 to 50'}
                        </p>
                      </div>

                      {/* Pick/Roster Lock Deadline - Playoff Pools */}
                      {(leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool' || leagueType === 'playoff-roster-pool') && (
                        <div className="space-y-3">
                          <Label htmlFor="playoff-lock" className="text-base flex items-center gap-2">
                            <Lock className="h-4 w-4 text-pastel-orange" />
                            {leagueType === 'playoff-roster-pool' ? 'Roster Lock Deadline' : 'Pick Lock Deadline'}
                          </Label>
                          <Input
                            id="playoff-lock"
                            type="datetime-local"
                            value={playoffLockDeadline}
                            onChange={(e) => setPlayoffLockDeadline(e.target.value)}
                            className="h-12"
                          />
                          <p className="text-xs text-white/55">
                            {leagueType === 'playoff-roster-pool'
                              ? 'After this time, rosters lock and players cannot be swapped. Default is Round 1 Game 1 puck drop.'
                              : 'After this time, picks lock. Typically set to just before the first playoff game.'}
                          </p>
                        </div>
                      )}

                      {/* Bracket Pick Mode — bracket-pickem only */}
                      {leagueType === 'playoff-bracket-pickem' && (
                        <div className="space-y-3">
                          <Label className="text-base flex items-center gap-2">
                            <Trophy className="h-4 w-4 text-pastel-orange" />
                            Bracket Pick Mode
                          </Label>
                          <RadioGroup
                            value={bracketPickMode}
                            onValueChange={(v) => setBracketPickMode(v as 'round-by-round' | 'full-bracket')}
                            className="grid grid-cols-1 gap-3"
                          >
                            <label
                              htmlFor="mode-rbr"
                              className={cn(
                                'flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-colors',
                                bracketPickMode === 'round-by-round'
                                  ? 'bg-pastel-orange/15 ring-2 ring-pastel-orange/40 shadow-[0_4px_12px_-4px_rgba(255,168,87,0.3)]'
                                  : 'bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/30 hover:bg-white/[0.08]'
                              )}
                            >
                              <RadioGroupItem value="round-by-round" id="mode-rbr" className="mt-1" />
                              <div className="flex-1">
                                <div className="font-jbmono font-bold text-sm mb-1">Round by Round</div>
                                <p className="text-xs text-white/55">
                                  Members pick each round&apos;s winners as it starts. You can only pick Round 2 after Round 1 finishes. Forgiving format — no need to predict upsets upfront.
                                </p>
                              </div>
                            </label>
                            <label
                              htmlFor="mode-full"
                              className={cn(
                                'flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-colors',
                                bracketPickMode === 'full-bracket'
                                  ? 'bg-pastel-orange/15 ring-2 ring-pastel-orange/40 shadow-[0_4px_12px_-4px_rgba(255,168,87,0.3)]'
                                  : 'bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/30 hover:bg-white/[0.08]'
                              )}
                            >
                              <RadioGroupItem value="full-bracket" id="mode-full" className="mt-1" />
                              <div className="flex-1">
                                <div className="font-jbmono font-bold text-sm mb-1">Full Bracket (March Madness style)</div>
                                <p className="text-xs text-white/55">
                                  Members pick ALL 15 series — including Stanley Cup champion — before Round 1 Game 1 puck drop. One shot, live with it. Classic playoff pool format.
                                </p>
                              </div>
                            </label>
                          </RadioGroup>
                        </div>
                      )}

                      {/* Scoring Format - Fantasy only */}
                      {isFantasy && (
                        <div className="space-y-3">
                          <Label htmlFor="scoring-format" className="text-base">Scoring Format</Label>
                          <Select value={scoringFormat} onValueChange={(v) => setScoringFormat(v as ScoringFormat)}>
                            <SelectTrigger id="scoring-format" className="h-12">
                              <SelectValue placeholder="Select format" />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(SCORING_FORMAT_LABELS) as ScoringFormat[]).map((format) => (
                                <SelectItem key={format} value={format}>
                                  <div className="flex items-center gap-2">
                                    {SCORING_FORMAT_LABELS[format]}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            {SCORING_FORMAT_DESCRIPTIONS[scoringFormat]}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ======================================================== */}
                  {/* SECTION 3: POOL-SPECIFIC SETTINGS                        */}
                  {/* ======================================================== */}
                  {leagueType === 'pickem' && (
                    <div className="border-t border-white/10 pt-6">
                      <SectionHeader
                        title="Pick'em Settings"
                        subtitle="Configure how picks work each week"
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <Label>Pick Format</Label>
                          <Select value={pickemFormat} onValueChange={(v) => setPickemFormat(v as PickemFormat)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="straight-up">Straight Up (pick the winner)</SelectItem>
                              <SelectItem value="against-the-spread">Against the Spread (ATS)</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            {pickemFormat === 'straight-up'
                              ? 'Simply pick which team wins each game. 1 point per correct pick.'
                              : 'Pick winners against the point spread for more challenging predictions.'
                            }
                          </p>
                        </div>
                        <div className="space-y-3">
                          <Label>Games Per Week</Label>
                          <Select value={picksPerWeek} onValueChange={setPicksPerWeek}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">All games</SelectItem>
                              <SelectItem value="5">5 games</SelectItem>
                              <SelectItem value="10">10 games</SelectItem>
                              <SelectItem value="15">15 games</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            {picksPerWeek === '0' ? 'Pick every game on the schedule each week.' : `Select ${picksPerWeek} games to pick each week.`}
                          </p>
                        </div>
                        <div className="space-y-3">
                          <Label>Pick Deadline</Label>
                          <Select value={pickDeadline} onValueChange={(v) => setPickDeadline(v as 'per-game' | 'first-game')}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="per-game">Lock at each game's start time</SelectItem>
                              <SelectItem value="first-game">Lock all picks at first game of the week</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            {pickDeadline === 'per-game'
                              ? 'Each pick locks when that game starts. Make late picks up until puck drop.'
                              : 'All picks lock when the first game of the week starts. Plan ahead.'
                            }
                          </p>
                        </div>
                        <div className="space-y-3">
                          <Label>Tiebreaker</Label>
                          <Select value={tiebreaker} onValueChange={(v) => setTiebreaker(v as 'none' | 'total-points' | 'most-upsets')}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No tiebreaker</SelectItem>
                              <SelectItem value="total-points">Total combined score prediction</SelectItem>
                              <SelectItem value="most-upsets">Most upsets picked correctly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}

                  {leagueType === 'survivor' && (
                    <div className="border-t border-white/10 pt-6">
                      <SectionHeader
                        title="Survivor Pool Settings"
                        subtitle="Configure elimination rules"
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <Label>Lives (Strikes Before Elimination)</Label>
                          <Select value={survivorLives} onValueChange={setSurvivorLives}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1 life (classic - one wrong and out)</SelectItem>
                              <SelectItem value="2">2 lives (one mulligan)</SelectItem>
                              <SelectItem value="3">3 lives (two mulligans)</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            In classic survivor, one wrong pick eliminates you. Extra lives give second chances.
                          </p>
                        </div>
                        <div className="space-y-3">
                          <Label>Pick Deadline</Label>
                          <Select value={pickDeadline} onValueChange={(v) => setPickDeadline(v as 'per-game' | 'first-game')}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="per-game">Lock at your picked game's start time</SelectItem>
                              <SelectItem value="first-game">Lock all picks at first game of the week</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-3">
                          <Label>Team Repeat Rule</Label>
                          <Select value={allowRepeatTeams ? 'allow' : 'no-repeat'} onValueChange={(v) => setAllowRepeatTeams(v === 'allow')}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="no-repeat">No repeats all season (classic)</SelectItem>
                              <SelectItem value="allow">Allow repeats after mid-season</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            Classic: once you pick a team, you can never pick them again. Allow repeats: teams reset at mid-season.
                          </p>
                        </div>
                        <div className="space-y-3 flex items-start pt-2">
                          <div className="bg-white/5 ring-1 ring-white/10 rounded-xl p-4">
                            <div className="flex items-start gap-2">
                              <Info className="w-4 h-4 text-pastel-orange mt-0.5 flex-shrink-0" />
                              <p className="text-sm text-white/55">
                                Each week, pick one NHL team to win. Last person standing wins!
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {leagueType === 'confidence-pool' && (
                    <div className="border-t border-white/10 pt-6">
                      <SectionHeader
                        title="Confidence Pool Settings"
                        subtitle="Configure confidence point rules"
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <Label>Games Per Week</Label>
                          <Select value={picksPerWeek} onValueChange={setPicksPerWeek}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">All games</SelectItem>
                              <SelectItem value="5">5 games</SelectItem>
                              <SelectItem value="10">10 games</SelectItem>
                              <SelectItem value="15">15 games</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-3">
                          <Label>Max Confidence Points</Label>
                          <div className="flex items-center gap-2 px-3 py-2 bg-white/5 ring-1 ring-white/10 rounded-md">
                            <span className="text-sm font-semibold">{confidenceMaxPoints} points max</span>
                            <span className="text-xs text-white/55">(auto-linked to picks per week)</span>
                          </div>
                          <p className="text-xs text-white/55">
                            Assign confidence points 1 through {confidenceMaxPoints} to each pick. Higher confidence = more points if correct.
                            Each value can only be used once per week. This is always equal to your picks per week.
                          </p>
                        </div>
                        <div className="space-y-3">
                          <Label>Pick Deadline</Label>
                          <Select value={pickDeadline} onValueChange={(v) => setPickDeadline(v as 'per-game' | 'first-game')}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="per-game">Lock at each game's start time</SelectItem>
                              <SelectItem value="first-game">Lock all picks at first game of the week</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-3">
                          <Label>Tiebreaker</Label>
                          <Select value={tiebreaker} onValueChange={(v) => setTiebreaker(v as 'none' | 'total-points' | 'most-upsets')}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No tiebreaker</SelectItem>
                              <SelectItem value="total-points">Total combined score prediction</SelectItem>
                              <SelectItem value="most-upsets">Most upsets picked correctly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* SECTION 4: DRAFT SETTINGS (Fantasy Only)                 */}
                  {/* ======================================================== */}
                  {showDraftSettings && (
                    <div className="border-t border-white/10 pt-6">
                      <SectionHeader
                        title="Draft Settings"
                        subtitle="Choose how teams build their rosters"
                      />

                      {/* Draft Type - Radio Cards */}
                      <div className="space-y-4 mb-6">
                        <Label className="text-base font-semibold">Draft Type</Label>
                        <RadioGroup
                          value={draftType}
                          onValueChange={(v) => setDraftType(v as DraftType)}
                          className="grid grid-cols-1 gap-3"
                        >
                          {(Object.keys(DRAFT_TYPE_LABELS) as DraftType[]).map((type) => (
                            <div key={type}>
                              <RadioGroupItem value={type} id={`draft-${type}`} className="peer sr-only" />
                              <Label
                                htmlFor={`draft-${type}`}
                                className={`flex items-start gap-4 rounded-xl border-2 p-4 cursor-pointer transition-all
                                  ${draftType === type
                                    ? 'bg-pastel-orange/15 ring-2 ring-pastel-orange/40 shadow-[0_4px_12px_-4px_rgba(255,168,87,0.3)]'
                                    : 'bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/30 hover:bg-white/[0.08]'
                                  }`}
                              >
                                <div className={`mt-0.5 ${draftType === type ? 'text-pastel-orange' : 'text-white/55'}`}>
                                  {DRAFT_TYPE_ICONS[type]}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold">{DRAFT_TYPE_LABELS[type]}</span>
                                    {type === 'snake' && (
                                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Most Popular</Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-white/55 mt-1 leading-relaxed">
                                    {DRAFT_TYPE_DESCRIPTIONS[type]}
                                  </p>
                                </div>
                                {draftType === type && (
                                  <CheckCircle className="w-5 h-5 text-pastel-orange flex-shrink-0 mt-0.5" />
                                )}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>

                      {/* Draft Config Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {draftType !== 'offline' && (
                          <div className="space-y-3">
                            <Label>Draft Rounds</Label>
                            <Select value={draftRounds} onValueChange={setDraftRounds}>
                              <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="14">14 Rounds</SelectItem>
                                <SelectItem value="16">16 Rounds</SelectItem>
                                <SelectItem value="18">18 Rounds</SelectItem>
                                <SelectItem value="21">21 Rounds</SelectItem>
                                <SelectItem value="24">24 Rounds</SelectItem>
                                <SelectItem value="30">30 Rounds</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {(draftType === 'snake' || draftType === 'linear') && (
                          <div className="space-y-3">
                            <Label>Pick Time Limit</Label>
                            <Select value={pickTimeLimit} onValueChange={setPickTimeLimit}>
                              <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="30">30 seconds</SelectItem>
                                <SelectItem value="60">60 seconds</SelectItem>
                                <SelectItem value="90">90 seconds</SelectItem>
                                <SelectItem value="120">120 seconds</SelectItem>
                                <SelectItem value="180">3 minutes</SelectItem>
                                <SelectItem value="300">5 minutes</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {draftType === 'offline' && (
                          <div className="md:col-span-3">
                            <div className="bg-white/5 ring-1 ring-white/10 rounded-xl p-4">
                              <div className="flex items-start gap-2">
                                <Info className="w-4 h-4 text-pastel-orange mt-0.5 flex-shrink-0" />
                                <p className="text-sm text-white/55">
                                  With offline draft, the commissioner will manually enter draft results after your
                                  external draft event. Set up your own draft board, do it live, or use any method you prefer.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Auction-Specific Settings */}
                      {isAuction && (
                        <div className="mt-6 p-4 rounded-xl border-2 border-dashed border-pastel-orange/40 bg-pastel-orange/[0.08]">
                          <h4 className="font-semibold text-sm mb-4 flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-pastel-orange" />
                            Auction Settings
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <Label className="text-sm">Salary Budget ($)</Label>
                              <Input
                                type="number"
                                value={auctionBudget}
                                onChange={(e) => setAuctionBudget(e.target.value)}
                                className="h-10 font-mono"
                                min={50}
                                max={1000}
                              />
                              <p className="text-xs text-white/55">Budget per team</p>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm">Minimum Bid ($)</Label>
                              <Input
                                type="number"
                                value={auctionMinBid}
                                onChange={(e) => setAuctionMinBid(e.target.value)}
                                className="h-10 font-mono"
                                min={0}
                                max={10}
                              />
                              <p className="text-xs text-white/55">Minimum bid on any player</p>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm">Nomination Timer</Label>
                              <Select value={auctionNominationTime} onValueChange={setAuctionNominationTime}>
                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="15">15 seconds</SelectItem>
                                  <SelectItem value="30">30 seconds</SelectItem>
                                  <SelectItem value="45">45 seconds</SelectItem>
                                  <SelectItem value="60">60 seconds</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-white/55">Time to nominate a player</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* SECTION 5: SCORING SETTINGS (Points-Based Formats)       */}
                  {/* ======================================================== */}
                  {showPointValues && (
                    <div className="border-t border-white/10 pt-6">
                      <SectionHeader
                        title="Scoring Settings"
                        subtitle="Toggle stats and adjust point values"
                        badge={
                          <Badge variant="secondary" className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft border-0">
                            {leagueStats.filter(s => s.enabled).length} Active Stats
                          </Badge>
                        }
                      />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {Object.entries(statsByCategory).map(([category, stats]) => (
                          <div key={category} className="space-y-3">
                            <h4 className="font-semibold text-sm uppercase tracking-wider text-white/55">
                              {category} Stats
                            </h4>
                            <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                              {stats.map((stat) => (
                                <div
                                  key={stat.id}
                                  className={`grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2.5 border-b last:border-0 transition-colors ${
                                    stat.enabled ? 'bg-primary/5' : 'opacity-60'
                                  }`}
                                >
                                  <Switch
                                    checked={stat.enabled}
                                    onCheckedChange={() => handleStatToggle(stat.id)}
                                  />
                                  <span className={`text-sm truncate ${stat.enabled ? 'text-pastel-cream font-medium' : 'text-white/55'}`}>
                                    {stat.name}
                                  </span>
                                  <Select
                                    value={String(stat.points)}
                                    onValueChange={(v) => handleStatPointsChange(stat.id, v)}
                                    disabled={!stat.enabled}
                                  >
                                    <SelectTrigger className="h-8 w-[72px] font-mono text-xs px-2">
                                      <SelectValue />
                                    </SelectTrigger>
                                      <SelectContent>
                                        {(() => {
                                          // Per-stat option sets — every stat now includes 0 so
                                          // commissioners can zero out any stat for simpler leagues.
                                          const OPTIONS_BY_STAT: Record<string, number[]> = {
                                            g: [0, 1, 2, 3, 4, 5, 6],                    // Goals (default 3)
                                            a: [0, 1, 1.5, 2, 2.5, 3, 4],                // Assists (default 2)
                                            ppp: [0, 0.5, 1, 1.5, 2, 3],                 // Power Play Points (default 1)
                                            shg: [0, 1, 1.5, 2, 2.5, 3, 4],              // Shorthanded Points (default 2)
                                            sog: [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5], // Shots on Goal (default 0.4)
                                            blk: [0, 0.25, 0.5, 0.75, 1, 1.5],           // Blocks (default 0.5)
                                            hit: [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5],    // Hits (default 0.2)
                                            pim: [-1, -0.5, -0.25, 0, 0.25, 0.5, 1],     // Penalty Minutes (default 0.5)
                                            pm: [-1, -0.5, -0.25, 0, 0.25, 0.5, 1, 1.5], // Plus/Minus (default 0.5)
                                            w: [0, 2, 3, 4, 5, 6, 8],                    // Wins (default 4)
                                            so: [0, 2, 3, 4, 5, 6, 8],                   // Shutouts (default 3)
                                            sv: [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5],     // Saves (default 0.2)
                                            ga: [-2, -1.5, -1, -0.5, -0.25, 0],          // Goals Against (default -1)
                                          };
                                          const opts = OPTIONS_BY_STAT[stat.id] || [0, 0.25, 0.5, 1, 2, 3];
                                          const current = Number(stat.points);
                                          // Include current value even if it's outside the suggested range
                                          const all = opts.includes(current) ? opts : [...opts, current].sort((a, b) => a - b);
                                          return all.map(v => (
                                            <SelectItem key={v} value={String(v)} className="font-mono">
                                              {v === 0 ? '0' : v > 0 ? `+${v}` : String(v)}
                                            </SelectItem>
                                          ));
                                        })()}
                                      </SelectContent>
                                    </Select>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* SECTION 5b: CATEGORY SETTINGS (H2H-Cat / Roto)           */}
                  {/* ======================================================== */}
                  {showCategories && (
                    <div className="border-t border-white/10 pt-6">
                      <SectionHeader
                        title={scoringFormat === 'roto' ? 'Rotisserie Categories' : 'Head-to-Head Categories'}
                        subtitle={
                          scoringFormat === 'roto'
                            ? 'Select which stat categories to rank teams in. Teams earn roto points based on their ranking in each category.'
                            : 'Select which stat categories count as individual matchups each week. Each category is a separate win/loss/tie.'
                        }
                        badge={
                          <Badge variant="secondary" className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft border-0">
                            {selectedCategories.length} Categories
                          </Badge>
                        }
                      />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Skater Categories */}
                        <div className="space-y-3">
                          <h4 className="font-semibold text-sm uppercase tracking-wider text-white/55">
                            Skater Categories
                          </h4>
                          <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                            {AVAILABLE_CATEGORIES.filter(c => !c.isGoalie).map((cat) => (
                              <div
                                key={cat.id}
                                className={`flex items-center justify-between p-3 border-b last:border-0 transition-colors ${
                                  selectedCategories.includes(cat.id) ? 'bg-primary/5' : 'opacity-60'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <Switch
                                    checked={selectedCategories.includes(cat.id)}
                                    onCheckedChange={() => handleCategoryToggle(cat.id)}
                                  />
                                  <span className={`font-medium ${
                                    selectedCategories.includes(cat.id) ? 'text-pastel-cream' : 'text-white/55'
                                  }`}>
                                    {cat.name}
                                  </span>
                                </div>
                                <Badge variant="outline" className="font-mono text-xs">
                                  {cat.abbreviation}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Goalie Categories */}
                        <div className="space-y-3">
                          <h4 className="font-semibold text-sm uppercase tracking-wider text-white/55">
                            Goalie Categories
                          </h4>
                          <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                            {AVAILABLE_CATEGORIES.filter(c => c.isGoalie).map((cat) => (
                              <div
                                key={cat.id}
                                className={`flex items-center justify-between p-3 border-b last:border-0 transition-colors ${
                                  selectedCategories.includes(cat.id) ? 'bg-primary/5' : 'opacity-60'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <Switch
                                    checked={selectedCategories.includes(cat.id)}
                                    onCheckedChange={() => handleCategoryToggle(cat.id)}
                                  />
                                  <span className={`font-medium ${
                                    selectedCategories.includes(cat.id) ? 'text-pastel-cream' : 'text-white/55'
                                  }`}>
                                    {cat.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="font-mono text-xs">
                                    {cat.abbreviation}
                                  </Badge>
                                  {!cat.higherIsBetter && (
                                    <Badge variant="secondary" className="text-[10px]">Lower is better</Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>

                          {scoringFormat === 'roto' && (
                            <div className="space-y-3 pt-2">
                              <Label>Minimum Goalie Games</Label>
                              <Select value={minGoalieGames} onValueChange={setMinGoalieGames}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">No minimum</SelectItem>
                                  <SelectItem value="2">2 games</SelectItem>
                                  <SelectItem value="3">3 games</SelectItem>
                                  <SelectItem value="5">5 games</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-white/55">
                                Minimum goalie starts required for rate stats (GAA, SV%) to count.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* SECTION 6: SEASON & PLAYOFF SETTINGS (Fantasy Only)      */}
                  {/* ======================================================== */}
                  {isFantasy && (
                    <div className="border-t border-white/10 pt-6">
                      <SectionHeader
                        title="Season Settings"
                        subtitle="Playoffs, trade deadline, and keeper rules"
                      />

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Playoff Teams */}
                        {showMatchupSettings && (
                          <div className="space-y-3">
                            <Label>Playoff Teams</Label>
                            <Select value={playoffTeams} onValueChange={setPlayoffTeams}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">No Playoffs</SelectItem>
                                <SelectItem value="4">4 Teams</SelectItem>
                                <SelectItem value="6">6 Teams</SelectItem>
                                <SelectItem value="8">8 Teams</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Playoff Weeks */}
                        {showMatchupSettings && parseInt(playoffTeams) > 0 && (
                          <div className="space-y-3">
                            <Label>Playoff Weeks</Label>
                            <Select value={playoffWeeks} onValueChange={setPlayoffWeeks}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="2">2 Weeks</SelectItem>
                                <SelectItem value="3">3 Weeks</SelectItem>
                                <SelectItem value="4">4 Weeks</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Trade Deadline */}
                        <div className="space-y-3">
                          <Label>Trade Deadline</Label>
                          <Select value={tradeDeadlineWeek} onValueChange={setTradeDeadlineWeek}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">No Deadline</SelectItem>
                              <SelectItem value="8">Week 8</SelectItem>
                              <SelectItem value="10">Week 10</SelectItem>
                              <SelectItem value="12">Week 12</SelectItem>
                              <SelectItem value="14">Week 14</SelectItem>
                              <SelectItem value="16">Week 16</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            No trades allowed after this week.
                          </p>
                        </div>
                      </div>

                      {/* Advanced: Keeper / Dynasty */}
                      <div className="mt-6">
                        <button
                          type="button"
                          onClick={() => setShowAdvancedSeason(!showAdvancedSeason)}
                          className="flex items-center gap-2 text-sm font-semibold text-pastel-orange hover:text-pastel-orange/80 transition-colors"
                        >
                          {showAdvancedSeason ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          Advanced: Keeper & Dynasty Settings
                        </button>

                        {showAdvancedSeason && (
                          <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-white/15 bg-white/5 space-y-6">
                            {/* Keeper Toggle */}
                            <div className="flex items-center justify-between">
                              <div>
                                <Label className="text-base font-semibold">Keeper League</Label>
                                <p className="text-xs text-white/55 mt-1">
                                  Teams keep a set number of players between seasons.
                                </p>
                              </div>
                              <Switch checked={keeperEnabled} onCheckedChange={(v) => {
                                setKeeperEnabled(v);
                                if (!v) setDynastyMode(false);
                              }} />
                            </div>

                            {keeperEnabled && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-4 border-l-2 border-pastel-orange/30">
                                <div className="space-y-2">
                                  <Label>Keepers Per Team</Label>
                                  <Select value={keeperCount} onValueChange={setKeeperCount} disabled={dynastyMode}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="0">Unlimited (Dynasty)</SelectItem>
                                      <SelectItem value="1">1 Keeper</SelectItem>
                                      <SelectItem value="2">2 Keepers</SelectItem>
                                      <SelectItem value="3">3 Keepers</SelectItem>
                                      <SelectItem value="5">5 Keepers</SelectItem>
                                      <SelectItem value="8">8 Keepers</SelectItem>
                                      <SelectItem value="10">10 Keepers</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {dynastyMode && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                      Dynasty mode: entire roster is kept between seasons.
                                    </p>
                                  )}
                                </div>
                                <div className="space-y-2">
                                  <Label>Keeper Draft Penalty</Label>
                                  <Select value={keeperPenalty} onValueChange={(v) => setKeeperPenalty(v as typeof keeperPenalty)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">No Penalty (free keepers)</SelectItem>
                                      <SelectItem value="round-cost">Round Cost (kept at drafted round)</SelectItem>
                                      <SelectItem value="round-escalation">Escalation (cost goes up 1 round each year)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <p className="text-xs text-white/55">
                                    {keeperPenalty === 'none' && 'Keepers have no draft pick cost.'}
                                    {keeperPenalty === 'round-cost' && 'Keeping a player costs the round they were originally drafted in.'}
                                    {keeperPenalty === 'round-escalation' && 'Keeper cost increases by one round each season.'}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Dynasty Toggle */}
                            <div className="flex items-center justify-between pt-2 border-t">
                              <div>
                                <Label className="text-base font-semibold flex items-center gap-2">
                                  <Crown className="w-4 h-4 text-amber-500" />
                                  Dynasty Mode
                                </Label>
                                <p className="text-xs text-white/55 mt-1">
                                  Keep your entire roster between seasons. Only rookies are drafted each year.
                                  The ultimate long-term commitment.
                                </p>
                              </div>
                              <Switch checked={dynastyMode} onCheckedChange={(v) => {
                                setDynastyMode(v);
                                if (v) {
                                  setKeeperEnabled(true);
                                  setKeeperCount('0'); // Dynasty = unlimited keepers (keep entire roster)
                                }
                              }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* SECTION 7: WAIVER & TRADE SETTINGS (Fantasy Only)        */}
                  {/* ======================================================== */}
                  {showWaiverSettings && (
                    <div className="border-t border-white/10 pt-6">
                      <SectionHeader
                        title="Waiver & Trade Settings"
                        subtitle="Configure free agency and trade rules"
                      />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label>Waiver Process Time (MT)</Label>
                          <Select
                            value={waiverSettings.waiver_process_time}
                            onValueChange={(value) => setWaiverSettings(prev => ({ ...prev, waiver_process_time: value }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="00:00:00">12:00 AM (Midnight)</SelectItem>
                              <SelectItem value="02:00:00">2:00 AM (Default)</SelectItem>
                              <SelectItem value="03:00:00">3:00 AM</SelectItem>
                              <SelectItem value="06:00:00">6:00 AM</SelectItem>
                              <SelectItem value="09:00:00">9:00 AM</SelectItem>
                              <SelectItem value="12:00:00">12:00 PM (Noon)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Waiver Period (Hours)</Label>
                          <Select
                            value={waiverSettings.waiver_period_hours.toString()}
                            onValueChange={(value) => setWaiverSettings(prev => ({ ...prev, waiver_period_hours: parseInt(value) }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="24">24 hours (1 day)</SelectItem>
                              <SelectItem value="48">48 hours (2 days)</SelectItem>
                              <SelectItem value="72">72 hours (3 days)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Waiver Type</Label>
                          <Select
                            value={waiverSettings.waiver_type}
                            onValueChange={(value: 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings') => setWaiverSettings(prev => ({ ...prev, waiver_type: value }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rolling">Rolling Priority (Join Order)</SelectItem>
                              <SelectItem value="reverse_draft_order">Rolling Priority (Reverse Draft Order)</SelectItem>
                              <SelectItem value="reverse_standings">Reverse Standings</SelectItem>
                              <SelectItem value="faab">FAAB (Bidding)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* FAAB Budget - only shown when waiver type is FAAB */}
                        {waiverSettings.waiver_type === 'faab' && (
                          <div className="space-y-2">
                            <Label>FAAB Budget ($)</Label>
                            <Input
                              type="number"
                              value={waiverSettings.faab_budget}
                              onChange={(e) => setWaiverSettings(prev => ({ ...prev, faab_budget: parseInt(e.target.value) || 100 }))}
                              className="h-10 font-mono"
                              min={25}
                              max={500}
                            />
                            <p className="text-xs text-white/55">
                              Each team gets this budget to bid on free agents all season. Budget does not replenish.
                            </p>
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label>Game Lock</Label>
                          <div className="flex items-center space-x-2 pt-2">
                            <Switch
                              checked={waiverSettings.waiver_game_lock}
                              onCheckedChange={(checked) => setWaiverSettings(prev => ({ ...prev, waiver_game_lock: checked }))}
                            />
                            <span className="text-sm text-white/55">Lock players during/after games</span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>Allow Trades During Games</Label>
                          <div className="flex items-center space-x-2 pt-2">
                            <Switch
                              checked={waiverSettings.allow_trades_during_games}
                              onCheckedChange={(checked) => setWaiverSettings(prev => ({ ...prev, allow_trades_during_games: checked }))}
                            />
                            <span className="text-sm text-white/55">Players can be traded even if game-locked</span>
                          </div>
                        </div>

                        {/* Transaction Limits - ESPN/Yahoo/Sleeper industry standard */}
                        <div className="space-y-2">
                          <Label>Max Adds Per Week</Label>
                          <Select value={weeklyAddLimit} onValueChange={setWeeklyAddLimit}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Unlimited (Default)</SelectItem>
                              <SelectItem value="2">2 per week</SelectItem>
                              <SelectItem value="3">3 per week</SelectItem>
                              <SelectItem value="4">4 per week</SelectItem>
                              <SelectItem value="5">5 per week</SelectItem>
                              <SelectItem value="6">6 per week</SelectItem>
                              <SelectItem value="7">7 per week</SelectItem>
                              <SelectItem value="10">10 per week</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            Limit how many free agent pickups a team can make each week. Resets every Monday.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Max Adds Per Season</Label>
                          <Select value={seasonAddLimit} onValueChange={setSeasonAddLimit}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Unlimited (Default)</SelectItem>
                              <SelectItem value="25">25 per season</SelectItem>
                              <SelectItem value="50">50 per season</SelectItem>
                              <SelectItem value="75">75 per season</SelectItem>
                              <SelectItem value="100">100 per season</SelectItem>
                              <SelectItem value="150">150 per season</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            Limit total free agent pickups for the entire season.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* SECTION 8: POSITION TYPE + ROSTER SLOT CONFIG            */}
                  {/* ======================================================== */}
                  {isFantasy && (
                    <div className="border-t border-white/10 pt-6 space-y-6">
                      {/* Position Type Toggle */}
                      <div>
                        <SectionHeader
                          title="Position Format"
                          subtitle="Choose how roster positions are structured"
                        />
                        <div className="grid grid-cols-2 gap-3 max-w-md">
                          <button
                            type="button"
                            onClick={() => {
                              setPositionType('individual');
                              const defaults: Record<string, number> = {};
                              DEFAULT_ROSTER_SLOTS.forEach(s => { defaults[s.slot] = s.count; });
                              setRosterSlots(defaults);
                            }}
                            className={cn(
                              "p-3 rounded-lg border-2 text-left transition-all",
                              positionType === 'individual'
                                ? "bg-pastel-orange/15 ring-2 ring-pastel-orange/40 shadow-[0_4px_12px_-4px_rgba(255,168,87,0.3)]"
                                : "bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/40 hover:bg-white/[0.08]"
                            )}
                          >
                            <div className="font-semibold text-sm">C / LW / RW / D / G</div>
                            <div className="text-xs text-white/55 mt-1">Individual positions</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPositionType('forward');
                              const defaults: Record<string, number> = {};
                              DEFAULT_FDG_ROSTER_SLOTS.forEach(s => { defaults[s.slot] = s.count; });
                              setRosterSlots(defaults);
                            }}
                            className={cn(
                              "p-3 rounded-lg border-2 text-left transition-all",
                              positionType === 'forward'
                                ? "bg-pastel-orange/15 ring-2 ring-pastel-orange/40 shadow-[0_4px_12px_-4px_rgba(255,168,87,0.3)]"
                                : "bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/40 hover:bg-white/[0.08]"
                            )}
                          >
                            <div className="font-semibold text-sm">F / D / G</div>
                            <div className="text-xs text-white/55 mt-1">Forward / Defense / Goalie</div>
                          </button>
                        </div>
                      </div>

                      {/* Roster Slot Counts */}
                      <div>
                        <SectionHeader
                          title="Roster Slots"
                          subtitle="Customize how many of each position slot"
                          badge={
                            <Badge variant="secondary" className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft border-0">
                              {Object.values(rosterSlots).reduce((a, b) => a + b, 0)} Total
                            </Badge>
                          }
                        />
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {(positionType === 'forward' ? DEFAULT_FDG_ROSTER_SLOTS : DEFAULT_ROSTER_SLOTS).map((slot) => (
                            <div key={slot.slot} className="space-y-1">
                              <Label className="text-sm">{slot.label} ({slot.slot})</Label>
                              <Input
                                type="number"
                                min={0}
                                max={10}
                                value={rosterSlots[slot.slot] ?? slot.count}
                                onChange={(e) =>
                                  setRosterSlots(prev => ({
                                    ...prev,
                                    [slot.slot]: parseInt(e.target.value) || 0,
                                  }))
                                }
                                className="h-10 font-mono"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* CREATE BUTTON                                             */}
                  {/* ======================================================== */}
                  <div className="pt-4 flex justify-between items-center">
                    {/* Summary badges */}
                    <div className="hidden md:flex flex-wrap gap-2">
                      <Badge variant="outline">{LEAGUE_TYPE_LABELS[leagueType]}</Badge>
                      {isFantasy && <Badge variant="outline">{SCORING_FORMAT_LABELS[scoringFormat]}</Badge>}
                      {isFantasy && <Badge variant="outline">{DRAFT_TYPE_LABELS[draftType]}</Badge>}
                      {keeperEnabled && <Badge variant="secondary">Keeper</Badge>}
                      {dynastyMode && <Badge variant="secondary">Dynasty</Badge>}
                      {bestBallEnabled && <Badge variant="secondary">Best Ball</Badge>}
                    </div>

                    <Button
                      size="lg"
                      className="rounded-full px-8 min-w-[200px]"
                      onClick={handleCreateLeague}
                      disabled={loading || !leagueName}
                    >
                      {loading ? (
                        <div className="flex items-center">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                          Creating...
                        </div>
                      ) : (
                        <>Create League <CheckCircle className="ml-2 w-4 h-4" /></>
                      )}
                    </Button>
                  </div>
                </TabsContent>

                {/* ============================================================ */}
                {/* JOIN LEAGUE TAB                                              */}
                {/* ============================================================ */}
                <TabsContent value="join" className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="text-center pb-2">
                    <UserPlus className="w-10 h-10 mx-auto mb-3 text-pastel-orange" />
                    <h2 className="text-xl font-bold mb-1">Join a League</h2>
                    <p className="text-sm text-white/55">
                      Enter the join code provided by your league commissioner
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="join-code" className="text-sm font-semibold">Join Code</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="join-code"
                          placeholder="Paste join code here..."
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value)}
                          disabled={loading}
                          className="font-mono text-sm h-10"
                        />
                        {joinCode && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-10 w-10 flex-shrink-0"
                            onClick={() => {
                              navigator.clipboard.writeText(joinCode);
                              toast({
                                title: 'Copied!',
                                description: 'Join code copied to clipboard',
                              });
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-white/55">
                        Ask your commissioner for the league join code, or paste it from an invite link
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="team-name-join" className="text-sm">
                        Team Name <span className="text-white/55 font-normal">(optional)</span>
                      </Label>
                      <Input
                        id="team-name-join"
                        placeholder="e.g. Ice Warriors"
                        value={teamNameForJoin}
                        onChange={(e) => setTeamNameForJoin(e.target.value)}
                        disabled={loading}
                        className="h-10"
                      />
                      <p className="text-xs text-white/55">
                        Leave blank to use your default team name
                      </p>
                    </div>
                  </div>

                  <div className="bg-white/5 ring-1 ring-white/10 rounded-xl p-3 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-pastel-orange mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Before joining:</p>
                        <ul className="text-xs text-white/55 space-y-0.5 mt-0.5">
                          <li>- Make sure you trust the league commissioner</li>
                          <li>- Check if the draft has already happened</li>
                          <li>- You can only own one team per league</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 pb-4 flex justify-end items-center gap-3">
                    <Button
                      variant="outline"
                      onClick={() => navigate('/gm-office')}
                      disabled={loading}
                      className="min-w-[100px]"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="lg"
                      className="rounded-full px-6 min-w-[160px]"
                      onClick={() => handleJoinLeague()}
                      disabled={loading || !joinCode.trim()}
                    >
                      {loading ? (
                        <div className="flex items-center">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                          Joining...
                        </div>
                      ) : (
                        <>Join League <UserPlus className="ml-2 w-4 h-4" /></>
                      )}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

            </CardContent>
          </Card>

        </div>
      </main>
      <HockeyFooter />
    </div>
  );
};

export default CreateLeague;
