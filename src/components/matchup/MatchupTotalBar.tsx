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

  return (
    <div className="w-full h-8 bg-gray-200 rounded-full overflow-hidden flex relative">
      <div 
        className="h-full bg-blue-600 transition-all duration-500" 
        style={{ width: `${percent1}%` }} 
      />
      <div 
        className="h-full bg-red-600 flex-grow transition-all duration-500" 
        style={{ width: `${percent2}%` }}
      />
      {/* Centered scores overlay */}
      {showLabels && (
        <div className="absolute inset-0 flex justify-between items-center px-4 font-black text-white mix-blend-difference">
          <span>{team1Score.toFixed(1)}</span>
          <span>{team2Score.toFixed(1)}</span>
        </div>
      )}
      {isTied && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold text-gray-700 bg-white/80 px-2 py-0.5 rounded">
            TIED
          </span>
        </div>
      )}
    </div>
  );
};
