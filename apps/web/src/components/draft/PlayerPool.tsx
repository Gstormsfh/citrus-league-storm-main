import { useState, useMemo, useRef, useEffect, memo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Star, Eye, EyeOff, ArrowUpDown, ArrowUp, ArrowDown, Clock, Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Player } from '@/services/PlayerService';
import { ScoringCalculator, ScoringSettings } from '@citrus/shared';
import { DraftPoolRow } from './DraftPoolRow';
import { poolHeadlineFor } from './draftPoolHeadline';
import { draftPoolSeasonLine, positionRanks } from './draftPoolLine';
import { draftNeedLine } from './draftNeed';
// Direct file imports, not the `@/components/pressbox` barrel: the barrel
// re-exports LeagueHeader, which reaches LeagueContext and the Supabase
// client at module scope. The pool is a draft-room surface with its own
// transport and must not pull the league shell in behind it.
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxChips } from '@/components/pressbox/Chips';
import { PB_SORT_TRIGGER, PressBoxDraftSearchRow } from '@/components/pressbox/DraftSearchRow';
import { Mug } from '@/components/roster/Mug';
import { mugFromDirectory } from '@/components/roster/headshot';
import type { DraftProjection, QualitySignal } from './draftDecision';

interface PlayerPoolProps {
  onPlayerSelect: (player: Player) => void;
  onPlayerDraft: (player: Player) => void;
  selectedPlayer: Player | null;
  draftedPlayers: string[];
  isDraftActive: boolean;
  availablePlayers: Player[];
  /**
   * 2026-08-18 launch audit: when the player DIRECTORY itself failed to
   * load, this pool rendered "No players found. Try adjusting your
   * filters." — telling a user to fix filters when in fact nothing had
   * loaded and they could not draft at all. Pass the load error so the
   * empty state can tell the truth.
   */
  loadError?: Error | null;
  onRetryLoad?: () => void;
  onAddToQueue?: (playerId: string) => void;
  /**
   * V2-PARITY (2026-08-17): when provided, every row gets an info
   * button that opens the player card (the shared PlayerStatsModal in
   * the v2 room). Optional so existing v1 callers are untouched.
   */
  onShowCard?: (player: Player) => void;
  onToggleWatchlist?: (playerId: string) => void;
  queue?: string[];
  watchlist?: Set<string>;
  /** Pre-built Set for O(1) drafted lookups (optional, built from draftedPlayers if not provided) */
  draftedPlayerSet?: Set<string>;
  /** League scoring settings for calculating fantasy points */
  scoringSettings?: ScoringSettings | null;
  /** Pre-computed projected FPTS from ROS projections */
  projectedFptsMap?: Map<string, DraftProjection>;
  /**
   * DECISION SUPPORT (2026-09-02) — one cohort-relative advanced read per
   * player, keyed by player id. Built once per pool by the room from
   * `/api/players/dashboard-index` (see `draftDecision.qualitySignalFor`).
   *
   * Optional and empty-by-default on purpose: the endpoint 401s for guests
   * and demo visitors, and a pool with no signals must render exactly what
   * it rendered before signals existed.
   */
  qualitySignals?: ReadonlyMap<string, QualitySignal>;
  /**
   * DR-3.1 (2026-07-29) — F8 fix: when the caller is on the clock,
   * EVERY available row shows an always-visible inline Draft button
   * (industry pattern: Yahoo/ESPN). One click from "I want him" to
   * submitted, no select-then-locate-elsewhere step. Off-clock users
   * see the original select-first behavior.
   */
  isYourTurn?: boolean;
  /**
   * STORMY'S NEED LINE (2026-09-05, artboard 4a): the league's slots per
   * position, the positions you have drafted, and the picks before your
   * next turn. See draftNeed.ts. Absent draws no line.
   */
  need?: { caps: Record<string, number> | null; myPositions: string[]; picksAway: number | null } | null;
  /**
   * DR-4 (2026-07-30) — F11 fix (layer 1 GUARD): while the caller has
   * a pending pick in-flight for their team, every Draft button in
   * the pool disables + shows "Submitting…". Prevents the
   * double-submit that surfaces the pick_out_of_order → clock-expired
   * copy mismatch (see DraftRoomV2.tsx:handleDraftFromPool for the
   * layer 2 DISAMBIGUATE that catches any race that slips this guard).
   */
  isSubmitPending?: boolean;
  /**
   * THE ROW'S VERB (2026-09-05). `Draft` for snake and linear; `Nominate`
   * in an auction room, where a "Draft" button that answers "it's not your
   * turn" was the wrong control on every row. `isYourTurn` is then "my
   * nomination" and `onPlayerDraft` nominates.
   */
  actionVerb?: 'Draft' | 'Nominate';
}

/** How long an armed row waits for its second tap before standing down. */
export const POOL_ARM_TTL_MS = 6000;

/**
 * One shared empty map so a caller that passes no signals does not hand the
 * memo a fresh identity on every render — the same reason the harness stubs
 * keep their context values at module scope.
 */
const EMPTY_SIGNALS: ReadonlyMap<string, QualitySignal> = new Map();

/**
 * Likewise for the projections. This default used to be an inline
 * `new Map()`, which was harmless while nothing depended on its identity;
 * `rankMap` now does, so an inline default would rebuild the ranking of
 * every available player on every render for the v1 room, which passes no
 * map at all.
 */
const EMPTY_PROJECTIONS: Map<string, DraftProjection> = new Map();

// Normalize position (L -> LW, R -> RW)
const normalizePosition = (pos: string): string => {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  return upper;
};

