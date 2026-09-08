import { useLeague } from '@/contexts/LeagueContext';
import { projectedSummary, scoreGameLog } from '@/components/player/projectionScoring';
import { hasUnprojectedPlusMinus, leagueDashboardProjection, usesFantasyPoints } from '@/components/player/leagueDashboardProjection';
import { useGameLogIdentity } from '@/components/player/useGameLogIdentity';
import { userMessage } from '@/lib/userMessage';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { AlertCircle, Clock, Trash2, Snowflake, CalendarDays, Loader2, Newspaper } from 'lucide-react';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { cn } from '@/lib/utils';
import { LeagueService, getLeagueFormat } from '@/services/LeagueService';
import { ScheduleService } from '@/services/ScheduleService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect, useMemo, useRef } from 'react';
import { CitrusSparkle } from '@/components/icons/CitrusIcons';
import { getTodayMST } from '@/utils/timezoneUtils';
import { logger } from '@/utils/logger';
import { playerApi } from '@/api/players';
import { MatchupService } from '@/services/MatchupService';
import { matchupApi } from '@/api/matchups';
import { ScoringCalculator } from '@/utils/scoringUtils';
import { generatePlayerWriteup, WriteupTone, type CareerSummary, type WriteupExtras } from '@/utils/playerWriteup';
import { NewsItemRow } from '@/components/news/NewsItemRow';
import { buildAdvancedCardData, type CardEntry } from '@/components/player/playerAdvancedMetrics';
import { usePlayerXgHistory } from '@/components/player/usePlayerXgHistory';
import { projectionFraming } from '@/components/player/projectionFraming';
import { getCurrentSeason, getUpcomingSeasonStartDate, getProjectionsSeason, getSeasonStartDate } from '@citrus/shared';
import { useCitrusPlayerNotes } from '@/hooks/useCitrusPlayerNotes';
import { PlayerAdvancedCard } from '@/components/player/PlayerAdvancedCard';
import {
  PressBoxPlayerCardHero,
  pressBoxPlayerCardGround,
  PressBoxGameLog,
  PressBoxUpcomingCards,
  PressBoxStatTiles,
  PressBoxNoteCard,
  type PressBoxStatTile,
} from '@/components/pressbox/PlayerCard';
import { usePlayerDashboardIndex } from '@/hooks/usePlayerDashboardIndex';
import { newestRowFor, vitalsFrom, type DirectoryVitalsRow, type Vital } from '@/components/player/vitals';
import { Link } from 'react-router-dom';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { PressBoxTabs } from '@/components/pressbox/Tabs';
import {
  type GameLogEntry,
  playedRows,
  upcomingRows,
  upcomingCards,
  SKATER_LOG_HEADINGS,
  GOALIE_LOG_HEADINGS,
  SKATER_PROJ_HEADINGS,
  GOALIE_PROJ_HEADINGS,
} from '@/components/player/gameLogRows';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { getTeamColor } from '@/utils/teamColors';

/* 2026-08-19 visual audit — muted-text correction.
   text-citrus-charcoal is #5C5C5C, a soft charcoal designed for the
   original CREAM theme. At 20-70% opacity on the dark #1A2A20 tiles it
   composites to near-invisible (team codes on this page measured
   1.47:1). Remapped to cream at the alpha that preserves the intended
   hierarchy while clearing 4.5:1 on a dark tile. */


// The GameLogEntry type lives with the row mapping in
// components/player/gameLogRows.ts (2026-09-04).

/** Rows the phone log shows before "+ N MORE". */
const PLAYED_ROWS = 10;
const UPCOMING_ROWS = 10;

/** Compute a meaningful confidence score from projection data + temporal distance */
function computeConfidence(projection: Record<string, unknown>, gameDate: string, todayStr: string): number {
  if (!projection) return 0;

  // Base confidence from sample size (games played proxy: shrinkage_weight)
  // shrinkage_weight is 0.0-1.0 based on GP/sample — use directly as base
  const shrinkage = Number(projection.shrinkage_weight || 0);
  const baseConfidence = shrinkage > 0 ? Math.min(shrinkage / 0.9, 1.0) : 0.7;

  // Temporal decay: games farther out are less confident
  // ~1.0 for tomorrow, ~0.85 at 30 days, ~0.70 at 60 days
  const gameMs = new Date(gameDate + 'T00:00:00').getTime();
  const todayMs = new Date(todayStr + 'T00:00:00').getTime();
  const daysOut = Math.max(0, (gameMs - todayMs) / 86400000);
  const temporalFactor = Math.max(0.50, 1.0 - (daysOut * 0.005));

  // Opponent factor: extreme opponent adjustments = less confidence
  const oppAdj = Number(projection.opponent_adjustment || 1.0);
  const oppDeviation = Math.abs(oppAdj - 1.0);
  const opponentFactor = Math.max(0.75, 1.0 - oppDeviation);

  return Math.round(baseConfidence * temporalFactor * opponentFactor * 100) / 100;
}

interface PlayerStatsModalProps {
  player: HockeyPlayer | null;
  isOpen: boolean;
  onClose: () => void;
  leagueId?: string | null;
  isOnRoster?: boolean;
  onPlayerDropped?: () => void;
  /**
   * CARD UNIFICATION (2026-09-01): optional primary footer action so
   * contexts with a verb (the draft room's "Draft Player") can use THIS
   * card instead of forking their own. One player card everywhere.
   */
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    pending?: boolean;
    pendingLabel?: string;
  };
}

/**
 * Scouting-tag palette. Caution borrows the amber/red language the status
 * badges already use for injuries, deliberately NOT orange — orange is spoken
 * for as the app's "this is you" identity signal (Standings, matchup ScoreCard).
 */
const WRITEUP_TAG_STYLES: Record<WriteupTone, string> = {
  positive: 'bg-pressbox-sage/15 text-pressbox-sage-soft',
  neutral: 'bg-white/[0.06] text-pressbox-text/70',
  caution: 'bg-pressbox-grapefruit/[0.15] text-pressbox-grapefruit-text',
};

const getPositionAbbr = (pos: string) => {
  const p = pos?.toUpperCase() || '';
  if (['C', 'CENTRE', 'CENTER'].includes(p)) return 'C';
  if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(p)) return 'LW';
  if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(p)) return 'RW';
  if (['D', 'DEFENCE', 'DEFENSE'].includes(p)) return 'D';
  if (['G', 'GOALIE'].includes(p)) return 'G';
  return p.substring(0, 2);
};

// ─── Stat cell helper ────────────────────────────────────────────────
// 2026-08-24 dead-dark-variant sweep: bg-[#E8EED9]/40 (cream wash) put
// pastel-cream text on a cream surface — the washed-out stat boxes. The
// .dark remap layer that was supposed to darken it never applies because
// no .dark class exists on <html>. Dark-first tile instead.
/**
 * PRESS BOX (2026-09-04): the artboard's stat tile — Plex 8px label at 45%
 * over an 18px tabular figure in a #16241B tile at 10px radius. `highlight`
 * is the artboard's orange-soft, for the figures a manager scans for first.
 */
const StatCell = ({ label, value, highlight, sub }: { label: string; value: string | number; highlight?: boolean; sub?: string }) => (
  <div className={cn(PB_TYPE, 'p-2 rounded-[10px] bg-pressbox-tile border border-white/[0.08]')}>
    <span className="block font-plex font-medium text-[8px] tracking-[0.08em] uppercase text-pressbox-text/45 truncate">{label}</span>
    <span className={cn(
      'block mt-[3px] font-plex font-semibold text-[18px] tabular-nums',
      highlight ? 'text-pressbox-orange-soft' : 'text-pressbox-text',
    )}>
      {value}
    </span>
    {sub && <span className="block font-plex font-medium text-[9px] text-pressbox-text/45">{sub}</span>}
  </div>
);

