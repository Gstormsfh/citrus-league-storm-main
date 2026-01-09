interface MatchupTotalBarProps {
  team1Score: number;
  team2Score: number;
  team1Name?: string;
  team2Name?: string;
  showLabels?: boolean; // Default true
}

export const MatchupTotalBar = ({ 
  team1Score, 
  team2Score, 
  team1Name = 'Team 1',
  team2Name = 'Team 2',
  showLabels = true
}: MatchupTotalBarProps) => {
  const total = team1Score + team2Score || 1; // Avoid divide by zero
  const percent1 = (team1Score / total) * 100;
  const percent2 = (team2Score / total) * 100;
  const isTied = Math.abs(team1Score - team2Score) < 0.01;
  const team1Leading = team1Score > team2Score;
  const team2Leading = team2Score > team1Score;

  return (
    <div className="w-full">
      {/* PASTEL SCOREBOARD HEADER */}
      <div className="relative bg-gradient-to-r from-citrus-cream via-citrus-peach/20 to-citrus-cream p-3 rounded-t-xl border-2 border-citrus-sage/30">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_#AAD1A3_2px,_transparent_2px)] bg-[length:32px_32px] opacity-5 rounded-t-xl"></div>
        <div className="flex justify-between items-center relative z-10">
          {/* TEAM 1 */}
          <div className="flex-1 flex flex-col items-start gap-1">
            <div className={`font-varsity text-xs uppercase tracking-widest ${team1Leading ? 'text-citrus-sage' : 'text-citrus-charcoal/50'} transition-colors`}>
              {team1Name}
            </div>
            <div className={`font-varsity text-4xl font-black ${team1Leading ? 'text-citrus-sage drop-shadow-sm' : 'text-citrus-charcoal'} transition-all`}>
              {team1Score.toFixed(1)}
            </div>
          </div>

          {/* CENTER DIVIDER */}
          <div className="flex flex-col items-center gap-2 px-4">
            <div className="w-1 h-16 bg-gradient-to-b from-citrus-sage/40 via-citrus-orange/40 to-citrus-peach/40 rounded-full"></div>
            {isTied && (
              <div className="absolute bg-citrus-peach/80 border-2 border-citrus-orange/50 px-3 py-1 rounded-varsity shadow-sm">
                <span className="font-varsity text-[10px] font-black text-citrus-charcoal uppercase tracking-widest">
                  TIED
                </span>
              </div>
            )}
          </div>

          {/* TEAM 2 */}
          <div className="flex-1 flex flex-col items-end gap-1">
            <div className={`font-varsity text-xs uppercase tracking-widest ${team2Leading ? 'text-citrus-orange' : 'text-citrus-charcoal/50'} transition-colors`}>
              {team2Name}
            </div>
            <div className={`font-varsity text-4xl font-black ${team2Leading ? 'text-citrus-orange drop-shadow-sm' : 'text-citrus-charcoal'} transition-all`}>
              {team2Score.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* PASTEL PROGRESS BAR */}
      <div className="relative h-6 bg-citrus-cream border-x-2 border-b-2 border-citrus-sage/30 rounded-b-xl overflow-hidden">
        {/* Soft center line */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,_transparent_48%,_#AAD1A3_48%,_#AAD1A3_52%,_transparent_52%)] opacity-5"></div>
        
        {/* Progress bars */}
        <div className="absolute inset-0 flex">
          <div 
            className="h-full bg-gradient-to-r from-citrus-sage/60 to-citrus-sage/40 transition-all duration-700 border-r border-citrus-sage/30 relative" 
            style={{ width: `${percent1}%` }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_#FFFDF2_2px,_transparent_2px)] bg-[length:16px_16px] opacity-20"></div>
          </div>
          <div 
            className="h-full bg-gradient-to-l from-citrus-peach/60 to-citrus-peach/40 flex-grow transition-all duration-700 relative" 
            style={{ width: `${percent2}%` }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_#FFFDF2_2px,_transparent_2px)] bg-[length:16px_16px] opacity-20"></div>
          </div>
        </div>

        {/* Percentage labels */}
        {showLabels && (
          <div className="absolute inset-0 flex justify-between items-center px-3">
            <span className="font-varsity text-[10px] font-black text-citrus-charcoal drop-shadow-sm">
              {percent1.toFixed(0)}%
            </span>
            <span className="font-varsity text-[10px] font-black text-citrus-charcoal drop-shadow-sm">
              {percent2.toFixed(0)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
