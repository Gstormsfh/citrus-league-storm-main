import { Calendar } from "lucide-react";
import { CitrusWedge } from "@/components/icons/CitrusIcons";

interface MatchupTotalBarProps {
  team1Score: number;
  team2Score: number;
  team1Name?: string;
  team2Name?: string;
  showLabels?: boolean; // Default true
  team1GamesRemaining?: number;
  team2GamesRemaining?: number;
}

export const MatchupTotalBar = ({ 
  team1Score, 
  team2Score, 
  team1Name = 'Team 1',
  team2Name = 'Team 2',
  showLabels = true,
  team1GamesRemaining = 0,
  team2GamesRemaining = 0
}: MatchupTotalBarProps) => {
  const total = team1Score + team2Score || 1; // Avoid divide by zero
  const percent1 = (team1Score / total) * 100;
  const percent2 = (team2Score / total) * 100;
  const isTied = Math.abs(team1Score - team2Score) < 0.01;
  const team1Leading = team1Score > team2Score;
  const team2Leading = team2Score > team1Score;

  return (
    <div className="w-full rounded-[2rem] overflow-hidden bg-[#1A2A20] ring-1 ring-white/10 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)]">
      {/* Scoreboard Header - Like patch on jacket */}
      <div className="relative p-4 border-b border-white/10">
        {/* Radial texture overlay */}
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_rgba(255,255,255,0.02)_1px,_transparent_1px)] bg-[length:20px_20px]"></div>

        <div className="flex justify-between items-center relative z-10">
          {/* Team 1 */}
          <div className="flex-1 text-center p-3 bg-pastel-sage/15 rounded-xl ring-1 ring-pastel-sage/40">
            <div className="font-varsity text-xs text-pastel-cream uppercase tracking-tighter">
              {team1Name}
            </div>
            <div className={`font-varsity text-5xl tabular-nums mt-1 ${team1Leading ? 'text-pastel-sage' : 'text-white/70'}`}>
              {team1Score.toFixed(1)}
            </div>
            {/* Games Remaining Badge */}
            <div className="mt-2 flex items-center justify-center gap-1 bg-white/5 px-2 py-1 rounded-lg ring-1 ring-pastel-sage/30">
              <Calendar className="w-3 h-3 text-pastel-sage" aria-hidden="true" />
              <span className="text-[10px] font-varsity font-bold text-pastel-cream uppercase tracking-wide tabular-nums">
                {team1GamesRemaining}
              </span>
              <span className="text-[9px] font-display text-white/55">
                games left
              </span>
              <CitrusWedge className="w-2.5 h-2.5 text-pastel-sage opacity-70" />
            </div>
          </div>

          {/* VS Divider */}
          <div className="px-4">
            <span className="font-script text-2xl text-pastel-orange">vs</span>
          </div>

          {/* Team 2 */}
          <div className="flex-1 text-center p-3 bg-pastel-sage/15 rounded-xl ring-1 ring-pastel-sage/40">
            <div className="font-varsity text-xs text-pastel-cream uppercase tracking-tighter">
              {team2Name}
            </div>
            <div className={`font-varsity text-5xl tabular-nums mt-1 ${team2Leading ? 'text-pastel-sage' : 'text-white/70'}`}>
              {team2Score.toFixed(1)}
            </div>
            {/* Games Remaining Badge */}
            <div className="mt-2 flex items-center justify-center gap-1 bg-white/5 px-2 py-1 rounded-lg ring-1 ring-pastel-sage/30">
              <Calendar className="w-3 h-3 text-pastel-sage" aria-hidden="true" />
              <span className="text-[10px] font-varsity font-bold text-pastel-cream uppercase tracking-wide tabular-nums">
                {team2GamesRemaining}
              </span>
              <span className="text-[9px] font-display text-white/55">
                games left
              </span>
              <CitrusWedge className="w-2.5 h-2.5 text-pastel-sage opacity-70" />
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar - Thick embroidered stripe */}
      <div className="h-6 flex bg-white/5 relative">
        {isTied && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-xs font-bold text-pastel-cream bg-[#1A2A20] px-2 py-0.5 rounded-lg ring-1 ring-white/20 shadow-sm">
              TIED
            </div>
          </div>
        )}
        <div
          className="bg-pastel-sage border-r border-white/10 transition-all duration-700"
          style={{ width: `${percent1}%` }}
        />
        <div
          className="bg-pastel-orange/60 flex-grow transition-all duration-700"
          style={{ width: `${percent2}%` }}
        />
      </div>
    </div>
  );
};
