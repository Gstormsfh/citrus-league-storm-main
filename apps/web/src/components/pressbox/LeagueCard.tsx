/**
 * ONE LEAGUE ON THE HOME SCREEN (artboard 1a).
 *
 * Crest, name, `12-TEAM · H2H PTS · 2ND`, and one status on the right. That
 * third line is the card's whole argument: a manager in four leagues cannot
 * hold four sets of rules in their head, so the card says what KIND of league
 * this is every time it is seen, and where you stand in it.
 *
 * THE LIVE LEAGUE EXPANDS AND THE OTHERS DO NOT. A 3px orange rail down the
 * left edge, a compact scoreboard, and a gradient bar — one card in the stack
 * gets to be a screen, and the rest stay one line tall. A home screen that
 * expands all four is a list of dashboards nobody reads; expanding only the
 * live one is the same editorial call a broadcast makes when it cuts to the
 * game that is close.
 *
 * The right-hand status takes three shapes and they are not decoration:
 * `LIVE` in sage (something is happening now), a record block (nothing is,
 * here is where you stand), and an orange `6 PICKS DUE` (something is
 * happening and it is waiting on YOU). Orange only ever means the last one.
 */
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxLeagueCardScore {
  name: string;
  initial?: string;
  score?: number | null;
  projection?: number | null;
  winPct?: number | null;
  isYou?: boolean;
}

export interface PressBoxLeagueCardProps {
  name: string;
  /** `FZ`. Two letters off the league name when the caller has nothing else. */
  crest?: string;
  /** `12-TEAM · H2H PTS · 2ND`. */
  metaLine?: string | null;
  to: string;
  /** `LIVE` / `6 PICKS DUE`. */
  badge?: string | null;
  badgeTone?: 'live' | 'due';
  /** A record instead of a badge: `3–5 · 2–6` over `TRAILING 3 CATS`. */
  statLine?: string | null;
  statNote?: string | null;
  statNoteTone?: 'bad' | 'muted';
  /** Present renders the expanded live scoreboard and the rail. */
  you?: PressBoxLeagueCardScore | null;
  them?: PressBoxLeagueCardScore | null;
  className?: string;
}

const fig = (n: number | null | undefined) => (n == null ? null : n.toFixed(1));

function Team({ side, mirrored }: { side: PressBoxLeagueCardScore; mirrored: boolean }) {
  return (
    <span className={cn('flex items-center gap-2 min-w-0', mirrored && 'flex-row-reverse text-right')}>
      <span
        aria-hidden="true"
        className={cn(
          'w-6 h-6 flex-none rounded-full flex items-center justify-center font-condensed font-bold text-[10px] text-pressbox-text',
          side.isYou ? 'bg-pressbox-orange/20 border-2 border-pressbox-orange' : 'bg-[#2a3a30]',
        )}
      >
        {(side.initial ?? side.name).slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block font-barlow font-semibold text-[13px] truncate text-pressbox-text">
          {side.name}
        </span>
        {side.winPct != null && (
          <span
            className={cn(
              'block font-plex font-medium text-[10px]',
              side.isYou ? 'text-pressbox-orange-soft' : 'text-pressbox-text/55',
            )}
          >
            {Math.round(side.winPct)}% WIN
          </span>
        )}
      </span>
    </span>
  );
}

export function PressBoxLeagueCard({
  name,
  crest,
  metaLine,
  to,
  badge,
  badgeTone = 'live',
  statLine,
  statNote,
  statNoteTone = 'muted',
  you,
  them,
  className,
}: PressBoxLeagueCardProps) {
  const live = !!(you && them);
  const initials = crest ?? name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
  const winPct = you?.winPct ?? null;

  return (
    <Link
      to={to}
      className={cn(
        PB_TYPE,
        'focus-citrus block relative overflow-hidden p-3 rounded-[14px] bg-pressbox-tile border border-white/[0.08]',
        className,
      )}
    >
      {live && <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[3px] bg-pressbox-orange" />}

      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="w-10 h-10 flex-none rounded-[10px] bg-pressbox-tile-high flex items-center justify-center font-condensed font-extrabold text-[15px] text-pressbox-text"
        >
          {initials}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-barlow font-bold text-[16px] truncate text-pressbox-text">{name}</span>
          {metaLine && (
            <span className="block mt-0.5 font-plex font-medium text-[11px] truncate text-pressbox-text/55">
              {metaLine}
            </span>
          )}
        </span>

        {badge && (
          <span
            className={cn(
              'flex-none px-[7px] py-[3px] rounded-[4px] font-plex font-semibold text-[10px] tracking-[0.08em]',
              badgeTone === 'live'
                ? 'bg-pressbox-sage/15 text-pressbox-sage-soft'
                : 'bg-pressbox-orange/15 text-pressbox-orange-soft',
            )}
          >
            {badge}
          </span>
        )}

        {!badge && statLine && (
          <span className="flex-none text-right">
            <span className="block font-plex font-semibold text-[13px] text-pressbox-text">{statLine}</span>
            {statNote && (
              <span
                className={cn(
                  'block font-plex font-medium text-[9px]',
                  statNoteTone === 'bad' ? 'text-pressbox-grapefruit' : 'text-pressbox-text/50',
                )}
              >
                {statNote}
              </span>
            )}
          </span>
        )}
      </div>

      {live && you && them && (
        <>
          <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Team side={you} mirrored={false} />
            <span className="text-center">
              <span className="block font-plex font-semibold text-[20px] tabular-nums tracking-[-0.02em] text-pressbox-text">
                <span className="text-pressbox-sage">{fig(you.score)}</span>
                <span className="mx-1.5 text-pressbox-text/30">&ndash;</span>
                {fig(them.score)}
              </span>
              {(you.projection != null || them.projection != null) && (
                <span className="block font-plex font-medium text-[9px] text-pressbox-text/50">
                  PROJ {fig(you.projection) ?? '–'} &middot; {fig(them.projection) ?? '–'}
                </span>
              )}
            </span>
            <Team side={them} mirrored />
          </div>

          {winPct != null && (
            <div aria-hidden="true" className="mt-2 h-1 rounded-[2px] bg-white/[0.08] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pressbox-orange to-pressbox-orange-soft"
                style={{ width: `${Math.max(0, Math.min(100, winPct))}%` }}
              />
            </div>
          )}
        </>
      )}
    </Link>
  );
}

export default PressBoxLeagueCard;
