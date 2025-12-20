interface ScoreCardProps {
  myTeamName: string;
  myTeamRecord: { wins: number; losses: number };
  opponentTeamName: string;
  opponentTeamRecord: { wins: number; losses: number };
  myTeamPoints: string;
  opponentTeamPoints: string;
}

export const ScoreCard = ({
  myTeamName,
  myTeamRecord,
  opponentTeamName,
  opponentTeamRecord,
  myTeamPoints,
  opponentTeamPoints,
}: ScoreCardProps) => {
  // Calculate win probability based on scores
  const myPointsNum = parseFloat(myTeamPoints) || 0;
  const oppPointsNum = parseFloat(opponentTeamPoints) || 0;
  const totalPoints = myPointsNum + oppPointsNum;
  const winProbability = totalPoints > 0 ? Math.round((myPointsNum / totalPoints) * 100) : 50;
  const isWinning = myPointsNum > oppPointsNum;
  
  return (
    <div className="mb-6 bg-card/60 backdrop-blur-sm border border-border/40 rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-200">
      {/* Main Score Display - Sleeper Style Compact */}
      <div className="px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
          {/* My Team Section - Left */}
          <div className="flex-1 min-w-0 w-full md:w-auto order-1 md:order-1">
            <div className="flex items-center gap-2.5">
              <div className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-fantasy-secondary shadow-sm ring-1 ring-fantasy-secondary/20"></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm md:text-base font-bold text-foreground truncate leading-tight">{myTeamName}</div>
                <div className="text-[10px] md:text-xs text-muted-foreground mt-0.5 md:mt-1 font-medium">
                  {myTeamRecord.wins}-{myTeamRecord.losses} W-L
                </div>
              </div>
            </div>
          </div>
          
          {/* Score Display - Center (Focal Point) */}
          <div className="flex items-baseline gap-3 md:gap-5 px-4 md:px-8 flex-shrink-0 order-3 md:order-2 w-full md:w-auto justify-center">
            <div className="text-center">
              <div className="text-3xl md:text-4xl lg:text-5xl font-extrabold leading-none tracking-tight text-[hsl(var(--vibrant-green))]">
                {myTeamPoints}
              </div>
              <div className="text-[9px] md:text-[10px] text-muted-foreground/60 mt-0.5 md:mt-1 font-medium uppercase tracking-wider">Pts</div>
            </div>
            <div className="text-muted-foreground/25 text-lg md:text-xl font-light pb-1">—</div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl lg:text-5xl font-extrabold leading-none tracking-tight text-foreground/80">
                {opponentTeamPoints}
              </div>
              <div className="text-[9px] md:text-[10px] text-muted-foreground/60 mt-0.5 md:mt-1 font-medium uppercase tracking-wider">Pts</div>
            </div>
          </div>
          
          {/* Opponent Team Section - Right */}
          <div className="flex-1 min-w-0 flex justify-end w-full md:w-auto order-2 md:order-3">
            <div className="flex items-center gap-2.5 max-w-full w-full md:w-auto justify-end">
              <div className="min-w-0 flex-1 md:flex-none text-right">
                <div className="text-sm md:text-base font-bold text-foreground truncate leading-tight">{opponentTeamName}</div>
                <div className="text-[10px] md:text-xs text-muted-foreground mt-0.5 md:mt-1 font-medium">
                  {opponentTeamRecord.wins}-{opponentTeamRecord.losses} W-L
                </div>
              </div>
              <div className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-[hsl(var(--vibrant-orange))] shadow-sm ring-1 ring-[hsl(var(--vibrant-orange))]/20"></div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Subtle Win Probability Indicator - Centered at bottom */}
      <div className="px-4 md:px-6 py-2.5 md:py-3 bg-muted/10 border-t border-border/20">
        <div className="flex flex-col items-center gap-2">
          <span className="text-[10px] md:text-xs text-muted-foreground font-semibold uppercase tracking-wider">Win Probability</span>
          <div className="flex items-center gap-2.5 w-full max-w-[280px]">
            <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-fantasy-secondary via-fantasy-primary to-fantasy-tertiary rounded-full transition-all duration-500 ease-out shadow-sm"
                style={{ width: `${winProbability}%` }}
              />
            </div>
            <span className="text-[10px] md:text-xs font-bold text-foreground min-w-[38px] text-right">
              {winProbability}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