export const PlayerPool = memo(({
  onPlayerSelect,
  onPlayerDraft,
  selectedPlayer,
  draftedPlayers,
  isDraftActive,
  availablePlayers,
  loadError,
  onRetryLoad,
  onAddToQueue,
  onShowCard,
  onToggleWatchlist,
  queue = [],
  watchlist = new Set(),
  draftedPlayerSet: externalDraftedSet,
  scoringSettings,
  projectedFptsMap = EMPTY_PROJECTIONS,
  qualitySignals = EMPTY_SIGNALS,
  isYourTurn = false,
  need = null,
  isSubmitPending = false,
  actionVerb = 'Draft',
}: PlayerPoolProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  // TWO TAPS (2026-09-05): the one row whose verb reads CONFIRM. Stands
  // down on a timer, when the turn passes, and once the action fires.
  const [armedId, setArmedId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = null;
    setArmedId(null);
  };
  const arm = (id: string) => {
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmedId(id);
    armTimer.current = setTimeout(() => setArmedId(null), POOL_ARM_TTL_MS);
  };
  useEffect(() => {
    if (!isYourTurn || !isDraftActive) disarm();
  }, [isYourTurn, isDraftActive]);
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('All');
  // Default sort is the overall projected-fantasy-points ranking (#1 / #2 / #3...).
  // This gives users a single "who's best to draft next" ordering out of the box.
  const [sortBy, setSortBy] = useState('projRank');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showDrafted, setShowDrafted] = useState(false);
  /** `★ 6` (artboard 4a): the pool narrowed to your queue, in the pool's own order. */
  const [queuedOnly, setQueuedOnly] = useState(false);

  // PERF: Use pre-built Set for O(1) lookups instead of O(n) Array.includes on every player
  const draftedSet = useMemo(() => {
    return externalDraftedSet || new Set(draftedPlayers);
  }, [externalDraftedSet, draftedPlayers]);

  // Debounce search input (200ms) to avoid re-filtering 500+ players on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fantasy points calculator using league scoring settings
  const scorer = useMemo(() => new ScoringCalculator(scoringSettings), [scoringSettings]);
  const calcFpts = (p: Player): number => {
    const isGoalie = p.position === 'G';
    return scorer.calculatePoints(
      isGoalie
        ? { wins: p.wins || 0, saves: p.saves || 0, shutouts: p.shutouts || 0, goals_against: p.goals_against || 0 }
        : { goals: p.goals || 0, assists: p.assists || 0, shots: p.shots || 0, blocks: p.blocks || 0, hits: p.hits || 0, pim: p.pim || 0, ppp: p.ppp || 0, shp: p.shp || 0 },
      isGoalie
    );
  };
  // Pre-compute FPTS map for O(1) lookups in sort + render
  const fptsMap = useMemo(() => {
    const map = new Map<string, number>();
    availablePlayers.forEach(p => map.set(p.id, calcFpts(p)));
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePlayers, scorer]);

  /**
   * THE POOL'S #1 IS THE BEST PLAYER LEFT TO DRAFT, NOT THE BEST PLAYER LAST
   * SEASON (2026-09-02).
   *
   * This ranking used to be season-actual fantasy points, with the comment
   * "who's best to draft next" over it. A draft is a forward-looking
   * decision and season totals answer a backward-looking question: an
   * injured star who piled up points before Christmas outranked a healthy
   * player projected to beat him over the rest of the year, and that
   * ordering is what the room defaulted to.
   *
   * Two tiers, never mixed on one scale: players the projection covers,
   * ordered by their rest-of-season projection; then players it does not,
   * ordered by season fantasy points. Mixing a rest-of-season total with a
   * full-season total on one axis compares two different quantities and
   * produces an order that is wrong in a way nobody can see.
   *
   * With no projections at all — a guest's 401, or a caller that passes no
   * map — the second tier holds everyone and the ordering is exactly what it
   * was before.
   */
  const rankMap = useMemo<Map<string, number>>(() => {
    const projected: { id: string; value: number }[] = [];
    const unprojected: { id: string; value: number }[] = [];
    for (const p of availablePlayers) {
      const proj = projectedFptsMap.get(p.id);
      if (proj && Number.isFinite(proj.total)) projected.push({ id: p.id, value: proj.total });
      else unprojected.push({ id: p.id, value: calcFpts(p) });
    }
    projected.sort((a, b) => b.value - a.value);
    unprojected.sort((a, b) => b.value - a.value);
    const map = new Map<string, number>();
    [...projected, ...unprojected].forEach((p, i) => {
      map.set(p.id, i + 1);
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePlayers, scorer, projectedFptsMap]);

  /** `D1`, `LW3`: rank at his position in the pool's projection order (artboard 4a). */
  const positionRankMap = useMemo(() => {
    const byId = new Map(availablePlayers.map((p) => [p.id, p]));
    const ordered = [...rankMap.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    return positionRanks(ordered, (id) => byId.get(id)?.position);
  }, [availablePlayers, rankMap]);

  /** Stormy's line under the chips, from the pool's own order minus the drafted. */
  const needLine = useMemo(() => {
    if (!need) return null;
    const byId = new Map(availablePlayers.map((p) => [p.id, p]));
    const ordered = [...rankMap.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id).filter((id) => !draftedSet.has(id));
    return draftNeedLine({ caps: need.caps, myPositions: need.myPositions, orderedIds: ordered, positionOf: (id) => byId.get(id)?.position, picksAway: need.picksAway });
  }, [need, availablePlayers, rankMap, draftedSet]);

  // Compute data freshness from the most recent last_updated timestamp across all players
  const dataFreshnessLabel = useMemo(() => {
    if (!availablePlayers || availablePlayers.length === 0) return null;

    // Check if we're in the offseason (all players have zero stats)
    const hasAnyStats = availablePlayers.some(p =>
      p.games_played > 0 || p.goals > 0 || p.assists > 0 || (p.wins != null && p.wins > 0)
    );

    let mostRecent: Date | null = null;
    for (const p of availablePlayers) {
      if (p.last_updated) {
        const d = new Date(p.last_updated);
        if (!isNaN(d.getTime()) && (!mostRecent || d > mostRecent)) {
          mostRecent = d;
        }
      }
    }

    if (!hasAnyStats) {
      return 'Offseason: showing prior season stats';
    }

    if (!mostRecent) {
      return 'Stats reflect latest available data';
    }

    // Format as a short readable date, e.g. "Apr 2, 2026"
    return `Data as of ${mostRecent.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }, [availablePlayers]);

  const filteredAndSortedPlayers = useMemo(() => {
    const lowerSearch = debouncedSearch.toLowerCase();
    const normalizedFilterPos = normalizePosition(selectedPosition);

    const filtered = availablePlayers.filter(player => {
      const matchesSearch = player.full_name.toLowerCase().includes(lowerSearch) ||
                           player.team.toLowerCase().includes(lowerSearch);
      const normalizedPlayerPos = normalizePosition(player.position);
      const matchesPosition = selectedPosition === 'All' ||
        normalizedPlayerPos === normalizedFilterPos ||
        (selectedPosition === 'F' && ['C', 'LW', 'RW'].includes(normalizedPlayerPos));
      const isDrafted = draftedSet.has(player.id);
      const matchesDraftStatus = showDrafted ? true : !isDrafted;
      const matchesQueue = !queuedOnly || queue.includes(player.id);

      return matchesSearch && matchesPosition && matchesDraftStatus && matchesQueue;
    });

    // Sort goalies and skaters separately to avoid cross-type NaN comparisons
    // (goalies have wins/saves/gaa, skaters have points/goals/assists — mixing them
    // produces NaN from undefined fields, causing "wonky" sort in All Players view).
    const rankCompare = (a: typeof filtered[0], b: typeof filtered[0]) => {
      // Rank: lower is better (#1 > #2). Always sort ascending regardless
      // of sortDirection — "#1 first" is what users want. Ties broken by
      // projected FPTS descending. Unranked players (missing projections)
      // fall to the bottom via 999999.
      const ra = rankMap.get(a.id) ?? 999999;
      const rb = rankMap.get(b.id) ?? 999999;
      return ra - rb;
    };
    const goalieSort = (a: typeof filtered[0], b: typeof filtered[0]) => {
      if (sortBy === 'projRank') return rankCompare(a, b);
      let comparison = 0;
      switch (sortBy) {
        case 'wins': comparison = (b.wins || 0) - (a.wins || 0); break;
        case 'losses': comparison = (b.losses || 0) - (a.losses || 0); break;
        case 'gaa': comparison = (a.goals_against_average || 999) - (b.goals_against_average || 999); break;
        case 'savePct': comparison = (b.save_percentage || 0) - (a.save_percentage || 0); break;
        case 'saves': comparison = (b.saves || 0) - (a.saves || 0); break;
        case 'shutouts': comparison = (b.shutouts || 0) - (a.shutouts || 0); break;
        case 'fpts': comparison = (fptsMap.get(b.id) || 0) - (fptsMap.get(a.id) || 0); break;
        case 'fptsPerGp': {
          const fptsA = a.games_played ? (fptsMap.get(a.id) || 0) / a.games_played : 0;
          const fptsB = b.games_played ? (fptsMap.get(b.id) || 0) / b.games_played : 0;
          comparison = fptsB - fptsA; break;
        }
        case 'projFpts': comparison = (projectedFptsMap.get(b.id)?.total || 0) - (projectedFptsMap.get(a.id)?.total || 0); break;
        case 'projFptsPerGp': comparison = (projectedFptsMap.get(b.id)?.perGp || 0) - (projectedFptsMap.get(a.id)?.perGp || 0); break;
        case 'name': comparison = a.full_name.localeCompare(b.full_name); break;
        default: comparison = (b.wins || 0) - (a.wins || 0);
      }
      return sortDirection === 'desc' ? comparison : -comparison;
    };

    const skaterSort = (a: typeof filtered[0], b: typeof filtered[0]) => {
      if (sortBy === 'projRank') return rankCompare(a, b);
      let comparison = 0;
      switch (sortBy) {
        case 'points': comparison = (b.points || 0) - (a.points || 0); break;
        case 'goals': comparison = (b.goals || 0) - (a.goals || 0); break;
        case 'assists': comparison = (b.assists || 0) - (a.assists || 0); break;
        case 'shots': comparison = (b.shots || 0) - (a.shots || 0); break;
        case 'hits': comparison = (b.hits || 0) - (a.hits || 0); break;
        case 'blocks': comparison = (b.blocks || 0) - (a.blocks || 0); break;
        case 'xGoals': comparison = (b.xGoals || 0) - (a.xGoals || 0); break;
        case 'plusMinus': comparison = (b.plus_minus || 0) - (a.plus_minus || 0); break;
        case 'ppp': comparison = (b.ppp || 0) - (a.ppp || 0); break;
        case 'shp': comparison = (b.shp || 0) - (a.shp || 0); break;
        case 'pim': comparison = (b.pim || 0) - (a.pim || 0); break;
        case 'toi': comparison = (b.icetime_seconds || 0) - (a.icetime_seconds || 0); break;
        case 'fpts': comparison = (fptsMap.get(b.id) || 0) - (fptsMap.get(a.id) || 0); break;
        case 'fptsPerGp': {
          const fptsA = a.games_played ? (fptsMap.get(a.id) || 0) / a.games_played : 0;
          const fptsB = b.games_played ? (fptsMap.get(b.id) || 0) / b.games_played : 0;
          comparison = fptsB - fptsA; break;
        }
        case 'projFpts': comparison = (projectedFptsMap.get(b.id)?.total || 0) - (projectedFptsMap.get(a.id)?.total || 0); break;
        case 'projFptsPerGp': comparison = (projectedFptsMap.get(b.id)?.perGp || 0) - (projectedFptsMap.get(a.id)?.perGp || 0); break;
        case 'name': comparison = a.full_name.localeCompare(b.full_name); break;
        default: comparison = (b.points || 0) - (a.points || 0);
      }
      return sortDirection === 'desc' ? comparison : -comparison;
    };

    if (selectedPosition === 'All') {
      const skaters = filtered.filter(p => p.position !== 'G');
      const goalies = filtered.filter(p => p.position === 'G');
      skaters.sort(skaterSort);
      goalies.sort(goalieSort);
      return [...skaters, ...goalies];
    } else if (selectedPosition === 'G') {
      filtered.sort(goalieSort);
    } else {
      filtered.sort(skaterSort);
    }

    return filtered;
  }, [debouncedSearch, selectedPosition, sortBy, sortDirection, draftedSet, showDrafted, queuedOnly, queue, availablePlayers, fptsMap, projectedFptsMap, rankMap]);

  // PERF: Paginate to avoid rendering 500+ DOM nodes at once
  const PAGE_SIZE = 75;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count when filters change (user expects fresh results from top)
  const filterKey = `${debouncedSearch}|${selectedPosition}|${sortBy}|${sortDirection}|${showDrafted}|${queuedOnly}`;
  const prevFilterKey = useRef(filterKey);
  if (filterKey !== prevFilterKey.current) {
    prevFilterKey.current = filterKey;
    if (visibleCount !== PAGE_SIZE) setVisibleCount(PAGE_SIZE);
  }

  const visiblePlayers = useMemo(
    () => filteredAndSortedPlayers.slice(0, visibleCount),
    [filteredAndSortedPlayers, visibleCount]
  );
  const hasMore = visibleCount < filteredAndSortedPlayers.length;

  const handleHeaderClick = (stat: string) => {
    if (sortBy === stat) {
      // Toggle direction if clicking same stat
      setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      // Set new stat and default to descending
      setSortBy(stat);
      setSortDirection('desc');
    }
  };

  // Desktop table row for a player — memoized to prevent re-rendering all rows on each pick
  const PlayerRow = useMemo(() => {
    const Row = memo(({ player, displayRank }: { player: Player; displayRank: number }) => {
    const isSelected = selectedPlayer?.id === player.id;
    const isDrafted = draftedSet.has(player.id);
    const isInQueue = queue.includes(player.id);

    return (
      <tr
        className={cn(
          'border-b border-white/5 hover:bg-white/5 active:bg-pastel-surface-high/60 transition-colors cursor-pointer',
          isSelected && 'bg-fantasy-primary/10 ring-2 ring-fantasy-primary/30',
          isDrafted && 'opacity-50'
        )}
        onClick={() => !isDrafted && onPlayerSelect(player)}
      >
        <td className="px-1.5 py-2 text-center w-[44px] bg-pastel-surface-tile text-pastel-cream">
          <span className="text-xs font-mono text-pastel-cream font-bold">
            {displayRank}
          </span>
        </td>
        <td className="px-2 py-2 sticky left-[44px] bg-pastel-surface-tile z-sticky-base text-pastel-cream">
          <div className="flex items-center gap-1.5">
            {/* 2026-09-03 headshot audit: this was a bare <img> that set
                `display: none` on itself when the CDN failed, so a broken
                headshot left the desktop row faceless and reflowed the name
                column, while the phone row beside it (DraftPoolRow) already
                drew the shared `Mug`. Same face, both breakpoints: headshot
                -> team crest -> initials, in a box that never moves. */}
            <Mug p={mugFromDirectory(player)} size="xs" crest />
            {isInQueue && (
              <Star className="h-3 w-3 fill-fantasy-tertiary text-fantasy-tertiary" />
            )}
            {/* FULL NAMES (2026-09-01): was an initial-plus-surname
                abbreviation squeezed into a 140px box — "C. Mc…" in a
                1400px-wide table. The sticky name column affords the
                real name; 190px covers the longest names in the league
                before truncation even starts. */}
            <span className="font-medium text-sm truncate max-w-[190px]">{player.full_name}</span>
          </div>
        </td>
        <td className="px-2 py-1.5 text-pastel-cream">
          <Badge variant="outline" className="text-[10px] px-1">
            {player.eligible_positions && player.eligible_positions.length > 1 ? player.eligible_positions.join('/') : normalizePosition(player.position)}
          </Badge>
        </td>
        <td className="px-2 py-1.5 text-xs text-pastel-cream/70">{player.team}</td>
        <td className="px-2 py-1.5 text-xs text-center font-medium text-pastel-cream">{player.games_played}</td>
        {player.position === 'G' ? (
          <>
            <td className="px-2 py-1.5 text-xs text-center font-semibold text-pastel-cream">{player.wins || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.losses || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.goals_against_average ? player.goals_against_average.toFixed(2) : '0.00'}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.save_percentage ? (player.save_percentage * 100).toFixed(1) : '0.0'}%</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.saves || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.shutouts || 0}</td>
          </>
        ) : (
          <>
            <td className="px-2 py-1.5 text-xs text-center font-semibold text-pastel-cream">{player.points}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.goals}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.assists}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.plus_minus > 0 ? '+' : ''}{player.plus_minus}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.ppp || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.shp || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.shots}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.hits}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.blocks}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream">{player.pim || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream/70">{player.icetime_seconds && player.games_played ? (() => { const totalSec = Math.round(player.icetime_seconds / player.games_played); const m = Math.floor(totalSec / 60); const s = totalSec % 60; return `${m}:${s < 10 ? '0' : ''}${s}`; })() : '-'}</td>
            <td className="px-2 py-1.5 text-xs text-center text-pastel-cream/70">{player.xGoals.toFixed(2)}</td>
          </>
        )}
        <td className="px-2 py-1.5 text-xs text-center font-bold text-emerald-300 bg-emerald-500/10">{(fptsMap.get(player.id) || 0).toFixed(1)}</td>
        <td className="px-2 py-1.5 text-xs text-center font-semibold text-emerald-300 bg-emerald-500/10">{player.games_played ? ((fptsMap.get(player.id) || 0) / player.games_played).toFixed(2) : '-'}</td>
        <td className="px-2 py-1.5 text-xs text-center font-bold text-sky-300 bg-sky-500/10" title={`${projectedFptsMap.get(player.id)?.gamesRemaining || 0} games remaining`}>{(projectedFptsMap.get(player.id)?.total || 0) > 0 ? (projectedFptsMap.get(player.id)!.total).toFixed(1) : '-'}</td>
        <td className="px-2 py-1.5 text-xs text-center font-semibold text-sky-300 bg-sky-500/10">{(projectedFptsMap.get(player.id)?.perGp || 0) > 0 ? (projectedFptsMap.get(player.id)!.perGp).toFixed(2) : '-'}</td>
        <td className="px-2 py-1.5 text-pastel-cream">
          <div className="flex items-center gap-1 relative z-10" onClick={(e) => e.stopPropagation()}>
            {onShowCard && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 relative z-20"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onShowCard(player);
                }}
                title={`View ${player.full_name} card`}
                aria-label={`View ${player.full_name} player card`}
                data-testid="pool-row-card-button"
              >
                <Info className="h-4 w-4 text-pastel-cream/70 hover:text-sky-300" />
              </Button>
            )}
            {onAddToQueue && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 relative z-20"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onAddToQueue(player.id);
                }}
                title={isInQueue ? "Remove from queue" : "Add to queue"}
                aria-label={
                  isInQueue
                    ? `Remove ${player.full_name} from your queue`
                    : `Add ${player.full_name} to your queue`
                }
                aria-pressed={isInQueue}
                data-testid="pool-queue-star"
              >
                <Star className={cn(
                  "h-4 w-4",
                  isInQueue ? "fill-fantasy-tertiary text-fantasy-tertiary" : "text-pastel-cream/70 hover:text-fantasy-tertiary"
                )} />
              </Button>
            )}
            {(isSelected || isYourTurn) && isDraftActive && !isDrafted && (
              <Button
                size="sm"
                className="h-7 px-3 text-xs font-bold bg-pastel-orange text-pastel-surface hover:bg-pastel-orange/90 relative z-20 pointer-events-auto"
                disabled={isSubmitPending}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onPlayerDraft(player);
                }}
                data-testid="pool-row-draft-button"
              >
                {isSubmitPending ? 'Submitting…' : 'Draft'}
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  });
    Row.displayName = 'PlayerRow';
    return Row;
  }, [selectedPlayer?.id, draftedSet, isDraftActive, isYourTurn, isSubmitPending, queue, onPlayerSelect, onPlayerDraft, onAddToQueue, onShowCard, fptsMap, projectedFptsMap]);

  /**
   * THE PHONE POOL, PRESS BOX (2026-09-04) — artboard 4a.
   *
   * Below `md` the pool is no longer a Card with a heading; it is the
   * screen. Search and sort share one 38px line, the position filter is a
   * row of chips, the column head names the number every row leads with,
   * and the rows run full-bleed so a selected row's rail can reach the
   * screen edge. Every control here drives the SAME state as the desktop
   * filters below — one search term, one position, one sort key, one
   * show-drafted flag — so a manager who turns the phone sideways is looking
   * at the same list.
   *
   * The sort stays a Radix Select. The artboard draws a `PROJ ▾` button and
   * that is exactly what the trigger now looks like, but the sixteen sort
   * keys and the goalie/skater split behind it did not need rewriting to
   * change their clothes.
   */
  const headColumnLabel = (poolHeadlineFor(sortBy, {
    seasonFpts: 0, projectionTotal: 0, projectionPerGp: 0, gamesPlayed: 0, points: 0, goals: 0,
    assists: 0, shots: 0, hits: 0, blocks: 0, xGoals: 0, plusMinus: 0, ppp: 0, shp: 0, pim: 0,
    icetimeSeconds: 0, wins: 0, losses: 0, gaa: 0, savePct: 0, saves: 0, shutouts: 0,
  })?.label ?? 'proj').toUpperCase();
  const positionChips = [
    { key: 'All', label: 'ALL' },
    { key: 'C', label: 'C' },
    { key: 'LW', label: 'LW' },
    { key: 'RW', label: 'RW' },
    { key: 'D', label: 'D' },
    { key: 'G', label: 'G' },
    { key: 'F', label: 'FWD' },
  ];
  const sortOptions = selectedPosition === 'G'
    ? [['projRank', 'RANK'], ['wins', 'W'], ['losses', 'L'], ['gaa', 'GAA'], ['savePct', 'SV%'], ['saves', 'SV'], ['shutouts', 'SO'], ['name', 'NAME']]
    : [['projRank', 'RANK'], ['points', 'PTS'], ['goals', 'G'], ['assists', 'A'], ['plusMinus', '+/-'], ['ppp', 'PPP'], ['shp', 'SHP'], ['shots', 'SOG'], ['hits', 'HIT'], ['blocks', 'BLK'], ['pim', 'PIM'], ['toi', 'TOI'], ['xGoals', 'xG'], ['name', 'NAME']];
  const sortLabel = sortOptions.find(([k]) => k === sortBy)?.[1] ?? 'RANK';

  const phonePool = (
    <div className={cn(PB_TYPE, 'md:hidden')} data-testid="player-pool-phone">
      <div className="px-3.5 pt-2.5">
        <PressBoxDraftSearchRow
          value={searchTerm}
          onValueChange={setSearchTerm}
          sort={
            <Select value={sortBy} onValueChange={(value) => { setSortBy(value); setSortDirection('desc'); }}>
              <SelectTrigger className={cn(PB_SORT_TRIGGER, 'w-auto gap-1.5 border-0 [&>svg]:hidden')} aria-label={`Sort by ${sortLabel}. Change sort`}>
                {sortLabel} &#9662;
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <div className="mt-2 flex items-center gap-1.5">
          <PressBoxChips
            chips={positionChips}
            activeKey={selectedPosition}
            onSelect={setSelectedPosition}
            label="Position filter"
            className="min-w-0 overflow-x-auto scrollbar-hide"
          />
          {/* `★ 6` (artboard 4a): your queue as a filter, at the row's far edge,
              with the count. Show-drafted is the other toggle beside it; both
              wear the chip's clothes and neither is a position. */}
          {onAddToQueue && queue.length > 0 && (
            <button
              type="button"
              onClick={() => setQueuedOnly((v) => !v)}
              aria-pressed={queuedOnly}
              title={queuedOnly ? 'Show every player' : 'Show only your queue'}
              data-testid="pool-queued-only"
              className={cn(
                'ml-auto flex-none px-[11px] py-[5px] rounded-full font-plex font-semibold text-[10px] tracking-[0.06em] whitespace-nowrap',
                queuedOnly ? 'bg-pressbox-orange text-pressbox-orange-ink' : 'bg-pressbox-tile text-pressbox-orange-soft',
              )}
            >
              &#9733; {queue.length}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDrafted(!showDrafted)}
            aria-pressed={showDrafted}
            title={showDrafted ? 'Hide drafted players' : 'Show drafted players'}
            className={cn(
              'flex-none px-[11px] py-[5px] rounded-full font-plex font-semibold text-[10px] tracking-[0.06em] whitespace-nowrap',
              !(onAddToQueue && queue.length > 0) && 'ml-auto',
              showDrafted ? 'bg-pressbox-text text-pressbox-surface' : 'bg-pressbox-tile text-pressbox-text/70',
            )}
          >
            DRAFTED
          </button>
        </div>

        {needLine && (
          <p
            className="mt-2.5 flex items-center gap-2 rounded-[10px] bg-pressbox-tile border border-white/[0.08] px-3 py-2 font-barlow text-[12px] text-pressbox-text/85"
            data-testid="draft-need-line"
          >
            <span aria-hidden="true" className="w-[18px] h-[18px] flex-none rounded-full bg-pressbox-orange/20 border border-pressbox-orange flex items-center justify-center font-condensed font-bold text-[9px] text-pressbox-orange-soft">S</span>
            <span className="min-w-0 truncate"><span className="font-plex font-semibold text-[9px] uppercase tracking-[0.1em] text-pressbox-orange-soft">Stormy</span> · {needLine.text}</span>
          </p>
        )}

        <div
          aria-hidden="true"
          className="grid grid-cols-[22px_1fr_54px_40px] gap-2.5 pt-3 pb-1.5 px-0.5 font-plex font-medium text-[9px] tracking-[0.08em] text-pressbox-text/40"
        >
          <span>RK</span>
          <span>PLAYER</span>
          <span className="text-right">{headColumnLabel}</span>
          <span />
        </div>
      </div>

      <div>
        {visiblePlayers.map((player, index) => {
          const isSelected = selectedPlayer?.id === player.id;
          const isDrafted = draftedSet.has(player.id);
          const queueIndex = queue.indexOf(player.id);
          return (
            <DraftPoolRow
              key={player.id}
              rank={index + 1}
              player={player}
              seasonFpts={fptsMap.get(player.id) || 0}
              projection={projectedFptsMap.get(player.id) ?? null}
              signal={qualitySignals.get(player.id) ?? null}
              seasonLine={draftPoolSeasonLine(player)}
              positionRank={positionRankMap.get(player.id) ?? null}
              headlineOverride={poolHeadlineFor(sortBy, {
                seasonFpts: fptsMap.get(player.id) || 0,
                projectionTotal: projectedFptsMap.get(player.id)?.total ?? null,
                projectionPerGp: projectedFptsMap.get(player.id)?.perGp ?? null,
                gamesPlayed: player.games_played ?? null,
                points: player.points ?? null,
                goals: player.goals ?? null,
                assists: player.assists ?? null,
                shots: player.shots ?? null,
                hits: player.hits ?? null,
                blocks: player.blocks ?? null,
                xGoals: player.xGoals ?? null,
                plusMinus: player.plus_minus ?? null,
                ppp: player.ppp ?? null,
                shp: player.shp ?? null,
                pim: player.pim ?? null,
                icetimeSeconds: player.icetime_seconds ?? null,
                wins: player.wins ?? null,
                losses: player.losses ?? null,
                gaa: player.goals_against_average ?? null,
                savePct: player.save_percentage ?? null,
                saves: player.saves ?? null,
                shutouts: player.shutouts ?? null,
              })}
              selected={isSelected}
              drafted={isDrafted}
              queued={queueIndex >= 0}
              queuePosition={queueIndex >= 0 ? queueIndex + 1 : null}
              canDraft={isYourTurn && isDraftActive && !isDrafted}
              submitting={isSubmitPending}
              armed={armedId === player.id}
              onArm={() => arm(player.id)}
              verb={actionVerb}
              onSelect={() => onPlayerSelect(player)}
              onDraft={() => {
                disarm();
                onPlayerDraft(player);
              }}
              onToggleQueue={onAddToQueue ? () => onAddToQueue(player.id) : undefined}
              onShowCard={onShowCard ? () => onShowCard(player) : undefined}
            />
          );
        })}
        {hasMore && (
          <button
            type="button"
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            className="w-full py-3 border-t border-white/[0.06] font-plex font-semibold text-[10px] tracking-[0.08em] text-pressbox-orange-soft"
          >
            + {filteredAndSortedPlayers.length - visibleCount} MORE
          </button>
        )}
        {filteredAndSortedPlayers.length === 0 && (
          loadError ? (
            // Same truth the desktop table tells (2026-08-18 launch audit):
            // a directory that failed to load is not a filter miss.
            <div className="text-center py-8 px-3.5" data-testid="player-pool-load-error-mobile">
              <p className="font-barlow font-semibold text-[14px] text-pressbox-grapefruit-text">Couldn&apos;t load the player list.</p>
              <p className="mt-1 font-barlow text-[12px] text-pressbox-text/55">
                A connection problem, not a filter. Nothing loaded.
              </p>
              {onRetryLoad && (
                <button
                  type="button"
                  onClick={onRetryLoad}
                  className="mt-3 rounded-[8px] border border-pressbox-grapefruit/45 px-3 py-1.5 font-plex font-semibold text-[10px] tracking-[0.06em] text-pressbox-grapefruit-text"
                >
                  RETRY
                </button>
              )}
            </div>
          ) : (
            <div className="text-center py-8 font-barlow text-[12px] text-pressbox-text/55">
              Nobody left matches those filters.
            </div>
          )
        )}
      </div>
    </div>
  );

  return (
    <>
    {phonePool}
    <Card className="hidden md:block p-2 sm:p-4 border-white/10 bg-pastel-surface-tile">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-base sm:text-xl font-semibold flex items-center gap-2 text-pastel-cream">
          <Star className="h-4 w-4 sm:h-5 sm:w-5 text-fantasy-primary" />
          Players
        </h2>
        <div className="flex items-center gap-3">
          {dataFreshnessLabel && (
            <span className="hidden sm:flex items-center gap-1 text-[11px] text-pastel-cream/70">
              <Clock className="h-3 w-3" />
              {dataFreshnessLabel}
            </span>
          )}
          <div className="text-xs sm:text-sm text-pastel-cream/70">
            {filteredAndSortedPlayers.length}
          </div>
        </div>
      </div>

      {/* Filters — ONE LINE ON A PHONE (2026-09-02). `flex-wrap` with a
          140px minimum on the search box pushed the show-drafted toggle onto
          a line of its own at 393px: 44px of chrome above the first player,
          on the screen whose entire job is showing players. The search box
          shrinks instead (`min-w-0`), and the row goes back to wrapping at
          `sm` where there is room for it. */}
      <div className="flex flex-nowrap sm:flex-wrap gap-2 mb-3 px-1">
        <div className="relative flex-1 min-w-0 sm:min-w-[140px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-pastel-cream/70" />
          <Input
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-9 text-sm bg-pastel-surface-tile backdrop-blur-sm border-white/10"
          />
        </div>

        <Select value={selectedPosition} onValueChange={setSelectedPosition}>
          <SelectTrigger className="w-[80px] sm:w-[120px] h-9 bg-pastel-surface-tile backdrop-blur-sm border-white/10 text-xs sm:text-sm">
            <SelectValue placeholder="Pos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All</SelectItem>
            <SelectItem value="C">C</SelectItem>
            <SelectItem value="LW">LW</SelectItem>
            <SelectItem value="RW">RW</SelectItem>
            <SelectItem value="D">D</SelectItem>
            <SelectItem value="G">G</SelectItem>
            <SelectItem value="F">Fwd</SelectItem>
          </SelectContent>
        </Select>

        <div className="hidden sm:block space-y-1">
          <Label className="text-xs text-pastel-cream/70">Sort By</Label>
          <Select value={sortBy} onValueChange={(value) => {
            setSortBy(value);
            setSortDirection('desc');
          }}>
            <SelectTrigger className="bg-pastel-surface-tile backdrop-blur-sm border-white/10">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {selectedPosition === 'G' ? (
                <>
                  <SelectItem value="projRank">Overall Rank (#1 →)</SelectItem>
                  <SelectItem value="wins">Wins</SelectItem>
                  <SelectItem value="losses">Losses</SelectItem>
                  <SelectItem value="gaa">GAA</SelectItem>
                  <SelectItem value="savePct">Save %</SelectItem>
                  <SelectItem value="saves">Saves</SelectItem>
                  <SelectItem value="shutouts">Shutouts</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="projRank">Overall Rank (#1 →)</SelectItem>
                  <SelectItem value="points">Points</SelectItem>
                  <SelectItem value="goals">Goals</SelectItem>
                  <SelectItem value="assists">Assists</SelectItem>
                  <SelectItem value="plusMinus">+/-</SelectItem>
                  <SelectItem value="ppp">PPP</SelectItem>
                  <SelectItem value="shp">SHP</SelectItem>
                  <SelectItem value="shots">Shots</SelectItem>
                  <SelectItem value="hits">Hits</SelectItem>
                  <SelectItem value="blocks">Blocks</SelectItem>
                  <SelectItem value="pim">PIM</SelectItem>
                  <SelectItem value="toi">TOI</SelectItem>
                  <SelectItem value="xGoals">xGoals</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Mobile sort select - ALL stats available */}
        <Select value={sortBy} onValueChange={(value) => { setSortBy(value); setSortDirection('desc'); }}>
          <SelectTrigger className="sm:hidden w-[80px] h-9 bg-pastel-surface-tile backdrop-blur-sm border-white/10 text-xs">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {selectedPosition === 'G' ? (
              <>
                <SelectItem value="projRank">Rank</SelectItem>
                <SelectItem value="wins">W</SelectItem>
                <SelectItem value="losses">L</SelectItem>
                <SelectItem value="gaa">GAA</SelectItem>
                <SelectItem value="savePct">SV%</SelectItem>
                <SelectItem value="saves">SV</SelectItem>
                <SelectItem value="shutouts">SO</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </>
            ) : (
              <>
                <SelectItem value="projRank">Rank</SelectItem>
                <SelectItem value="points">PTS</SelectItem>
                <SelectItem value="goals">G</SelectItem>
                <SelectItem value="assists">A</SelectItem>
                <SelectItem value="plusMinus">+/-</SelectItem>
                <SelectItem value="ppp">PPP</SelectItem>
                <SelectItem value="shp">SHP</SelectItem>
                <SelectItem value="shots">SOG</SelectItem>
                <SelectItem value="hits">HIT</SelectItem>
                <SelectItem value="blocks">BLK</SelectItem>
                <SelectItem value="pim">PIM</SelectItem>
                <SelectItem value="toi">TOI</SelectItem>
                <SelectItem value="xGoals">xG</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>

        <Button
          variant={showDrafted ? "default" : "outline"}
          size="sm"
          onClick={() => setShowDrafted(!showDrafted)}
          className="h-9 w-9 p-0 flex-shrink-0"
          title={showDrafted ? "Hide drafted players" : "Show drafted players"}
        >
          {showDrafted ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>

      {/* Desktop: Full table view — horizontally scrollable to show all stats */}
      <div className="hidden md:block border border-white/10 rounded-lg bg-pastel-surface-tile text-pastel-cream backdrop-blur-sm min-w-0">
        {/* SCROLL-TRAP (2026-08-13) — the cap is now `lg:` only.
            It used to apply from `md` (768px) up. In the 768-1023px
            band the layout is a SINGLE column, so everything below the
            pool — manager presence, team rosters, the draft queue —
            sat underneath a 467px box holding 2,582px of rows
            (measured on staging at 766x755). Every wheel tick landed
            inside the box, and with 75 rows rendered you never reach
            its bottom edge, so scroll never chains out to the page.
            The page was not stuck; it was unreachable.
            At lg and up the cap is correct and stays: the sidebar is a
            real second column there, so pinning the pool to the
            viewport keeps the board and the queue in view instead of
            pushing them off-screen. */}
        <div className="overflow-auto scrollbar-styled lg:max-h-[calc(100dvh-18rem)]" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[1400px] text-sm border-collapse">
            <thead className="bg-pastel-surface-high sticky top-0 z-sticky-raised border-b border-white/10">
              <tr>
                <th className="px-1.5 py-2 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs w-[44px]"
                  onClick={() => handleHeaderClick('projRank')}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    #
                    {sortBy === 'projRank' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'projRank' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-2 text-left font-semibold text-pastel-cream sticky left-[44px] bg-pastel-surface-high z-sticky-base min-w-[190px]">Player</th>
                <th className="px-2 py-2 text-left font-semibold text-pastel-cream">Pos</th>
                <th className="px-2 py-2 text-left font-semibold text-pastel-cream">Team</th>
                <th className="px-2 py-2 text-center font-semibold text-pastel-cream">GP</th>
                {/* Conditionally show goalie or skater stats based on filter */}
                {selectedPosition === 'G' ? (
                  <>
                    <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                      onClick={() => handleHeaderClick('wins')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        W
                        {sortBy === 'wins' && (
                          sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        )}
                        {sortBy !== 'wins' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </div>
                    </th>
                    <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                      onClick={() => handleHeaderClick('losses')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        L
                        {sortBy === 'losses' && (
                          sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        )}
                        {sortBy !== 'losses' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </div>
                    </th>
                    <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                      onClick={() => handleHeaderClick('gaa')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        GAA
                        {sortBy === 'gaa' && (
                          sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        )}
                        {sortBy !== 'gaa' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </div>
                    </th>
                    <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                      onClick={() => handleHeaderClick('savePct')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        SV%
                        {sortBy === 'savePct' && (
                          sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        )}
                        {sortBy !== 'savePct' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </div>
                    </th>
                    <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                      onClick={() => handleHeaderClick('saves')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        SV
                        {sortBy === 'saves' && (
                          sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        )}
                        {sortBy !== 'saves' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </div>
                    </th>
                    <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                      onClick={() => handleHeaderClick('shutouts')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        SO
                        {sortBy === 'shutouts' && (
                          sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        )}
                        {sortBy !== 'shutouts' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </div>
                    </th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                      onClick={() => handleHeaderClick('points')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        PTS
                        {sortBy === 'points' && (
                          sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        )}
                        {sortBy !== 'points' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </div>
                    </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('goals')}
                >
                  <div className="flex items-center justify-center gap-1">
                    G
                    {sortBy === 'goals' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'goals' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('assists')}
                >
                  <div className="flex items-center justify-center gap-1">
                    A
                    {sortBy === 'assists' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'assists' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('plusMinus')}
                >
                  <div className="flex items-center justify-center gap-1">
                    +/-
                    {sortBy === 'plusMinus' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'plusMinus' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('ppp')}
                >
                  <div className="flex items-center justify-center gap-1">
                    PPP
                    {sortBy === 'ppp' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'ppp' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-3 py-2 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none"
                  onClick={() => handleHeaderClick('shp')}
                >
                  <div className="flex items-center justify-center gap-1">
                    SHP
                    {sortBy === 'shp' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'shp' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-3 py-2 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none"
                  onClick={() => handleHeaderClick('shots')}
                >
                  <div className="flex items-center justify-center gap-1">
                    SOG
                    {sortBy === 'shots' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'shots' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('hits')}
                >
                  <div className="flex items-center justify-center gap-1">
                    HIT
                    {sortBy === 'hits' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'hits' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('blocks')}
                >
                  <div className="flex items-center justify-center gap-1">
                    BLK
                    {sortBy === 'blocks' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'blocks' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('pim')}
                >
                  <div className="flex items-center justify-center gap-1">
                    PIM
                    {sortBy === 'pim' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'pim' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('toi')}
                >
                  <div className="flex items-center justify-center gap-1">
                    TOI/GP
                    {sortBy === 'toi' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'toi' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream cursor-pointer hover:bg-white/5 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('xGoals')}
                >
                  <div className="flex items-center justify-center gap-1">
                    xG
                    {sortBy === 'xGoals' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'xGoals' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                  </>
                )}
                <th className="px-2 py-1.5 text-center font-bold text-emerald-300 bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('fpts')}
                >
                  <div className="flex items-center justify-center gap-1">
                    FPTS
                    {sortBy === 'fpts' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'fpts' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-bold text-emerald-300 bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('fptsPerGp')}
                >
                  <div className="flex items-center justify-center gap-1">
                    FPTS/GP
                    {sortBy === 'fptsPerGp' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'fptsPerGp' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-bold text-sky-300 bg-sky-500/10 cursor-pointer hover:bg-sky-500/20 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('projFpts')}
                >
                  <div className="flex items-center justify-center gap-1" title="Rest-of-season projected fantasy points (from last pipeline run)">
                    Proj ROS
                    {sortBy === 'projFpts' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'projFpts' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-bold text-sky-300 bg-sky-500/10 cursor-pointer hover:bg-sky-500/20 transition-colors select-none text-xs"
                  onClick={() => handleHeaderClick('projFptsPerGp')}
                >
                  <div className="flex items-center justify-center gap-1" title="Projected fantasy points per game (rest of season, from last pipeline run)">
                    Proj/GP
                    {sortBy === 'projFptsPerGp' && (
                      sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                    )}
                    {sortBy !== 'projFptsPerGp' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </div>
                </th>
                <th className="px-2 py-1.5 text-center font-semibold text-pastel-cream text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visiblePlayers.map((player, index) => (
                <PlayerRow key={player.id} player={player} displayRank={index + 1} />
              ))}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <button
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            className="w-full py-2 text-xs font-display font-bold text-pastel-cream bg-citrus-sage/10 hover:bg-citrus-sage/20 border-t border-white/10 transition-colors"
          >
            Show more ({filteredAndSortedPlayers.length - visibleCount} remaining)
          </button>
        )}
        {filteredAndSortedPlayers.length === 0 && (
          loadError ? (
            <div className="text-center py-12" data-testid="player-pool-load-error">
              <p className="font-semibold text-destructive">Couldn&apos;t load the player list.</p>
              <p className="text-xs mt-1 text-pastel-cream/70">
                This is a connection problem, not a filter. No players were loaded at all.
              </p>
              {onRetryLoad && (
                <button
                  type="button"
                  onClick={onRetryLoad}
                  data-testid="player-pool-load-retry"
                  className="mt-3 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Retry
                </button>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-pastel-cream/70">
              Nobody matches those filters. Widen the position, or clear the search to see the whole board.
            </div>
          )
        )}
      </div>
    </Card>
    </>
  );
});

PlayerPool.displayName = 'PlayerPool';