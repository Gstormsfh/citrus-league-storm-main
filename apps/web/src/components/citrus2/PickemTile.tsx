import { TeamChip } from './TeamChip';

export interface PickemGame {
  away: string;
  /** NHL team record — W-L-OTL (NHL counts OT losses separately) */
  awayRec: string;
  home: string;
  homeRec: string;
  picked: string | null;
}

/**
 * Pickem tile — pick-the-winner UI matching the real PoolPickem product.
 * No Vegas odds, no spreads — we don't do those. Just team monograms, real
 * records, and the picked team highlighted with the opponent dimmed.
 */
export function PickemTile({
  games,
  picksMade,
  totalGames,
  lockTime = '7:00 PM ET',
}: {
  games: PickemGame[];
  picksMade: number;
  totalGames: number;
  lockTime?: string;
}) {
  return (
    <div className="bg-pastel-surface-tile border border-white/10 rounded-2xl p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-white/10">
        <div>
          <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/45 font-bold">
            Pickem
          </div>
          <div className="font-sans font-bold text-[15px] text-pastel-cream mt-0.5">Tonight's Slate</div>
        </div>
        <span className="font-jbmono text-[10px] text-pastel-sage tabular-nums">
          {picksMade} of {totalGames} picked
        </span>
      </div>
      <div className="space-y-3">
        {games.map((g) => (
          <div
            key={`${g.away}-${g.home}`}
            className="grid grid-cols-[1fr_auto_1fr] items-stretch rounded-xl overflow-hidden"
          >
            <PickButton team={g.away} record={g.awayRec} state={pickState(g, 'away')} />
            <div className="flex items-center justify-center px-2 bg-white/[0.02]">
              <span className="font-jbmono text-[10px] text-white/30">@</span>
            </div>
            <PickButton team={g.home} record={g.homeRec} state={pickState(g, 'home')} />
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between font-jbmono text-[10px] text-white/45 tracking-wide">
        <span>Locks at puck drop · {lockTime}</span>
        <span className="text-pastel-sage">{totalGames - picksMade} more →</span>
      </div>
    </div>
  );
}

type PickState = 'picked' | 'dimmed' | 'open';

function pickState(g: PickemGame, side: 'away' | 'home'): PickState {
  const team = side === 'away' ? g.away : g.home;
  if (g.picked === team) return 'picked';
  if (g.picked) return 'dimmed';
  return 'open';
}

function PickButton({ team, record, state }: { team: string; record: string; state: PickState }) {
  const styles =
    state === 'picked'
      ? 'bg-pastel-orange/15 ring-1 ring-pastel-orange/40'
      : state === 'dimmed'
      ? 'bg-white/[0.02] opacity-40'
      : 'bg-white/[0.04] hover:bg-white/[0.08]';
  return (
    <button className={`flex items-center gap-2.5 py-3 px-3 transition-colors text-left ${styles}`}>
      <TeamChip abbrev={team} />
      <div className="min-w-0">
        <div className="font-sans font-bold text-[12px] text-pastel-cream truncate">{team}</div>
        <div className="font-jbmono text-[9px] text-white/45 tabular-nums">{record}</div>
      </div>
    </button>
  );
}
