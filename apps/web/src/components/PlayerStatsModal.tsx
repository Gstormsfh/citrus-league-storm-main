import { userMessage } from '@/lib/userMessage';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Star, AlertCircle, Clock, Trash2, Flame, Snowflake, CalendarDays, Loader2, CheckCircle2, Newspaper } from 'lucide-react';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { cn } from '@/lib/utils';
import { LeagueService } from '@/services/LeagueService';
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
import { generatePlayerWriteup, WriteupTone } from '@/utils/playerWriteup';
import { getCurrentSeason, getUpcomingSeasonStartDate, getProjectionsSeason, getSeasonStartDate } from '@citrus/shared';
import { useCitrusPlayerNotes } from '@/hooks/useCitrusPlayerNotes';
import { PlayerAdvancedCard } from '@/components/player/PlayerAdvancedCard';
import { PressBoxPlayerCardHero, pressBoxPlayerCardGround } from '@/components/pressbox/PlayerCard';
import { PressBoxTabs } from '@/components/pressbox/Tabs';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { getTeamColor } from '@/utils/teamColors';

/* 2026-08-19 visual audit — muted-text correction.
   text-citrus-charcoal is #5C5C5C, a soft charcoal designed for the
   original CREAM theme. At 20-70% opacity on the dark #1A2A20 tiles it
   composites to near-invisible (team codes on this page measured
   1.47:1). Remapped to cream at the alpha that preserves the intended
   hierarchy while clearing 4.5:1 on a dark tile. */


