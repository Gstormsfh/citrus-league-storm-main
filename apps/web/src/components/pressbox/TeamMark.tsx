/**
 * A TEAM'S MARK (2026-09-05). The Scores rows drew each team as its
 * abbreviation in a coloured circle -- the thing every AI-drawn scoreboard
 * does, and the thing Garrett named. The app already draws the NHL crest
 * everywhere else it names a team (the league header, the Mug's fallback,
 * the matchup logos bar), from the same NHL asset URL; this is that crest,
 * at a row's size, with the Press Box fallback when the SVG does not load:
 * the abbreviation in condensed caps on a tile, no circle.
 *
 * The failed URL is remembered per URL so a later abbreviation gets its
 * own try, and a failed <img> is replaced, never left as a broken glyph.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { teamCrestUrl } from '@/components/roster/headshot';

export type PressBoxTeamMarkSize = 'xs' | 'sm' | 'md';

const SIZE: Record<PressBoxTeamMarkSize, { box: string; text: string }> = {
  xs: { box: 'w-5 h-5', text: 'text-[8px]' },
  sm: { box: 'w-7 h-7', text: 'text-[10px]' },
  md: { box: 'w-9 h-9', text: 'text-[12px]' },
};

export interface PressBoxTeamMarkProps {
  abbrev: string;
  size?: PressBoxTeamMarkSize;
  /** The accessible name; the abbreviation when the caller has nothing better. */
  label?: string;
  className?: string;
}

export function PressBoxTeamMark({ abbrev, size = 'sm', label, className }: PressBoxTeamMarkProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const code = (abbrev || '').toUpperCase();
  const url = /^[A-Z]{2,4}$/.test(code) ? teamCrestUrl(code) : null;
  const s = SIZE[size];
  const ok = url !== null && failed !== url;
  return (
    <span
      className={cn('relative shrink-0 flex items-center justify-center', s.box, className)}
      data-testid="team-mark"
      data-mark-state={ok ? 'crest' : 'text'}
      role="img"
      aria-label={label ?? code}
    >
      {ok ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" onError={() => setFailed(url)} />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'w-full h-full rounded-[6px] bg-pressbox-tile-high flex items-center justify-center font-condensed font-bold tracking-[0.04em] text-pressbox-text/80',
            s.text,
          )}
        >
          {code.slice(0, 3)}
        </span>
      )}
    </span>
  );
}

export default PressBoxTeamMark;
