
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DailyPointsChartProps {
  dayLabels: string[];
  myDailyPoints: number[];
  opponentDailyPoints: number[];
  hasData?: boolean;
}

export const DailyPointsChart = ({ dayLabels, myDailyPoints, opponentDailyPoints, hasData = true }: DailyPointsChartProps) => {
  // Check if we have any data
  const hasAnyPoints = myDailyPoints.some(p => p > 0) || opponentDailyPoints.some(p => p > 0);
  const shouldShowData = hasData && hasAnyPoints;

  if (!shouldShowData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Daily Points Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg mb-2">Matchup hasn't started yet</p>
            <p className="text-sm">Daily points will appear here once the matchup begins</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Points Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2 mb-6">
          {dayLabels.map((day, index) => (
            <div key={day} className="text-center">
              <div className="bg-fantasy-light rounded-t-md py-1 text-xs font-medium">
                {day}
              </div>
              <div className="flex flex-col">
                <div className="h-[100px] bg-fantasy-primary/20 relative">
                  <div 
                    className="absolute bottom-0 left-0 right-0 bg-fantasy-primary"
                    style={{ height: `${Math.min((myDailyPoints[index] / 50) * 100, 100)}%` }}
                  ></div>
                  <div className="absolute bottom-1 left-0 right-0 text-xs text-white font-bold">
                    {myDailyPoints[index].toFixed(1)}
                  </div>
                </div>
                <div className="h-[100px] bg-fantasy-muted/20 relative">
                  <div 
                    className="absolute bottom-0 left-0 right-0 bg-fantasy-muted"
                    style={{ height: `${Math.min((opponentDailyPoints[index] / 50) * 100, 100)}%` }}
                  ></div>
                  <div className="absolute bottom-1 left-0 right-0 text-xs text-white font-bold">
                    {opponentDailyPoints[index].toFixed(1)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        
        <div className="flex justify-center gap-8">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-fantasy-primary mr-2"></div>
            <span className="text-sm">My Team</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 bg-fantasy-muted mr-2"></div>
            <span className="text-sm">Opponent</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
