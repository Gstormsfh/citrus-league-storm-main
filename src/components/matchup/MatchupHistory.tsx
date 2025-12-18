
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchupService } from "@/services/MatchupService";
import { getWeekLabel } from "@/utils/weekCalculator";

interface MatchupHistoryProps {
  leagueId?: string;
  userTeamId?: string;
  opponentTeamId?: string | null;
  userTeamName?: string;
  opponentTeamName?: string;
  firstWeekStart?: Date | null;
}

interface MatchupHistoryItem {
  week: number;
  weekLabel: string;
  userScore: number;
  opponentScore: number;
  isWin: boolean;
}

export const MatchupHistory = ({ 
  leagueId, 
  userTeamId, 
  opponentTeamId, 
  userTeamName = "My Team",
  opponentTeamName = "Opponent",
  firstWeekStart 
}: MatchupHistoryProps) => {
  const [history, setHistory] = useState<MatchupHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);

  useEffect(() => {
    const loadHistory = async () => {
      if (!leagueId || !userTeamId || !opponentTeamId || !firstWeekStart) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const { matchups, error } = await MatchupService.getMatchupHistory(
          leagueId,
          userTeamId,
          opponentTeamId
        );

        if (error) {
          console.error('Error loading matchup history:', error);
          setHistory([]);
          setLoading(false);
          return;
        }

        // Transform matchups to display format
        const historyItems: MatchupHistoryItem[] = (matchups || []).map(m => {
          const isUserTeam1 = m.team1Id === userTeamId;
          const userScore = isUserTeam1 ? m.team1Score : m.team2Score;
          const opponentScore = isUserTeam1 ? m.team2Score : m.team1Score;
          const isWin = userScore > opponentScore;

          return {
            week: m.week,
            weekLabel: getWeekLabel(m.week, firstWeekStart),
            userScore,
            opponentScore,
            isWin
          };
        });

        // Calculate wins and losses
        const winCount = historyItems.filter(h => h.isWin).length;
        const lossCount = historyItems.filter(h => !h.isWin).length;

        setHistory(historyItems);
        setWins(winCount);
        setLosses(lossCount);
      } catch (error) {
        console.error('Error in loadHistory:', error);
        setHistory([]);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [leagueId, userTeamId, opponentTeamId, firstWeekStart]);

  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Matchup History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Matchup History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg mb-2">No matchup history yet</p>
            <p className="text-sm">This is your first matchup with {opponentTeamName}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Matchup History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {history.map((item) => (
            <div key={item.week} className="flex items-center justify-between p-3 bg-fantasy-light rounded-md">
              <div>
                <span className="block text-sm mb-1">{item.weekLabel}</span>
                <div className="flex items-center">
                  <span className="font-medium">{userTeamName}</span>
                  <span className={`mx-2 font-bold ${item.isWin ? 'text-fantasy-positive' : 'text-fantasy-danger'}`}>
                    {item.isWin ? 'W' : 'L'}
                  </span>
                  <span>{item.userScore.toFixed(1)}-{item.opponentScore.toFixed(1)}</span>
                </div>
              </div>
              <div className="text-muted-foreground">vs. {opponentTeamName}</div>
            </div>
          ))}
        </div>
        
        <div className="mt-6 text-center">
          <div className="inline-flex items-center bg-fantasy-light rounded-lg p-2">
            <div className="px-3 py-1 text-center">
              <div className="text-xl font-bold">{wins}</div>
              <div className="text-xs text-muted-foreground">WINS</div>
            </div>
            <div className="px-3 py-1 border-l border-r border-fantasy-border text-center">
              <div className="text-xl font-bold">{losses}</div>
              <div className="text-xs text-muted-foreground">LOSS</div>
            </div>
            <div className="px-3 py-1 text-center">
              <div className="text-xl font-bold">{winRate}%</div>
              <div className="text-xs text-muted-foreground">WIN RATE</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
