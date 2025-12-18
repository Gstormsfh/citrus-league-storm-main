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
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          Draft History
        </h2>
        <div className="text-sm text-muted-foreground">
          {draftHistory.length} picks made
        </div>
      </div>

      {draftHistory.length > 0 ? (
        <div className="border border-fantasy-border rounded-lg overflow-hidden bg-white">
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
      ) : (
        <div className="text-center py-12">
          <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <div className="text-muted-foreground mb-2">No picks made yet</div>
          <div className="text-sm text-muted-foreground">
            Draft history will appear here as picks are made
          </div>
        </div>
      )}
    </Card>
  );
};