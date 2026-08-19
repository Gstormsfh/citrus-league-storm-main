import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Player } from '@/services/PlayerService';
import { DraftPick } from '@/services/DraftService';

/* 2026-08-19 visual audit: this panel was still on the ORIGINAL light
   theme (fantasy-surface #FFFFFF, fantasy-dark #1E293B, fantasy-light
   #FFF1DB) while the draft room around it renders on #0F1F15. It read as
   a white box pasted into a dark app. Migrated to the pastel dark
   surface tokens the rest of the room already uses. */


interface RosterDepthChartProps {
  draftedPlayers: Player[];
  draftPicks: DraftPick[];
  currentRound: number;
  totalRounds: number;
  availablePlayers?: Player[];
  onAddToQueue?: (playerId: string) => void;
  /**
   * 'individual' shows C/LW/RW/D/G slots separately; 'forward' collapses
   * C/LW/RW into a single F slot (Yahoo-style). Defaults to 'individual'.
   */
  positionType?: 'individual' | 'forward';
  /**
   * League-configured slot counts (e.g. { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 2 }
   * or { F: 6, D: 4, G: 2, UTIL: 1 }). Overrides the format's default counts
   * when provided so the chart matches what the commissioner actually chose.
   */
  rosterSlots?: Record<string, number>;
}

// Normalize position (L -> LW, R -> RW)
const normalizePosition = (pos: string): string => {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  return upper;
};

// Default starting lineups for each position format. The actual counts can be
// overridden by `rosterSlots` on the league settings.
const DEFAULT_INDIVIDUAL: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1 };
const DEFAULT_FORWARD: Record<string, number> = { F: 6, D: 4, G: 2, UTIL: 1 };

const positionColors: Record<string, string> = {
  'C': 'bg-fantasy-primary/10',
  'LW': 'bg-fantasy-secondary/10',
  'RW': 'bg-fantasy-tertiary/10',
  'F': 'bg-fantasy-primary/10',
  'D': 'bg-blue-50',
  'G': 'bg-purple-50',
  'UTIL': 'bg-yellow-50',
};