// ─── Types for game log entries ──────────────────────────────────────
interface GameLogEntry {
  date: string; // YYYY-MM-DD
  dayLabel: string; // e.g. "Sun", "Mon"
  dateLabel: string; // e.g. "Feb 15"
  opponent: string; // e.g. "vs BOS" or "@ NYR"
  gameTime?: string;
  projectedPoints: number;
  projection: Record<string, unknown> | null; // Full projection object (skater or goalie)
  isGoalie: boolean;
  isPast: boolean;
  isToday: boolean;
  computedConfidence: number; // 0.0-1.0, computed fresh on the frontend
  // Actual stats for played games
  actualPoints?: number;
  actualStats?: Record<string, unknown>;
}

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
  positive: 'bg-pastel-sage/20 text-pastel-cream ring-pastel-sage/40',
  neutral: 'bg-white/5 text-white/70 ring-white/15',
  caution: 'bg-amber-500/15 text-amber-200 ring-amber-500/30',
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
const StatCell = ({ label, value, highlight, sub }: { label: string; value: string | number; highlight?: boolean; sub?: string }) => (
  <div className="flex flex-col items-center p-3 bg-white/5 rounded-xl border border-citrus-sage/20">
    <span className="text-[10px] font-display font-semibold text-pastel-cream/65 uppercase tracking-wider mb-1">{label}</span>
    <span className={cn(
      "text-xl font-varsity font-black leading-none",
      highlight ? "text-citrus-orange" : "text-pastel-cream"
    )}>
      {value}
    </span>
    {sub && <span className="text-[9px] text-pastel-cream/60 font-display mt-0.5">{sub}</span>}
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

const PlayerStatsModal = ({ player, isOpen, onClose, leagueId, isOnRoster = false, onPlayerDropped, action }: PlayerStatsModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isDropping, setIsDropping] = useState(false);
  // Headshot-first avatar (2026-08-18): try the player's real NHL
  // headshot, fall back to team logo, then jersey number. Mirrors
  // HockeyPlayerCard's chain so every card surface agrees.
  const [headshotErr, setHeadshotErr] = useState(false);
  /** PRESS BOX (2026-09-04): the card's tab, driven by the Press Box strip. */
  const [cardTab, setCardTab] = useState<'stats' | 'advanced' | 'gamelog'>('stats');

  // Game log state (all 82 games: actuals for played + projections for future)
  const [gameLog, setGameLog] = useState<GameLogEntry[]>([]);
  const [gameLogLoading, setGameLogLoading] = useState(false);
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

  // Fetch full season game log when modal opens (actuals for played games + projections for future)
  useEffect(() => {
    if (!isOpen || !player) {
      if (!isOpen) {
        setGameLog([]);
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

    const playerKey = `${player.id}-${player.team}-${logSeason}`;
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
    setTotalProjected(0);
    setTotalActual(0);
    setGoalieStartsRemaining(null);
    setGameLogLoading(true);

    // A player change mid-flight must not let the OLD response win. Same
    // guard usePlayerXgHistory carries, for the same reason.
    let cancelled = false;

    const fetchGameLog = async () => {
      const teamAbbrev = player.teamAbbreviation || player.team || '';
      if (!teamAbbrev) {
        setGameLogLoading(false);
        return;
      }

      try {
        const todayStr = getTodayMST();
        const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
        const playerIsGoalie = player.position === 'Goalie' || player.position === 'G';

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
        const { games } = await ScheduleService.getGamesForTeam(teamAbbrev, windowStart, windowEnd);

        if (!games || games.length === 0) {
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
        const seasonStartStr = games[0].game_date.split('T')[0];
        const seasonEndStr = games[games.length - 1].game_date.split('T')[0];

        const actualStatsMap = new Map<string, any>();
        const projectionMap = new Map<string, any>();

        try {
          const response = await matchupApi.getPlayerGameLog(playerId, seasonStartStr, seasonEndStr);
          const payload = (response?.data ?? {}) as {
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
        } catch (err) {
          logger.warn('[PlayerStatsModal] Could not fetch the game log:', err);
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
            setGoalieStartsRemaining(
              Number.isFinite(rosGames) && rosGames > 0 ? Math.round(rosGames) : null,
            );
          } catch {
            // ROS row unavailable — keep the summed value rather than
            // showing nothing; the label falls back to team games.
            setGoalieStartsRemaining(null);
          }
        } else {
          setGoalieStartsRemaining(null);
        }

        if (cancelled) return;
        setGameLog(entries);
        setTotalProjected(goalieAwareTotal);
        setTotalActual(actTotal);
      } catch (error) {
        logger.error('[PlayerStatsModal] Error fetching game log:', error);
      } finally {
        if (!cancelled) setGameLogLoading(false);
      }
    };

    fetchGameLog();

    return () => {
      cancelled = true;
    };
  }, [isOpen, player, logSeason]);

  // MUST sit above the `if (!player) return null` below — a hook called after
  // an early return runs conditionally, which breaks the Rules of Hooks and
  // desyncs every hook after it the moment `player` goes null on close.
  const { notes: citrusNotes } = useCitrusPlayerNotes(player?.id, isOpen);

  if (!player) return null;

  const isGoalie = player.position === 'Goalie' || player.position === 'G';
  const stats = player.stats || {};
  // Pure function of `player` — cheap enough to run inline, and deliberately
  // not memoised on a value that changes identity every render anyway.
  const writeup = generatePlayerWriteup(player);
  const posAbbr = getPositionAbbr(player.position);
  const teamAbbr = player.teamAbbreviation || player.team?.split(' ').pop()?.substring(0, 3).toUpperCase() || '';

  // Use game log totals for the hero banner
  const dailyProj = isGoalie ? player.goalieProjection : player.daily_projection;
  const futureGames = gameLog.filter(g => !g.isPast);
  const pastGames = gameLog.filter(g => g.isPast);
  const hasGame = gameLog.length > 0 || dailyProj != null;
  const heroProjectedPts = futureGames.length > 0 ? totalProjected : (dailyProj?.total_projected_points || 0);
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
            const vitals = [
              player.age != null ? { label: 'AGE', value: String(player.age) } : null,
              player.height ? { label: 'HT', value: player.height } : null,
              player.weight ? { label: 'WT', value: player.weight } : null,
              player.experience ? { label: 'EXP', value: player.experience } : null,
            ].filter((v): v is { label: string; value: string } => v !== null);
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

          {/* Week Projection Banner */}
          <div className={cn(PB_TYPE, 'mt-3 flex items-center justify-between gap-3 rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-3 py-2')}>
            <div className="flex items-center gap-2 min-w-0">
              {hasGame ? (
                <>
                  <CalendarDays className="w-4 h-4 flex-none text-pressbox-orange-soft" aria-hidden="true" />
                  <span className="font-plex font-medium text-[11px] text-pressbox-text/70 truncate">
                    {heroGameCount > 0
                      ? goalieStartsRemaining !== null
                        ? `≈${goalieStartsRemaining} projected starts`
                        : `${heroGameCount} upcoming game${heroGameCount !== 1 ? 's' : ''}`
                      : (player.nextGame?.opponent || 'Today')}
                  </span>
                </>
              ) : (
                <>
                  <Snowflake className="w-4 h-4 flex-none text-pressbox-text/45" aria-hidden="true" />
                  {/* 2026-08-24 polish: during the off-season EVERY card
                      hit this branch and read like a data failure
                      ("No upcoming games · PROJ —", spotted in trade QA).
                      Jul–Sep is the NHL off-season — say so instead. */}
                  <span className="font-plex font-medium text-[11px] text-pressbox-text/55 truncate">
                    {(() => {
                      // Was hard-coded to "return in October", which is wrong
                      // for 2026-27: that season opens Sept 29. Read the real
                      // opener instead of naming a month.
                      const opener = getUpcomingSeasonStartDate();
                      if (!opener) return 'No upcoming games';
                      const label = new Date(`${opener}T00:00:00`).toLocaleDateString(undefined, {
                        month: 'long',
                        day: 'numeric',
                      });
                      return `Off-season. Games return ${label}`;
                    })()}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-baseline gap-1.5 flex-none">
              <span className="font-plex font-semibold text-[9px] uppercase tracking-[0.1em] text-pressbox-text/45">
                {heroGameCount > 0 ? 'Total proj' : 'Proj'}
              </span>
              <span className={cn(
                'font-plex font-semibold text-[17px] tabular-nums',
                hasGame ? 'text-pressbox-orange-soft' : 'text-pressbox-text/55',
              )}>
                {hasGame ? heroProjectedPts.toFixed(1) : '–'}
              </span>
            </div>
          </div>
        </div>

        {/* ═══ Body ═══ */}
        {/* PRESS BOX (2026-09-04): the strip is the artboard's — orange
            underline, condensed caps — and it drives the same three panes.
            `max-h-[55vh] overflow-y-auto` stays for the modal; on the phone
            sheet the body takes what the hero and the footer leave. */}
        <div className={cn(PB_TYPE, 'px-4 pt-1 pb-4 max-h-[55vh] overflow-y-auto max-sm:max-h-none max-sm:flex-1 max-sm:min-h-0')}>
          <Tabs value={cardTab} onValueChange={(v) => setCardTab(v as 'stats' | 'advanced' | 'gamelog')}>
            <PressBoxTabs
              className="px-0 gap-4 mb-4 border-white/10"
              label="Player card view"
              activeKey={cardTab}
              onSelect={(k) => setCardTab(k as 'stats' | 'advanced' | 'gamelog')}
              tabs={[
                { key: 'stats', label: 'Overview' },
                { key: 'advanced', label: 'Detailed' },
                { key: 'gamelog', label: 'Game log' },
              ]}
            />

            {/* ─── Overview Tab ─── */}
            <TabsContent value="stats" className="mt-0 space-y-4">
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
                  className="font-jbmono text-[10px] uppercase tracking-[0.16em] text-pastel-cream/60"
                >
                  {seasonLabel(getCurrentSeason())} season
                </span>
                {openerLabel && getProjectionsSeason() !== getCurrentSeason() && (
                  <span className="font-display text-[10px] text-pastel-cream/60">
                    {seasonLabel(getProjectionsSeason())} starts {openerLabel}
                  </span>
                )}
              </div>
              {/* Scouting report — leads the tab the way ESPN/Sleeper lead
                  with a blurb. Derived from the same stat line rendered
                  directly below it (see utils/playerWriteup), so the prose and
                  the numbers can never disagree. */}
              <div className="py-3 px-3.5 bg-white/5 rounded-xl border border-citrus-sage/15">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <CitrusSparkle className="w-3 h-3 text-citrus-orange" aria-hidden="true" />
                    <span className="text-[9px] font-display uppercase tracking-[0.18em] text-pastel-cream/60">
                      Player Outlook
                    </span>
                  </div>
                  {/* Bylined, the way Sleeper credits Rotowire. This is our own
                      analysis, derived from our own numbers — so it says so. */}
                  <span className="text-[9px] font-display text-white/55 flex-shrink-0">
                    via Citrus
                  </span>
                </div>
                <div className="text-sm font-display font-bold text-pastel-cream leading-snug">
                  {writeup.headline}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-white/70">
                  {writeup.summary}
                </p>
                {writeup.analysis && (
                  <p className="mt-2 text-[13px] leading-relaxed text-white/70">
                    <span className="font-display font-bold text-pastel-cream">Analysis: </span>
                    {writeup.analysis}
                  </p>
                )}
                {writeup.tags.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {writeup.tags.map((tag) => (
                      <span
                        key={tag.label}
                        className={cn(
                          'inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-jbmono uppercase tracking-wider font-bold ring-1',
                          WRITEUP_TAG_STYLES[tag.tone],
                        )}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Latest News — Citrus notes generated from our own shot-quality
                  data (citrus_news). Same slot Sleeper fills with Rotowire.
                  Renders nothing at all when there are no notes; an empty
                  "Latest News" header would imply the feed had failed. */}
              {citrusNotes.length > 0 && (
                <div className="py-3 px-3.5 bg-white/5 rounded-xl border border-citrus-sage/15">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      <Newspaper className="w-3 h-3 text-citrus-orange" aria-hidden="true" />
                      <span className="text-[9px] font-display uppercase tracking-[0.18em] text-pastel-cream/60">
                        Latest News
                      </span>
                    </div>
                    <span className="text-[9px] font-display text-white/55 flex-shrink-0">via Citrus</span>
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
                                  : 'bg-pastel-cream/70',
                            )}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-display font-bold text-pastel-cream leading-snug">
                              {note.headline}
                            </div>
                            <p className="mt-1 text-[13px] leading-relaxed text-white/70">{note.body}</p>
                            {note.analysis && (
                              <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">
                                <span className="font-display font-bold text-pastel-cream">Analysis: </span>
                                {note.analysis}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Key stats grid */}
              {isGoalie ? (
                <div className="grid grid-cols-3 gap-2">
                  <StatCell label="W" value={stats.wins ?? 0} highlight />
                  <StatCell label="GAA" value={stats.gaa?.toFixed(2) ?? '0.00'} />
                  <StatCell label="SV%" value={stats.savePct ? `${(stats.savePct * 100).toFixed(1)}` : '0.0'} />
                  <StatCell label="SO" value={stats.shutouts ?? 0} />
                  <StatCell label="GP" value={stats.gamesPlayed ?? 0} />
                  <StatCell label="SV" value={stats.saves ?? 0} />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
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
                <div className="grid grid-cols-4 gap-2">
                  <StatCell label="PPP" value={stats.powerPlayPoints ?? 0} />
                  <StatCell label="HIT" value={stats.hits ?? 0} />
                  <StatCell label="BLK" value={stats.blockedShots ?? 0} />
                  <StatCell label="PIM" value={stats.pim ?? 0} />
                </div>
              )}

              {/* Bio quick view */}
              {(player.age || player.height || player.weight) && (
                <div className="flex items-center gap-4 py-2.5 px-3 bg-white/5 rounded-xl border border-citrus-sage/15 text-sm">
                  {player.age && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-pastel-cream/60 text-xs font-display">Age</span>
                      <span className="font-display font-bold text-pastel-cream">{player.age}</span>
                    </div>
                  )}
                  {player.height && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-pastel-cream/60 text-xs font-display">Ht</span>
                      <span className="font-display font-bold text-pastel-cream">{player.height}</span>
                    </div>
                  )}
                  {player.weight && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-pastel-cream/60 text-xs font-display">Wt</span>
                      <span className="font-display font-bold text-pastel-cream">{player.weight}</span>
                    </div>
                  )}
                  {player.experience && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-pastel-cream/60 text-xs font-display">Exp</span>
                      <span className="font-display font-bold text-pastel-cream">{player.experience}</span>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ─── Detailed Stats Tab ─── */}
            <TabsContent value="advanced" className="mt-0 space-y-4">
              {/* Same reason as Overview: say the year rather than let a
                  reader assume it. See the note there. */}
              <span
                data-testid="advanced-season-label"
                className="block font-jbmono text-[10px] uppercase tracking-[0.16em] text-pastel-cream/60 -mb-1"
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
              />

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
                  <div className="grid grid-cols-3 gap-2">
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
                  <div className="rounded-xl border border-citrus-sage/20 overflow-x-auto">
                    <div className="grid grid-cols-4 gap-px bg-citrus-sage/15 min-w-[320px]">
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
                        <div key={i} className="bg-card p-2.5 flex flex-col items-center text-center">
                          <span className="text-[9px] font-display font-semibold text-pastel-cream/60 uppercase tracking-wider">{item.label}</span>
                          <span className="text-base font-varsity font-black text-pastel-cream mt-0.5">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Advanced metrics */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-display font-bold text-pastel-cream/65 uppercase tracking-wider flex items-center gap-1.5">
                      <CitrusSparkle className="w-3.5 h-3.5 text-citrus-orange" />
                      Advanced
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
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

            {/* ─── Game Log Tab ─── */}
            <TabsContent value="gamelog" className="mt-0 space-y-4">
              {/* SEASON PICKER. Above the loading branch on purpose: a reader
                  who lands on the wrong season must be able to leave it
                  without waiting for it to arrive. Two seasons, because two
                  is what exists - the one being projected and the one that
                  was played. */}
              <div
                role="group"
                aria-label="Season"
                className="grid grid-cols-2 gap-0.5 rounded-lg bg-white/5 p-0.5"
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
                        'h-9 rounded-md font-display text-[12px] font-bold tabular-nums transition-colors',
                        active
                          ? 'bg-citrus-sage text-white'
                          : 'text-pastel-cream/60 hover:text-pastel-cream',
                      )}
                    >
                      {seasonLabel(yr)}
                    </button>
                  );
                })}
              </div>

              {gameLogLoading ? (
                <div className="text-center py-10">
                  <Loader2 className="w-8 h-8 text-citrus-sage/40 mx-auto mb-3 animate-spin" />
                  <p className="text-sm font-display text-pastel-cream/60">Loading game log…</p>
                </div>
              ) : gameLog.length > 0 ? (
                <>
                  {/* Season summary banner */}
                  <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-citrus-sage/10 to-citrus-peach/10 rounded-xl border border-citrus-sage/20">
                    <CalendarDays className="w-5 h-5 text-citrus-orange flex-shrink-0" />
                    <div>
                      <span className="text-sm font-display font-bold text-pastel-cream">
                        {gameLog.length} Game{gameLog.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-pastel-cream/65 ml-2">
                        {pastGames.length} played · {goalieStartsRemaining !== null
                          ? `≈${goalieStartsRemaining} projected starts of ${futureGames.length} team games`
                          : `${futureGames.length} remaining`}
                      </span>
                    </div>
                    <div className="ml-auto text-right">
                      {totalActual > 0 && (
                        <div className="text-lg font-varsity font-black text-pastel-cream leading-tight">{totalActual.toFixed(1)}<span className="text-[9px] text-pastel-cream/60 font-display uppercase ml-1">actual</span></div>
                      )}
                      {futureGames.length > 0 && (
                        <div className="text-sm font-varsity font-black text-citrus-orange leading-tight">{totalProjected.toFixed(1)}<span className="text-[9px] text-pastel-cream/60 font-display uppercase ml-1">proj</span></div>
                      )}
                    </div>
                  </div>

                  {/* Game-by-game log — chronological order, auto-scroll to today */}
                  <div className="space-y-2">
                    {(() => {
                      const hasToday = gameLog.some(g => g.isToday);
                      let scrollTargetSet = false;
                      return gameLog.map((gp) => {
                      const hasActuals = gp.isPast && gp.actualStats != null;
                      const displayPoints = hasActuals ? (gp.actualPoints ?? 0) : gp.projectedPoints;
                      const as = gp.actualStats || {};
                      // Scroll target: today's game, or first non-past game if no today game
                      const isScrollTarget = gp.isToday || (!hasToday && !gp.isPast && !scrollTargetSet);
                      if (isScrollTarget && !gp.isPast) scrollTargetSet = true;

                      return (
                      <div
                        key={gp.date}
                        ref={isScrollTarget ? todayGameRef : undefined}
                        className={cn(
                          "rounded-xl border overflow-hidden transition-all",
                          gp.isToday ? "border-citrus-orange bg-citrus-peach/5"
                            : hasActuals ? "border-citrus-sage/20 bg-card"
                            : gp.isPast ? "border-citrus-sage/15 bg-white/[0.03] opacity-50"
                            : "border-citrus-sage/20 bg-white/5"
                        )}
                      >
                        {/* Game header row */}
                        <div className="flex items-center gap-3 px-3 py-2">
                          <div className="flex flex-col items-center min-w-[40px]">
                            <span className={cn(
                              "text-[10px] font-varsity font-black uppercase tracking-wider",
                              gp.isToday ? "text-citrus-orange" : "text-pastel-cream/65"
                            )}>
                              {gp.dayLabel}
                            </span>
                            <span className="text-xs font-display font-bold text-pastel-cream">{gp.dateLabel}</span>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              {hasActuals ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-citrus-sage" />
                              ) : (
                                <Flame className={cn("w-3.5 h-3.5", gp.isToday ? "text-citrus-orange" : "text-citrus-sage/50")} />
                              )}
                              <span className="text-sm font-display font-bold text-pastel-cream">{gp.opponent}</span>
                              {!hasActuals && gp.gameTime && <span className="text-[10px] text-pastel-cream/60 font-display">{gp.gameTime}</span>}
                            </div>
                            {gp.isToday && (
                              <Badge className="mt-0.5 bg-citrus-orange/90 text-white border-0 text-[10px] font-varsity font-black tracking-wider h-4 px-1.5">
                                TODAY
                              </Badge>
                            )}
                          </div>
                          <div className="text-right">
                            <div className={cn(
                              "text-xl font-varsity font-black",
                              hasActuals ? "text-pastel-cream" : (displayPoints > 0 ? "text-citrus-orange" : "text-pastel-cream/60")
                            )}>
                              {hasActuals ? displayPoints.toFixed(1) : (displayPoints > 0 ? displayPoints.toFixed(1) : (gp.isPast ? 'DNP' : '-'))}
                            </div>
                            <div className="text-[10px] text-pastel-cream/60 font-display uppercase">
                              {hasActuals ? 'pts' : (gp.isPast ? '' : 'proj')}
                            </div>
                          </div>
                        </div>

                        {/* Stat breakdown row — horizontally scrollable on mobile */}
                        {hasActuals ? (
                          /* ACTUAL STATS for played games */
                          <div className="px-3 pb-2 pt-0 overflow-x-auto">
                            {gp.isGoalie ? (
                              <div className="grid grid-cols-6 gap-1 min-w-[320px]">
                                {[
                                  { label: 'W', value: Number(as.wins || 0) },
                                  { label: 'SV', value: Number(as.saves || 0) },
                                  { label: 'SO', value: Number(as.shutouts || 0) },
                                  { label: 'GA', value: Number(as.goals_against || 0) },
                                  { label: 'GAA', value: as.gaa != null ? Number(as.gaa).toFixed(2) : '-' },
                                  { label: 'SV%', value: as.save_pct != null ? `${(Number(as.save_pct) * 100).toFixed(1)}` : '-' },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-citrus-sage/10 rounded border border-citrus-sage/15">
                                    <span className="text-[9px] font-display font-semibold text-pastel-cream/60 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-pastel-cream">{s.value}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="grid grid-cols-8 gap-1 min-w-[380px]">
                                {[
                                  { label: 'G', value: Number(as.goals || 0) },
                                  { label: 'A', value: Number(as.assists || 0) },
                                  { label: 'SOG', value: Number(as.shots_on_goal || 0) },
                                  { label: 'BLK', value: Number(as.blocks || 0) },
                                  { label: 'PPP', value: Number(as.ppp || 0) },
                                  { label: 'SHP', value: Number(as.shp || 0) },
                                  { label: 'HIT', value: Number(as.hits || 0) },
                                  { label: 'PIM', value: Number(as.pim || 0) },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-citrus-sage/10 rounded border border-citrus-sage/15">
                                    <span className="text-[9px] font-display font-semibold text-pastel-cream/60 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-pastel-cream">{s.value}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : gp.projection && gp.projectedPoints > 0 ? (
                          /* PROJECTED STATS for future games */
                          <div className="px-3 pb-2 pt-0 overflow-x-auto">
                            {gp.isGoalie ? (
                              <div className="grid grid-cols-6 gap-1 min-w-[320px]">
                                {[
                                  { label: 'W', value: (gp.projection.projected_wins as number | undefined)?.toFixed(2) },
                                  { label: 'SV', value: (gp.projection.projected_saves as number | undefined)?.toFixed(0) },
                                  { label: 'SO', value: (gp.projection.projected_shutouts as number | undefined)?.toFixed(2) },
                                  { label: 'GA', value: (gp.projection.projected_goals_against as number | undefined)?.toFixed(2) },
                                  { label: 'GAA', value: (gp.projection.projected_gaa as number | undefined)?.toFixed(2) },
                                  { label: 'SV%', value: gp.projection.projected_save_pct ? `${(Number(gp.projection.projected_save_pct) * 100).toFixed(1)}` : '-' },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-white/5 rounded border border-citrus-sage/10">
                                    <span className="text-[9px] font-display font-semibold text-pastel-cream/60 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-pastel-cream">{s.value ?? '-'}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="grid grid-cols-8 gap-1 min-w-[380px]">
                                {[
                                  { label: 'G', value: (gp.projection.projected_goals as number | undefined)?.toFixed(2) },
                                  { label: 'A', value: (gp.projection.projected_assists as number | undefined)?.toFixed(2) },
                                  { label: 'SOG', value: (gp.projection.projected_sog as number | undefined)?.toFixed(1) },
                                  { label: 'BLK', value: (gp.projection.projected_blocks as number | undefined)?.toFixed(1) },
                                  { label: 'PPP', value: (gp.projection.projected_ppp as number | undefined)?.toFixed(2) },
                                  { label: 'SHP', value: (gp.projection.projected_shp as number | undefined)?.toFixed(2) },
                                  { label: 'HIT', value: (gp.projection.projected_hits as number | undefined)?.toFixed(1) },
                                  { label: 'PIM', value: (gp.projection.projected_pim as number | undefined)?.toFixed(1) },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-white/5 rounded border border-citrus-sage/10">
                                    <span className="text-[9px] font-display font-semibold text-pastel-cream/60 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-pastel-cream">{s.value ?? '-'}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Likely Range + Confidence for future games */}
                            {gp.projection?.likely_low != null && gp.projection?.likely_high != null && (
                              <div className="flex items-center justify-between mt-1.5 px-1">
                                <span className="text-[10px] font-display text-pastel-cream/60">Likely Range</span>
                                <span className="text-[9px] font-varsity font-black text-pastel-cream">
                                  {Number(gp.projection.likely_low).toFixed(1)} – {Number(gp.projection.likely_high).toFixed(1)} pts
                                </span>
                              </div>
                            )}
                            {gp.computedConfidence > 0 && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] font-display text-pastel-cream/60">Confidence</span>
                                <div className="flex-1 h-1.5 bg-citrus-sage/10 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-citrus-sage to-citrus-orange rounded-full"
                                    style={{ width: `${Math.min(gp.computedConfidence * 100, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[9px] font-varsity font-black text-pastel-cream">
                                  {Math.round(gp.computedConfidence * 100)}%
                                </span>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );});
                    })()}
                  </div>
                </>
              ) : (
                <div className="text-center py-10">
                  <Snowflake className="w-10 h-10 text-pastel-cream/60 mx-auto mb-3" />
                  {/* Names the season (2026-09-04). With a picker above it,
                      "No games scheduled" is ambiguous: the reader cannot tell
                      whether the schedule is missing or they are simply
                      looking at a season this player did not play. */}
                  <p className="text-sm font-display text-pastel-cream/60">
                    No games in {seasonLabel(logSeason)}
                  </p>
                  <p className="text-xs font-display text-pastel-cream/60 mt-1">
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
        {leagueId && user && isOnRoster && (
          <div className={cn(PB_TYPE, 'px-4 py-3 border-t border-white/[0.08] bg-pressbox-surface pb-[max(0.75rem,env(safe-area-inset-bottom))]')}>
            <button
              type="button"
              onClick={handleDropPlayer}
              disabled={isDropping}
              className="focus-citrus w-full h-[38px] rounded-[9px] bg-pressbox-grapefruit/[0.12] border border-pressbox-grapefruit/35 text-pressbox-grapefruit-text font-plex font-semibold text-[11px] tracking-[0.06em] uppercase flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {isDropping ? 'Dropping…' : 'Drop player'}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PlayerStatsModal;
