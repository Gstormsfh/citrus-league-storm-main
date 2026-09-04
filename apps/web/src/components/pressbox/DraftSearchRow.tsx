/**
 * THE DRAFT POOL SEARCH ROW (artboard 4a).
 *
 * A 38px field and a sort button, both 10px-radius `#16241B`, sharing one
 * line. The sort control is a BUTTON showing its current key (`PROJ ▾`)
 * rather than a labelled select: on a phone, under a clock, the useful
 * information is which sort is on, and the label "Sort by" costs the width
 * that the answer needs.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxDraftSearchRowProps {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  /** `PROJ`. The arrow is drawn here. */
  sortLabel: string;
  onSortPress?: () => void;
  className?: string;
}

export function PressBoxDraftSearchRow({
  value,
  onValueChange,
  placeholder = 'Search',
  sortLabel,
  onSortPress,
  className,
}: PressBoxDraftSearchRowProps) {
  return (
    <div className={cn(PB_TYPE, 'flex gap-1.5', className)}>
      <div className="flex-1 h-[38px] rounded-[10px] bg-pressbox-tile flex items-center gap-2 px-3">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="flex-none text-pressbox-text/45"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Search the player pool"
          className="flex-1 min-w-0 bg-transparent outline-none font-barlow text-[13px] text-pressbox-text placeholder:text-pressbox-text/45"
        />
      </div>
      <button
        type="button"
        onClick={onSortPress}
        aria-label={`Sort by ${sortLabel}. Change sort`}
        className="focus-citrus h-[38px] px-3 rounded-[10px] bg-pressbox-tile font-plex font-semibold text-[10px] text-pressbox-text/80"
      >
        {sortLabel} &#9662;
      </button>
    </div>
  );
}

export default PressBoxDraftSearchRow;
