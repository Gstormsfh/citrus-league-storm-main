import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { History } from 'lucide-react';

interface DraftPick {
  id: string;
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  position: string;
  round: number;
  pick: number;
  timestamp: number;
  playerTeam?: string; // Optional: player's NHL team
}

interface DraftHistoryProps {
  draftHistory: DraftPick[];
}

export const DraftHistory = ({ draftHistory }: DraftHistoryProps) => {
  const sortedHistory = [...draftHistory].reverse(); // Show most recent first

  return (
    <Card className="p-3 sm:p-6">
      <div className="flex items-center justify-between mb-3 sm:mb-6">
        <h2 className="text-base sm:text-xl font-semibold flex items-center gap-2">
          <History className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
          History
        </h2>
        <div className="text-xs sm:text-sm text-muted-foreground">
          {draftHistory.length} picks
        </div>
      </div>

      {draftHistory.length > 0 ? (
        <>
          {/* Mobile: Compact card list */}
          <div className="md:hidden border border-fantasy-border rounded-lg overflow-hidden bg-[#E8EED9]/50 backdrop-blur-sm max-h-[60vh] overflow-y-auto">
            {sortedHistory.map((pick) => (
              <div key={pick.id} className="border-b border-fantasy-border/50 px-3 py-2 flex items-center gap-2">
                <span className="text-xs font-bold text-primary w-8 flex-shrink-0">#{pick.pick}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] px-1 py-0 flex-shrink-0">{pick.position}</Badge>
                    <span className="font-medium text-sm truncate">{pick.playerName}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {pick.teamName} • R{pick.round}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: Full table */}
          <div className="hidden md:block border border-fantasy-border rounded-lg overflow-hidden bg-[#E8EED9]/50 backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-fantasy-light/50 border-b border-fantasy-border">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Pick</th>
                    <th className="px-3 py-2 text-left font-semibold">Player</th>
                    <th className="px-3 py-2 text-left font-semibold">Pos</th>
                    <th className="px-3 py-2 text-left font-semibold">Team</th>
                    <th className="px-3 py-2 text-left font-semibold">Drafted By</th>
                    <th className="px-3 py-2 text-center font-semibold">Round</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHistory.map((pick) => (
                    <tr
                      key={pick.id}
                      className="border-b border-fantasy-border/50 hover:bg-fantasy-light/30 transition-colors"
                    >
                      <td className="px-3 py-2 text-center font-medium text-primary">
                        #{pick.pick}
                      </td>
                      <td className="px-3 py-2 font-medium">{pick.playerName}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">
                          {pick.position}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{pick.playerTeam || '-'}</td>
                      <td className="px-3 py-2 text-sm">{pick.teamName}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">
                        R{pick.round}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-8 sm:py-12">
          <History className="h-8 w-8 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-3" />
          <div className="text-muted-foreground text-sm mb-1">No picks made yet</div>
          <div className="text-xs text-muted-foreground">
            History will appear as picks are made
          </div>
        </div>
      )}
    </Card>
  );
};