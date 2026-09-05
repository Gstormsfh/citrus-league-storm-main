/**
 * THE MATCHUP SCORE BLOCK — the header of the Match screen.
 *
 * Two managers, two 40px scores, the win-probability bar, and the seven-day
 * strip. Every value read out of the artboard:
 *
 *     scores   font:600 40px/1 'IBM Plex Mono';letter-spacing:-.03em
 *              yours #84A57D when leading, else rgba(243,239,230,.85)
 *     centre   font:600 9px Plex .4 — "THU · DAY 4/7"
 *     meta     PROJ 257.2 · 27 LEFT · 64% WIN   (your win% #FF9F66,
 *              theirs #8DCDFF — orange is you, ice is them, everywhere)
 *     bar      height:6px;background:#8DCDFF with your #FF6B1A fill, and a
 *              1px white tick at 50% so "ahead" is readable without doing
 *              arithmetic on the percentage
 *     day tile flex:1;radius 6;background:#16241B;font:600 9px Plex, the
 *              leader's figure in sage; today outlined 1px #84A57D
 *
 * THE 50% TICK is the detail that makes the bar work. A bar without it says
 * "you have some of the width"; with it, the eye reads which side of even you
 * are on before it reads the number. It is one pixel and it is the difference
 * between decoration and information.
 *
 * NOTHING IS INVENTED. Every figure is a prop and every one is optional: no
 * win probability draws no bar, a future day draws its game COUNTS rather
 * than points (which is what the artboard does — FRI 6/5 is six games to
 * five, not six points), and a day with neither draws an empty tile.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

const MONO = 'font-plex tabular-nums';

export interface PressBoxScoreSide {
  name: string;
  /** `4–1 · 2ND`. */
  record?: string | null;
  score?: number | null;
  projection?: number | null;
  /** Games still to be played this week. */
  gamesLeft?: number | null;
  /** 0-100. Yours drives the bar. */
  winPct?: number | null;
}

export interface PressBoxScoreDay {
  /** `MON`. */
  label: string;
  /** The date behind the tile, `2026-09-27`; handed back on press. */
  key?: string;
  /** Points scored, when the day has been played. */
  yours?: number | null;
  theirs?: number | null;
  /**
   * MATCHUP PAGE (2026-09-04): `yours` / `theirs` are a PROJECTION for a
   * day still ahead, not points. Drawn dimmed with no leader tint, so a
   * number that has not happened is never read as one that has — the
   * artboard prints game COUNTS for those days, and the page draws them
   * instead whenever it holds them.
   */
  projected?: boolean;
  /** Game counts, for a day still ahead. */
  yourGames?: number | null;
  theirGames?: number | null;
  /** Outlined — today, or the day the page is showing. */
  isToday?: boolean;
}

export interface PressBoxScoreBlockProps {
  you: PressBoxScoreSide;
  them: PressBoxScoreSide;
  /** `THU · DAY 4/7`. */
  dayLabel?: string | null;
  days?: PressBoxScoreDay[];
  onDayPress?: (day: PressBoxScoreDay) => void;
  className?: string;
}

const fig = (n: number | null | undefined) => (n == null ? '–' : n.toFixed(1));

function Disc({ letter, mine }: { letter: string; mine: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'w-10 h-10 flex-none rounded-full flex items-center justify-center font-condensed font-bold text-[14px]',
        mine
          ? 'bg-pressbox-orange/20 border-2 border-pressbox-orange text-pressbox-text'
          : 'bg-[#2a3a30] text-pressbox-text',
      )}
    >
      {letter}
    </span>
  );
}

