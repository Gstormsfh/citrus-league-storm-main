import { Trophy } from 'lucide-react';
import { TeamColorBar } from './TeamChip';
import { LivePulse } from './LivePulse';

export interface BracketSeries {
  high: string;
  low: string;
  /** [highWins, lowWins] — best of 7 */
  wins: [number, number];
  winner: string | null;
}

/**
 * Stanley Cup playoff bracket tile — first-round series in two conferences.
 * Real NHL team colors via TeamColorBar. Best-of-7 win counts. Mirror of the
 * real /nhl/playoffs page structure.
 */
export function BracketTile({
  east,
  west,
  round = 'First Round',
  cupPick,
  updatedAgo = '60s',
  isLive = true,
}: {
  east: BracketSeries[];
  west: BracketSeries[];
  round?: string;
  cupPick?: string;
  updatedAgo?: string;
  isLive?: boolean;
}) {
  return (
    <div className="bg-pastel-surface-tile border border-white/10 rounded-2xl p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
        <div>
          <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 font-bold flex items-center gap-2">
            {isLive && <LivePulse size="xs" />}
            {round}{isLive ? ' · Live' : ''}
          </div>
          <div className="font-sans font-bold text-[15px] text-pastel-cream mt-0.5">Stanley Cup Playoffs</div>
        </div>
        <Trophy className="w-6 h-6 text-pastel-orange" strokeWidth={2} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-2 font-jbmono text-[9px] tracking-[0.22em] uppercase font-bold">
        <div className="text-pastel-sage-soft text-center">Eastern</div>
        <div className="text-pastel-orange-soft text-center">Western</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[east, west].map((conf, ci) => (
          <div key={ci} className="space-y-2">
            {conf.map((s, i) => (
              <SeriesRow key={i} series={s} />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between font-jbmono text-[10px] text-white/55 tracking-wide">
        <span>Best of 7 · Updated {updatedAgo} ago</span>
        {cupPick && <span className="text-pastel-sage">Your Cup pick: {cupPick} →</span>}
      </div>
    </div>
  );
}

function SeriesRow({ series }: { series: BracketSeries }) {
  return (
    <div className="bg-white/[0.03] rounded-md p-2 ring-1 ring-white/10 space-y-1">
      <SeriesTeam abbrev={series.high} wins={series.wins[0]} winner={series.winner === series.high} />
      <SeriesTeam abbrev={series.low} wins={series.wins[1]} winner={series.winner === series.low} />
    </div>
  );
}

function SeriesTeam({
  abbrev,
  wins,
  winner,
}: {
  abbrev: string;
  wins: number;
  winner: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <TeamColorBar abbrev={abbrev} />
        <span
          className={`font-jbmono text-[10px] font-bold tracking-wider tabular-nums truncate ${
            winner ? 'text-pastel-cream' : 'text-white/55'
          }`}
        >
          {abbrev}
        </span>
      </div>
      <span
        className={`font-jbmono text-[11px] font-bold tabular-nums ${
          wins === 4 ? 'text-pastel-sage-soft' : 'text-white/55'
        }`}
      >
        {wins}
      </span>
    </div>
  );
}
