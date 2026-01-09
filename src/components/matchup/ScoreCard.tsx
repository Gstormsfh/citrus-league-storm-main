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
    <div className="mb-6 rounded-[2rem] bg-citrus-cream corduroy-texture border-4 border-citrus-forest shadow-[0_8px_0_rgba(27,48,34,0.2)] overflow-hidden">
      {/* Header with team badges */}
      <div className="relative px-4 py-4 md:px-6 md:py-5 bg-citrus-cream border-b-4 border-citrus-forest">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Team 1 Badge - Embroidered patch */}
          <div className="flex items-center gap-3 p-3 bg-citrus-sage/15 rounded-2xl border-3 border-citrus-sage">
            <div className="w-12 h-12 rounded-full bg-citrus-sage border-4 border-citrus-forest flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)]">
              <span className="font-varsity text-xl text-citrus-cream">H</span>
            </div>
            <div>
              <div className="font-varsity text-sm text-citrus-sage uppercase">{myTeamName}</div>
              <div className="font-mono text-xs text-citrus-forest">{myTeamRecord.wins}-{myTeamRecord.losses}</div>
            </div>
          </div>
          
          {/* Center scores with stitched divider */}
          <div className="flex items-center gap-6 relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-citrus-peach/80 border-2 border-citrus-orange text-citrus-forest font-varsity text-xs px-3 py-1 rounded-varsity shadow-patch">
              WEEK
            </div>
            <div className="text-center">
              <div className={`font-varsity text-6xl ${isWinning ? 'text-citrus-sage' : 'text-citrus-charcoal'}`}>{myTeamPoints}</div>
            </div>
            <div className="w-1 h-20 border-l-2 border-dashed border-citrus-forest/30"></div>
            <div className="text-center">
              <div className={`font-varsity text-6xl ${isLosing ? 'text-citrus-peach' : 'text-citrus-charcoal'}`}>{opponentTeamPoints}</div>
            </div>
          </div>
          
          {/* Team 2 Badge */}
          <div className="flex items-center gap-3 p-3 bg-citrus-peach/15 rounded-2xl border-3 border-citrus-peach">
            <div>
              <div className="font-varsity text-sm text-citrus-peach uppercase text-right">{opponentTeamName}</div>
              <div className="font-mono text-xs text-citrus-forest text-right">{opponentTeamRecord.wins}-{opponentTeamRecord.losses}</div>
            </div>
            <div className="w-12 h-12 rounded-full bg-citrus-peach border-4 border-citrus-forest flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)]">
              <span className="font-varsity text-xl text-citrus-cream">A</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Win probability - embroidered bar */}
      <div className="px-6 pb-6">
        <div className="mb-2 flex justify-between items-center">
          <span className="font-varsity text-xs text-citrus-forest uppercase">Win Probability</span>
          <span className="font-display font-bold text-citrus-forest">{winProbability}%</span>
        </div>
        <div className="h-8 rounded-full overflow-hidden border-3 border-citrus-forest bg-citrus-cream shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]">
          <div className="flex h-full">
            <div className="bg-citrus-sage" style={{ width: `${winProbability}%` }} />
            <div className="bg-citrus-peach flex-grow" style={{ width: `${100-winProbability}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
};