export function PressBoxScoreBlock({
  you,
  them,
  dayLabel,
  days = [],
  onDayPress,
  className,
}: PressBoxScoreBlockProps) {
  const leading = you.score != null && them.score != null && you.score >= them.score;

  return (
    <div className={cn(PB_TYPE, 'border-t border-white/[0.08] px-3 pt-2.5 pb-2', className)}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <Disc letter={you.name.slice(0, 1).toUpperCase()} mine />
          <span className="min-w-0">
            <span className="block font-barlow font-bold text-[14px] truncate text-pressbox-text">
              {you.name}
            </span>
            {you.record && (
              <span className={cn(MONO, 'block font-medium text-[10px] text-pressbox-text/50')}>
                {you.record} · <span className="text-pressbox-orange-soft">YOU</span>
              </span>
            )}
          </span>
        </span>

        {dayLabel && (
          <span className={cn(MONO, 'text-center font-semibold text-[9px] tracking-[0.1em] text-pressbox-text/40')}>
            {dayLabel}
          </span>
        )}

        <span className="flex items-center gap-2 min-w-0 flex-row-reverse text-right">
          <Disc letter={them.name.slice(0, 1).toUpperCase()} mine={false} />
          <span className="min-w-0">
            <span className="block font-barlow font-bold text-[14px] truncate text-pressbox-text">
              {them.name}
            </span>
            {them.record && (
              <span className={cn(MONO, 'block font-medium text-[10px] text-pressbox-text/50')}>
                {them.record}
              </span>
            )}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-baseline mt-1.5">
        <span
          className={cn(
            MONO,
            'font-semibold text-[40px] leading-none tracking-[-0.03em]',
            leading ? 'text-pressbox-sage' : 'text-pressbox-text/85',
          )}
        >
          {fig(you.score)}
        </span>
        <span className={cn(MONO, 'text-center font-semibold text-[10px] text-pressbox-text/40 px-2')}>–</span>
        <span
          className={cn(
            MONO,
            'font-semibold text-[40px] leading-none tracking-[-0.03em] text-right',
            !leading && them.score != null ? 'text-pressbox-sage' : 'text-pressbox-text/85',
          )}
        >
          {fig(them.score)}
        </span>
      </div>

      <div className={cn(MONO, 'grid grid-cols-2 font-medium text-[10px] text-pressbox-text/50 mt-1')}>
        <span className="truncate">
          {you.projection != null && (
            <>PROJ <b className="text-pressbox-text font-semibold">{you.projection.toFixed(1)}</b></>
          )}
          {you.gamesLeft != null && <> · {you.gamesLeft} LEFT</>}
          {you.winPct != null && (
            <> · <span className="text-pressbox-orange-soft">{Math.round(you.winPct)}% WIN</span></>
          )}
        </span>
        <span className="truncate text-right">
          {them.winPct != null && (
            <><span className="text-pressbox-ice">{Math.round(them.winPct)}% WIN</span> · </>
          )}
          {them.gamesLeft != null && <>{them.gamesLeft} LEFT · </>}
          {them.projection != null && (
            <>PROJ <b className="text-pressbox-text font-semibold">{them.projection.toFixed(1)}</b></>
          )}
        </span>
      </div>

      {you.winPct != null && (
        <div className="relative mt-2 h-[6px] rounded-[3px] bg-pressbox-ice overflow-hidden">
          <span
            className="block h-full bg-pressbox-orange"
            style={{ width: `${Math.max(0, Math.min(100, you.winPct))}%` }}
            data-testid="winprob-fill"
          />
          {/* The even mark. Without it the bar says "some width"; with it the
              eye reads which side of 50 you are on before reading a number. */}
          <span
            aria-hidden="true"
            /* `bg-pressbox-text/60`, not the artboard's rgba(255,255,255,.6).
               darkThemeContrastGuard forbids white alpha between 40 and 84
               because it composites to an unreadable mid-grey here -- a rule
               written for SURFACES, and it cannot tell a 1px tick from a
               panel. The palette's neutral is cream rather than pure white
               anyway, so the tick now matches the rest of the bar and is
               indistinguishable at one pixel. */
            className="absolute left-1/2 -top-0.5 w-px h-[10px] bg-pressbox-text/60"
            data-testid="winprob-tick"
          />
        </div>
      )}

      {days.length > 0 && (
        <div className="flex gap-1 mt-2.5">
          {days.map((d) => {
            const played = d.yours != null || d.theirs != null;
            const youLead = played && !d.projected && (d.yours ?? 0) >= (d.theirs ?? 0);
            return (
              <button
                key={d.key ?? d.label}
                data-projected={d.projected ? 'true' : undefined}
                type="button"
                onClick={() => onDayPress?.(d)}
                aria-current={d.isToday ? 'date' : undefined}
                className={cn(
                  MONO,
                  'flex-1 min-w-0 rounded-[6px] bg-pressbox-tile text-center font-semibold text-[9px]',
                  d.isToday
                    ? 'border border-pressbox-sage text-pressbox-text px-0.5 py-1'
                    : 'px-0.5 py-[5px] text-pressbox-text/50',
                  !played && !d.isToday && 'text-pressbox-text/40',
                )}
              >
                <span className="block">{d.label}</span>
                <span className={cn('block mt-0.5', youLead ? 'text-pressbox-sage' : d.projected ? 'text-pressbox-text/45' : 'text-pressbox-text/70')}>
                  {played ? fig(d.yours) : (d.yourGames ?? '')}
                </span>
                <span className={cn('block', played && !d.projected && !youLead ? 'text-pressbox-sage' : d.projected ? 'text-pressbox-text/45' : 'text-pressbox-text/70')}>
                  {played ? fig(d.theirs) : (d.theirGames ?? '')}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PressBoxScoreBlock;
