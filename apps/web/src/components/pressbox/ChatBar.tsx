/**
 * CHAT BAR — persistent, 40px, above the nav on every league page.
 *
 * Replaces the floating orange FAB. The FAB was a saturated circle sitting on
 * top of the content, which under Press Box's colour contract is a second
 * "you" signal fighting the real one; worse, it covered a roster row. A bar
 * costs 40px of height and covers nothing.
 *
 * Two variants, because the slot has two jobs:
 *   `chat`   — the last thing a leaguemate said. Social pressure to open it.
 *   `stormy` — the one thing the assistant thinks you should do right now,
 *              with the action inline. This is the variant that earns the
 *              40px; a bar that only ever says "Chat" is a link, not a bar.
 *
 * Truncation is structural, not decorative: the message is the only variable
 * -length thing in fixed-height chrome, so it gets the META treatment and the
 * action never moves.
 */
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHATBAR_H, BOTTOMNAV_H } from './chromeMetrics';
import { PB_TYPE } from './rowScale';

export interface ChatBarProps {
  variant?: 'chat' | 'stormy';
  /** Display name of whoever spoke last. */
  author?: string | null;
  /** The message, or Stormy's nudge. Truncated — never wraps. */
  message?: string | null;
  /** Unread count. Rendered only above zero. */
  unread?: number;
  /** Right-aligned action label on the stormy variant, e.g. `SWAP`, `FIX →`. */
  actionLabel?: string;
  onPress?: () => void;
  onAction?: () => void;
  className?: string;
}

export function ChatBar({
  variant = 'chat',
  author,
  message,
  unread = 0,
  actionLabel,
  onPress,
  onAction,
  className,
}: ChatBarProps) {
  const isStormy = variant === 'stormy';
  const label = isStormy
    ? `Stormy · ${message ?? ''}`
    : `Chat${author ? ` · ${author}` : ''}${message ? `: ${message}` : ''}`;

  return (
    <div
      className={cn(
        PB_TYPE,
        'fixed left-0 right-0 z-app-nav lg:hidden',
        'bg-pressbox-surface border-t border-white/[0.08]',
        'flex items-center gap-2 px-3',
        className,
      )}
      style={{ height: CHATBAR_H, bottom: `calc(${BOTTOMNAV_H}px + env(safe-area-inset-bottom))` }}
    >
      <button
        type="button"
        onClick={onPress}
        className="focus-citrus flex items-center gap-2 min-w-0 flex-1 h-full text-left"
        aria-label={isStormy ? `Stormy: ${message ?? 'suggestion'}` : 'Open league chat'}
      >
        {isStormy ? (
          <span
            aria-hidden="true"
            className="w-[22px] h-[22px] flex-shrink-0 rounded-full bg-pressbox-tile-high ring-1 ring-white/[0.08] flex items-center justify-center font-condensed font-extrabold text-[11px] text-pressbox-orange-soft"
          >
            S
          </span>
        ) : (
          <MessageCircle className="w-4 h-4 flex-shrink-0 text-pressbox-orange-soft" strokeWidth={2} aria-hidden="true" />
        )}
        <span className="font-plex font-medium text-[10px] leading-none whitespace-nowrap overflow-hidden text-ellipsis text-pressbox-text/55">
          {label}
        </span>
      </button>

      {unread > 0 && !isStormy && (
        <span
          className="flex-shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-pressbox-grapefruit flex items-center justify-center font-plex font-semibold text-[9px] text-pressbox-orange-ink"
          aria-label={`${unread} unread`}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}

      {isStormy && actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="focus-citrus flex-shrink-0 h-7 px-2.5 rounded-[8px] bg-pressbox-orange font-condensed font-extrabold text-[11px] uppercase tracking-[0.06em] text-pressbox-orange-ink"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default ChatBar;
