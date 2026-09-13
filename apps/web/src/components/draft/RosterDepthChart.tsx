import { isEligibleForPosition, playerEligiblePositionsLabel } from '@citrus/shared';
import { assignMaxWeight } from '@/components/roster/autoLineup';
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
  'D': 'bg-blue-950/20',
  'G': 'bg-purple-950/20',
  'UTIL': 'bg-yellow-950/20',
};

/** Fill compatible slots without spending a dual-eligible player on the only
 * slot a teammate can fill. Maximize filled slots, then existing points. */
export function assignDepthChart(players: Player[], counts: Record<string, number>) {
  const unique = [...new Map(players.map(p => [p.id, p])).values()];
  const slots = Object.entries(counts).flatMap(([position, count]) =>
    Array.from({ length: Math.max(0, Math.floor(count)) }, (_, slotIndex) => ({ position, slotIndex })));
  const pointBound = unique.reduce((sum, p) => sum + Math.abs(Number(p.points) || 0), 0) + 1;
  const weights = slots.map(slot => [
    ...unique.map(p => isEligibleForPosition(p, slot.position)
      ? pointBound + (Number(p.points) || 0) : -1e12),
    ...slots.map(() => 0),
  ]);
  const starters: Array<{ player: Player; position: string; slotIndex: number }> = [];
  assignMaxWeight(weights).forEach((column, row) => {
    if (column < unique.length && weights[row][column] > 0)
      starters.push({ player: unique[column], ...slots[row] });
  });
  const selected = new Set(starters.map(s => s.player.id));
  return { starters, bench: unique.filter(p => !selected.has(p.id)).sort((a, b) => b.points - a.points) };
}

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
      startingLineup[k] = (typeof configured === 'number' && Number.isFinite(configured) && configured >= 0) ? Math.floor(configured) : (defaults[k] || 0);
    }

    const { starters, bench } = assignDepthChart(draftedPlayers, startingLineup);

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
                            <td className="px-2 sm:px-3 py-1.5 text-xs font-medium">{playerEligiblePositionsLabel(player, positionType)}</td>
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
                        <td className="px-2 sm:px-3 py-1.5 text-xs font-medium">{playerEligiblePositionsLabel(player, positionType)}</td>
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
