import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Player } from '@/services/PlayerService';
import { DraftPick } from '@/services/DraftService';

interface RosterDepthChartProps {
  draftedPlayers: Player[];
  draftPicks: DraftPick[];
  currentRound: number;
  totalRounds: number;
  availablePlayers?: Player[];
  onAddToQueue?: (playerId: string) => void;
}

// Normalize position (L -> LW, R -> RW)
const normalizePosition = (pos: string): string => {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  return upper;
};

// Starting lineup slots (what actually plays)
const startingLineup = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
const positionColors = {
  'C': 'bg-fantasy-primary/10',
  'LW': 'bg-fantasy-secondary/10',
  'RW': 'bg-fantasy-tertiary/10',
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
  onAddToQueue
}: RosterDepthChartProps) => {
  // Separate players into starters and bench
  const { starters, bench } = useMemo(() => {
    const starters: Array<{ player: Player; position: string; slotIndex: number }> = [];
    const bench: Player[] = [];
    
    // Group players by position
    const playersByPos: Record<string, Player[]> = {
      'C': [], 'LW': [], 'RW': [], 'D': [], 'G': [], 'UTIL': []
    };
    
    draftedPlayers.forEach(player => {
      const pos = normalizePosition(player.position);
      // For players that can play multiple positions, try to assign to primary position first
      if (pos === 'C' || pos === 'LW' || pos === 'RW' || pos === 'D' || pos === 'G') {
        playersByPos[pos].push(player);
      } else {
        // Unknown position goes to UTIL candidates
        playersByPos['UTIL'].push(player);
      }
    });
    
    // Sort each position by points (best players first)
    Object.keys(playersByPos).forEach(pos => {
      playersByPos[pos].sort((a, b) => b.points - a.points);
    });
    
    // Assign to starting lineup slots
    const slotsFilled: Record<string, number> = {
      'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0
    };
    
    // First, fill primary positions
    (['C', 'LW', 'RW', 'D', 'G'] as const).forEach(pos => {
      const players = playersByPos[pos];
      const slotsNeeded = startingLineup[pos];
      
      for (let i = 0; i < Math.min(players.length, slotsNeeded); i++) {
        starters.push({ player: players[i], position: pos, slotIndex: i });
        slotsFilled[pos]++;
      }
      
      // Remaining players at this position go to bench
      for (let i = slotsNeeded; i < players.length; i++) {
        bench.push(players[i]);
      }
    });
    
    // Fill UTIL slot with best available forward/defenseman (not goalies)
    const utilCandidates: Player[] = [];
    ['C', 'LW', 'RW', 'D'].forEach(pos => {
      const players = playersByPos[pos];
      const slotsNeeded = startingLineup[pos];
      // Players beyond starting slots can be used for UTIL
      for (let i = slotsNeeded; i < players.length; i++) {
        utilCandidates.push(players[i]);
      }
    });
    // Also include any players that were already in UTIL group
    utilCandidates.push(...playersByPos['UTIL']);
    utilCandidates.sort((a, b) => b.points - a.points);
    
    // Fill UTIL slot
    if (slotsFilled['UTIL'] < startingLineup['UTIL'] && utilCandidates.length > 0) {
      const utilPlayer = utilCandidates[0];
      starters.push({ player: utilPlayer, position: 'UTIL', slotIndex: 0 });
      slotsFilled['UTIL']++;
      // Remove from bench if it was there
      const benchIndex = bench.findIndex(p => p.id === utilPlayer.id);
      if (benchIndex >= 0) {
        bench.splice(benchIndex, 1);
      }
    }
    
    // Any remaining players go to bench
    // (already handled above, but double-check)
    
    return { starters, bench };
  }, [draftedPlayers]);

  return (
    <Card className="border-fantasy-border bg-fantasy-surface">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-fantasy-dark">
          Your Roster
        </CardTitle>
        <div className="text-xs text-muted-foreground mt-1">
          Round {currentRound}/{totalRounds} • {draftedPlayers.length} players
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Starting Lineup Section */}
        <div>
          <h3 className="text-sm font-semibold text-fantasy-dark mb-2">Starting Lineup</h3>
          <div className="border border-fantasy-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-fantasy-light/50 border-b border-fantasy-border">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-fantasy-dark">Position</th>
                  <th className="px-3 py-2 text-left font-semibold text-fantasy-dark">Player</th>
                  <th className="px-3 py-2 text-right font-semibold text-fantasy-dark">Points</th>
                  <th className="px-3 py-2 text-right font-semibold text-fantasy-dark">Round</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(startingLineup).map(([pos, slots]) => {
                  const colors = positionColors[pos as keyof typeof positionColors] || '';
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
                              colors, // Light background for position
                              !player && "opacity-50"
                            )}
                          >
                            <td className="px-3 py-2 text-xs font-medium">{pos}</td>
                            <td className="px-3 py-2 text-xs">
                              {player ? (
                                <div className="font-medium">{player.full_name}</div>
                              ) : (
                                <span className="text-muted-foreground italic">Empty</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-right">
                              {player ? player.points : '-'}
                            </td>
                            <td className="px-3 py-2 text-xs text-right">
                              {player ? draftPicks.find(p => p.player_id === player.id)?.round_number : '-'}
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
            <h3 className="text-sm font-semibold text-fantasy-dark mb-2">Bench ({bench.length})</h3>
            <div className="border border-fantasy-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-fantasy-light/50 border-b border-fantasy-border">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-fantasy-dark">Position</th>
                    <th className="px-3 py-2 text-left font-semibold text-fantasy-dark">Player</th>
                    <th className="px-3 py-2 text-right font-semibold text-fantasy-dark">Points</th>
                    <th className="px-3 py-2 text-right font-semibold text-fantasy-dark">Round</th>
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
                        <td className="px-3 py-2 text-xs font-medium">{pos}</td>
                        <td className="px-3 py-2 text-xs">
                          <div className="font-medium">{player.full_name}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-right">
                          {player.points}
                        </td>
                        <td className="px-3 py-2 text-xs text-right">
                          {draftPicks.find(p => p.player_id === player.id)?.round_number || '-'}
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
