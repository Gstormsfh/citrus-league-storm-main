import { userMessage } from '@/lib/userMessage';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import MobileMenuButton from '@/components/MobileMenuButton';
import {
  HockeyFooter,
  CupIcon,
  CrossedSticksIcon,
  BracketIcon,
  MaskIcon,
  RangeIcon,
  MascotPortrait,
  StormyLoading,
} from '@/components/citrus2';
import { LeagueService } from '@/services/LeagueService';
import {
  PlayoffService,
  type PlayoffBracket as BracketType,
  type PlayoffSeed,
  type PlayoffSeries,
} from '@/services/PlayoffService';
import {
  Trophy, ChevronRight, Crown, Shield, RotateCcw,
  Play, Swords, Medal, AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { LeagueMembershipService } from '@/services/LeagueMembershipService';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { logger } from '@/utils/logger';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';

// ============================================================================
// BRACKET MATCHUP CARD - Individual series matchup in the bracket
// ============================================================================

interface MatchupCardProps {
  series: PlayoffSeries;
  teamNames: Record<string, string>;
  seedMap: Map<string, PlayoffSeed>;
  isChampionship?: boolean;
  compact?: boolean;
}

const MatchupCard: React.FC<MatchupCardProps> = ({
  series,
  teamNames,
  seedMap,
  isChampionship = false,
  compact = false,
}) => {
  const getTeamDisplay = (teamId: string | null, seed: number | null, isWinner: boolean, score: number) => {
    if (!teamId) {
      return (
        <div className={cn(
          'flex items-center justify-between px-3 py-2 rounded-md',
          'bg-white/5 ring-1 ring-white/10 text-white/55 italic'
        )}>
          <span className="text-xs">TBD</span>
          <span className="text-xs">-</span>
        </div>
      );
    }

    const teamSeed = seedMap.get(teamId);
    const seedNum = seed || teamSeed?.seed_number;
    const name = teamNames[teamId] || 'Unknown Team';
    const isCompleted = series.status === 'completed';

    return (
      <div className={cn(
        'flex items-center justify-between px-3 py-2 rounded-md transition-all',
        isCompleted && isWinner && 'bg-green-950/30 border border-green-800/60',
        isCompleted && !isWinner && 'bg-white/5 ring-1 ring-white/10 text-white/55 line-through opacity-60',
        !isCompleted && 'bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/30',
        isChampionship && isCompleted && isWinner && 'bg-amber-400/15 ring-1 ring-amber-400/40 shadow-[0_8px_24px_-12px_rgba(251,191,36,0.4)]',
      )}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {seedNum && (
            <span className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
              isCompleted && isWinner
                ? 'bg-green-500 text-white'
                : 'bg-white/5 ring-1 ring-white/10 text-white/55'
            )}>
              {seedNum}
            </span>
          )}
          <span className={cn(
            'text-sm font-medium truncate',
            isCompleted && isWinner && 'font-bold',
            compact && 'text-xs',
          )}>
            {name}
          </span>
          {isCompleted && isWinner && isChampionship && (
            <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          )}
        </div>
        <span className={cn(
          'font-bold tabular-nums ml-2 shrink-0',
          isCompleted && isWinner ? 'text-pastel-sage-soft' : 'text-pastel-cream',
          compact ? 'text-sm' : 'text-base',
        )}>
          {series.status === 'pending' ? '-' : score.toFixed(1)}
        </span>
      </div>
    );
  };

  const homeIsWinner = series.winner_team_id === series.home_team_id;
  const awayIsWinner = series.winner_team_id === series.away_team_id;

  return (
    <div className={cn(
      'rounded-lg overflow-hidden border shadow-sm',
      isChampionship && 'ring-2 ring-amber-400/50 shadow-[0_16px_40px_-12px_rgba(251,191,36,0.3)]',
      series.status === 'active' && 'ring-2 ring-pastel-orange/40 shadow-[0_8px_24px_-12px_rgba(255,168,87,0.4)]',
      series.status === 'completed' && !isChampionship && 'border-white/10',
      series.status === 'pending' && 'border-white/10 opacity-70',
    )}>
      {/* Status badge */}
      <div className={cn(
        'px-3 py-1 text-xs font-bold uppercase tracking-wider text-center',
        series.status === 'active' && 'bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft',
        series.status === 'completed' && 'bg-green-900/30 text-green-400',
        series.status === 'pending' && 'bg-white/5 ring-1 ring-white/10 text-white/55',
        series.status === 'bye' && 'bg-blue-900/20 text-blue-400',
      )}>
        {series.status === 'active' && 'Live'}
        {series.status === 'completed' && 'Final'}
        {series.status === 'pending' && 'Upcoming'}
        {series.status === 'bye' && 'Bye'}
        {series.matchup_week_1 && (
          <span className="ml-1 opacity-70">
            {series.matchup_week_2
              ? `Wk ${series.matchup_week_1}-${series.matchup_week_2}`
              : `Wk ${series.matchup_week_1}`}
          </span>
        )}
      </div>

      <div className="p-2 space-y-1 bg-[#1A2A20]">
        {getTeamDisplay(series.home_team_id, series.home_seed, homeIsWinner, series.home_score)}
        <div className="flex items-center gap-1 px-3">
          <div className="flex-1 border-t border-white/10"></div>
          <span className="text-[9px] text-white/55 font-medium uppercase">vs</span>
          <div className="flex-1 border-t border-white/10"></div>
        </div>
        {getTeamDisplay(series.away_team_id, series.away_seed, awayIsWinner, series.away_score)}
      </div>
    </div>
  );
};

