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
    <div className="mb-6 bg-gradient-to-br from-citrus-forest via-citrus-charcoal to-citrus-forest border-4 border-citrus-sage rounded-varsity shadow-varsity overflow-hidden hover:shadow-[0_8px_0_0_rgba(124,181,24,0.3),0_4px_16px_rgba(124,181,24,0.4)] transition-all duration-300">
      {/* 1970s HOCKEY SCOREBOARD HEADER */}
      <div className="relative px-4 py-4 md:px-6 md:py-5 bg-gradient-to-r from-citrus-forest via-citrus-charcoal to-citrus-forest border-b-3 border-citrus-sage/30">
        {/* Vintage texture overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_#AAD1A3_2px,_transparent_2px)] bg-[length:32px_32px] opacity-5"></div>
        
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
          {/* MY TEAM - GREEN SIDE */}
          <div className="flex-1 min-w-0 w-full md:w-auto order-1">
            <div className="flex items-center gap-3">
              {/* Varsity Badge */}
              <div className="flex-shrink-0 w-10 h-10 rounded-varsity bg-gradient-to-br from-citrus-sage to-[#7CB518] border-2 border-citrus-forest shadow-patch flex items-center justify-center">
                <span className="font-varsity text-lg font-black text-citrus-forest">H</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-varsity text-sm md:text-base font-black text-citrus-sage uppercase tracking-wide truncate">{myTeamName}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-display text-[10px] md:text-xs text-citrus-cream/80 font-bold">
                    {myTeamRecord.wins}-{myTeamRecord.losses}
                  </span>
                  <span className="text-citrus-cream/40">•</span>
                  <span className="font-display text-[10px] md:text-xs text-citrus-sage/80 uppercase tracking-wider">Home</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* SCOREBOARD - CENTER PIECE */}
          <div className="flex items-center gap-4 md:gap-6 px-6 md:px-10 order-3 md:order-2 bg-citrus-charcoal/50 border-2 border-citrus-sage/30 rounded-varsity py-4 relative">
            {/* Period indicator (always show "WEEK") */}
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-citrus-orange border-2 border-citrus-forest px-3 py-0.5 rounded-lg shadow-patch">
              <span className="font-varsity text-[9px] font-black text-citrus-cream uppercase tracking-widest">WEEK</span>
            </div>
            
            {/* My Score */}
            <div className="text-center relative">
              <div className={`font-varsity text-4xl md:text-5xl lg:text-6xl font-black leading-none tracking-tight transition-all ${
                isWinning ? 'text-citrus-sage drop-shadow-[0_0_12px_rgba(170,209,163,0.8)]' : 'text-citrus-cream'
              }`}>
                {myTeamPoints}
              </div>
              {isWinning && (
                <div className="absolute -top-2 -right-2 w-4 h-4 bg-citrus-sage rounded-full border-2 border-citrus-forest animate-pulse"></div>
              )}
            </div>
            
            {/* Center Divider */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-0.5 h-12 bg-gradient-to-b from-citrus-sage via-citrus-orange to-citrus-peach rounded-full"></div>
              {isTied && (
                <span className="font-varsity text-[8px] font-black text-citrus-orange uppercase tracking-widest">TIE</span>
              )}
            </div>
            
            {/* Opponent Score */}
            <div className="text-center relative">
              <div className={`font-varsity text-4xl md:text-5xl lg:text-6xl font-black leading-none tracking-tight transition-all ${
                isLosing ? 'text-citrus-orange drop-shadow-[0_0_12px_rgba(223,117,54,0.8)]' : 'text-citrus-cream'
              }`}>
                {opponentTeamPoints}
              </div>
              {isLosing && (
                <div className="absolute -top-2 -right-2 w-4 h-4 bg-citrus-orange rounded-full border-2 border-citrus-forest animate-pulse"></div>
              )}
            </div>
          </div>
          
          {/* OPPONENT TEAM - ORANGE SIDE */}
          <div className="flex-1 min-w-0 flex justify-end w-full md:w-auto order-2 md:order-3">
            <div className="flex items-center gap-3 max-w-full">
              <div className="min-w-0 flex-1 md:flex-none text-right">
                <div className="font-varsity text-sm md:text-base font-black text-citrus-orange uppercase tracking-wide truncate">{opponentTeamName}</div>
                <div className="flex items-center justify-end gap-2 mt-1">
                  <span className="font-display text-[10px] md:text-xs text-citrus-orange/80 uppercase tracking-wider">Away</span>
                  <span className="text-citrus-cream/40">•</span>
                  <span className="font-display text-[10px] md:text-xs text-citrus-cream/80 font-bold">
                    {opponentTeamRecord.wins}-{opponentTeamRecord.losses}
                  </span>
                </div>
              </div>
              {/* Varsity Badge */}
              <div className="flex-shrink-0 w-10 h-10 rounded-varsity bg-gradient-to-br from-citrus-orange to-citrus-peach border-2 border-citrus-forest shadow-patch flex items-center justify-center">
                <span className="font-varsity text-lg font-black text-citrus-forest">A</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* 1970s WIN PROBABILITY BAR */}
      <div className="relative px-4 md:px-6 py-3 md:py-4 bg-gradient-to-r from-citrus-forest/80 to-citrus-charcoal/80">
        {/* Ice texture */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,_transparent_48%,_#AAD1A3_48%,_#AAD1A3_52%,_transparent_52%)] opacity-5"></div>
        
        <div className="flex flex-col gap-2 relative z-10">
          <div className="flex items-center justify-between">
            <span className="font-varsity text-[10px] font-black text-citrus-sage uppercase tracking-widest">Win Probability</span>
            <span className="font-varsity text-sm font-black text-citrus-cream">{winProbability}%</span>
          </div>
          
          {/* Hockey Rink Style Progress Bar */}
          <div className="relative h-4 bg-citrus-cream/10 rounded-lg overflow-hidden border-2 border-citrus-sage/20">
            <div className="absolute inset-0 flex">
              <div 
                className="h-full bg-gradient-to-r from-citrus-sage to-[#7CB518] transition-all duration-700 relative"
                style={{ width: `${winProbability}%` }}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_#FFFDF2_2px,_transparent_2px)] bg-[length:12px_12px] opacity-20"></div>
              </div>
              <div 
                className="h-full bg-gradient-to-l from-citrus-orange to-citrus-peach flex-grow transition-all duration-700 relative"
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
