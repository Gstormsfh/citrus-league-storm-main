/**
 * THE DRAFT ROOM HEADER (artboard 4a/4b).
 *
 * Not the league header. A draft is a different room with a different job:
 * the league header exists so you can move between screens, this one exists
 * so you always know WHERE THE DRAFT IS. `ROUND 3 · PICK 7 · 30 / 216` is
 * three answers to that — which round, whose turn in it, and how far through
 * the whole thing — and it sits directly under the title in 10px mono
 * because a drafter reads it every twenty seconds for two hours.
 *
 * `11/12 ●` on the right is who is actually in the room, with the dot in
 * sage. It is the first thing a commissioner looks for when a pick stalls,
 * and the artboard gives it the corner rather than burying it in a menu.
 *
 * The title is Barlow Condensed 800 at 22px/1 — the only place in Press Box
 * that goes that large in the condensed face, because this screen has no
 * scoreboard to outrank it.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxDraftHeaderProps {
  leagueName: string;
  /** `ROUND 3 · PICK 7 · 30 / 216`. Built by the page, which knows the format. */
  progressLine?: string | null;
  /** `11/12`. Absent hides the presence readout rather than showing a guess. */
  connected?: number | null;
  total?: number | null;
  onBack?: () => void;
  className?: string;
  /** The tab strip, so the header owns the whole block the artboard draws. */
  children?: React.ReactNode;
}

export function PressBoxDraftHeader({
  leagueName,
  progressLine,
  connected,
  total,
  onBack,
  className,
  children,
}: PressBoxDraftHeaderProps) {
  const showPresence = connected != null && total != null;
  return (
    <header className={cn(PB_TYPE, 'bg-pressbox-surface pt-1.5 px-3.5', className)}>
      <div className="flex items-center gap-2.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Leave the draft room"
            /* The artboard draws a bare 18px glyph, which is a 18x18 tap
               target — under the 44px floor. The glyph keeps the artboard's
               box so the header row stays 37.5px and the title keeps its
               width; `after` grows the HIT AREA to 44x44 without taking any
               layout space. Both requirements, no compromise. */
            className="focus-citrus relative flex-none text-[18px] leading-none text-pressbox-text/70 after:absolute after:-inset-y-[13px] after:-inset-x-5 after:content-['']"
          >
            &lsaquo;
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="font-condensed font-extrabold text-[22px] leading-none uppercase tracking-[0.02em] text-pressbox-text truncate">
            {leagueName} draft
          </h1>
          {progressLine && (
            <p className="mt-[3px] font-plex font-medium text-[10px] text-pressbox-text/50 truncate">
              {progressLine}
            </p>
          )}
        </div>
        {showPresence && (
          <p className="font-plex font-medium text-[9px] text-pressbox-text/50 whitespace-nowrap">
            {connected}/{total} <span className="text-pressbox-sage">&#9679;</span>
          </p>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}

export default PressBoxDraftHeader;
