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
  const isLosing = myPointsNum < oppPointsNum;
  const isTied = Math.abs(myPointsNum - oppPointsNum) < 0.01;
  
  return (
    <div className="mb-6 bg-gradient-to-br from-citrus-cream via-citrus-peach/10 to-citrus-cream border-2 border-citrus-sage/40 rounded-varsity shadow-sm overflow-hidden hover:shadow-md transition-all duration-300">
      {/* PASTEL SCOREBOARD HEADER */}
      <div className="relative px-4 py-4 md:px-6 md:py-5 bg-gradient-to-r from-citrus-cream via-citrus-peach/20 to-citrus-cream border-b-2 border-citrus-sage/30">
        {/* Vintage texture overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_#AAD1A3_2px,_transparent_2px)] bg-[length:32px_32px] opacity-5"></div>
        
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
          {/* MY TEAM - GREEN SIDE */}
          <div className="flex-1 min-w-0 w-full md:w-auto order-1">
            <div className="flex items-center gap-3">
              {/* Varsity Badge */}
              <div className="flex-shrink-0 w-10 h-10 rounded-varsity bg-gradient-to-br from-citrus-sage/40 to-citrus-sage/30 border-2 border-citrus-sage shadow-sm flex items-center justify-center">
                <span className="font-varsity text-lg font-black text-citrus-sage">H</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-varsity text-sm md:text-base font-black text-citrus-sage uppercase tracking-wide truncate">{myTeamName}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-display text-[10px] md:text-xs text-citrus-charcoal/70 font-bold">
                    {myTeamRecord.wins}-{myTeamRecord.losses}
                  </span>
                  <span className="text-citrus-charcoal/40">•</span>
                  <span className="font-display text-[10px] md:text-xs text-citrus-sage uppercase tracking-wider">Home</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* SCOREBOARD - CENTER PIECE */}
          <div className="flex items-center gap-4 md:gap-6 px-6 md:px-10 order-3 md:order-2 bg-citrus-cream/80 border-2 border-citrus-sage/30 rounded-varsity py-4 relative">
            {/* Period indicator (always show "WEEK") */}
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-citrus-peach border-2 border-citrus-orange/50 px-3 py-0.5 rounded-lg shadow-sm">
              <span className="font-varsity text-[9px] font-black text-citrus-charcoal uppercase tracking-widest">WEEK</span>
            </div>
            
            {/* My Score */}
            <div className="text-center relative">
              <div className={`font-varsity text-4xl md:text-5xl lg:text-6xl font-black leading-none tracking-tight transition-all ${
                isWinning ? 'text-citrus-sage drop-shadow-sm' : 'text-citrus-charcoal'
              }`}>
                {myTeamPoints}
              </div>
              {isWinning && (
                <div className="absolute -top-2 -right-2 w-4 h-4 bg-citrus-sage/60 rounded-full border-2 border-citrus-sage animate-pulse"></div>
              )}
            </div>
            
            {/* Center Divider */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-0.5 h-12 bg-gradient-to-b from-citrus-sage/40 via-citrus-orange/40 to-citrus-peach/40 rounded-full"></div>
              {isTied && (
                <span className="font-varsity text-[8px] font-black text-citrus-orange uppercase tracking-widest">TIE</span>
              )}
            </div>
            
            {/* Opponent Score */}
            <div className="text-center relative">
              <div className={`font-varsity text-4xl md:text-5xl lg:text-6xl font-black leading-none tracking-tight transition-all ${
                isLosing ? 'text-citrus-orange drop-shadow-sm' : 'text-citrus-charcoal'
              }`}>
                {opponentTeamPoints}
              </div>
              {isLosing && (
                <div className="absolute -top-2 -right-2 w-4 h-4 bg-citrus-orange/60 rounded-full border-2 border-citrus-orange animate-pulse"></div>
              )}
            </div>
          </div>
          
          {/* OPPONENT TEAM - ORANGE SIDE */}
          <div className="flex-1 min-w-0 flex justify-end w-full md:w-auto order-2 md:order-3">
            <div className="flex items-center gap-3 max-w-full">
              <div className="min-w-0 flex-1 md:flex-none text-right">
                <div className="font-varsity text-sm md:text-base font-black text-citrus-orange uppercase tracking-wide truncate">{opponentTeamName}</div>
                <div className="flex items-center justify-end gap-2 mt-1">
                  <span className="font-display text-[10px] md:text-xs text-citrus-orange uppercase tracking-wider">Away</span>
                  <span className="text-citrus-charcoal/40">•</span>
                  <span className="font-display text-[10px] md:text-xs text-citrus-charcoal/70 font-bold">
                    {opponentTeamRecord.wins}-{opponentTeamRecord.losses}
                  </span>
                </div>
              </div>
              {/* Varsity Badge */}
              <div className="flex-shrink-0 w-10 h-10 rounded-varsity bg-gradient-to-br from-citrus-peach/60 to-citrus-peach/40 border-2 border-citrus-orange shadow-sm flex items-center justify-center">
                <span className="font-varsity text-lg font-black text-citrus-orange">A</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* PASTEL WIN PROBABILITY BAR */}
      <div className="relative px-4 md:px-6 py-3 md:py-4 bg-gradient-to-r from-citrus-cream via-citrus-peach/10 to-citrus-cream">
        {/* Soft texture */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,_transparent_48%,_#AAD1A3_48%,_#AAD1A3_52%,_transparent_52%)] opacity-3"></div>
        
        <div className="flex flex-col gap-2 relative z-10">
          <div className="flex items-center justify-between">
            <span className="font-varsity text-[10px] font-black text-citrus-sage uppercase tracking-widest">Win Probability</span>
            <span className="font-varsity text-sm font-black text-citrus-charcoal">{winProbability}%</span>
          </div>
          
          {/* Soft Progress Bar */}
          <div className="relative h-4 bg-citrus-cream/50 rounded-lg overflow-hidden border border-citrus-sage/20">
            <div className="absolute inset-0 flex">
              <div 
                className="h-full bg-gradient-to-r from-citrus-sage/50 to-citrus-sage/30 transition-all duration-700 relative"
                style={{ width: `${winProbability}%` }}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_#FFFDF2_2px,_transparent_2px)] bg-[length:12px_12px] opacity-20"></div>
              </div>
              <div 
                className="h-full bg-gradient-to-l from-citrus-peach/50 to-citrus-peach/30 flex-grow transition-all duration-700 relative"
                style={{ width: `${100 - winProbability}%` }}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_#FFFDF2_2px,_transparent_2px)] bg-[length:12px_12px] opacity-20"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
