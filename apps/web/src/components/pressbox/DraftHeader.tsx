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
 * scoreboard to outrank it. `FINALSZ DRAFT` when the room knows its league;
 * `DRAFT ROOM` when it does not, which is every mid-draft refresh, because
 * the in-draft path is deliberately kept free of extra network work and the
 * league name only arrives with the lobby. Either way the accessible name
 * ends in "room" so the page heading reads the same to a screen reader.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxDraftHeaderProps {
  /** Absent renders `Draft room`. */
  leagueName?: string | null;
  /**
   * `ROUND 3 · PICK 7 · 30 / 216`. A string, or the caller's own node when
   * it carries a test id or a status the caller controls.
   */
  progress?: React.ReactNode;
  /** `11/12`. Absent hides the presence readout rather than showing a guess. */
  connected?: number | null;
  total?: number | null;
  /** Renders beside the presence readout: a compact clock, a connection dot. */
  aside?: React.ReactNode;
  /** A back BUTTON — for a room that closes in place. */
  onBack?: () => void;
  /**
   * The room's own exit, when it must own it — DraftRoomV2 renders its
   * `draft-room-exit` Link here, because four guards read that link off the
   * room's source by name. Wear `PB_DRAFT_EXIT`. Takes priority over onBack.
   */
  exit?: React.ReactNode;
  className?: string;
  /** The tab strip, so the header owns the whole block the artboard draws. */
  children?: React.ReactNode;
}

/**
 * The exit chevron's classes. `text-pastel-orange` by name rather than the
 * Press Box token: the exit is brand orange in both draft rooms and
 * draftRoomMobileGuard reads the class by that name. Same hex either way.
 */
export const PB_DRAFT_EXIT =
  "focus-citrus relative flex-none text-[18px] leading-none text-pastel-orange after:absolute after:-inset-y-[13px] after:-inset-x-5 after:content-['']";

export function PressBoxDraftHeader({
  leagueName,
  progress,
  connected,
  total,
  aside,
  onBack,
  exit,
  className,
  children,
}: PressBoxDraftHeaderProps) {
  const showPresence = connected != null && total != null;
  return (
    <header className={cn(PB_TYPE, 'bg-pressbox-surface pt-1.5 px-3.5', className)}>
      <div className="flex items-center gap-2.5">
        {exit ??
          (onBack ? (
            <button type="button" onClick={onBack} aria-label="Leave the draft room" className={PB_DRAFT_EXIT}>
              &lsaquo;
            </button>
          ) : null)}

        <div className="flex-1 min-w-0">
          <h1 className="font-condensed font-extrabold text-[22px] leading-none uppercase tracking-[0.02em] text-pressbox-text truncate">
            {leagueName ? (
              <>
                {leagueName} draft<span className="sr-only"> room</span>
              </>
            ) : (
              'Draft room'
            )}
          </h1>
          {progress && (
            <div className="mt-[3px] font-plex font-medium text-[10px] uppercase text-pressbox-text/50 truncate">
              {progress}
            </div>
          )}
        </div>

        {(showPresence || aside) && (
          <div className="flex items-center gap-2 flex-none">
            {showPresence && (
              <p className="font-plex font-medium text-[9px] text-pressbox-text/50 whitespace-nowrap">
                {connected}/{total} <span className="text-pressbox-sage">&#9679;</span>
              </p>
            )}
            {aside}
          </div>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}

export default PressBoxDraftHeader;