// ─── Main Component ──────────────────────────────────────────────────
/** "2026-27" from 2026 - the way a season is written on every other site. */
function seasonLabel(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`;
}

/**
 * A season's calendar window.
 *
 * The end is the day before the NEXT season opens, so a prior-season window
 * carries that season's playoffs (played the following April to June) and
 * stops before the next opener. Without an end bound, asking for 2025 also
 * returned every 2026-27 game, which is the "all of prior year combined"
 * shape this modal was reported for, in reverse.
 */
/**
 * THE LOG, REMEMBERED (2026-09-05). "Game log takes forever to load stats
 * and prior stats." Every open of the card, and every tap between the two
 * seasons, refetched the schedule and the whole log. Now the built log is
 * kept per player and season for five minutes: the second season is one
 * fetch, and the flip back is instant. Module scope so it survives the
 * modal unmounting between cards.
 */
interface GameLogBuilt {
  entries: GameLogEntry[];
  totalProjected: number;
  totalActual: number;
  goalieStartsRemaining: number | null;
  at: number;
}
const GAME_LOG_TTL_MS = 5 * 60 * 1000;
const gameLogCache = new Map<string, GameLogBuilt>();

function seasonWindow(season: number): { start: string; end: string } {
  const start = getSeasonStartDate(season) ?? `${season}-09-01`;
  const nextStart = getSeasonStartDate(season + 1);
  if (nextStart) {
    const d = new Date(`${nextStart}T00:00:00`);
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return { start, end: `${y}-${m}-${day}` };
  }
  // No entry for the following season yet: June 30 clears any playoff run.
  return { start, end: `${season + 1}-06-30` };
}

const PlayerStatsModal = ({ player, isOpen, onClose, leagueId: suppliedLeagueId, isOnRoster = false, onPlayerDropped, action }: PlayerStatsModalProps) => {
  const { activeLeagueId } = useLeague();
  const leagueId = suppliedLeagueId ?? activeLeagueId ?? undefined;
  const [leagueScoring, setLeagueScoring] = useState<unknown>(null);
  const [scoringReady, setScoringReady] = useState(!leagueId);
  const [pointsFormat, setPointsFormat] = useState(true);
  const [goalieRos, setGoalieRos] = useState<Record<string, unknown> | null>(null);
  const [showProjectionBreakdown, setShowProjectionBreakdown] = useState(false);
  const projectionPlayerId = player?.id;
  const projectionGoalie = player?.position === 'G' || player?.position === 'Goalie';
  useEffect(() => {
    let cancelled = false;
    setShowProjectionBreakdown(false);
    setScoringReady(!leagueId);
    setLeagueScoring(null);
    setGoalieRos(null);
    if (!isOpen) return;
    void (async () => {
      try {
        const result = leagueId ? await LeagueService.getLeague(leagueId) : null;
        if (result?.error || (leagueId && !result?.league)) throw new Error('League scoring unavailable');
        if (cancelled) return;
        setLeagueScoring(result?.league?.scoring_settings ?? null);
        setPointsFormat(usesFantasyPoints(result?.league ? getLeagueFormat(result.league).scoringFormat : undefined));
        setScoringReady(true);
        if (projectionGoalie && projectionPlayerId) {
          const response = await playerApi.getRosProjectionForPlayer(Number(projectionPlayerId));
          const rows = response.data as Record<string, unknown>[] | undefined;
          if (!cancelled) setGoalieRos(rows?.[0] ?? null);
        }
      } catch (error) { logger.error('[PlayerStatsModal] League projection scoring unavailable:', error); }
    })();
    return () => { cancelled = true; };
  }, [leagueId, isOpen, projectionPlayerId, projectionGoalie]);
  const { user } = useAuth();
  const { toast } = useToast();
  const [isDropping, setIsDropping] = useState(false);
  // Headshot-first avatar (2026-08-18): try the player's real NHL
  // headshot, fall back to team logo, then jersey number. Mirrors
  // HockeyPlayerCard's chain so every card surface agrees.
  const [headshotErr, setHeadshotErr] = useState(false);
  /** PRESS BOX (2026-09-04): the card's tab, driven by the Press Box strip. */
  /**
   * THE ARTBOARD'S FIVE (2026-09-05): Summary · Game log · Splits · xG ·
   * News. `summary` is the writeup and the season line, `log` the table,
   * `splits` the full stat grids, `xg` the advanced card, `news` the notes.
   */
  type CardTab = 'summary' | 'log' | 'splits' | 'xg' | 'news';
  const [cardTab, setCardTab] = useState<CardTab>('summary');

  // Game log state (all 82 games: actuals for played + projections for future)
  const [gameLog, setGameLog] = useState<GameLogEntry[]>([]);
  const [gameLogLoading, setGameLogLoading] = useState(false);
  const [gameLogError, setGameLogError] = useState(false);
  const [gameLogAttempt, setGameLogAttempt] = useState(0);
  const [totalProjected, setTotalProjected] = useState(0);
  /** GOALIE-PROJ SANITY (2026-09-01): start-aware remaining games for goalies. */
  const [goalieStartsRemaining, setGoalieStartsRemaining] = useState<number | null>(null);
  const [totalActual, setTotalActual] = useState(0);
  /**
   * WHICH SEASON THE GAME LOG IS ABOUT (2026-09-04).
   *
   * Defaults to the season ahead - the one with a schedule and projections in
   * it - and lets the reader drop back to the season that was actually played.
   * That is the shape every other fantasy product ships, and it is the only
   * shape that works in September: the new season has 82 games and no stats,
   * the old one has 82 stat lines and no future.
   *
   * Scoped to the GAME LOG on purpose. Overview and Detailed read last
   * season's numbers because season 2026 has none yet (production 2026-09-04:
   * player_season_stats holds 0 rows for 2026 and 1,063 for 2025), so a
   * toggle over those two tabs would offer a choice between numbers and an
   * empty card. When the season opens and both sides have data, this state is
   * what those tabs hang off.
   */
  const [logSeason, setLogSeason] = useState<number>(() => getProjectionsSeason());
  const [showAllPlayed, setShowAllPlayed] = useState(false);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  /** "September 29", or null when the map has no next opener. Same read the
   *  off-season line above the tabs uses, hoisted so both agree. */
  const openerLabel = useMemo(() => {
    const opener = getUpcomingSeasonStartDate();
    if (!opener) return null;
    return new Date(`${opener}T00:00:00`).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
    });
  }, []);
  const fetchedForPlayerRef = useRef<string | null>(null);
  const todayGameRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to today's game after game log renders
  useEffect(() => {
    if (gameLog.length === 0 || gameLogLoading) return;
    // Double rAF ensures React has flushed the DOM update
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (todayGameRef.current) {
          todayGameRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }, [gameLog, gameLogLoading]);

  const gameLogPlayer = useGameLogIdentity(player);

  // Fetch full season game log when modal opens (actuals for played games + projections for future)
  useEffect(() => {
    if (!isOpen || !gameLogPlayer) {
      if (!isOpen) {
        setGameLog([]);
        setGameLogError(false);
        setTotalProjected(0);
        setTotalActual(0);
        setGoalieStartsRemaining(null);
        // The next player opens on the season ahead, whatever this reader
        // chose for the last one.
        setLogSeason(getProjectionsSeason());
        fetchedForPlayerRef.current = null;
      }
      return;
    }

    const playerKey = `${gameLogPlayer.id}-${gameLogPlayer.team}-${logSeason}`;
    if (fetchedForPlayerRef.current === playerKey) return;
    fetchedForPlayerRef.current = playerKey;

    // STALE FRAME (2026-09-04). Reported: "pages load in incorrectly before
    // the proper page loads... loads an old stale version, then refreshes."
    //
    // The reset below used to live only in the `!isOpen` branch above, so it
    // ran when the modal CLOSED and never when the player CHANGED. Open a
    // second player without a close in between and this component rendered
    // his name and his team over the previous player's game log and totals,
    // until the fetch landed and everything swapped underneath the reader.
    //
    // `gameLogLoading` did not save it: the log list is gated on that flag,
    // but `heroProjectedPts` is not - it reads `totalProjected` straight out
    // of state, at the top of the card, in the largest type on the screen.
    // So the first thing a manager saw was the LAST player's projection
    // attributed to this one.
    //
    // Cleared here, synchronously, in the same commit that changes the
    // identity: an empty card for a moment is honest, a populated wrong one
    // is not. `setGameLogLoading(true)` moves up here for the same reason -
    // it used to be set inside the async body, one render too late, and the
    // `!teamAbbrev` path bailed before ever setting it.
    setGameLog([]);
    setGameLogError(false);
    setTotalProjected(0);
    setTotalActual(0);
    setGoalieStartsRemaining(null);
    setGameLogLoading(true);
    setShowAllPlayed(false);
    setShowAllUpcoming(false);

    // A player change mid-flight must not let the OLD response win. Same
    // guard usePlayerXgHistory carries, for the same reason.
    let cancelled = false;

    const fetchGameLog = async () => {
      const teamAbbrev = gameLogPlayer.team || '';
      if (!teamAbbrev) {
        setGameLogLoading(false);
        return;
      }

      const cached = gameLogCache.get(playerKey);
      if (cached && Date.now() - cached.at < GAME_LOG_TTL_MS) {
        setGameLog(cached.entries);
        setTotalProjected(cached.totalProjected);
        setTotalActual(cached.totalActual);
        setGoalieStartsRemaining(cached.goalieStartsRemaining);
        setGameLogLoading(false);
        return;
      }

      try {
        const todayStr = getTodayMST();
        const playerId = typeof gameLogPlayer.id === 'string' ? parseInt(gameLogPlayer.id, 10) : gameLogPlayer.id;
        const playerIsGoalie = gameLogPlayer.position === 'Goalie' || gameLogPlayer.position === 'G';

        // WHICH SEASON'S GAMES (2026-09-04). Reported: "schedule in the game
        // log is still showing 2025 - we need to have it show THIS year, and
        // projections - and not all of prior year combined."
        //
        // This read `getCurrentSeason()`, which is the season being PLAYED.
        // On 2026-09-04 that is still 2025, because the flip happens on the
        // opener (2026-09-29) - so the window opened at 2025-09-01 and the
        // modal returned all 82 games of the season that just finished.
        // Every one of them was in the past, so the log was a wall of
        // history with no projections in it at all.
        //
        // `getProjectionsSeason()` is the question this code is actually
        // asking: the season being played, or, in the July-September run-up,
        // the one about to be. Today it answers 2026; from the opener it
        // equals getCurrentSeason() again, so nothing changes in-season.
        // That is also the key the ingested projections are stored under,
        // which is why the future rows had nothing to join to before.
        //
        // The window now starts at the real opener from SEASON_START_DATES
        // rather than a hardcoded September 1st - the season that opens on
        // the 29th should not have a month of nothing in front of it.
        //
        // NOTE the deliberate asymmetry with the rest of this modal: the
        // SCHEDULE and PROJECTIONS look forward, while season stats and the
        // advanced metrics keep reading last season, because that is the
        // only season with numbers in it until games are played.
        const { start: windowStart, end: windowEnd } = seasonWindow(logSeason);
        // The schedule and the log in parallel: the log's range is the
        // season window, known before the schedule answers. One round trip
        // on a phone, not two in a row.
        const [scheduleResult, logResponse] = await Promise.all([
          ScheduleService.getGamesForTeam(teamAbbrev, windowStart, windowEnd),
          matchupApi.getPlayerGameLog(playerId, windowStart, windowEnd),
        ]);
        if (scheduleResult.error) throw scheduleResult.error;
        const scheduled = scheduleResult.games;

        // REGULAR SEASON ONLY (2026-09-05). The season window runs to the
        // eve of the next opener so a full run of playoff games sat in the
        // log: Quinn Hughes read "93 Games" and 666.9 FPTS for 2025-26 with
        // May dates against COL and DAL. Fantasy is the regular season;
        // nhl_games carries game_type, and the stats map is keyed by these
        // rows' dates, so the playoff stats fall away with the rows.
        const games = (scheduled ?? []).filter(
          (g: { game_type?: string | null }) => g.game_type === 'regular',
        );

        if (games.length === 0) {
          if (!cancelled) setGameLogLoading(false);
          return;
        }

        // Separate past and future games
        const pastGames = games.filter((g: any) => g.game_date.split('T')[0] < todayStr);
        const futureGames = games.filter((g: any) => g.game_date.split('T')[0] >= todayStr);

        /*
         * ONE REQUEST FOR THE WHOLE SEASON.
         *
         * This used to call /daily-game-stats once per PAST game date, in
         * serial batches of ten, and /projections/daily once per FUTURE date.
         * A full season is up to 82 of each — on the ~350ms round trip a phone
         * sees, that is most of a minute to open a modal, and it is exactly
         * why "Game Log takes a long ass time to open".
         *
         * player_game_stats carries game_date directly, so the server reads the
         * whole log in one query: measured against production, 82 rows in
         * 12.9ms. Projections come back from the same call.
         */
        const actualStatsMap = new Map<string, any>();
        const projectionMap = new Map<string, any>();

        {
          const payload = (logResponse?.data ?? {}) as {
            games?: Array<Record<string, unknown>>;
            projections?: Array<Record<string, unknown>>;
          };

          for (const row of payload.games ?? []) {
            const d = String(row.game_date ?? '').split('T')[0];
            if (d) actualStatsMap.set(d, row);
          }
          for (const row of payload.projections ?? []) {
            const d = String(row.projection_date ?? '').split('T')[0];
            if (d) projectionMap.set(d, row);
          }
        }

        // Build game log entries
        const entries: GameLogEntry[] = [];
        let projTotal = 0;
        let actTotal = 0;

        for (const game of games) {
          const gameDate = game.game_date.split('T')[0];
          const [gy, gm, gd] = gameDate.split('-').map(Number);
          const gameDateObj = new Date(gy, gm - 1, gd);
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayLabel = dayNames[gameDateObj.getDay()];
          const dateLabel = gameDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          const isHome = game.home_team.toUpperCase() === teamAbbrev.toUpperCase();
          const opponent = isHome ? `vs ${game.away_team}` : `@ ${game.home_team}`;
          const isPast = gameDate < todayStr;
          const isToday = gameDate === todayStr;

          const actualStat = actualStatsMap.get(gameDate);
          const projection = projectionMap.get(gameDate) || null;
          const projectedPoints = Number(projection?.total_projected_points || 0);
          // Calculate fantasy points from raw game stats using scoring calculator
          const scorer = new ScoringCalculator();
          const actualPoints = actualStat
            ? scorer.calculatePoints(actualStat, playerIsGoalie)
            : undefined;

          if (isPast && actualPoints != null) actTotal += actualPoints;
          if (!isPast) projTotal += projectedPoints;

          const mcConfidence = Number(projection?.dynamic_confidence || 0);
          const confidence = mcConfidence > 0 ? mcConfidence : (projection ? computeConfidence(projection, gameDate, todayStr) : 0);

          entries.push({
            date: gameDate,
            dayLabel,
            dateLabel,
            opponent,
            gameTime: game.game_time ? (() => {
              try {
                return new Date(game.game_time).toLocaleTimeString('en-US', {
                  hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Denver'
                });
              } catch { return undefined; }
            })() : undefined,
            projectedPoints,
            projection,
            isGoalie: playerIsGoalie,
            isPast,
            isToday,
            computedConfidence: confidence,
            actualPoints,
            actualStats: actualStat || undefined,
          });
        }

        // GOALIE-PROJ SANITY (2026-09-01): a goalie's daily projection
        // rows exist for every TEAM game (they are "if he starts"
        // values), so summing them promised one netminder 84 starts and
        // a 619-point season — which outranked every skater and fed the
        // founder's "goalies drafted first overall" report. The
        // rest-of-season table already carries start-aware numbers
        // (Vasilevskiy 55 games, not 84); the headline total and games
        // label read from it for goalies. Skater sums stay as-is —
        // team games ≈ player games for them.
        let goalieAwareTotal = projTotal;
        let startsRemaining: number | null = null;
        if (playerIsGoalie) {
          try {
            const rosRes = await playerApi.getRosProjectionForPlayer(playerId);
            const rosRows = (rosRes?.data ?? []) as Array<{
              total_projected_points?: number | null;
              games_remaining?: number | null;
            }>;
            const ros = Array.isArray(rosRows) ? rosRows[0] : null;
            const rosTotal = Number(ros?.total_projected_points);
            const rosGames = Number(ros?.games_remaining);
            if (Number.isFinite(rosTotal) && rosTotal > 0) {
              goalieAwareTotal = rosTotal;
            }
            startsRemaining = Number.isFinite(rosGames) && rosGames > 0 ? Math.round(rosGames) : null;
          } catch {
            // ROS row unavailable — keep the summed value rather than
            // showing nothing; the label falls back to team games.
            startsRemaining = null;
          }
        }
        if (cancelled) return;
        setGameLog(entries);
        setGoalieStartsRemaining(startsRemaining);
        setTotalProjected(goalieAwareTotal);
        setTotalActual(actTotal);
        gameLogCache.set(playerKey, {
          entries,
          totalProjected: goalieAwareTotal,
          totalActual: actTotal,
          goalieStartsRemaining: startsRemaining,
          at: Date.now(),
        });
      } catch (error) {
        logger.error('[PlayerStatsModal] Error fetching game log:', error);
        if (!cancelled) setGameLogError(true);
      } finally {
        if (!cancelled) setGameLogLoading(false);
      }
    };

    fetchGameLog();

    return () => {
      cancelled = true;
      if (fetchedForPlayerRef.current === playerKey) fetchedForPlayerRef.current = null;
    };
  }, [isOpen, gameLogPlayer, logSeason, gameLogAttempt]);

  const leagueProjection = useMemo(() => projectedSummary(
    projectionGoalie && goalieRos ? [goalieRos] : gameLog.filter(g => !g.isPast && g.projection).map(g => g.projection!),
    leagueScoring, projectionGoalie,
  ), [gameLog, leagueScoring, projectionGoalie, goalieRos]);

  // MUST sit above the `if (!player) return null` below — a hook called after
  // an early return runs conditionally, which breaks the Rules of Hooks and
  // desyncs every hook after it the moment `player` goes null on close.
  const { notes: citrusNotes, items: wireItems } = useCitrusPlayerNotes(player?.id, isOpen);
  // Same rule: the log's rows are derived above the early return. They read
  // the goalie flag off `player` directly because `isGoalie` is declared
  // below it.
  const logIsGoalie = player?.position === 'Goalie' || player?.position === 'G';
  const scoredGameLog = useMemo(() => scoreGameLog(gameLog, leagueScoring), [gameLog, leagueScoring]);
  const leagueActualTotal = scoredGameLog.reduce((sum, entry) => sum + (entry.isPast ? entry.actualPoints ?? 0 : 0), 0);
  const playedLog = useMemo(() => playedRows(scoredGameLog, logIsGoalie), [scoredGameLog, logIsGoalie]);
  const upcomingLog = useMemo(() => upcomingRows(gameLog, logIsGoalie), [gameLog, logIsGoalie]);

  // ── THE ARTBOARD'S TILES, WATCH AND SHARE (2026-09-05) ────────────────
  // Rank and the xG rate come off the shared dashboard index, already in
  // memory on every surface that opens a card; the week's points are the
  // log's last seven days; the season projection is the hero's figure.
  const rawIndex = usePlayerDashboardIndex({ enabled: isOpen });
  const leagueIndex = useMemo(() => leagueDashboardProjection(rawIndex.players, leagueScoring, isOpen && scoringReady && pointsFormat),
    [rawIndex.players, leagueScoring, isOpen, scoringReady, pointsFormat]);
  const index = { ...rawIndex, players: leagueIndex };
  // The bio strip from player_directory (age, height, weight, shoots), when
  // the player object did not bring its own.
  const [directoryVitals, setDirectoryVitals] = useState<Vital[]>([]);
  // CAREER (2026-09-05): the directory's career document, for the writeup.
  const [career, setCareer] = useState<CareerSummary | null>(null);
  useEffect(() => {
    const id = Number(player?.id);
    if (!isOpen || !Number.isFinite(id) || id <= 0) {
      setDirectoryVitals([]);
      setCareer(null);
      return;
    }
    let cancelled = false;
    playerApi
      .getDirectory([String(id)])
      .then((res) => {
        if (cancelled) return;
        const rows = ((res as { data?: unknown }).data ?? []) as DirectoryVitalsRow[];
        const newest = newestRowFor(rows, id);
        setDirectoryVitals(vitalsFrom(newest));
        setCareer((newest?.career as CareerSummary | null | undefined) ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setDirectoryVitals([]);
          setCareer(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, player?.id]);
  const indexEntry = useMemo(() => {
    const id = Number(player?.id);
    return Number.isFinite(id) ? index.players.find((p) => p.id === id) ?? null : null;
  }, [index.players, player?.id]);
  // THE WRITEUP'S EXTRAS (2026-09-05): what the card already holds beyond
  // one season's box score. Age from the directory strip, the seasons on
  // our books from the xG history, the cohort reads the XG tab draws, and
  // the projection with the framing the card uses. See WriteupExtras.
  const xgHistory = usePlayerXgHistory(Number(player?.id) || null, { enabled: isOpen });
  const positionRank = useMemo(() => {
    if (!indexEntry || !scoringReady || !pointsFormat) return null;
    const cohort = index.players.filter((p) => p.position === indexEntry.position);
    const key = (p: typeof indexEntry) => p.proj_fantasy_points;
    const mine = key(indexEntry);
    if (mine == null) return null;
    const ahead = cohort.filter((p) => (key(p) ?? -Infinity) > mine).length;
    return `${indexEntry.position}${ahead + 1}`;
  }, [index.players, indexEntry, scoringReady, pointsFormat]);
  const weekPoints = useMemo(() => {
    if (!scoringReady || !pointsFormat) return null;
    const today = getTodayMST();
    const from = new Date(`${today}T00:00:00`);
    from.setDate(from.getDate() - 6);
    const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    const played = scoredGameLog.filter((e) => e.isPast && e.date >= fromStr && e.actualPoints != null);
    return played.length ? played.reduce((sum, e) => sum + (e.actualPoints ?? 0), 0) : null;
  }, [scoredGameLog, scoringReady, pointsFormat]);
  const [watched, setWatched] = useState(() => {
    const wl = LeagueService.getWatchlist() as unknown;
    const id = String(player?.id ?? '');
    return wl instanceof Set ? wl.has(id) : Array.isArray(wl) ? wl.map(String).includes(id) : false;
  });
  const toggleWatch = () => {
    const id = String(player?.id ?? '');
    if (watched) LeagueService.removeFromWatchlist(id);
    else LeagueService.addToWatchlist(id);
    setWatched(!watched);
  };
  const sharePlayer = async () => {
    const url = `${window.location.origin}/players/${player?.id ?? ''}`;
    try {
      if (navigator.share) await navigator.share({ title: player?.name ?? 'Player', url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ title: 'Link copied', description: url });
      }
    } catch {
      /* the share sheet was dismissed */
    }
  };

  if (!player) return null;

  const isGoalie = player.position === 'Goalie' || player.position === 'G';
  const stats = player.stats || {};
  // Pure function of `player` and the extras — cheap enough to run inline,
  // and deliberately not memoised on a value that changes identity anyway.
  const writeupExtras: WriteupExtras = (() => {
    const ageVital = directoryVitals.find((v) => v.label === 'AGE');
    const age = ageVital ? Number(ageVital.value) : null;
    const goalsBySeason = (xgHistory.points ?? [])
      .filter((p) => p.game_type === 'regular')
      .reduce<Map<number, number>>((m, p) => m.set(p.season, (m.get(p.season) ?? 0) + p.goals), new Map());
    let advanced: ReturnType<typeof buildAdvancedCardData> | null = null;
    if (indexEntry && index.players.length > 0) {
      try {
        advanced = buildAdvancedCardData(indexEntry as CardEntry, index.players as CardEntry[]);
      } catch {
        advanced = null;
      }
    }
    const pct = (key: string) => advanced?.metrics.find((m) => m.spec.key === key)?.percentile ?? null;
    const framing = projectionFraming();
    return {
      age: Number.isFinite(age as number) ? age : null,
      goalsBySeason: [...goalsBySeason.entries()].sort((a, b) => a[0] - b[0]).map(([season, goals]) => ({ season, goals })),
      xgPercentile: pct('xg_per_60'),
      garPercentile: pct('gar_per_60'),
      cohortNoun: advanced?.cohortNoun ?? null,
      cohortSize: advanced?.cohortSize ?? null,
      projFp: scoringReady && pointsFormat && !gameLogLoading && gameLog.some(g => !g.isPast && g.projection) ? leagueProjection.points : null,
      projGp: isGoalie ? goalieStartsRemaining : gameLog.filter(g => !g.isPast && g.projection).length || null,
      posRank: positionRank,
      projectionLabel: framing.beforeOpener ? `for ${framing.eyebrow.replace(' projection', '')}` : 'the rest of the way',
      career,
    };
  })();
  const writeup = generatePlayerWriteup(player, writeupExtras);

  const posAbbr = getPositionAbbr(player.position);
  const teamAbbr = player.teamAbbreviation || player.team?.split(' ').pop()?.substring(0, 3).toUpperCase() || '';

  // Use game log totals for the hero banner
  const futureGames = gameLog.filter(g => !g.isPast);
  const pastGames = gameLog.filter(g => g.isPast);
  const hasProjection = scoringReady && pointsFormat && !gameLogLoading && !gameLogError && futureGames.some(g => g.projection != null);
  const heroProjectedPts = leagueProjection.points;
  const cardTiles: PressBoxStatTile[] = [
    { key: 'wk', label: 'L7 PTS', value: weekPoints != null ? weekPoints.toFixed(1) : '–', tone: weekPoints != null ? 'sage' : 'plain' },
    { key: 'szn', label: 'SZN PROJ', value: hasProjection ? String(Math.round(heroProjectedPts)) : '–', onClick: hasProjection ? () => setShowProjectionBreakdown(v => !v) : undefined },
    { key: 'rank', label: 'POS RANK', value: positionRank ?? '–' },
    {
      key: 'xg',
      label: indexEntry?.gar_per_60 != null ? 'GAR / 60' : 'xG / 60',
      value:
        indexEntry?.gar_per_60 != null
          ? `${indexEntry.gar_per_60 >= 0 ? '+' : ''}${indexEntry.gar_per_60.toFixed(2)}`
          : indexEntry?.xg_per_60 != null
            ? indexEntry.xg_per_60.toFixed(2)
            : '–',
      tone: indexEntry?.gar_per_60 != null || indexEntry?.xg_per_60 != null ? 'orange' : 'plain',
    },
  ];
  const heroGameCount = futureGames.length;

  const statusConfig: Record<string, { label: string; cls: string; icon: typeof AlertCircle }> = {
    IR:   { label: 'Injury Reserve', cls: 'bg-red-500/10 text-red-400 border-red-400/40', icon: AlertCircle },
    SUSP: { label: 'Suspended', cls: 'bg-orange-500/10 text-orange-400 border-orange-400/40', icon: AlertCircle },
    GTD:  { label: 'Game Time Decision', cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-400/40', icon: Clock },
    WVR:  { label: 'Waiver', cls: 'bg-pastel-sage/15 text-pastel-sage-soft border-pastel-sage/40', icon: AlertCircle },
  };
  const statusInfo = player.status ? statusConfig[player.status] : null;

  const handleDropPlayer = async () => {
    if (!user || !leagueId || !player?.id) {
      toast({ title: "Can't Drop Player", description: "We're missing some info this drop needs. Reopen the modal and try again.", variant: "destructive" });
      return;
    }
    if (!confirm(`Are you sure you want to drop ${player.name}?`)) return;
    setIsDropping(true);
    try {
      const { success, error } = await LeagueService.dropPlayer(leagueId, user.id, String(player.id), 'Roster Tab');
      if (success) {
        toast({ title: "Player Dropped", description: `${player.name} has been dropped from your roster.` });
        // 2026-08-24: broadcast so the Roster/FA pages behind this modal
        // refetch fresh instead of showing the dropped player until reload.
        try {
          const { notifyRosterChanged } = await import('@/utils/rosterRefresh');
          notifyRosterChanged(undefined, leagueId);
        } catch { /* best-effort */ }
        onPlayerDropped?.();
        onClose();
      } else {
        toast({ title: "Drop Didn't Take", description: (error as { message?: string })?.message || "Couldn't drop the player. Try again in a moment.", variant: "destructive" });
      }
    } catch (error: unknown) {
      const message = userMessage(error, "Failed to drop player.");
      toast({ title: "Drop Didn't Take", description: message, variant: "destructive" });
    } finally {
      setIsDropping(false);
    }
  };

  // Compute shooting % safely
  const shootingPct = stats.shots && stats.goals ? ((stats.goals / stats.shots) * 100).toFixed(1) : null;
  const plusMinus = stats.plusMinus ?? 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          'max-w-lg sm:max-w-2xl p-0 overflow-hidden rounded-2xl bg-pressbox-surface border-white/[0.08] text-pressbox-text',
          /* PRESS BOX (2026-09-04): below sm the card is the SCREEN, as the
             artboard draws it — no centred modal with the team colour cut
             off at the rounded corners. Same sheet mechanics the league
             settings dialog uses; the body flexes to fill. */
          'max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-w-none max-sm:w-full max-sm:h-full max-sm:max-h-none max-sm:rounded-none max-sm:flex max-sm:flex-col max-sm:pt-[env(safe-area-inset-top)]',
        )}
      >

        {/* ═══ Hero Header ═══
            PRESS BOX (2026-09-04): artboard 1a's player card. The team's
            colour washes the top 240px and dies into the surface; the hero
            is the first and last name at 30px condensed over the owner and
            position line, the face at 84px with the club badge on its
            corner, and the vitals the directory holds. The projection
            banner keeps every word it had — `≈3 projected starts`, the
            off-season sentence — in a Press Box tile under the hero. */}
        <div className="relative px-4 pt-4 pb-3" style={pressBoxPlayerCardGround(getTeamColor(teamAbbr))}>
          {(() => {
            const words = (player.name || '').trim().split(/\s+/);
            const firstName = words.length > 1 ? words.slice(0, -1).join(' ') : words[0] ?? '';
            const lastName = words.length > 1 ? words[words.length - 1] : '';
            const ownerLine = [isOnRoster ? 'YOUR ROSTER' : null, statusInfo?.label?.toUpperCase() ?? null, player.starter ? 'STARTER' : null]
              .filter(Boolean)
              .join(' · ');
            const own = [
              player.age != null ? { label: 'AGE', value: String(player.age) } : null,
              player.height ? { label: 'HT', value: player.height } : null,
              player.weight ? { label: 'WT', value: player.weight } : null,
              player.experience ? { label: 'EXP', value: player.experience } : null,
            ].filter((v): v is { label: string; value: string } => v !== null);
            const vitals = own.length > 0 ? own : directoryVitals;
            return (
              <PressBoxPlayerCardHero
                firstName={firstName}
                lastName={lastName}
                ownerLine={ownerLine || null}
                position={posAbbr}
                jersey={player.number ? `#${player.number}` : null}
                teamAbbreviation={teamAbbr || null}
                teamColor={getTeamColor(teamAbbr)}
                headshotUrl={player.image && !headshotErr ? player.image : null}
                vitals={vitals}
                onClose={onClose}
              />
            );
          })()}

          {/* THE ACTION BAR (2026-09-05, artboard 1a · player card):
              TRADE · DROP · watch · share, under the vitals. DROP only when
              he is on the viewer's roster (the footer that carried it is
              gone); TRADE goes to the analyzer with the league. The week
              projection banner that sat here lives on as the SZN PROJ tile. */}
          <div className={cn(PB_TYPE, 'flex gap-1.5 mt-3.5 font-plex font-semibold text-[11px] tracking-[0.06em]')} data-testid="player-card-actions">
            <Link
              to={`/trade-analyzer${leagueId ? `?league=${leagueId}` : ''}`}
              onClick={onClose}
              className="focus-citrus flex-1 h-9 rounded-[9px] bg-white/[0.06] border border-white/[0.12] text-pressbox-text flex items-center justify-center gap-1.5 uppercase"
            >
              ⇄ Trade
            </Link>
            {leagueId && user && isOnRoster ? (
              <button
                type="button"
                onClick={handleDropPlayer}
                disabled={isDropping}
                className="focus-citrus flex-1 h-9 rounded-[9px] bg-pressbox-grapefruit/[0.12] border border-pressbox-grapefruit/35 text-pressbox-grapefruit-text flex items-center justify-center uppercase disabled:opacity-40"
              >
                {isDropping ? 'Dropping…' : 'Drop'}
              </button>
            ) : (
              <Link
                to={`/players/${player.id}`}
                onClick={onClose}
                className="focus-citrus flex-1 h-9 rounded-[9px] bg-white/[0.06] border border-white/[0.12] text-pressbox-text flex items-center justify-center uppercase"
              >
                Dashboard
              </Link>
            )}
            <button
              type="button"
              aria-label={watched ? 'Stop watching' : 'Watch'}
              aria-pressed={watched}
              onClick={toggleWatch}
              className={cn(
                'focus-citrus w-9 h-9 rounded-[9px] border flex items-center justify-center text-[14px]',
                watched ? 'bg-pressbox-orange/15 border-pressbox-orange/45 text-pressbox-orange-soft' : 'bg-white/[0.06] border-white/[0.12] text-pressbox-text',
              )}
            >
              ★
            </button>
            <button
              type="button"
              aria-label="Share"
              onClick={sharePlayer}
              className="focus-citrus w-9 h-9 rounded-[9px] bg-white/[0.06] border border-white/[0.12] text-pressbox-text flex items-center justify-center text-[14px]"
            >
              ▢
            </button>
          </div>
        </div>

        {/* ═══ Body ═══ */}
        {/* PRESS BOX (2026-09-04): the strip is the artboard's — orange
            underline, condensed caps — and it drives the same three panes.
            `max-h-[55vh] overflow-y-auto` stays for the modal; on the phone
            sheet the body takes what the hero and the footer leave. */}
        <div className={cn(PB_TYPE, 'px-4 pt-1 pb-4 max-h-[55vh] overflow-y-auto max-sm:max-h-none max-sm:flex-1 max-sm:min-h-0')}>
          <Tabs value={cardTab} onValueChange={(v) => setCardTab(v as CardTab)}>
            <PressBoxTabs
              className="px-0 gap-4 mb-3 border-white/10"
              label="Player card view"
              activeKey={cardTab}
              onSelect={(k) => setCardTab(k as CardTab)}
              tabs={[
                { key: 'summary', label: 'Summary' },
                { key: 'log', label: 'Game log' },
                { key: 'splits', label: 'Splits' },
                { key: 'xg', label: 'xG' },
                { key: 'news', label: citrusNotes.length + wireItems.length > 0 ? `News · ${citrusNotes.length + wireItems.length}` : 'News' },
              ]}
            />

            {/* THE FOUR TILES (artboard): this week's points, the season
                projection, the position rank, the xG rate. Each says its
                real name and shows a dash rather than a number it does not
                have. */}
            {(cardTab === 'summary' || cardTab === 'log') && <PressBoxStatTiles className="mb-3" tiles={cardTiles} />}
            {(cardTab === 'summary' || cardTab === 'log') && scoringReady && !pointsFormat && <p className="mb-3 text-xs text-pressbox-text/60">Category scoring: compare individual projected stats in Game log.</p>}
            {showProjectionBreakdown && hasProjection && (
              <section className="mt-2 rounded-xl border border-white/10 bg-pressbox-tile p-3 text-pressbox-text" aria-label="Projection breakdown">
                <div className="flex justify-between text-sm font-semibold"><span>Projected scoring breakdown</span><button type="button" onClick={() => setShowProjectionBreakdown(false)} aria-label="Close projection breakdown">Close</button></div>
                {!scoringReady ? <p className="text-sm mt-2">League scoring is unavailable. Try reopening the player.</p> : <>
                  <p className="text-xs text-pressbox-text/60 mt-1">{leagueId ? 'Using this league’s scoring settings.' : 'Using default scoring; no league selected.'}</p>
                  {!isGoalie && hasUnprojectedPlusMinus(leagueScoring) && <p className="text-xs text-pressbox-text/60 mt-1">Plus/minus isn’t projected; this total excludes it.</p>}
                  <table className="w-full text-xs mt-2"><thead><tr><th className="text-left">Stat</th><th>Projected</th><th>Weight</th><th>Points</th></tr></thead><tbody>
                    {Object.entries(leagueProjection.breakdown).filter(([, b]) => b.points !== 0).map(([stat, b]) => <tr key={stat}><td className="py-1">{stat}</td><td className="text-center">{b.count.toFixed(2)}</td><td className="text-center">{(b.points / b.count).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td className="text-right">{b.points.toFixed(1)}</td></tr>)}
                  </tbody></table>
                  <p className="text-right text-sm font-semibold mt-2">Total {leagueProjection.points.toFixed(1)} points</p>
                </>}
              </section>
            )}

            {/* ─── Overview Tab ─── */}
            <TabsContent value="summary" className="mt-0 space-y-4">
              {/* WHICH SEASON THESE NUMBERS ARE (2026-09-04).
                  
                  The Game Log carries a season picker and these two tabs do
                  not, because there is nothing yet to pick between: on
                  production today `player_season_stats` holds 1,063 rows for
                  2025 and NONE for 2026, and `player_talent_metrics` holds 940
                  for 2025 and none for 2026. A picker here would offer a
                  choice between numbers and a blank card.
                  
                  What it must not do is leave the reader guessing. A stat line
                  with no year on it is read as "this season" by default, which
                  is exactly wrong right now. So the tab says which season it
                  is, every time, and the day 2026 has rows this label is where
                  the picker goes. */}
              <div className="flex items-center justify-between gap-2 -mb-1">
                <span
                  data-testid="overview-season-label"
                  className="font-plex font-medium text-[10px] uppercase tracking-[0.1em] text-pressbox-text/45"
                >
                  {seasonLabel(getCurrentSeason())} season
                </span>
                {openerLabel && getProjectionsSeason() !== getCurrentSeason() && (
                  <span className="font-plex font-medium text-[10px] text-pressbox-text/45">
                    {seasonLabel(getProjectionsSeason())} starts {openerLabel}
                  </span>
                )}
              </div>
              {/* Scouting report — leads the tab the way ESPN/Sleeper lead
                  with a blurb. Derived from the same stat line rendered
                  directly below it (see utils/playerWriteup), so the prose and
                  the numbers can never disagree.
                  PRESS BOX (2026-09-04): the artboard's note card — eyebrow in
                  orange-soft mono, Barlow body — with Citrus's byline kept. */}
              <div className="p-3 rounded-[12px] bg-pressbox-tile border border-white/[0.08]">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <CitrusSparkle className="w-3 h-3 text-pressbox-orange-soft" aria-hidden="true" />
                    <span className="font-plex font-semibold text-[9px] uppercase tracking-[0.12em] text-pressbox-orange-soft">
                      Player Outlook
                    </span>
                  </div>
                  {/* Bylined, the way Sleeper credits Rotowire. This is our own
                      analysis, derived from our own numbers — so it says so. */}
                  <span className="font-plex font-medium text-[9px] text-pressbox-text/45 flex-shrink-0">
                    via Citrus
                  </span>
                </div>
                <div className="font-barlow font-bold text-[14px] text-pressbox-text leading-snug">
                  {writeup.headline}
                </div>
                <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-pressbox-text/70">
                  {writeup.summary}
                </p>
                {writeup.analysis && (
                  <p className="mt-2 font-barlow text-[13px] leading-[1.45] text-pressbox-text/70">
                    <span className="font-bold text-pressbox-text">Analysis: </span>
                    {writeup.analysis}
                  </p>
                )}
                {writeup.tags.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {writeup.tags.map((tag) => (
                      <span
                        key={tag.label}
                        className={cn(
                          'inline-flex items-center rounded-[4px] px-1.5 py-0.5 font-plex font-semibold text-[9px] uppercase tracking-[0.08em]',
                          WRITEUP_TAG_STYLES[tag.tone],
                        )}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Key stats grid */}
              {isGoalie ? (
                <div className="grid grid-cols-3 gap-1.5">
                  <StatCell label="W" value={stats.wins ?? 0} highlight />
                  <StatCell label="GAA" value={stats.gaa?.toFixed(2) ?? '0.00'} />
                  <StatCell label="SV%" value={stats.savePct ? `${(stats.savePct * 100).toFixed(1)}` : '0.0'} />
                  <StatCell label="SO" value={stats.shutouts ?? 0} />
                  <StatCell label="GP" value={stats.gamesPlayed ?? 0} />
                  <StatCell label="SV" value={stats.saves ?? 0} />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  <StatCell label="G" value={stats.goals ?? 0} highlight />
                  <StatCell label="A" value={stats.assists ?? 0} highlight />
                  <StatCell label="PTS" value={stats.points ?? ((stats.goals ?? 0) + (stats.assists ?? 0))} highlight />
                  <StatCell label="+/−" value={`${plusMinus > 0 ? '+' : ''}${plusMinus}`} />
                  <StatCell label="SOG" value={stats.shots ?? 0} sub={shootingPct ? `${shootingPct}% SH` : undefined} />
                  <StatCell label="GP" value={stats.gamesPlayed ?? 0} />
                </div>
              )}

              {/* Secondary stats row */}
              {!isGoalie && (
                <div className="grid grid-cols-4 gap-1.5">
                  <StatCell label="PPP" value={stats.powerPlayPoints ?? 0} />
                  <StatCell label="HIT" value={stats.hits ?? 0} />
                  <StatCell label="BLK" value={stats.blockedShots ?? 0} />
                  <StatCell label="PIM" value={stats.pim ?? 0} />
                </div>
              )}

              {/* The vitals — age, height, weight, experience — moved up into
                  the Press Box hero (2026-09-04); the bio strip that repeated
                  them here is gone. */}
            </TabsContent>

            {/* ─── Detailed Stats Tab ─── */}
            <TabsContent value="xg" className="mt-0 space-y-4">
              {/* Same reason as Overview: say the year rather than let a
                  reader assume it. See the note there. */}
              <span
                data-testid="advanced-season-label"
                className="block font-plex font-medium text-[10px] uppercase tracking-[0.1em] text-pressbox-text/45 -mb-1"
              >
                {seasonLabel(getCurrentSeason())} season
              </span>
              {/* PWS-1 ADVANCED CARD (2026-09-02) — the highest-leverage
                  single integration of the player-dashboard design system,
                  because THIS modal is the one player card the whole app
                  opens: Roster, Free Agents, Matchup, Trade Analyzer, Other
                  Team, Pool Playoff Roster, Team Intel Hub, DraftRoom and
                  DraftRoomV2 all render it (grepped 2026-09-02, ten call
                  sites). Wiring it here puts xG/60, G-xG finishing, the GAR
                  decomposition and the ROS projection on every one of them
                  from one diff.

                  It leads the DETAILED tab rather than Overview on purpose.
                  Overview already opens with the derived Citrus writeup,
                  which is a verdict-shaped block; a second verdict line
                  above it would be the "double-up" PWS-2 warns about. This
                  tab is where a manager comes for exactly these numbers,
                  and the card supersedes the two-cell "Advanced" box
                  (xGoals + SH%) that used to be the whole of it.

                  `enabled={isOpen}` so a closed modal on a guest surface
                  never even asks; and the card returns null on 401, so the
                  tab renders precisely what it rendered before. */}
              <PlayerAdvancedCard
                playerId={player.id}
                variant="expanded"
                enabled={isOpen}
                indexOverride={index.players}
              />
            </TabsContent>

            {/* ─── Splits Tab: every season number the directory holds ─── */}
            <TabsContent value="splits" className="mt-0 space-y-4">
              <span className="block font-plex font-medium text-[10px] uppercase tracking-[0.1em] text-pressbox-text/45 -mb-1">
                {seasonLabel(getCurrentSeason())} season
              </span>
              {isGoalie ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <StatCell label="SV%" value={stats.savePct ? `${(stats.savePct * 100).toFixed(3)}` : '0.000'} />
                    <StatCell label="GAA" value={stats.gaa?.toFixed(2) ?? '0.00'} />
                    <StatCell label="HD SV%" value={stats.highDangerSavePct ? `${(stats.highDangerSavePct * 100).toFixed(1)}` : '-'} />
                    <StatCell label="GSAx" value={
                      stats.goalsSavedAboveExpected
                        ? `${stats.goalsSavedAboveExpected > 0 ? '+' : ''}${stats.goalsSavedAboveExpected.toFixed(1)}`
                        : '-'
                    } highlight={!!(stats.goalsSavedAboveExpected && stats.goalsSavedAboveExpected > 0)} />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <StatCell label="W" value={stats.wins ?? 0} />
                    <StatCell label="L" value={stats.losses ?? 0} />
                    <StatCell label="OTL" value={stats.otl ?? 0} />
                    <StatCell label="SO" value={stats.shutouts ?? 0} />
                    <StatCell label="SV" value={stats.saves ?? 0} />
                    <StatCell label="GP" value={stats.gamesPlayed ?? 0} />
                  </div>
                </>
              ) : (
                <>
                  {/* Full stat grid — scrollable on narrow screens */}
                  <div className="rounded-[12px] border border-white/[0.08] overflow-x-auto">
                    <div className="grid grid-cols-4 gap-px bg-white/[0.06] min-w-[320px]">
                      {[
                        { label: 'G', value: stats.goals ?? 0 },
                        { label: 'A', value: stats.assists ?? 0 },
                        { label: 'PTS', value: stats.points ?? (stats.goals ?? 0) + (stats.assists ?? 0) },
                        { label: '+/−', value: `${plusMinus > 0 ? '+' : ''}${plusMinus}` },
                        { label: 'SOG', value: stats.shots ?? 0 },
                        { label: 'HIT', value: stats.hits ?? 0 },
                        { label: 'BLK', value: stats.blockedShots ?? 0 },
                        { label: 'PIM', value: stats.pim ?? 0 },
                        { label: 'PPP', value: stats.powerPlayPoints ?? 0 },
                        { label: 'SHP', value: stats.shortHandedPoints ?? 0 },
                        { label: 'GP', value: stats.gamesPlayed ?? 0 },
                        { label: 'TOI/G', value: stats.toi ?? '-' },
                      ].map((item, i) => (
                        <div key={i} className="bg-pressbox-tile p-2.5 flex flex-col items-center text-center">
                          <span className="font-plex font-medium text-[8px] uppercase tracking-[0.08em] text-pressbox-text/45">{item.label}</span>
                          <span className="font-plex font-semibold text-[15px] tabular-nums text-pressbox-text mt-0.5">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Advanced metrics */}
                  <div className="space-y-2">
                    <h4 className="font-condensed font-bold text-[14px] uppercase tracking-[0.08em] text-pressbox-text flex items-center gap-1.5">
                      <CitrusSparkle className="w-3.5 h-3.5 text-pressbox-orange-soft" aria-hidden="true" />
                      Advanced
                    </h4>
                    <div className="grid grid-cols-2 gap-1.5">
                      <StatCell
                        label="xGoals"
                        value={stats.xGoals?.toFixed(1) ?? '-'}
                        sub={stats.xGoals && stats.goals != null ? `${((stats.goals - stats.xGoals) > 0 ? '+' : '')}${(stats.goals - stats.xGoals).toFixed(1)} diff` : undefined}
                      />
                      <StatCell
                        label="SH%"
                        value={shootingPct ? `${shootingPct}%` : '-'}
                      />
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            {/* ─── News Tab: Citrus notes from our own shot-quality data ─── */}
            <TabsContent value="news" className="mt-0 space-y-4">
              {/* NEWS ROOM (2026-09-05): the wire stories that name him, from
                  NHL.com, ESPN and the publishers' feeds. A summary, the
                  source and the link out, the way Sleeper and Yahoo do it. */}
              {wireItems.length > 0 && (
                <div className="rounded-[12px] bg-pressbox-tile border border-white/[0.08] overflow-hidden" data-testid="card-wire-news">
                  <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-1">
                    <span className="font-plex font-semibold text-[9px] uppercase tracking-[0.12em] text-pressbox-orange-soft">From the wires</span>
                    <span className="font-plex font-medium text-[9px] text-pressbox-text/45">{wireItems.length} {wireItems.length === 1 ? 'story' : 'stories'}</span>
                  </div>
                  <div className="divide-y divide-white/[0.06]">
                    {wireItems.map((item) => (
                      <NewsItemRow key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              )}
              {/* Latest News — Citrus notes generated from our own shot-quality
                  data (citrus_news). Same slot Sleeper fills with Rotowire.
                  Renders nothing at all when there are no notes; an empty
                  "Latest News" header would imply the feed had failed. */}
              {citrusNotes.length > 0 ? (
                <div className="p-3 rounded-[12px] bg-pressbox-tile border border-white/[0.08]">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      <Newspaper className="w-3 h-3 text-pressbox-orange-soft" aria-hidden="true" />
                      <span className="font-plex font-semibold text-[9px] uppercase tracking-[0.12em] text-pressbox-orange-soft">
                        Latest News
                      </span>
                    </div>
                    <span className="font-plex font-medium text-[9px] text-pressbox-text/45 flex-shrink-0">via Citrus</span>
                  </div>
                  <div className="space-y-3">
                    {citrusNotes.map((note) => (
                      <div key={note.id}>
                        <div className="flex items-start gap-1.5">
                          <span
                            className={cn(
                              'w-1 h-1 rounded-full flex-shrink-0 mt-1.5',
                              note.severity === 'caution'
                                ? 'bg-amber-400'
                                : note.severity === 'positive'
                                  ? 'bg-pastel-sage'
                                  : 'bg-pressbox-text/70',
                            )}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <div className="font-barlow font-bold text-[14px] text-pressbox-text leading-snug">
                              {note.headline}
                            </div>
                            <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-pressbox-text/70">{note.body}</p>
                            {note.analysis && (
                              <p className="mt-1.5 font-barlow text-[13px] leading-[1.45] text-pressbox-text/70">
                                <span className="font-bold text-pressbox-text">Analysis: </span>
                                {note.analysis}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : wireItems.length === 0 ? (
                <div className="text-center py-10">
                  <Newspaper className="w-8 h-8 text-pressbox-text/45 mx-auto mb-3" aria-hidden="true" />
                  <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">Nothing on the wires yet</p>
                  <p className="font-plex font-medium text-[10px] text-pressbox-text/45 mt-1">Stories that name him land here as they are published</p>
                </div>
              ) : null}
            </TabsContent>

            {/* ─── Game Log Tab ─── */}
            <TabsContent value="log" className="mt-0 space-y-4">
              {/* SEASON PICKER. Above the loading branch on purpose: a reader
                  who lands on the wrong season must be able to leave it
                  without waiting for it to arrive. Two seasons, because two
                  is what exists - the one being projected and the one that
                  was played. */}
              <div
                role="group"
                aria-label="Season"
                className="grid grid-cols-2 gap-0.5 rounded-[8px] bg-pressbox-tile p-0.5"
              >
                {[getProjectionsSeason(), getProjectionsSeason() - 1].map((yr) => {
                  const active = logSeason === yr;
                  return (
                    <button
                      key={yr}
                      type="button"
                      data-testid={`gamelog-season-${yr}`}
                      aria-pressed={active}
                      onClick={() => setLogSeason(yr)}
                      className={cn(
                        'focus-citrus h-8 rounded-[6px] font-plex font-semibold text-[10px] tracking-[0.06em] tabular-nums transition-colors',
                        active
                          ? 'bg-pressbox-text text-pressbox-surface'
                          : 'text-pressbox-text/60 hover:text-pressbox-text',
                      )}
                    >
                      {seasonLabel(yr)}
                    </button>
                  );
                })}
              </div>

              {gameLogLoading ? (
                <div className="text-center py-10">
                  <Loader2 className="w-8 h-8 text-pressbox-sage/40 mx-auto mb-3 animate-spin" />
                  <p className="font-plex font-medium text-[10px] text-pressbox-text/45">Loading game log…</p>
                </div>
              ) : gameLogError ? (
                <div role="alert" className="text-center py-10">
                  <p className="text-sm text-pressbox-text">Couldn’t load this season’s games. Please try again.</p>
                  <button type="button" className="focus-citrus mt-3 rounded-lg px-4 py-2 bg-pressbox-orange text-pressbox-surface" onClick={() => setGameLogAttempt(attempt => attempt + 1)}>Retry game log</button>
                </div>
              ) : gameLog.length > 0 ? (
                <>
                  {/* Season summary banner. Only once it says something the
                      UPCOMING head below cannot: games played, or the goalie
                      starts note. Before the opener the head IS the summary,
                      and two lines reading `8 GAMES · 37.6 PROJ` is a stutter. */}
                  {(pastGames.length > 0 || goalieStartsRemaining !== null) && (
                  <div className="flex items-center gap-3 p-3 rounded-[12px] bg-pressbox-tile border border-white/[0.08]">
                    <CalendarDays className="w-4 h-4 text-pressbox-orange-soft flex-shrink-0" aria-hidden="true" />
                    <div>
                      <span className="font-barlow font-bold text-[14px] text-pressbox-text">
                        {gameLog.length} Game{gameLog.length !== 1 ? 's' : ''}
                      </span>
                      <span className="font-plex font-medium text-[10px] text-pressbox-text/55 ml-2">
                        {pastGames.length} played · {goalieStartsRemaining !== null
                          ? `≈${goalieStartsRemaining} projected starts of ${futureGames.length} team games`
                          : `${futureGames.length} remaining`}
                      </span>
                    </div>
                    <div className="ml-auto text-right">
                      {scoringReady && pointsFormat && scoredGameLog.some(g => g.isPast && g.actualPoints != null) && (
                        <div className="font-plex font-semibold text-[17px] tabular-nums text-pressbox-text leading-tight">{leagueActualTotal.toFixed(1)}<span className="font-plex font-medium text-[9px] text-pressbox-text/45 uppercase ml-1">actual</span></div>
                      )}
                      {hasProjection && (
                        <div className="font-plex font-semibold text-[14px] tabular-nums text-pressbox-orange-soft leading-tight">{leagueProjection.points.toFixed(1)}<span className="font-plex font-medium text-[9px] text-pressbox-text/45 uppercase ml-1">proj</span></div>
                      )}
                    </div>
                  </div>
                  )}

                  {/* PLAYED — the artboard's table, newest first, AVG footer.
                      Ten rows by default: a full season is 82, and the ten
                      most recent are what "how's he going" means. The rest
                      are one press away. */}
                  {playedLog.length > 0 && (
                    <div>
                      <PressBoxGameLog
                        showPoints={scoringReady && pointsFormat}
                        statHeadings={isGoalie ? GOALIE_LOG_HEADINGS : SKATER_LOG_HEADINGS}
                        rows={
                          showAllPlayed || playedLog.length <= PLAYED_ROWS + 1
                            ? playedLog
                            : [...playedLog.slice(0, PLAYED_ROWS), ...playedLog.slice(-1)]
                        }
                      />
                      {!showAllPlayed && playedLog.length > PLAYED_ROWS + 1 && (
                        <button
                          type="button"
                          onClick={() => setShowAllPlayed(true)}
                          className="focus-citrus mt-1.5 w-full h-8 rounded-[8px] bg-white/[0.04] border border-white/[0.08] font-plex font-semibold text-[10px] tracking-[0.08em] text-pressbox-text/60 hover:text-pressbox-text"
                        >
                          + {playedLog.length - PLAYED_ROWS - 1} MORE
                        </button>
                      )}
                    </div>
                  )}

                  {/* UPCOMING — the next three as the artboard's cards, then
                      every remaining game's projection in the same table
                      with the likely range where TOI would be. The ref lands
                      here so the auto-scroll still brings "now" into view. */}
                  {futureGames.length > 0 && (
                    <div ref={todayGameRef} className="space-y-2">
                      <PressBoxSectionHead
                        sm
                        title="Upcoming"
                        action={
                          <span className="font-plex font-medium text-[10px] tabular-nums text-pressbox-text/45 whitespace-nowrap">
                            {futureGames.length} GAME{futureGames.length === 1 ? '' : 'S'}
                            {hasProjection ? ` · ${leagueProjection.points.toFixed(1)} PROJ` : ''}
                          </span>
                        }
                      />
                      <PressBoxUpcomingCards games={upcomingCards(gameLog)} />
                      <PressBoxGameLog
                        showPoints={false}
                        showTail={false}
                        pointsHeading="PROJ"
                        tail={{ heading: 'RANGE', width: 64 }}
                        statHeadings={isGoalie ? GOALIE_PROJ_HEADINGS : SKATER_PROJ_HEADINGS}
                        rows={showAllUpcoming ? upcomingLog : upcomingLog.slice(0, UPCOMING_ROWS)}
                      />
                      {!showAllUpcoming && upcomingLog.length > UPCOMING_ROWS && (
                        <button
                          type="button"
                          onClick={() => setShowAllUpcoming(true)}
                          className="focus-citrus w-full h-8 rounded-[8px] bg-white/[0.04] border border-white/[0.08] font-plex font-semibold text-[10px] tracking-[0.08em] text-pressbox-text/60 hover:text-pressbox-text"
                        >
                          + {upcomingLog.length - UPCOMING_ROWS} MORE
                        </button>
                      )}
                    </div>
                  )}

                  {/* STORMY'S READ (artboard): the writeup's analysis, in the
                      note card, under the log. Nothing invented: absent when
                      the writeup has no analysis line. */}
                  {writeup.analysis && (
                    <PressBoxNoteCard
                      eyebrow="Stormy · read"
                      avatarSrc="/mascots/mascot-stormy.webp"
                      body={writeup.analysis}
                    />
                  )}
                </>
              ) : (
                <div className="text-center py-10">
                  <Snowflake className="w-8 h-8 text-pressbox-text/45 mx-auto mb-3" aria-hidden="true" />
                  {/* Names the season (2026-09-04). With a picker above it,
                      "No games scheduled" is ambiguous: the reader cannot tell
                      whether the schedule is missing or they are simply
                      looking at a season this player did not play. */}
                  <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">
                    No games in {seasonLabel(logSeason)}
                  </p>
                  <p className="font-plex font-medium text-[10px] text-pressbox-text/45 mt-1">
                    Try the other season, or check back when the schedule lands
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* ═══ Footer Actions ═══ */}
        {action && (
          <div className={cn(PB_TYPE, 'px-4 py-3 border-t border-white/[0.08] bg-pressbox-surface pb-[max(0.75rem,env(safe-area-inset-bottom))]')}>
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled || action.pending}
              className="focus-citrus w-full h-[44px] rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold text-[14px] uppercase tracking-[0.1em] disabled:opacity-40"
            >
              {action.pending ? (action.pendingLabel ?? 'Working…') : action.label}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PlayerStatsModal;
