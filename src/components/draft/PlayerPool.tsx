import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Star, Eye, EyeOff, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Player } from '@/services/PlayerService';

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
}

// Normalize position (L -> LW, R -> RW)
const normalizePosition = (pos: string): string => {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  return upper;
};

export const PlayerPool = ({ 
  onPlayerSelect, 
  onPlayerDraft, 
  selectedPlayer, 
  draftedPlayers, 
  isDraftActive,
  availablePlayers,
  onAddToQueue,
  onToggleWatchlist,
  queue = [],
  watchlist = new Set()
}: PlayerPoolProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('All');
  const [sortBy, setSortBy] = useState('points');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showDrafted, setShowDrafted] = useState(false);


  const filteredAndSortedPlayers = useMemo(() => {
    const filtered = availablePlayers.filter(player => {
      const matchesSearch = player.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           player.team.toLowerCase().includes(searchTerm.toLowerCase());
      const normalizedPlayerPos = normalizePosition(player.position);
      const normalizedFilterPos = normalizePosition(selectedPosition);
      const matchesPosition = selectedPosition === 'All' || 
        normalizedPlayerPos === normalizedFilterPos ||
        (selectedPosition === 'F' && ['C', 'LW', 'RW'].includes(normalizedPlayerPos));
      const isDrafted = draftedPlayers.includes(player.id);
      const matchesDraftStatus = showDrafted ? true : !isDrafted;
      
      return matchesSearch && matchesPosition && matchesDraftStatus;
    });

    filtered.sort((a, b) => {
      let comparison = 0;
      const isGoalie = a.position === 'G' || b.position === 'G';
      
      // Goalie-specific sorting
      if (isGoalie && selectedPosition === 'G') {
        switch (sortBy) {
          case 'wins':
            comparison = (b.wins || 0) - (a.wins || 0);
            break;
          case 'gaa': {
            // Lower GAA is better, so reverse the comparison
            const gaaA = a.goals_against_average || 999;
            const gaaB = b.goals_against_average || 999;
            comparison = gaaA - gaaB;
            break;
          }
          case 'savePct': {
            // Higher save % is better
            const svA = a.save_percentage || 0;
            const svB = b.save_percentage || 0;
            comparison = svB - svA;
            break;
          }
          case 'saves':
            comparison = (b.saves || 0) - (a.saves || 0);
            break;
          case 'name':
            comparison = a.full_name.localeCompare(b.full_name);
            break;
          default:
            comparison = (b.wins || 0) - (a.wins || 0);
        }
      } else {
        // Skater sorting
        switch (sortBy) {
          case 'points':
            comparison = b.points - a.points;
            break;
          case 'goals':
            comparison = b.goals - a.goals;
            break;
          case 'assists':
            comparison = b.assists - a.assists;
            break;
          case 'shots':
            comparison = b.shots - a.shots;
            break;
          case 'hits':
            comparison = b.hits - a.hits;
            break;
          case 'blocks':
            comparison = b.blocks - a.blocks;
            break;
          case 'xGoals':
            comparison = b.xGoals - a.xGoals;
            break;
          case 'name':
            comparison = a.full_name.localeCompare(b.full_name);
            break;
          default:
            comparison = b.points - a.points;
        }
      }
      return sortDirection === 'desc' ? comparison : -comparison;
    });

    return filtered;
  }, [searchTerm, selectedPosition, sortBy, sortDirection, draftedPlayers, showDrafted, availablePlayers]);

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

  const PlayerRow = ({ player }: { player: Player }) => {
    const isSelected = selectedPlayer?.id === player.id;
    const isDrafted = draftedPlayers.includes(player.id);
    const isInQueue = queue.includes(player.id);

    return (
      <tr
        className={cn(
          'border-b border-fantasy-border/50 hover:bg-fantasy-light/30 transition-colors cursor-pointer',
          isSelected && 'bg-fantasy-primary/10 ring-2 ring-fantasy-primary/30',
          isDrafted && 'opacity-50'
        )}
        onClick={() => !isDrafted && onPlayerSelect(player)}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            {isInQueue && (
              <Star className="h-3 w-3 fill-fantasy-tertiary text-fantasy-tertiary" />
            )}
            <span className="font-medium text-sm">{player.full_name}</span>
          </div>
        </td>
        <td className="px-3 py-2">
          <Badge variant="outline" className="text-xs">
            {normalizePosition(player.position)}
          </Badge>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{player.team}</td>
        <td className="px-3 py-2 text-xs text-center font-medium">{player.games_played}</td>
        {player.position === 'G' ? (
          <>
            <td className="px-3 py-2 text-xs text-center font-semibold">{player.wins || 0}</td>
            <td className="px-3 py-2 text-xs text-center">{player.goals_against_average ? player.goals_against_average.toFixed(2) : '0.00'}</td>
            <td className="px-3 py-2 text-xs text-center">{player.save_percentage ? (player.save_percentage * 100).toFixed(3) : '0.000'}%</td>
            <td className="px-3 py-2 text-xs text-center">{player.saves || 0}</td>
            <td className="px-3 py-2 text-xs text-center">-</td>
            <td className="px-3 py-2 text-xs text-center">-</td>
            <td className="px-3 py-2 text-xs text-center text-muted-foreground">-</td>
            <td className="px-3 py-2 text-xs text-center text-muted-foreground">-</td>
          </>
        ) : (
          <>
            <td className="px-3 py-2 text-xs text-center font-semibold">{player.points}</td>
            <td className="px-3 py-2 text-xs text-center">{player.goals}</td>
            <td className="px-3 py-2 text-xs text-center">{player.assists}</td>
            <td className="px-3 py-2 text-xs text-center">{player.shots}</td>
            <td className="px-3 py-2 text-xs text-center">{player.hits}</td>
            <td className="px-3 py-2 text-xs text-center">{player.blocks}</td>
            <td className="px-3 py-2 text-xs text-center text-muted-foreground">{player.xGoals.toFixed(2)}</td>
            {/* Corsi/Fenwick intentionally removed */}
          </>
        )}
        <td className="px-3 py-2">
          <div className="flex items-center gap-1 relative z-10" onClick={(e) => e.stopPropagation()}>
            {onAddToQueue && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 relative z-20"
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
  };

  return (
    <Card className="p-4 border-fantasy-border bg-fantasy-surface">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2 text-fantasy-dark">
          <Star className="h-5 w-5 text-fantasy-primary" />
          Available Players
        </h2>
        <div className="text-sm text-muted-foreground">
          {filteredAndSortedPlayers.length} players
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        <div className="relative col-span-2">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search players or teams..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-citrus-cream border-fantasy-border"
          />
        </div>
        
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Position</Label>
          <Select value={selectedPosition} onValueChange={setSelectedPosition}>
            <SelectTrigger className="bg-citrus-cream border-fantasy-border">
              <SelectValue placeholder="Position" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Positions</SelectItem>
              <SelectItem value="C">C</SelectItem>
              <SelectItem value="LW">LW</SelectItem>
              <SelectItem value="RW">RW</SelectItem>
              <SelectItem value="D">D</SelectItem>
              <SelectItem value="G">G</SelectItem>
              <SelectItem value="F">Forwards</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Sort By</Label>
          <Select value={sortBy} onValueChange={(value) => {
            setSortBy(value);
            setSortDirection('desc');
          }}>
            <SelectTrigger className="bg-citrus-cream border-fantasy-border">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {selectedPosition === 'G' ? (
                <>
                  <SelectItem value="wins">Wins</SelectItem>
                  <SelectItem value="gaa">GAA</SelectItem>
                  <SelectItem value="savePct">Save %</SelectItem>
                  <SelectItem value="saves">Saves</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="points">Points</SelectItem>
                  <SelectItem value="goals">Goals</SelectItem>
                  <SelectItem value="assists">Assists</SelectItem>
                  <SelectItem value="shots">Shots</SelectItem>
                  <SelectItem value="hits">Hits</SelectItem>
                  <SelectItem value="blocks">Blocks</SelectItem>
                  <SelectItem value="xGoals">xGoals</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <Button
            variant={showDrafted ? "default" : "outline"}
            size="sm"
            onClick={() => setShowDrafted(!showDrafted)}
            className="h-9"
            title={showDrafted ? "Hide drafted players" : "Show drafted players"}
          >
            {showDrafted ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Player List Table */}
      <div className="border border-fantasy-border rounded-lg overflow-hidden bg-citrus-cream">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-fantasy-light/50 border-b border-fantasy-border">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-fantasy-dark">Player</th>
                <th className="px-3 py-2 text-left font-semibold text-fantasy-dark">Pos</th>
                <th className="px-3 py-2 text-left font-semibold text-fantasy-dark">Team</th>
                <th className="px-3 py-2 text-center font-semibold text-fantasy-dark">GP</th>
                {/* Conditionally show goalie or skater stats based on filter */}
                {selectedPosition === 'G' ? (
                  <>
                    <th 
                      className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                      className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                      className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                      className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
                      onClick={() => handleHeaderClick('saves')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        Saves
                        {sortBy === 'saves' && (
                          sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        )}
                        {sortBy !== 'saves' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </div>
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-fantasy-dark">-</th>
                    <th className="px-3 py-2 text-center font-semibold text-fantasy-dark">-</th>
                    <th className="px-3 py-2 text-center font-semibold text-fantasy-dark">-</th>
                    <th className="px-3 py-2 text-center font-semibold text-fantasy-dark">-</th>
                  </>
                ) : (
                  <>
                    <th 
                      className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                  className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                  className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                  className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                  className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                  className="px-3 py-2 text-center font-semibold text-fantasy-dark cursor-pointer hover:bg-fantasy-light/70 transition-colors select-none"
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
                    <th className="px-3 py-2 text-center font-semibold text-fantasy-dark">CF%</th>
                  </>
                )}
                <th className="px-3 py-2 text-center font-semibold text-fantasy-dark">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedPlayers.map(player => (
                <PlayerRow key={player.id} player={player} />
              ))}
            </tbody>
          </table>
        </div>
        {filteredAndSortedPlayers.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No players found. Try adjusting your filters.
          </div>
        )}
      </div>
    </Card>
  );
};