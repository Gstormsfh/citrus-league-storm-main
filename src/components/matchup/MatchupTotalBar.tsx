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
    <div className="w-full rounded-[2rem] overflow-hidden border-4 border-citrus-forest shadow-[0_6px_0_rgba(27,48,34,0.2)]">
      {/* Scoreboard Header - Like patch on jacket */}
      <div className="relative bg-citrus-cream corduroy-texture p-4 border-b-4 border-citrus-forest">
        {/* Radial texture overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_rgba(0,0,0,0.02)_1px,_transparent_1px)] bg-[length:20px_20px]"></div>
        
        <div className="flex justify-between items-center relative z-10">
          {/* Team 1 - Vintage Sage */}
          <div className="flex-1 text-center p-3 bg-citrus-sage/20 rounded-xl border-3 border-citrus-sage">
            <div className="font-varsity text-xs text-citrus-sage uppercase tracking-tighter">
              {team1Name}
            </div>
            <div className="font-varsity text-5xl text-citrus-sage mt-1">
              {team1Score.toFixed(1)}
            </div>
          </div>
          
          {/* VS Divider */}
          <div className="px-4">
            <span className="font-script text-2xl text-citrus-orange">vs</span>
          </div>
          
          {/* Team 2 - Muted Coral */}
          <div className="flex-1 text-center p-3 bg-citrus-peach/20 rounded-xl border-3 border-citrus-peach">
            <div className="font-varsity text-xs text-citrus-peach uppercase tracking-tighter">
              {team2Name}
            </div>
            <div className="font-varsity text-5xl text-citrus-peach mt-1">
              {team2Score.toFixed(1)}
            </div>
          </div>
        </div>
      </div>
      
      {/* Progress Bar - Thick embroidered stripe */}
      <div className="h-6 flex bg-citrus-cream relative">
        {isTied && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-xs font-bold text-citrus-forest bg-citrus-cream/80 px-2 py-0.5 rounded-lg shadow-sm">
              TIED
            </div>
          </div>
        )}
        <div 
          className="bg-citrus-sage border-r-2 border-citrus-forest transition-all duration-700"
          style={{ width: `${percent1}%` }}
        />
        <div 
          className="bg-citrus-peach flex-grow transition-all duration-700"
          style={{ width: `${percent2}%` }}
        />
      </div>
    </div>
  );
};