export const RosterDepthChart = ({
  draftedPlayers,
  draftPicks,
  currentRound,
  totalRounds,
  availablePlayers = [],
  onAddToQueue,
  positionType = 'individual',
  rosterSlots
}: RosterDepthChartProps) => {
  // Separate players into starters and bench
  const { starters, bench, startingLineup } = useMemo(() => {
    // Derive starting lineup counts from the league's configured rosterSlots,
    // falling back to sensible defaults per position format. Only include
    // keys that are actually relevant to this format to keep the UI clean.
    const keys = positionType === 'forward' ? ['F', 'D', 'G', 'UTIL'] : ['C', 'LW', 'RW', 'D', 'G', 'UTIL'];
    const defaults = positionType === 'forward' ? DEFAULT_FORWARD : DEFAULT_INDIVIDUAL;
    const startingLineup: Record<string, number> = {};
    for (const k of keys) {
      const configured = rosterSlots?.[k];
      startingLineup[k] = (typeof configured === 'number' && configured > 0) ? configured : (defaults[k] || 0);
    }

    const primaryPositions: string[] = positionType === 'forward' ? ['F', 'D', 'G'] : ['C', 'LW', 'RW', 'D', 'G'];
    // UTIL can be filled by any skater (never a goalie)
    const utilCandidatePositions: string[] = positionType === 'forward' ? ['F', 'D'] : ['C', 'LW', 'RW', 'D'];

    const starters: Array<{ player: Player; position: string; slotIndex: number }> = [];
    const bench: Player[] = [];

    // Group players by position — collapse C/LW/RW into F if league is forward format
    const playersByPos: Record<string, Player[]> = {};
    for (const p of primaryPositions) playersByPos[p] = [];
    playersByPos['UTIL'] = [];

    draftedPlayers.forEach(player => {
      const raw = normalizePosition(player.position);
      let bucket: string;
      if (positionType === 'forward' && (raw === 'C' || raw === 'LW' || raw === 'RW')) {
        bucket = 'F';
      } else if (primaryPositions.includes(raw)) {
        bucket = raw;
      } else {
        bucket = 'UTIL';
      }
      playersByPos[bucket].push(player);
    });

    // Sort each position by points (best players first)
    Object.keys(playersByPos).forEach(pos => {
      playersByPos[pos].sort((a, b) => b.points - a.points);
    });

    const slotsFilled: Record<string, number> = {};
    for (const k of Object.keys(startingLineup)) slotsFilled[k] = 0;

    // First, fill primary positions
    primaryPositions.forEach(pos => {
      const players = playersByPos[pos];
      const slotsNeeded = startingLineup[pos] || 0;
      for (let i = 0; i < Math.min(players.length, slotsNeeded); i++) {
        starters.push({ player: players[i], position: pos, slotIndex: i });
        slotsFilled[pos]++;
      }
      for (let i = slotsNeeded; i < players.length; i++) {
        bench.push(players[i]);
      }
    });

    // Fill UTIL slots with best available skater (not goalies)
    const utilCandidates: Player[] = [];
    utilCandidatePositions.forEach(pos => {
      const players = playersByPos[pos];
      const slotsNeeded = startingLineup[pos] || 0;
      for (let i = slotsNeeded; i < players.length; i++) {
        utilCandidates.push(players[i]);
      }
    });
    utilCandidates.push(...(playersByPos['UTIL'] || []));
    utilCandidates.sort((a, b) => b.points - a.points);

    const utilSlots = startingLineup['UTIL'] || 0;
    for (let i = 0; i < Math.min(utilSlots, utilCandidates.length); i++) {
      const utilPlayer = utilCandidates[i];
      starters.push({ player: utilPlayer, position: 'UTIL', slotIndex: i });
      slotsFilled['UTIL']++;
      const benchIndex = bench.findIndex(p => p.id === utilPlayer.id);
      if (benchIndex >= 0) bench.splice(benchIndex, 1);
    }
    
    // Any remaining players go to bench
    // (already handled above, but double-check)

    return { starters, bench, startingLineup };
  }, [draftedPlayers, positionType, rosterSlots]);

  // PERF: O(1) lookup for draft round by player ID instead of O(n) find per slot
  const picksByPlayerId = useMemo(() => {
    const map = new Map<string, DraftPick>();
    draftPicks.forEach(p => map.set(p.player_id, p));
    return map;
  }, [draftPicks]);

  return (
    <Card className="border-white/10">
      <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6">
        <CardTitle className="text-base sm:text-lg font-semibold text-pastel-cream">
          Roster
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          R{currentRound}/{totalRounds} • {draftedPlayers.length} players
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 sm:space-y-4 px-2 sm:px-6">
        {/* Starting Lineup Section */}
        <div>
          <h3 className="text-xs sm:text-sm font-semibold text-pastel-cream mb-1.5 px-1">Starters</h3>
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-white/5 border-b border-white/10">
                <tr>
                  <th className="px-2 sm:px-3 py-1.5 text-left font-semibold text-pastel-cream">Pos</th>
                  <th className="px-2 sm:px-3 py-1.5 text-left font-semibold text-pastel-cream">Player</th>
                  <th className="px-2 sm:px-3 py-1.5 text-right font-semibold text-pastel-cream">PTS</th>
                  <th className="px-2 sm:px-3 py-1.5 text-right font-semibold text-pastel-cream hidden sm:table-cell">Rd</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(startingLineup).map(([pos, slots]) => {
                  const colors = positionColors[pos] || '';
                  return (
                    <>
                      {Array.from({ length: slots }).map((_, idx) => {
                        const starter = starters.find(s => s.position === pos && s.slotIndex === idx);
                        const player = starter?.player;
                        return (
                          <tr
                            key={`${pos}-${idx}`}
                            className={cn(
                              "border-b",
                              colors,
                              !player && "opacity-50"
                            )}
                          >
                            <td className="px-2 sm:px-3 py-1.5 text-xs font-medium">{pos}</td>
                            <td className="px-2 sm:px-3 py-1.5 text-xs">
                              {player ? (
                                <div className="font-medium truncate max-w-[120px] sm:max-w-none">{player.full_name}</div>
                              ) : (
                                <span className="text-muted-foreground italic">-</span>
                              )}
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 text-xs text-right">
                              {player ? player.points : '-'}
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 text-xs text-right hidden sm:table-cell">
                              {player ? picksByPlayerId.get(player.id)?.round_number : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* Bench Section */}
        {bench.length > 0 && (
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-pastel-cream mb-1.5 px-1">Bench ({bench.length})</h3>
            <div className="border border-white/10 rounded-lg overflow-hidden">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr>
                    <th className="px-2 sm:px-3 py-1.5 text-left font-semibold text-pastel-cream">Pos</th>
                    <th className="px-2 sm:px-3 py-1.5 text-left font-semibold text-pastel-cream">Player</th>
                    <th className="px-2 sm:px-3 py-1.5 text-right font-semibold text-pastel-cream">PTS</th>
                    <th className="px-2 sm:px-3 py-1.5 text-right font-semibold text-pastel-cream hidden sm:table-cell">Rd</th>
                  </tr>
                </thead>
                <tbody>
                  {bench.map((player) => {
                    const pos = normalizePosition(player.position);
                    const colors = positionColors[pos as keyof typeof positionColors] || 'bg-muted/20';
                    return (
                      <tr
                        key={player.id}
                        className={cn("border-b", colors)}
                      >
                        <td className="px-2 sm:px-3 py-1.5 text-xs font-medium">{pos}</td>
                        <td className="px-2 sm:px-3 py-1.5 text-xs">
                          <div className="font-medium truncate max-w-[120px] sm:max-w-none">{player.full_name}</div>
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 text-xs text-right">
                          {player.points}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 text-xs text-right hidden sm:table-cell">
                          {picksByPlayerId.get(player.id)?.round_number || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