// ============================================================================
// BRACKET ROUND COLUMN - A column in the bracket tree
// ============================================================================

interface RoundColumnProps {
  roundNumber: number;
  roundName: string;
  matchups: PlayoffSeries[];
  teamNames: Record<string, string>;
  seedMap: Map<string, PlayoffSeed>;
  totalRounds: number;
  isLast?: boolean;
}

const RoundColumn: React.FC<RoundColumnProps> = ({
  roundNumber,
  roundName,
  matchups,
  teamNames,
  seedMap,
  totalRounds,
  isLast = false,
}) => {
  const isChampionship = roundNumber === totalRounds;

  return (
    <div className="flex flex-col min-w-[140px] sm:min-w-[200px] lg:min-w-[240px]">
      {/* Round header */}
      <div className={cn(
        'text-center mb-4 pb-2 border-b-2',
        isChampionship ? 'ring-2 ring-amber-400/50' : 'ring-1 ring-pastel-orange/20',
      )}>
        <h3 className={cn(
          'text-sm font-bold uppercase tracking-wider',
          isChampionship ? 'text-amber-300' : 'text-pastel-orange',
        )}>
          {isChampionship && <Trophy className="w-4 h-4 inline-block mr-1 -mt-0.5" aria-hidden="true" />}
          {roundName}
        </h3>
      </div>

      {/* Matchups with spacing to align with bracket lines */}
      <div className={cn(
        'flex flex-col gap-4',
        // Increase gap for later rounds to vertically center between previous matchups
        roundNumber === 2 && 'gap-16 pt-8',
        roundNumber === 3 && 'gap-32 pt-20',
      )}>
        {matchups.map((series) => (
          <MatchupCard
            key={series.id}
            series={series}
            teamNames={teamNames}
            seedMap={seedMap}
            isChampionship={isChampionship}
          />
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// BRACKET CONNECTOR LINES (SVG)
// ============================================================================

const BracketConnectors: React.FC<{ bracketSize: number; roundCount: number }> = ({ bracketSize, roundCount }) => {
  // Connector lines between rounds (rendered as decorative elements between columns)
  // This creates the visual "bracket tree" effect
  return (
    <div className="flex items-center justify-center w-8 lg:w-12 shrink-0">
      <div className="w-px h-full bg-border/40 relative">
        {/* Horizontal tick marks at connection points */}
        <div className="absolute top-1/4 -left-2 w-4 border-t border-white/10"></div>
        <div className="absolute top-3/4 -left-2 w-4 border-t border-white/10"></div>
        <div className="absolute top-1/2 left-2 w-4 border-t border-white/10"></div>
      </div>
    </div>
  );
};

// ============================================================================
// CHAMPION BANNER
// ============================================================================

const ChampionBanner: React.FC<{
  bracket: BracketType;
  teamNames: Record<string, string>;
}> = ({ bracket, teamNames }) => {
  if (bracket.status !== 'completed' || !bracket.champion_team_id) return null;

  const champName = teamNames[bracket.champion_team_id] || 'Champion';
  const runnerUpName = bracket.runner_up_team_id ? teamNames[bracket.runner_up_team_id] : null;
  const thirdPlaceName = bracket.third_place_team_id ? teamNames[bracket.third_place_team_id] : null;

  return (
    <Card className="bg-[#1A2A20] border-0 ring-2 ring-amber-400/50 rounded-2xl shadow-[0_24px_60px_-16px_rgba(251,191,36,0.35)] overflow-hidden relative">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMSIgZmlsbD0iI2Y1OWUwYiIgb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] pointer-events-none"></div>
      <CardContent className="relative p-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Crown className="w-8 h-8 text-amber-500" />
          <Trophy className="w-10 h-10 text-amber-300" aria-hidden="true" />
          <Crown className="w-8 h-8 text-amber-500" />
        </div>
        <h2 className="font-calistoga text-2xl lg:text-3xl text-amber-300 mb-1">
          {bracket.season} Champion
        </h2>
        <p className="font-calistoga text-3xl lg:text-4xl text-pastel-cream mb-4">
          {champName}
        </p>

        <div className="flex items-center justify-center gap-6 text-sm text-white/55">
          {runnerUpName && (
            <div className="flex items-center gap-1.5">
              <Medal className="w-4 h-4 text-white/55" />
              <span>2nd: {runnerUpName}</span>
            </div>
          )}
          {thirdPlaceName && (
            <div className="flex items-center gap-1.5">
              <Medal className="w-4 h-4 text-amber-300" />
              <span>3rd: {thirdPlaceName}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// ============================================================================
// COMMISSIONER CONTROLS
// ============================================================================

interface CommissionerControlsProps {
  leagueId: string;
  bracket: BracketType | null;
  isCommissioner: boolean;
  onGenerate: (options: { consolation: boolean; twoWeek: boolean }) => Promise<void>;
  onAdvance: () => Promise<void>;
  onReset: () => Promise<void>;
  generating: boolean;
}

const CommissionerControls: React.FC<CommissionerControlsProps> = ({
  leagueId,
  bracket,
  isCommissioner,
  onGenerate,
  onAdvance,
  onReset,
  generating,
}) => {
  const [consolation, setConsolation] = useState(false);
  const [twoWeek, setTwoWeek] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!isCommissioner) return null;

  return (
    <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/20 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <MaskIcon className="w-4 h-4 text-pastel-orange" strokeWidth={2} />
          Commissioner Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!bracket && (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="consolation" className="text-xs">Consolation Bracket</Label>
                <Switch id="consolation" checked={consolation} onCheckedChange={setConsolation} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="twoWeek" className="text-xs">Two-Week Matchups</Label>
                <Switch id="twoWeek" checked={twoWeek} onCheckedChange={setTwoWeek} />
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => onGenerate({ consolation, twoWeek })}
              disabled={generating}
            >
              {generating ? (
                'Generating...'
              ) : (
                <>
                  <Swords className="w-4 h-4 mr-2" />
                  Generate Playoff Bracket
                </>
              )}
            </Button>
          </>
        )}

        {bracket && bracket.status === 'active' && (
          <>
            <Button
              className="w-full"
              onClick={onAdvance}
              disabled={generating}
            >
              <Play className="w-4 h-4 mr-2" />
              Advance Round {bracket.current_round}
            </Button>

            {!confirmReset ? (
              <Button
                variant="outline"
                className="w-full text-destructive border-destructive/20 hover:bg-destructive/5"
                onClick={() => setConfirmReset(true)}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset Bracket
              </Button>
            ) : (
              <div className="space-y-2">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <AlertDescription className="text-xs">
                    This will permanently delete the bracket and all playoff matchups.
                  </AlertDescription>
                </Alert>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    onClick={() => { onReset(); setConfirmReset(false); }}
                  >
                    Confirm Reset
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setConfirmReset(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {bracket && bracket.status === 'completed' && (
          <div className="text-center text-xs text-white/55 py-2">
            Bracket complete. Season is over.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ============================================================================
// SEED LIST CARD
// ============================================================================

const SeedList: React.FC<{
  seeds: PlayoffSeed[];
  teamNames: Record<string, string>;
  bracketSize: number;
}> = ({ seeds, teamNames, bracketSize }) => {
  if (seeds.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" aria-hidden="true" />
          Playoff Seeds ({bracketSize} Teams)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/40">
          {seeds.map((seed) => {
            const hasBye = bracketSize === 6 && seed.seed_number <= 2;
            return (
              <div key={seed.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                <span className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  seed.seed_number <= 2 ? 'bg-pastel-orange text-[#581E00]' : 'bg-white/5 ring-1 ring-white/10 text-white/55',
                )}>
                  {seed.seed_number}
                </span>
                <span className="font-medium truncate flex-1">
                  {teamNames[seed.team_id] || 'Unknown'}
                </span>
                <span className="text-xs text-white/55 tabular-nums">
                  {seed.regular_season_wins}-{seed.regular_season_losses}
                  {seed.regular_season_ties > 0 ? `-${seed.regular_season_ties}` : ''}
                </span>
                {hasBye && (
                  <span className="text-[9px] font-bold text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">
                    BYE
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

// ============================================================================
// MAIN PLAYOFF BRACKET PAGE
// ============================================================================

const PlayoffBracket = () => {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, activeLeagueFormat } = useLeague();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [bracket, setBracket] = useState<BracketType | null>(null);
  const [seeds, setSeeds] = useState<PlayoffSeed[]>([]);
  const [series, setSeries] = useState<PlayoffSeries[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveLeagueId = leagueId || activeLeagueId || '';

  const loadData = useCallback(async () => {
    if (!user || userLeagueState !== 'active-user' || !effectiveLeagueId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Load bracket data and team names in parallel
      const [bracketResult, teamsResult, commResult] = await Promise.all([
        PlayoffService.getBracket(effectiveLeagueId),
        LeagueService.getLeagueTeams(effectiveLeagueId),
        LeagueMembershipService.isCommissioner(effectiveLeagueId, user.id),
      ]);

      if (bracketResult.error) throw bracketResult.error;

      setBracket(bracketResult.bracket);
      setSeeds(bracketResult.seeds);
      setSeries(bracketResult.series);
      setIsCommissioner(commResult);

      const names: Record<string, string> = {};
      teamsResult.teams.forEach(team => {
        names[team.id] = team.team_name;
      });
      setTeamNames(names);
    } catch (err: unknown) {
      logger.error('[PlayoffBracket] Error loading:', err);
      setError(userMessage(err, 'Failed to load playoff bracket'));
    } finally {
      setLoading(false);
    }
  }, [user, userLeagueState, effectiveLeagueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGenerate = async (options: { consolation: boolean; twoWeek: boolean }) => {
    if (!effectiveLeagueId) return;
    setGenerating(true);
    try {
      const { result, error } = await PlayoffService.generateBracket(effectiveLeagueId, {
        consolationEnabled: options.consolation,
        twoWeekMatchups: options.twoWeek,
      });

      if (error) throw error;

      toast({
        title: 'Bracket Generated',
        description: `${result.bracket_size}-team playoff bracket created successfully.`,
      });

      await loadData();
    } catch (err: unknown) {
      toast({
        title: "Bracket Didn't Build",
        description: userMessage(err, "Couldn't generate the bracket — try again in a moment."),
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleAdvance = async () => {
    if (!bracket) return;
    setGenerating(true);
    try {
      const { result, error } = await PlayoffService.advanceRound(bracket.id);
      if (error) throw error;

      toast({
        title: 'Round Advanced',
        description: `${result.advanced_count} series advanced to the next round.`,
      });

      await loadData();
    } catch (err: unknown) {
      toast({
        title: "Round Didn't Advance",
        description: userMessage(err, "Couldn't advance the round — try again in a moment."),
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleReset = async () => {
    if (!effectiveLeagueId) return;
    setGenerating(true);
    try {
      const { error } = await PlayoffService.resetBracket(effectiveLeagueId);
      if (error) throw error;

      toast({ title: 'Bracket Reset', description: 'Playoff bracket has been deleted.' });
      setBracket(null);
      setSeeds([]);
      setSeries([]);
    } catch (err: unknown) {
      toast({
        title: "Bracket Reset Didn't Take",
        description: userMessage(err, "Couldn't reset the bracket — try again in a moment."),
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  // Build bracket tree from series data
  const seedMap = new Map<string, PlayoffSeed>();
  seeds.forEach(s => seedMap.set(s.team_id, s));

  const winnersByRound = new Map<number, PlayoffSeries[]>();
  const consolationByRound = new Map<number, PlayoffSeries[]>();
  let thirdPlaceSeries: PlayoffSeries | null = null;

  series.forEach(s => {
    if (s.bracket_position === 'winners') {
      if (!winnersByRound.has(s.round_number)) winnersByRound.set(s.round_number, []);
      winnersByRound.get(s.round_number)!.push(s);
    } else if (s.bracket_position === 'consolation') {
      if (!consolationByRound.has(s.round_number)) consolationByRound.set(s.round_number, []);
      consolationByRound.get(s.round_number)!.push(s);
    } else if (s.bracket_position === 'third_place') {
      thirdPlaceSeries = s;
    }
  });

  // Sort matchups within each round
  winnersByRound.forEach(roundSeries => roundSeries.sort((a, b) => a.match_number - b.match_number));
  consolationByRound.forEach(roundSeries => roundSeries.sort((a, b) => a.match_number - b.match_number));

  const displayLoading = useMinimumLoadingTime(loading, 800);

  // Redirect pool leagues to their pool page
  const _poolType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_poolType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_poolType!, activeLeagueId)} replace />;
  }

  if (displayLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F1F15]">
        <StormyLoading message="Loading the playoff bracket…" />
      </div>
    );
  }

  // Layout wrapper used throughout
  const PageLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="w-10" />
          <h1 className="text-lg font-bold text-pastel-cream">Playoffs</h1>
          <MobileMenuButton />
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          <div className={cn(
            "flex flex-col lg:grid lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2",
            userLeagueState === 'active-user' && (activeLeagueId || leagueId)
              ? "lg:grid-cols-[220px_1fr_260px] xl:grid-cols-[240px_1fr_280px]"
              : "lg:grid-cols-[220px_1fr]"
          )}>
            {/* Main content */}
            <div className="min-w-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overflow-x-auto px-2 lg:px-6 order-1 lg:order-2">
              {children}
            </div>

            {/* Left sidebar — AdSpace replaced with on-brand Stormy commentary */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4">
                <CommissionerControls
                  leagueId={effectiveLeagueId}
                  bracket={bracket}
                  isCommissioner={isCommissioner}
                  onGenerate={handleGenerate}
                  onAdvance={handleAdvance}
                  onReset={handleReset}
                  generating={generating}
                />
                {seeds.length > 0 && bracket && (
                  <SeedList seeds={seeds} teamNames={teamNames} bracketSize={bracket.bracket_size} />
                )}
                <div className="bg-[#1A2A20] ring-1 ring-amber-400/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(251,191,36,0.15)] overflow-hidden">
                  <MascotPortrait id="stormy" />
                  <div className="p-5">
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-amber-300 font-bold mb-1">
                      ✦ Stormy says
                    </div>
                    <div className="font-calistoga text-xl text-pastel-cream mb-2">Cup chase</div>
                    <p className="text-[11px] text-white/70 leading-relaxed">
                      Single-elimination. Higher seed picks home ice. Click any series to see the matchup detail. Champions are immortalized.
                    </p>
                  </div>
                </div>
              </div>
            </aside>

            {/* Right sidebar - notifications */}
            {userLeagueState === 'active-user' && (activeLeagueId || leagueId) && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId || leagueId || ''} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <HockeyFooter variant="app" />
    </div>
  );

  // Error state
  if (error) {
    return (
      <PageLayout>
        <div className="text-center py-20">
          <p className="text-white/55 text-lg mb-4">{error}</p>
          <Button onClick={() => effectiveLeagueId && navigate(`/standings`)}>
            Back to Standings
          </Button>
        </div>
      </PageLayout>
    );
  }

  // No bracket generated yet
  if (!bracket) {
    return (
      <PageLayout>
        <div className="text-center py-16">
          <div className="mb-6">
            <CupIcon className="w-16 h-16 mx-auto text-pastel-orange/30 mb-4" strokeWidth={2} />
            <h1 className="text-2xl font-bold mb-2">Playoff Bracket</h1>
            <p className="text-white/55 max-w-md mx-auto">
              {isCommissioner
                ? 'Generate the playoff bracket from the sidebar when the regular season ends. Teams will be seeded based on standings.'
                : 'The playoff bracket has not been generated yet. Ask your commissioner to set it up when the regular season ends.'}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate('/standings')}
          >
            View Standings
          </Button>
        </div>
      </PageLayout>
    );
  }

  // Active or completed bracket - render the full bracket tree
  const roundNumbers = Array.from(winnersByRound.keys()).sort((a, b) => a - b);

  return (
    <PageLayout>
      {/* Champion banner */}
      {bracket.status === 'completed' && (
        <div className="mb-6">
          <ChampionBanner bracket={bracket} teamNames={teamNames} />
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-primary to-[hsl(var(--vibrant-orange))] bg-clip-text text-transparent">
            Playoff Bracket
          </h1>
          {bracket.status === 'active' && (
            <span className="text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft px-2 py-0.5 rounded-full">
              LIVE
            </span>
          )}
        </div>
        <p className="text-sm text-white/55">
          {bracket.bracket_size}-team single elimination
          {bracket.two_week_matchups && ' (two-week matchups)'}
          {bracket.consolation_enabled && ' with consolation bracket'}
        </p>
      </div>

      {/* ====== WINNERS BRACKET ====== */}
      <Card className="mb-6 overflow-hidden border-none shadow-lg">
        <CardHeader className="bg-gradient-to-r from-pastel-orange/10 to-transparent pb-3 border-b border-white/10">
          <CardTitle className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold flex items-center gap-2">
            <Swords className="w-4 h-4" />
            {bracket.consolation_enabled ? 'Winners Bracket' : 'Bracket'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 lg:p-6">
          {/* Desktop: horizontal bracket flow */}
          <div className="hidden md:flex items-start gap-2 lg:gap-4 overflow-x-auto pb-4">
            {roundNumbers.map((roundNum, idx) => (
              <React.Fragment key={roundNum}>
                <RoundColumn
                  roundNumber={roundNum}
                  roundName={PlayoffService.getRoundName(bracket.bracket_size, roundNum)}
                  matchups={winnersByRound.get(roundNum) || []}
                  teamNames={teamNames}
                  seedMap={seedMap}
                  totalRounds={bracket.total_rounds}
                  isLast={idx === roundNumbers.length - 1}
                />
                {idx < roundNumbers.length - 1 && (
                  <div className="flex items-center justify-center shrink-0 pt-12">
                    <ChevronRight className="w-5 h-5 text-border" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Mobile: stacked rounds */}
          <div className="md:hidden space-y-6">
            {roundNumbers.map((roundNum) => {
              const isChampionship = roundNum === bracket.total_rounds;
              const roundName = PlayoffService.getRoundName(bracket.bracket_size, roundNum);
              return (
                <div key={roundNum}>
                  <h3 className={cn(
                    'text-sm font-bold uppercase tracking-wider mb-3 pb-1 border-b',
                    isChampionship ? 'text-amber-300 ring-1 ring-amber-400/40 bg-amber-400/10' : 'text-pastel-orange ring-1 ring-pastel-orange/30 bg-pastel-orange/10',
                  )}>
                    {isChampionship && <Trophy className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" aria-hidden="true" />}
                    {roundName}
                  </h3>
                  <div className="space-y-3">
                    {(winnersByRound.get(roundNum) || []).map((s) => (
                      <MatchupCard
                        key={s.id}
                        series={s}
                        teamNames={teamNames}
                        seedMap={seedMap}
                        isChampionship={isChampionship}
                        compact
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ====== THIRD-PLACE GAME ====== */}
      {thirdPlaceSeries && (
        <Card className="mb-6 overflow-hidden border-none shadow-md">
          <CardHeader className="bg-amber-400/10 pb-3 border-b border-white/10">
            <CardTitle className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-amber-300 font-bold flex items-center gap-2">
              <Medal className="w-4 h-4" />
              Third-Place Game
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="max-w-xs">
              <MatchupCard
                series={thirdPlaceSeries}
                teamNames={teamNames}
                seedMap={seedMap}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ====== CONSOLATION BRACKET ====== */}
      {consolationByRound.size > 0 && (
        <Card className="mb-6 overflow-hidden border-none shadow-md">
          <CardHeader className="bg-white/[0.03] pb-3 border-b border-white/10">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-white/55 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Consolation Bracket
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 lg:p-6">
            <div className="hidden md:flex items-start gap-2 lg:gap-4 overflow-x-auto pb-4">
              {Array.from(consolationByRound.keys()).sort((a, b) => a - b).map((roundNum, idx, arr) => (
                <React.Fragment key={roundNum}>
                  <RoundColumn
                    roundNumber={roundNum}
                    roundName={`Consolation R${idx + 1}`}
                    matchups={consolationByRound.get(roundNum) || []}
                    teamNames={teamNames}
                    seedMap={seedMap}
                    totalRounds={arr.length}
                  />
                  {idx < arr.length - 1 && (
                    <div className="flex items-center justify-center shrink-0 pt-12">
                      <ChevronRight className="w-5 h-5 text-border" />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            <div className="md:hidden space-y-6">
              {Array.from(consolationByRound.keys()).sort((a, b) => a - b).map((roundNum, idx) => (
                <div key={roundNum}>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-3 pb-1 border-b text-white/55 border-white/10">
                    Consolation R{idx + 1}
                  </h3>
                  <div className="space-y-3">
                    {(consolationByRound.get(roundNum) || []).map((s) => (
                      <MatchupCard
                        key={s.id}
                        series={s}
                        teamNames={teamNames}
                        seedMap={seedMap}
                        compact
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Back button */}
      <div className="mt-6 pb-4 flex gap-3">
        <Button
          variant="outline"
          onClick={() => navigate('/standings')}
        >
          View Standings
        </Button>
        <Button
          variant="outline"
          onClick={() => effectiveLeagueId && navigate(`/matchup/${effectiveLeagueId}/1`)}
        >
          Regular Season
        </Button>
      </div>
    </PageLayout>
  );
};

export default PlayoffBracket;
