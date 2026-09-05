/**
 * THE SCHEDULE ON A PHONE (2026-09-04).
 *
 * The league menu's `Schedule` tile: the NHL slate for the next seven
 * days, read the way a manager reads it before setting a lineup — how
 * heavy each day is, which clubs play most, who is on a back-to-back,
 * then the games themselves. No artboard draws it; the tiles, section
 * heads and rows are the artboards', the bars are the roster's 2px rule
 * grown to a chart. Every count is a pure transform of the games the
 * page loaded; the screen adds nothing.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';

export interface ScheduleGame {
  id: string | number;
  game_date: string;
  game_time?: string | null;
  home_team: string;
  away_team: string;
  status?: string | null;
}

export interface SchedulePhoneProps {
  loading: boolean;
  games: ScheduleGame[];
  /** Sunday-first, seven entries: `{ key: 'Mon', count: 8 }`. */
  days: ReadonlyArray<{ key: string; count: number }>;
  teams: ReadonlyArray<{ team: string; games: number }>;
  backToBacks: ReadonlyArray<{ team: string; from: string; to: string }>;
  /** `2026-10-03` → `SAT 10/3`. */
  dayLabel: (iso: string) => string;
  /** ISO timestamp → `7:00 PM`, or null. */
  timeLabel: (iso?: string | null) => string | null;
  banner?: React.ReactNode;
  className?: string;
}

const TILE = 'rounded-[10px] bg-pressbox-tile border border-white/[0.08]';

export function SchedulePhone(p: SchedulePhoneProps) {
  const maxDay = Math.max(1, ...p.days.map((d) => d.count));
  const maxTeam = Math.max(1, ...p.teams.map((t) => t.games));

  return (
    <div data-testid="schedule-phone" className={cn(PB_TYPE, 'px-3.5 pt-3', p.className)}>
      {p.banner}

      <PressBoxSectionHead
        title="The slate"
        count={p.loading ? null : `${p.games.length} games · 7 days`}
      />

      {p.loading ? (
        <div className="mt-2 flex flex-col gap-1.5" data-testid="schedule-phone-loading">
          <div className="h-[96px] rounded-[10px] bg-pressbox-tile border border-white/[0.08] animate-pulse" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[52px] rounded-[10px] bg-pressbox-tile border border-white/[0.08] animate-pulse" />
          ))}
        </div>
      ) : p.games.length === 0 ? (
        <div className="mt-2 px-4 py-8 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center" data-testid="schedule-phone-empty">
          <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">No games this week</p>
          <p className="mt-1 font-barlow text-[12px] text-pressbox-text/45">The slate fills in when the league publishes it.</p>
        </div>
      ) : (
        <>
          {/* Seven bars: how heavy each day is. */}
          <div className={cn(TILE, 'mt-2 p-3')} data-testid="schedule-phone-days">
            <div className="grid grid-cols-7 gap-1.5 items-end h-[64px]">
              {p.days.map((d) => (
                <div key={d.key} className="flex flex-col items-center justify-end h-full gap-1">
                  <span className="font-plex font-semibold text-[11px] tabular-nums text-pressbox-text">{d.count}</span>
                  <div className="w-full rounded-[2px] bg-pressbox-sage/80" style={{ height: `${Math.max(3, (d.count / maxDay) * 40)}px` }} />
                </div>
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-7 gap-1.5">
              {p.days.map((d) => (
                <span key={d.key} className="text-center font-plex font-medium text-[9px] tracking-[0.06em] text-pressbox-text/45 uppercase">
                  {d.key}
                </span>
              ))}
            </div>
          </div>

          {/* Who plays most. */}
          {p.teams.length > 0 && (
            <>
              <PressBoxSectionHead className="mt-4" sm title="Games by club" count={String(p.teams.length)} />
              <ul className={cn(TILE, 'mt-2 overflow-hidden')} data-testid="schedule-phone-teams">
                {p.teams.slice(0, 8).map((t, i, arr) => (
                  <li key={t.team} className={cn('flex items-center gap-3 px-3 py-2', i < arr.length - 1 && 'border-b border-white/[0.06]')}>
                    <span className="w-9 font-condensed font-extrabold text-[12px] text-pressbox-text">{t.team}</span>
                    <span className="flex-1 h-[6px] rounded-[3px] bg-white/[0.08] overflow-hidden">
                      <span className="block h-full rounded-[3px] bg-pressbox-orange-soft" style={{ width: `${(t.games / maxTeam) * 100}%` }} />
                    </span>
                    <span className="w-6 text-right font-plex font-semibold text-[12px] tabular-nums text-pressbox-text">{t.games}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Back-to-backs. */}
          <PressBoxSectionHead className="mt-4" sm title="Back-to-backs" count={p.backToBacks.length > 0 ? String(p.backToBacks.length) : null} />
          {p.backToBacks.length === 0 ? (
            <p className="mt-2 px-3 py-3 rounded-[10px] bg-pressbox-tile border border-white/[0.08] font-barlow text-[12px] text-pressbox-text/45">
              No club plays on consecutive days this week.
            </p>
          ) : (
            <ul className={cn(TILE, 'mt-2 overflow-hidden')} data-testid="schedule-phone-b2b">
              {p.backToBacks.slice(0, 12).map((b, i, arr) => (
                <li key={b.team} className={cn('flex items-center justify-between px-3 py-2', i < arr.length - 1 && 'border-b border-white/[0.06]')}>
                  <span className="font-condensed font-extrabold text-[12px] text-pressbox-text">{b.team}</span>
                  <span className="font-plex font-medium text-[10px] tabular-nums text-pressbox-text/60">
                    {p.dayLabel(b.from)} <span className="text-pressbox-text/35">→</span> {p.dayLabel(b.to)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* The games. */}
          <PressBoxSectionHead className="mt-4" sm title="The games" count={String(p.games.length)} />
          <ul className="mt-2 border-b border-white/[0.06]" data-testid="schedule-phone-games">
            {p.games.map((g, i) => {
              const day = g.game_date.split('T')[0];
              const first = i === 0 || p.games[i - 1].game_date.split('T')[0] !== day;
              return (
                <li key={g.id} className="border-t border-white/[0.06]">
                  {first && (
                    <p className="pt-2 pb-1 font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-text/45">{p.dayLabel(day)}</p>
                  )}
                  <div className="flex items-center justify-between gap-3 min-h-[40px] py-1.5">
                    <p className="font-barlow font-bold text-[14px] text-pressbox-text">
                      {g.away_team} <span className="font-plex font-medium text-[10px] text-pressbox-text/45">@</span> {g.home_team}
                    </p>
                    <p className="font-plex font-medium text-[10px] tabular-nums text-pressbox-text/60">
                      {p.timeLabel(g.game_time) ?? (g.status && g.status !== 'scheduled' ? g.status.toUpperCase() : 'TBD')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default SchedulePhone;
