import { useState, useMemo, useRef, useEffect, memo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Star, Eye, EyeOff, ArrowUpDown, ArrowUp, ArrowDown, Clock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Player } from '@/services/PlayerService';
import { ScoringCalculator, ScoringSettings } from '@citrus/shared';

interface PlayerPoolProps {
  onPlayerSelect: (player: Player) => void;
  onPlayerDraft: (player: Player) => void;
  selectedPlayer: Player | null;
  draftedPlayers: string[];
  isDraftActive: boolean;
  availablePlayers: Player[];
  onAddToQueue?: (playerId: string) => void;
  onToggleWatchlist?: (playerId: string) => void;
  queue?: string[];
  watchlist?: Set<string>;
  /** Pre-built Set for O(1) drafted lookups (optional, built from draftedPlayers if not provided) */
  draftedPlayerSet?: Set<string>;
  /** League scoring settings for calculating fantasy points */
  scoringSettings?: ScoringSettings | null;
  /** Pre-computed projected FPTS from ROS projections */
  projectedFptsMap?: Map<string, { total: number; perGp: number; gamesRemaining: number }>;
}

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
  onAddToQueue,
  onToggleWatchlist,
  queue = [],
  watchlist = new Set(),
  draftedPlayerSet: externalDraftedSet,
  scoringSettings,
  projectedFptsMap = new Map()
}: PlayerPoolProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('All');
  // Default sort is the overall projected-fantasy-points ranking (#1 / #2 / #3...).
  // This gives users a single "who's best to draft next" ordering out of the box.
  const [sortBy, setSortBy] = useState('projRank');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showDrafted, setShowDrafted] = useState(false);

  // Rank ALL players by actual season FPTS (using league scoring settings).
  // Actual stats are always current; ROS projections can be stale if the
  // pipeline hasn't run recently. Rankings stay dynamic to league scoring.
  const rankMap = useMemo<Map<string, number>>(() => {
    const scored = availablePlayers.map(p => ({
      id: p.id,
      fpts: calcFpts(p),
    }));
    scored.sort((a, b) => b.fpts - a.fpts);
    const map = new Map<string, number>();
    scored.forEach((p, i) => {
      map.set(p.id, i + 1);
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePlayers, scorer]);

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
      return 'Offseason — showing prior season stats';
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
      
      return matchesSearch && matchesPosition && matchesDraftStatus;
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
  }, [debouncedSearch, selectedPosition, sortBy, sortDirection, draftedSet, showDrafted, availablePlayers, fptsMap, projectedFptsMap, rankMap]);

  // PERF: Paginate to avoid rendering 500+ DOM nodes at once
  const PAGE_SIZE = 75;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count when filters change (user expects fresh results from top)
  const filterKey = `${debouncedSearch}|${selectedPosition}|${sortBy}|${sortDirection}|${showDrafted}`;
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
          'border-b border-fantasy-border/50 hover:bg-fantasy-light/30 active:bg-fantasy-light/50 transition-colors cursor-pointer',
          isSelected && 'bg-fantasy-primary/10 ring-2 ring-fantasy-primary/30',
          isDrafted && 'opacity-50'
        )}
        onClick={() => !isDrafted && onPlayerSelect(player)}
      >
        <td className="px-1.5 py-2 text-center w-[44px] bg-[#E8EED9]/95">
          <span className="text-xs font-mono text-citrus-forest font-bold">
            {displayRank}
          </span>
        </td>
        <td className="px-2 py-2 sticky left-[44px] bg-[#E8EED9]/95 z-10">
          <div className="flex items-center gap-1">
            {isInQueue && (
              <Star className="h-3 w-3 fill-fantasy-tertiary text-fantasy-tertiary" />
            )}
            <span className="font-medium text-sm truncate max-w-[140px]">{player.full_name}</span>
          </div>
        </td>
        <td className="px-2 py-1.5">
          <Badge variant="outline" className="text-[10px] px-1">
            {player.eligible_positions && player.eligible_positions.length > 1 ? player.eligible_positions.join('/') : normalizePosition(player.position)}
          </Badge>
        </td>
        <td className="px-2 py-1.5 text-xs text-muted-foreground">{player.team}</td>
        <td className="px-2 py-1.5 text-xs text-center font-medium">{player.games_played}</td>
        {player.position === 'G' ? (
          <>
            <td className="px-2 py-1.5 text-xs text-center font-semibold">{player.wins || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.losses || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.goals_against_average ? player.goals_against_average.toFixed(2) : '0.00'}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.save_percentage ? (player.save_percentage * 100).toFixed(1) : '0.0'}%</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.saves || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.shutouts || 0}</td>
          </>
        ) : (
          <>
            <td className="px-2 py-1.5 text-xs text-center font-semibold">{player.points}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.goals}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.assists}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.plus_minus > 0 ? '+' : ''}{player.plus_minus}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.ppp || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.shp || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.shots}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.hits}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.blocks}</td>
            <td className="px-2 py-1.5 text-xs text-center">{player.pim || 0}</td>
            <td className="px-2 py-1.5 text-xs text-center text-muted-foreground">{player.icetime_seconds && player.games_played ? (() => { const totalSec = Math.round(player.icetime_seconds / player.games_played); const m = Math.floor(totalSec / 60); const s = totalSec % 60; return `${m}:${s < 10 ? '0' : ''}${s}`; })() : '-'}</td>
            <td className="px-2 py-1.5 text-xs text-center text-muted-foreground">{player.xGoals.toFixed(2)}</td>
          </>
        )}
        <td className="px-2 py-1.5 text-xs text-center font-bold text-green-700 bg-green-50/30">{(fptsMap.get(player.id) || 0).toFixed(1)}</td>
        <td className="px-2 py-1.5 text-xs text-center font-semibold text-green-600 bg-green-50/30">{player.games_played ? ((fptsMap.get(player.id) || 0) / player.games_played).toFixed(2) : '-'}</td>
        <td className="px-2 py-1.5 text-xs text-center font-bold text-blue-700 bg-blue-50/30" title={`${projectedFptsMap.get(player.id)?.gamesRemaining || 0} games remaining`}>{(projectedFptsMap.get(player.id)?.total || 0) > 0 ? (projectedFptsMap.get(player.id)!.total).toFixed(1) : '-'}</td>
        <td className="px-2 py-1.5 text-xs text-center font-semibold text-blue-600 bg-blue-50/30">{(projectedFptsMap.get(player.id)?.perGp || 0) > 0 ? (projectedFptsMap.get(player.id)!.perGp).toFixed(2) : '-'}</td>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1 relative z-10" onClick={(e) => e.stopPropagation()}>
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
              >
                <Star className={cn(
                  "h-4 w-4",
                  isInQueue ? "fill-fantasy-tertiary text-fantasy-tertiary" : "text-muted-foreground hover:text-fantasy-tertiary"
                )} />
              </Button>
            )}
            {isSelected && isDraftActive && !isDrafted && (
              <Button
                size="sm"
                className="h-7 px-3 text-xs bg-fantasy-primary hover:bg-fantasy-primary/90 relative z-20 pointer-events-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onPlayerDraft(player);
                }}
              >
                Draft
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  });
    Row.displayName = 'PlayerRow';
    return Row;
  }, [selectedPlayer?.id, draftedSet, isDraftActive, queue, onPlayerSelect, onPlayerDraft, onAddToQueue, fptsMap, projectedFptsMap]);

  return (
    <Card className="p-2 sm:p-4 border-fantasy-border bg-fantasy-surface">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-base sm:text-xl font-semibold flex items-center gap-2 text-fantasy-dark">
          <Star className="h-4 w-4 sm:h-5 sm:w-5 text-fantasy-primary" />
          Players
        </h2>
        <div className="flex items-center gap-3">
          {dataFreshnessLabel && (
            <span className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {dataFreshnessLabel}
            </span>
          )}
          <div className="text-xs sm:text-sm text-muted-foreground">
            {filteredAndSortedPlayers.length}
          </div>
        </div>
      </div>

      {/* Filters - compact on mobile */}
      <div className="flex flex-wrap gap-2 mb-3 px-1">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-9 text-sm bg-[#E8EED9]/50 backdrop-blur-sm border-fantasy-border"
          />
        </div>

        <Select value={selectedPosition} onValueChange={setSelectedPosition}>
          <SelectTrigger className="w-[80px] sm:w-[120px] h-9 bg-[#E8EED9]/50 backdrop-blur-sm border-fantasy-border text-xs sm:text-sm">
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
          <Label className="text-xs text-muted-foreground">Sort By</Label>
          <Select value={sortBy} onValueChange={(value) => {
            setSortBy(value);
            setSortDirection('desc');
          }}>
            <SelectTrigger className="bg-[#E8EED9]/50 backdrop-blur-sm border-fantasy-border">
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
          <SelectTrigger className="sm:hidden w-[80px] h-9 bg-[#E8EED9]/50 backdrop-blur-sm border-fantasy-border text-xs">
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

      {/* Mobile: Table view with unified horizontal scroll — scrolls all players as one */}
      <div className="md:hidden border border-fantasy-border rounded-lg bg-[#E8EED9]/50 backdrop-blur-sm min-w-0">
        <div className="overflow-x-auto scrollbar-styled" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[900px] text-sm border-collapse">
            <thead className="bg-fantasy-light/50 border-b border-fantasy-border">
              <tr>
                <th className="px-1 py-1.5 text-center font-semibold text-fantasy-dark sticky left-0 bg-fantasy-light/95 z-10 w-[32px] text-[11px] cursor-pointer" onClick={() => handleHeaderClick('projRank')}>#</th>
                <th className="px-2 py-1.5 text-left font-semibold text-fantasy-dark sticky left-[32px] bg-fantasy-light/95 z-10 min-w-[100px] text-xs">Player</th>
                {selectedPosition === 'G' ? (
                  <>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('wins')}>W</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('losses')}>L</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('gaa')}>GAA</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('savePct')}>SV%</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('saves')}>SV</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('shutouts')}>SO</th>
                  </>
                ) : (
                  <>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('points')}>PTS</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('goals')}>G</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('assists')}>A</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('plusMinus')}>+/-</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('ppp')}>PPP</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('shp')}>SHP</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('shots')}>SOG</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('hits')}>HIT</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('blocks')}>BLK</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('pim')}>PIM</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px] cursor-pointer" onClick={() => handleHeaderClick('xGoals')}>xG</th>
                  </>
                )}
                <th className="px-1.5 py-1.5 text-center font-bold text-green-700 bg-green-50/50 text-[11px] cursor-pointer" onClick={() => handleHeaderClick('fpts')}>FPTS</th>
                <th className="px-1.5 py-1.5 text-center font-bold text-green-700 bg-green-50/50 text-[11px] cursor-pointer" onClick={() => handleHeaderClick('fptsPerGp')}>F/GP</th>
                <th className="px-1.5 py-1.5 text-center font-bold text-blue-700 bg-blue-50/50 text-[11px] cursor-pointer" onClick={() => handleHeaderClick('projFpts')} title="Rest-of-season projected fantasy points">ROS</th>
                <th className="px-1.5 py-1.5 text-center font-bold text-blue-700 bg-blue-50/50 text-[11px] cursor-pointer" onClick={() => handleHeaderClick('projFptsPerGp')} title="Projected fantasy points per game (rest of season)">P/GP</th>
                <th className="px-1.5 py-1.5 text-center font-semibold text-fantasy-dark text-[11px]"></th>
              </tr>
            </thead>
            <tbody>
              {visiblePlayers.map((player, index) => {
                const isSelected = selectedPlayer?.id === player.id;
                const isDrafted = draftedSet.has(player.id);
                const isInQueue = queue.includes(player.id);
                return (
                  <tr
                    key={player.id}
                    className={cn(
                      'border-b border-fantasy-border/50 transition-colors cursor-pointer active:bg-fantasy-light/50',
                      isSelected && 'bg-fantasy-primary/10',
                      isDrafted && 'opacity-40'
                    )}
                    onClick={() => !isDrafted && onPlayerSelect(player)}
                  >
                    <td className="px-1 py-1.5 text-center w-[32px] sticky left-0 bg-[#E8EED9]/95 z-10">
                      <span className="text-[10px] font-mono text-citrus-forest font-bold">{index + 1}</span>
                    </td>
                    <td className="px-1.5 py-1.5 sticky left-[32px] bg-[#E8EED9]/95 z-10">
                      <div className="flex items-center gap-1">
                        {isInQueue && <Star className="h-3 w-3 fill-fantasy-tertiary text-fantasy-tertiary flex-shrink-0" />}
                        <span className="font-medium text-xs truncate max-w-[100px]">{player.full_name}</span>
                        <Badge variant="outline" className="text-[9px] px-0.5 py-0 flex-shrink-0">{normalizePosition(player.position)}</Badge>
                      </div>
                    </td>
                    {player.position === 'G' ? (
                      <>
                        <td className="px-1.5 py-1 text-[11px] text-center font-semibold">{player.wins || 0}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.losses || 0}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.goals_against_average ? player.goals_against_average.toFixed(2) : '0.00'}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.save_percentage ? (player.save_percentage * 100).toFixed(1) : '0.0'}%</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.saves || 0}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.shutouts || 0}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-1.5 py-1 text-[11px] text-center font-semibold">{player.points}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.goals}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.assists}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.plus_minus > 0 ? '+' : ''}{player.plus_minus}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.ppp || 0}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.shp || 0}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.shots}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.hits}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.blocks}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center">{player.pim || 0}</td>
                        <td className="px-1.5 py-1 text-[11px] text-center text-muted-foreground">{player.xGoals.toFixed(1)}</td>
                      </>
                    )}
                    <td className="px-1.5 py-1 text-[11px] text-center font-bold text-green-700 bg-green-50/30">{(fptsMap.get(player.id) || 0).toFixed(1)}</td>
                    <td className="px-1.5 py-1 text-[11px] text-center font-semibold text-green-600 bg-green-50/30">{player.games_played ? ((fptsMap.get(player.id) || 0) / player.games_played).toFixed(1) : '-'}</td>
                    <td className="px-1.5 py-1 text-[11px] text-center font-bold text-blue-700 bg-blue-50/30">{(projectedFptsMap.get(player.id)?.total || 0) > 0 ? (projectedFptsMap.get(player.id)!.total).toFixed(1) : '-'}</td>
                    <td className="px-1.5 py-1 text-[11px] text-center font-semibold text-blue-600 bg-blue-50/30">{(projectedFptsMap.get(player.id)?.perGp || 0) > 0 ? (projectedFptsMap.get(player.id)!.perGp).toFixed(1) : '-'}</td>
                    <td className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        {onAddToQueue && (
                          <Button variant="ghost" size="sm" className="h-9 w-9 p-0"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onAddToQueue(player.id); }}>
                            <Star className={cn("h-4 w-4", isInQueue ? "fill-fantasy-tertiary text-fantasy-tertiary" : "text-muted-foreground")} />
                          </Button>
                        )}
                        {isSelected && isDraftActive && !isDrafted && (
                          <Button size="sm" className="h-7 px-2 text-[10px] bg-fantasy-primary hover:bg-fantasy-primary/90"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onPlayerDraft(player); }}>
                            Draft
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <button
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            className="w-full py-2.5 text-xs font-display font-bold text-citrus-forest bg-citrus-sage/10 hover:bg-citrus-sage/20 transition-colors"
          >
            Show more ({filteredAndSortedPlayers.length - visibleCount} remaining)
          </button>
        )}
        {filteredAndSortedPlayers.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No players found.
          </div>
        )}
      </div>

      {/* Desktop: Full table view — horizontally scrollable to show all stats */}
      <div className="hidden md:block border border-fantasy-border rounded-lg bg-[#E8EED9]/50 backdrop-blur-sm min-w-0">
        <div className="overflow-auto scrollbar-styled max-h-[calc(100dvh-18rem)]" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[1400px] text-sm border-collapse">
            <thead className="bg-fantasy-light sticky top-0 z-20 border-b border-fantasy-border">
              <tr>
                <th
                  className="px-1.5 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs w-[44px]"
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
                <th className="px-2 py-2 text-left font-semibold text-fantasy-dark sticky left-[44px] bg-fantasy-light/95 z-10 min-w-[160px]">Player</th>
                <th className="px-2 py-2 text-left font-semibold text-fantasy-dark">Pos</th>
                <th className="px-2 py-2 text-left font-semibold text-fantasy-dark">Team</th>
                <th className="px-2 py-2 text-center font-semibold text-fantasy-dark">GP</th>
                {/* Conditionally show goalie or skater stats based on filter */}
                {selectedPosition === 'G' ? (
                  <>
                    <th
                      className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                    <th
                      className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                    <th
                      className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                    <th
                      className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                    <th
                      className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                    <th
                      className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                    <th
                      className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                <th
                  className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                <th
                  className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-bold text-green-700 bg-green-50/50 cursor-pointer hover:bg-green-100/50 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-bold text-green-700 bg-green-50/50 cursor-pointer hover:bg-green-100/50 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-bold text-blue-700 bg-blue-50/50 cursor-pointer hover:bg-blue-100/50 transition-colors select-none text-xs"
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
                <th
                  className="px-2 py-1.5 text-center font-bold text-blue-700 bg-blue-50/50 cursor-pointer hover:bg-blue-100/50 transition-colors select-none text-xs"
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
                <th className="px-2 py-1.5 text-center font-semibold text-fantasy-dark text-xs">Actions</th>
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
            className="w-full py-2 text-xs font-display font-bold text-citrus-forest bg-citrus-sage/10 hover:bg-citrus-sage/20 border-t border-fantasy-border transition-colors"
          >
            Show more ({filteredAndSortedPlayers.length - visibleCount} remaining)
          </button>
        )}
        {filteredAndSortedPlayers.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No players found. Try adjusting your filters.
          </div>
        )}
      </div>
    </Card>
  );
});

PlayerPool.displayName = 'PlayerPool';