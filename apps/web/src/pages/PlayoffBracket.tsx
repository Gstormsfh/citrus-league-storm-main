import { userMessage } from '@/lib/userMessage';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import { PressBoxLeagueChrome } from '@/components/pressbox/LeagueChrome';
import { PressBoxPageLoading } from '@/components/pressbox/PageLoading';
import {
  HockeyFooter,
  CupIcon,
  CrossedSticksIcon,
  BracketIcon,
  MaskIcon,
  RangeIcon,
  MascotPortrait,
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
  Play, Swords, Medal,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PressBoxSettingGroup, PressBoxSettingRow } from '@/components/pressbox/Settings';
import { PressBoxNoteCard } from '@/components/pressbox/PlayerCard';
import { DestructiveConsequence } from '@/components/confirm/DestructiveConsequence';
import { PB_LOADING_MIN_MS, useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { LeagueMembershipService } from '@/services/LeagueMembershipService';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { logger } from '@/utils/logger';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';

/** PRESS BOX (2026-09-04): the two buttons this page needs. The orange
 *  primary is the save bar's; the secondary is its quiet outline. */
const PB_PRIMARY =
  'pb-type focus-citrus w-full h-11 inline-flex items-center justify-center gap-2 rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold text-[15px] uppercase tracking-[0.06em] disabled:opacity-40';
const PB_SECONDARY =
  'pb-type focus-citrus w-full h-11 inline-flex items-center justify-center gap-2 rounded-[10px] border border-white/[0.12] bg-white/[0.03] text-pressbox-text/80 font-condensed font-bold text-[15px] uppercase tracking-[0.06em]';

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
        <div className="flex items-center justify-between px-3 py-2 rounded-[8px] bg-white/[0.03] border border-white/[0.06] text-pressbox-text/45">
          <span className="font-plex font-medium text-[10px] tracking-[0.08em]">TBD</span>
          <span className="font-plex text-[12px]">–</span>
        </div>
      );
    }

    const teamSeed = seedMap.get(teamId);
    const seedNum = seed || teamSeed?.seed_number;
    const name = teamNames[teamId] || 'Unknown Team';
    const isCompleted = series.status === 'completed';
    // While a series is on, the side in front carries the figure in sage —
    // the Match screen's rule. Nothing is decided; nothing goes to half strength.
    const isLeading =
      series.status === 'active' &&
      series.home_score !== series.away_score &&
      score === Math.max(series.home_score, series.away_score);

    return (
      /* PRESS BOX (2026-09-04): the two-sided row the artboards use for
         a matchup — seed chip, name in Barlow, the figure in Plex. A winner
         takes sage, a loser goes to half strength, the champion's row wears
         the orange border; nothing glows. */
      <div className={cn(
        'flex items-center justify-between px-3 py-2 rounded-[8px] border transition-colors',
        isCompleted && isWinner && 'bg-pressbox-sage/[0.08] border-pressbox-sage/40',
        isCompleted && !isWinner && 'bg-white/[0.03] border-white/[0.06] opacity-50',
        !isCompleted && 'bg-white/[0.03] border-white/[0.08]',
        isChampionship && isCompleted && isWinner && 'border-pressbox-orange/60',
      )}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {seedNum && (
            <span className={cn(
              'w-5 h-5 rounded-[5px] flex items-center justify-center font-condensed font-extrabold text-[11px] shrink-0',
              isCompleted && isWinner ? 'bg-pressbox-sage text-pressbox-surface' : 'bg-white/[0.08] text-pressbox-text/70'
            )}>
              {seedNum}
            </span>
          )}
          <span className={cn(
            'font-barlow font-semibold truncate text-pressbox-text',
            isCompleted && isWinner && 'font-bold',
            compact ? 'text-[13px]' : 'text-[14px]',
          )}>
            {name}
          </span>
          {isCompleted && isWinner && isChampionship && (
            <Crown className="w-3.5 h-3.5 text-pressbox-orange-soft shrink-0" />
          )}
        </div>
        <span className={cn(
          'font-plex font-semibold tabular-nums ml-2 shrink-0',
          (isCompleted && isWinner) || isLeading ? 'text-pressbox-sage' : 'text-pressbox-text',
          compact ? 'text-[14px]' : 'text-[16px]',
        )}>
          {series.status === 'pending' || series.status === 'bye' ? '–' : score.toFixed(1)}
        </span>
      </div>
    );
  };

  const homeIsWinner = series.winner_team_id === series.home_team_id;
  const awayIsWinner = series.winner_team_id === series.away_team_id;

  return (
    <div className={cn(
      'pb-type rounded-[12px] overflow-hidden bg-pressbox-tile border',
      isChampionship ? 'border-pressbox-orange/50' : series.status === 'active' ? 'border-pressbox-sage/40' : 'border-white/[0.08]',
      series.status === 'pending' && 'opacity-70',
    )}>
      {/* Status line: the ticker's vocabulary — sage while it is on, orange-soft for the final, 45% for what has not started. */}
      <div className={cn(
        'px-3 py-1.5 font-plex font-semibold text-[9px] uppercase tracking-[0.14em] text-center border-b border-white/[0.06]',
        series.status === 'active' && 'text-pressbox-sage',
        series.status === 'completed' && 'text-pressbox-orange-soft',
        series.status === 'pending' && 'text-pressbox-text/45',
        series.status === 'bye' && 'text-pressbox-sage-soft',
      )}>
        {series.status === 'active' && 'Live'}
        {series.status === 'completed' && 'Final'}
        {series.status === 'pending' && 'Upcoming'}
        {series.status === 'bye' && 'Bye'}
        {series.matchup_week_1 && (
          <span className="ml-1.5 text-pressbox-text/45">
            {series.matchup_week_2
              ? `WK ${series.matchup_week_1}–${series.matchup_week_2}`
              : `WK ${series.matchup_week_1}`}
          </span>
        )}
      </div>

      <div className="p-2 space-y-1">
        {getTeamDisplay(series.home_team_id, series.home_seed, homeIsWinner, series.home_score)}
        <div className="flex items-center gap-1 px-3">
          <div className="flex-1 border-t border-white/[0.06]"></div>
          <span className="font-plex text-[8px] text-pressbox-text/40 uppercase tracking-[0.1em]">vs</span>
          <div className="flex-1 border-t border-white/[0.06]"></div>
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
      <div className="text-center mb-4 pb-2 border-b border-white/[0.08]">
        <h3 className={cn(
          'font-condensed font-bold text-[15px] uppercase tracking-[0.08em]',
          isChampionship ? 'text-pressbox-orange-soft' : 'text-pressbox-text',
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
    <div className="pb-type rounded-[12px] bg-pressbox-tile border border-pressbox-orange/50 px-4 py-5 text-center">
      <p className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-orange-soft">{bracket.season} CHAMPION</p>
      <p className="mt-1 font-condensed font-extrabold text-[30px] uppercase tracking-[0.02em] leading-none text-pressbox-text">
        {champName}
      </p>
      {(runnerUpName || thirdPlaceName) && (
        <p className="mt-3 font-plex font-medium text-[10px] tracking-[0.06em] text-pressbox-text/55 uppercase">
          {runnerUpName && <span>2ND · {runnerUpName}</span>}
          {runnerUpName && thirdPlaceName && <span className="text-pressbox-text/30"> · </span>}
          {thirdPlaceName && <span>3RD · {thirdPlaceName}</span>}
        </p>
      )}
    </div>
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
    /* PRESS BOX (2026-09-04): the commissioner's panel in the settings
       vocabulary — a labelled group, switch rows, the orange primary. */
    <Card className="pb-type rounded-[12px] bg-pressbox-tile border border-white/[0.08] shadow-none">
      <CardHeader className="pb-3 border-b border-white/[0.06]">
        <CardTitle className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text flex items-center gap-2">
          <MaskIcon className="w-4 h-4 text-pressbox-orange-soft" strokeWidth={2} />
          Commissioner
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {!bracket && (
          <>
            <PressBoxSettingGroup label="FORMAT">
              <PressBoxSettingRow label="Consolation bracket" checked={consolation} onToggle={setConsolation} />
              <PressBoxSettingRow label="Two-week matchups" checked={twoWeek} onToggle={setTwoWeek} last />
            </PressBoxSettingGroup>
            <button
              type="button"
              className={PB_PRIMARY}
              onClick={() => onGenerate({ consolation, twoWeek })}
              disabled={generating}
            >
              {generating ? (
                'Generating…'
              ) : (
                <>
                  <Swords className="w-4 h-4" />
                  Generate bracket
                </>
              )}
            </button>
          </>
        )}

        {bracket && bracket.status === 'active' && (
          <>
            <button
              type="button"
              className={PB_PRIMARY}
              onClick={onAdvance}
              disabled={generating}
            >
              <Play className="w-4 h-4" />
              Advance round {bracket.current_round}
            </button>

            {!confirmReset ? (
              <button
                type="button"
                className={PB_SECONDARY}
                onClick={() => setConfirmReset(true)}
              >
                <RotateCcw className="w-4 h-4" />
                Reset bracket
              </button>
            ) : (
              <div className="space-y-2">
                {/* A question, not a failure — see components/confirm. The
                    red stays on "Confirm Reset" below. */}
                <DestructiveConsequence>
                  This will permanently delete the bracket and all playoff matchups.
                </DestructiveConsequence>
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
          <div className="text-center font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45 py-2">
            Bracket complete · season over
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
    /* PRESS BOX (2026-09-04): the seed list as a standings slice — seed
       chip, Barlow name, the record in Plex, BYE as a sage tag. */
    <Card className="pb-type rounded-[12px] bg-pressbox-tile border border-white/[0.08] shadow-none">
      <CardHeader className="pb-3 border-b border-white/[0.06]">
        <CardTitle className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text flex items-center gap-2">
          <Trophy className="w-4 h-4 text-pressbox-orange-soft" aria-hidden="true" />
          Seeds
          <span className="font-plex font-medium text-[10px] tracking-[0.08em] text-pressbox-text/45">· {bracketSize} TEAMS</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-white/[0.06]">
          {seeds.map((seed) => {
            const hasBye = bracketSize === 6 && seed.seed_number <= 2;
            return (
              <div key={seed.id} className="flex items-center gap-2.5 px-4 py-2">
                <span className={cn(
                  'w-5 h-5 rounded-[5px] flex items-center justify-center font-condensed font-extrabold text-[11px] shrink-0',
                  seed.seed_number <= 2 ? 'bg-pressbox-orange text-pressbox-orange-ink' : 'bg-white/[0.08] text-pressbox-text/70',
                )}>
                  {seed.seed_number}
                </span>
                <span className="font-barlow font-semibold text-[14px] text-pressbox-text truncate flex-1">
                  {teamNames[seed.team_id] || 'Unknown'}
                </span>
                <span className="font-plex text-[11px] text-pressbox-text/55 tabular-nums">
                  {seed.regular_season_wins}-{seed.regular_season_losses}
                  {seed.regular_season_ties > 0 ? `-${seed.regular_season_ties}` : ''}
                </span>
                {hasBye && (
                  <span className="px-1.5 py-0.5 rounded-[4px] bg-pressbox-sage/15 font-plex font-semibold text-[9px] tracking-[0.12em] text-pressbox-sage">
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
        description: userMessage(err, "Couldn't generate the bracket. Try again in a moment."),
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

      // P3 (2026-09-03): advance_playoff_round now refuses to decide a series
      // whose weeks were never finished or never scored, so "0 series advanced"
      // is a normal, expected answer and the reason has to reach the
      // commissioner. Without this the button looked like it silently failed.
      const advanced = Number(result?.advanced_count ?? 0);
      const skipped = Number(result?.skipped_count ?? 0);
      const firstReason: string | undefined = result?.skipped?.[0]?.reason;

      toast({
        title: advanced > 0 ? 'Round Advanced' : 'Nothing to Advance Yet',
        description:
          skipped > 0
            ? `${advanced} series advanced. ${skipped} left undecided - ${firstReason ?? 'those weeks are not finished yet'}.`
            : `${advanced} series advanced to the next round.`,
        variant: advanced === 0 ? 'destructive' : undefined,
      });

      await loadData();
    } catch (err: unknown) {
      toast({
        title: "Round Didn't Advance",
        description: userMessage(err, "Couldn't advance the round. Try again in a moment."),
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
        description: userMessage(err, "Couldn't reset the bracket. Try again in a moment."),
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

  const displayLoading = useMinimumLoadingTime(loading, PB_LOADING_MIN_MS);

  // Redirect pool leagues to their pool page
  const _poolType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_poolType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_poolType!, activeLeagueId)} replace />;
  }

  if (displayLoading) {
    // PR3: the league chrome over the bracket's skeleton below lg; Stormy from lg.
    return <PressBoxPageLoading kind="bracket" message="Loading the playoff bracket…" />;
  }

  // Layout wrapper used throughout
  const PageLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen bg-pressbox-surface text-pressbox-text">
      <div className="hidden lg:block"><Navbar /></div>
      {/* PRESS BOX (2026-09-04): the league chrome — header, sub-tabs and
          the league menu — replaces the 09-01 title bar and its hamburger,
          which opened the old menu sheet. One menu in the app. */}
      <PressBoxLeagueChrome />
      <main className="w-full lg:pt-24 lg:pb-8 pb-app-chrome">
        <div className="w-full m-0 p-0">
          <div className={cn(
            "flex flex-col lg:grid lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2",
            userLeagueState === 'active-user' && (activeLeagueId || leagueId)
              ? "lg:grid-cols-[220px_1fr_260px] xl:grid-cols-[240px_1fr_280px]"
              : "lg:grid-cols-[220px_1fr]"
          )}>
            {/* Main content */}
            <div className="min-w-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overflow-x-auto px-2 pt-3 lg:px-6 lg:pt-0 order-1 lg:order-2">
              {children}
            </div>

            {/* Left sidebar — AdSpace replaced with on-brand Stormy commentary */}
            <aside className="w-full lg:w-auto order-2 lg:order-1 px-2 pb-4 lg:px-0 lg:pb-0">
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
                {/* The Stormy read, in the note card the player card and
                    the trade screen use. The portrait stays on desktop. */}
                <div className="hidden lg:block rounded-[12px] overflow-hidden border border-white/[0.08]">
                  <MascotPortrait id="stormy" />
                </div>
                <PressBoxNoteCard
                  eyebrow="STORMY · CUP CHASE"
                  body="Single elimination. The higher seed gets home ice. Tap any series for the matchup detail. Champions are immortalized."
                  avatarSrc="/mascots/mascot-stormy.webp"
                  className="lg:hidden"
                />
                <PressBoxNoteCard
                  eyebrow="STORMY · CUP CHASE"
                  body="Single elimination. The higher seed gets home ice. Click any series for the matchup detail. Champions are immortalized."
                  className="hidden lg:flex"
                />
              </div>
            </aside>

            {/* Right sidebar - notifications */}
            {userLeagueState === 'active-user' && (activeLeagueId || leagueId) && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-pressbox-tile border border-white/[0.08] rounded-[12px] overflow-hidden">
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
          <p className="pb-type font-barlow text-[15px] text-pressbox-text/70 mb-4">{error}</p>
          <button type="button" className={cn(PB_SECONDARY, 'w-auto px-5')} onClick={() => effectiveLeagueId && navigate(`/standings`)}>
            Back to standings
          </button>
        </div>
      </PageLayout>
    );
  }

  // No bracket generated yet
  if (!bracket) {
    return (
      <PageLayout>
        <div className="text-center py-10 lg:py-16">
          <div className="mb-6">
            <CupIcon className="w-16 h-16 mx-auto text-pressbox-orange-soft/30 mb-4" strokeWidth={2} />
            <h1 className="pb-type font-condensed font-extrabold text-[24px] uppercase tracking-[0.02em] text-pressbox-text mb-2">Playoffs</h1>
            <p className="pb-type font-barlow text-[13px] leading-[1.45] text-pressbox-text/60 max-w-md mx-auto">
              {isCommissioner
                ? 'Generate the bracket from the commissioner panel when the regular season ends. Teams are seeded from the standings.'
                : 'The bracket has not been generated yet. Ask your commissioner to set it up when the regular season ends.'}
            </p>
          </div>
          <button
            type="button"
            className={cn(PB_SECONDARY, 'w-auto px-5')}
            onClick={() => navigate('/standings')}
          >
            View standings
          </button>
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
          <h1 className="pb-type font-condensed font-extrabold text-[24px] lg:text-[30px] uppercase tracking-[0.02em] text-pressbox-text">
            Playoffs
          </h1>
          {bracket.status === 'active' && (
            <span className="pb-type px-1.5 py-0.5 rounded-[4px] bg-pressbox-sage/15 font-plex font-semibold text-[9px] tracking-[0.12em] text-pressbox-sage">
              LIVE
            </span>
          )}
          {bracket.status === 'completed' && (
            <span className="pb-type px-1.5 py-0.5 rounded-[4px] bg-pressbox-orange-soft/15 font-plex font-semibold text-[9px] tracking-[0.12em] text-pressbox-orange-soft">
              FINAL
            </span>
          )}
        </div>
        <p className="pb-type font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45">
          {bracket.bracket_size}-team single elimination
          {bracket.two_week_matchups && ' (two-week matchups)'}
          {bracket.consolation_enabled && ' with consolation bracket'}
        </p>
      </div>

      {/* ====== WINNERS BRACKET ====== */}
      <Card className="pb-type mb-6 overflow-hidden rounded-[12px] bg-pressbox-tile border border-white/[0.08] shadow-none">
        <CardHeader className="pb-3 border-b border-white/[0.06]">
          <CardTitle className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text flex items-center gap-2">
            <Swords className="w-4 h-4 text-pressbox-orange-soft" />
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
                    <ChevronRight className="w-5 h-5 text-pressbox-text/30" />
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
                    'font-condensed font-bold text-[15px] uppercase tracking-[0.08em] mb-2 pb-1 border-b border-white/[0.08]',
                    isChampionship ? 'text-pressbox-orange-soft' : 'text-pressbox-text',
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
        <Card className="pb-type mb-6 overflow-hidden rounded-[12px] bg-pressbox-tile border border-white/[0.08] shadow-none">
          <CardHeader className="pb-3 border-b border-white/[0.06]">
            <CardTitle className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text flex items-center gap-2">
              <Medal className="w-4 h-4 text-pressbox-orange-soft" />
              Third-Place Game
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="lg:max-w-xs">
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
        <Card className="pb-type mb-6 overflow-hidden rounded-[12px] bg-pressbox-tile border border-white/[0.08] shadow-none">
          <CardHeader className="pb-3 border-b border-white/[0.06]">
            <CardTitle className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/60 flex items-center gap-2">
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
                      <ChevronRight className="w-5 h-5 text-pressbox-text/30" />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            <div className="md:hidden space-y-6">
              {Array.from(consolationByRound.keys()).sort((a, b) => a - b).map((roundNum, idx) => (
                <div key={roundNum}>
                  <h3 className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] mb-2 pb-1 border-b border-white/[0.08] text-pressbox-text/60">
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
        <button
          type="button"
          className={PB_SECONDARY}
          onClick={() => navigate('/standings')}
        >
          View standings
        </button>
        <button
          type="button"
          className={PB_SECONDARY}
          onClick={() => effectiveLeagueId && navigate(`/matchup/${effectiveLeagueId}/1`)}
        >
          Regular season
        </button>
      </div>
    </PageLayout>
  );
};

export default PlayoffBracket;
