import { TeamChip } from './TeamChip';
import { LivePulse } from './LivePulse';

export interface LiveGameData {
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  period?: string;
  time?: string;
  /** 0-100, used for the period-progress bar */
  progressPct?: number;
  status?: 'LIVE' | 'FINAL' | 'SCHEDULED';
}

/**
 * Single live game scoreboard card. Uses real NHL team colors via TeamChip.
 * Reusable: hero composition, live scores page, league dashboard, etc.
 */
export function LiveGameTile({ game }: { game: LiveGameData }) {
  const isLive = (game.status ?? 'LIVE') === 'LIVE';
  return (
    <div className="bg-pastel-surface-tile border border-white/10 rounded-2xl p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between mb-4">
        {isLive ? (
          <span className="flex items-center gap-1.5">
            <LivePulse size="xs" />
            <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
              Live{game.period ? ` · ${game.period}` : ''}
            </span>
          </span>
        ) : (
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 font-bold">
            {game.status ?? 'FINAL'}
          </span>
        )}
        {game.time && (
          <span className="font-jbmono text-[10px] text-white/55 tabular-nums">{game.time}</span>
        )}
      </div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TeamChip abbrev={game.away} size="md" />
          <div className="font-jbmono text-[9px] text-white/55 tracking-wider uppercase">Away</div>
        </div>
        <div className="font-sans font-black text-[2.25rem] text-pastel-cream tabular-nums leading-none">
          {game.awayScore}
          <span className="text-white/55 mx-1">·</span>
          {game.homeScore}
        </div>
        <div className="flex items-center gap-2">
          <div className="font-jbmono text-[9px] text-white/55 tracking-wider uppercase">Home</div>
          <TeamChip abbrev={game.home} size="md" />
        </div>
      </div>
      {isLive && game.progressPct !== undefined && (
        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-pastel-orange rounded-full transition-all"
            style={{ width: `${game.progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
