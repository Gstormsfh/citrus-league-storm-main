import { TeamChip } from './TeamChip';
import { getTeamInfo } from '@/types/captracker';

export interface SurvivorPick {
  week: number;
  pick: string;
  status: 'win' | 'loss' | 'pending';
}

/**
 * Survivor tile — your pick history + used-teams reminder.
 * Matches the real PoolSurvivor product rules: pick one team per week,
 * can't reuse, one loss = eliminated.
 */
export function SurvivorTile({
  picks,
  alive,
  totalEntered,
  round = 'Round 1',
}: {
  picks: SurvivorPick[];
  alive: number;
  totalEntered: number;
  round?: string;
}) {
  const winCount = picks.filter((p) => p.status === 'win').length;
  const lossCount = picks.filter((p) => p.status === 'loss').length;
  const usedTeams = picks.map((p) => p.pick);
  return (
    <div className="bg-[#1A2A20] border border-white/10 rounded-2xl p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-white/10">
        <div>
          <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/45 font-bold">
            Survivor · {round}
          </div>
          <div className="font-sans font-bold text-[15px] text-pastel-cream mt-0.5">Your Picks</div>
        </div>
        <div className="text-right">
          <div className="font-sans font-black text-[20px] text-pastel-orange leading-none tabular-nums">
            {winCount}-{lossCount}
          </div>
          <div className="font-jbmono text-[9px] text-pastel-sage mt-1 tracking-wider uppercase font-bold">
            {lossCount > 0 ? 'Out' : 'Alive'}
          </div>
        </div>
      </div>
      <div className="space-y-2.5 mb-4">
        {picks.map((p) => (
          <div key={p.week} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-white/[0.04] ring-1 ring-white/10 flex items-center justify-center font-jbmono text-[11px] font-bold text-white/55">
              W{p.week}
            </div>
            <div
              className={`flex-1 h-11 rounded-md flex items-center justify-between px-3.5 ${
                p.status === 'win'
                  ? 'bg-pastel-sage/10 ring-1 ring-pastel-sage/25'
                  : p.status === 'loss'
                  ? 'bg-white/[0.04] ring-1 ring-white/10'
                  : 'bg-pastel-orange/10 ring-1 ring-pastel-orange/30'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <TeamChip abbrev={p.pick} />
                <span className="font-sans font-bold text-[13px] text-pastel-cream">
                  {getTeamInfo(p.pick)?.fullName || p.pick}
                </span>
              </div>
              <span
                className={`font-jbmono text-[10px] tracking-wider uppercase font-bold ${
                  p.status === 'win'
                    ? 'text-pastel-sage-soft'
                    : p.status === 'loss'
                    ? 'text-white/45'
                    : 'text-pastel-orange-soft'
                }`}
              >
                {p.status === 'win' ? '✓ Won' : p.status === 'loss' ? '✗ Out' : 'Locked'}
              </span>
            </div>
          </div>
        ))}
      </div>
      {/* Used teams reminder — real team colors, dimmed */}
      <div className="bg-white/[0.03] rounded-md p-2.5 mb-3">
        <div className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-white/40 font-bold mb-2">
          Used (can't pick again)
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {usedTeams.map((t) => {
            const info = getTeamInfo(t);
            return (
              <span
                key={t}
                className="px-2 py-0.5 rounded font-jbmono text-[10px] tracking-wider font-bold opacity-50 line-through"
                style={{
                  background: `${info?.primaryColor || '#84A57D'}30`,
                  color: '#FFF8F0',
                }}
              >
                {t}
              </span>
            );
          })}
        </div>
      </div>
      <div className="pt-3 border-t border-white/10 flex items-center justify-between font-jbmono text-[10px] text-white/45 tracking-wide">
        <span>1 loss = eliminated</span>
        <span className="text-pastel-sage">{alive} of {totalEntered.toLocaleString()} alive →</span>
      </div>
    </div>
  );
}
