/**
 * THE PRESS BOX TILE.
 *
 * A destination with the one live number that says whether you need to open
 * it: `Standings` over `2nd · 4–1 · 71% playoff odds`. That second line is
 * the whole design. A grid of six labelled boxes is a menu; a grid of six
 * boxes each carrying its current state is a STATUS BOARD, and it answers
 * most of the questions before you tap anything.
 *
 * The stat is Barlow 400 at 11px, not mono. Everywhere else in Press Box a
 * number is mono because it is being COMPARED — column against column, row
 * against row. Here it is being read as a sentence, once, and the mono face
 * would make six unrelated numbers look like a table.
 *
 * TWO SIZES, both the artboard's. The league menu (1a) is a full screen of
 * nothing but tiles, so they take 14px radius, an 18px glyph and a 15px
 * title, and the text sits on the floor of the box. League HQ runs the same
 * grid UNDER a matchup list, where the tiles are the second thing on the
 * screen rather than the only thing: 12px radius, 16px glyph, 14px title,
 * and the text packs up against the icon. `dense` picks the second.
 */
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxTileProps {
  title: string;
  /** The one live number. Omit it rather than inventing one. */
  stat?: string | null;
  to: string;
  Icon: LucideIcon;
  onNavigate?: () => void;
  /** League HQ's tighter tile. */
  dense?: boolean;
  className?: string;
}

export function PressBoxTile({ title, stat, to, Icon, onNavigate, dense, className }: PressBoxTileProps) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        PB_TYPE,
        'focus-citrus flex flex-col min-h-[88px] p-3 bg-pressbox-tile border border-white/[0.08]',
        dense ? 'rounded-[12px]' : 'rounded-[14px]',
        className,
      )}
    >
      <Icon
        className={cn('text-pressbox-orange-soft', dense ? 'w-4 h-4' : 'w-[18px] h-[18px]')}
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className={cn('block font-barlow font-bold text-pressbox-text', dense ? 'mt-2 text-[14px]' : 'mt-auto text-[15px]')}>
        {title}
      </span>
      {stat && (
        <span className="block mt-0.5 font-barlow text-[11px] text-pressbox-text/55">{stat}</span>
      )}
    </Link>
  );
}

export default PressBoxTile;
