/**
 * THE PRESS BOX ACTION GRID — the Players screen's six verbs in one tile.
 *
 * Artboard 1a, Players: `display:flex;justify-content:space-between;
 * background:#16241B;border:1px solid rgba(255,255,255,.08);border-radius:
 * 12px;padding:8px 6px;font:600 9px 'IBM Plex Mono';letter-spacing:.08em;
 * color:rgba(243,239,230,.5)`, each cell a column of an 18px stroke icon
 * over its word, `gap:5px`, `flex:1`. The active cell is SAGE — it is where
 * you are, and the artboard reserves sage for that — and nothing here is
 * orange, because none of these is the primary action of the screen: the
 * `+` on a row is.
 *
 * It is a tile of ENTRY POINTS, not a tab bar: SEARCH opens the field,
 * LEADERS and TRADE leave for other screens, TREND / AVAILABLE / WATCH switch
 * the list under it. A cell may therefore be `active` (the list it names is
 * showing), a link (`to`), or a plain handler (`onSelect`) — the caller says
 * which, and the grid draws them identically so the tile reads as one set.
 */
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxActionCell {
  key: string;
  /** `SEARCH`. Rendered uppercase; keep it to one short word. */
  label: string;
  /** A lucide icon; drawn at 18px, stroke 2. */
  icon: LucideIcon;
  /** Sage: the list this cell names is what is on screen. */
  active?: boolean;
  /** A route — rendered as a Link. */
  to?: string;
  onSelect?: () => void;
  /** The chip's accessible name when the word alone is terse. */
  ariaLabel?: string;
}

export interface PressBoxActionGridProps {
  cells: PressBoxActionCell[];
  /** Names the tile for a screen reader. `Players actions`. */
  label: string;
  className?: string;
}

/**
 * The cell is 34.5px tall as drawn (18px glyph, 5px gap, 9px word) inside
 * the tile's 8px padding. The hit area is grown to the tile's full 52px
 * with the `after:` inset rather than by padding the cell, so the tile
 * measures what the artboard measures and every tap still lands.
 */
const CELL =
  "focus-citrus relative flex-1 flex flex-col items-center gap-[5px] whitespace-nowrap after:absolute after:-inset-y-[9px] after:inset-x-0 after:content-['']";

export function PressBoxActionGrid({ cells, label, className }: PressBoxActionGridProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        PB_TYPE,
        'flex justify-between rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-1.5 py-2',
        'font-plex font-semibold text-[9px] uppercase tracking-[0.08em] text-pressbox-text/50',
        className,
      )}
    >
      {cells.map((c) => {
        const Icon = c.icon;
        const cls = cn(CELL, c.active && 'text-pressbox-sage');
        const body = (
          <>
            <Icon className="w-[18px] h-[18px]" strokeWidth={2} aria-hidden />
            {c.label}
          </>
        );
        if (c.to) {
          return (
            <Link key={c.key} to={c.to} className={cls} aria-label={c.ariaLabel}>
              {body}
            </Link>
          );
        }
        return (
          <button
            key={c.key}
            type="button"
            onClick={c.onSelect}
            aria-pressed={c.active}
            aria-label={c.ariaLabel}
            className={cls}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

export default PressBoxActionGrid;
