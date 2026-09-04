/**
 * THE PRESS BOX APP HEADER (artboard 1a, home).
 *
 * The only header in the app that is not about a league: mark, wordmark,
 * search, `+ LEAGUE`, notifications. `FANTASY` is Barlow Condensed 800 at
 * 24px — the largest type in Press Box outside a scoreboard — because this is
 * the one screen with nothing above it to defer to.
 *
 * `+ LEAGUE` IS THE ONLY ORANGE THING HERE, and it is a full pill rather than
 * an icon square. Adding or joining a league is the single action that makes
 * every other screen possible, so it is the one that gets a word instead of a
 * glyph; search and notifications are 34px squares because they are places
 * you already know how to get to.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxAppHeaderProps {
  title?: string;
  logoSrc?: string | null;
  onSearch?: () => void;
  onAddLeague?: () => void;
  onNotifications?: () => void;
  /** Unread count. Absent or 0 hides the dot rather than showing a zero. */
  unread?: number | null;
  className?: string;
}

const SQUARE =
  'focus-citrus w-[34px] h-[34px] flex-none rounded-[10px] bg-pressbox-tile border border-white/[0.08] flex items-center justify-center text-pressbox-text';

export function PressBoxAppHeader({
  title = 'Fantasy',
  logoSrc,
  onSearch,
  onAddLeague,
  onNotifications,
  unread,
  className,
}: PressBoxAppHeaderProps) {
  return (
    <header className={cn(PB_TYPE, 'flex items-center justify-between gap-2 pl-4 pr-4 pt-2 pb-1.5', className)}>
      <div className="flex items-center gap-2 min-w-0">
        {logoSrc && <img src={logoSrc} alt="" className="w-[26px] h-[26px] flex-none" />}
        <h1 className="font-condensed font-extrabold text-[24px] uppercase tracking-[0.02em] text-pressbox-text truncate">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onSearch} aria-label="Search" className={SQUARE}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onAddLeague}
          className="focus-citrus h-[34px] px-3 rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink flex items-center gap-1.5 font-plex font-bold text-[12px] tracking-[0.08em] whitespace-nowrap"
        >
          + LEAGUE
        </button>

        <button
          type="button"
          onClick={onNotifications}
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          className={cn(SQUARE, 'relative')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {!!unread && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 px-1 py-px rounded-full bg-pressbox-grapefruit text-[#2a0a0f] font-plex font-bold text-[9px]"
            >
              {unread}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

export default PressBoxAppHeader;
