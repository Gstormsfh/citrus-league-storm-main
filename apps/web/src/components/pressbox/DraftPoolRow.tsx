/**
 * THE DRAFT POOL ROW (artboard 4a).
 *
 * Grid `22px 1fr 54px 40px` at gap 10 and a 62px floor — taller than the
 * roster's 56 because the meta line here carries five facts, not two, and a
 * drafter is reading it under a clock.
 *
 * FOUR COLUMNS, and the order is an argument. Rank first, because the pool is
 * sorted and the number is how you keep your place while scrolling. Then the
 * player. Then PROJ, big, in mono — the thing you are actually choosing on.
 * ADP last and dimmest: it is what the ROOM thinks, useful only as a check
 * against what you think, so it gets the smallest, quietest column rather
 * than the position a value-based-drafting screen would give it.
 *
 * THE TIER LINE under PROJ (`TIER 2 · D1`) is 8px, below the 9px floor the
 * rest of Press Box holds, and it is the artboard's value. Tier is the one
 * fact that answers "can I wait?" — D1 in tier 2 means the drop after him is
 * a cliff — and it has to sit under the projection it qualifies without
 * competing with it.
 *
 * THE TARGET ROW takes the same tint and inset rail as your row on the
 * standings, extended to the full bleed with `-mx` so the rail reaches the
 * screen edge. On this screen it marks the player the queue says is next, not
 * a team.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxDraftPoolPlayer {
  id: string;
  rank: number;
  name: string;
  /** `D · COL · 90 PTS · 26:10 · BYE 9`. The leading token renders bold. */
  metaLead?: string | null;
  metaRest?: string | null;
  projection?: number | null;
  /** `TIER 2 · D1`. Orange when this is the tier break to act on. */
  tierLine?: string | null;
  tierUrgent?: boolean;
  adp?: number | null;
  headshotUrl?: string | null;
  /** Position in your queue. Renders the artboard's `★ Q2` after the name. */
  queuePosition?: number | null;
}

export interface PressBoxDraftPoolRowProps {
  player: PressBoxDraftPoolPlayer;
  /** The player the queue says you take next. Tinted and railed. */
  target?: boolean;
  onPress?: (player: PressBoxDraftPoolPlayer) => void;
  className?: string;
}

const GRID = 'grid grid-cols-[22px_1fr_54px_40px] gap-2.5 items-center min-h-[62px] border-t border-white/[0.06]';

export function PressBoxDraftPoolRow({ player, target, onPress, className }: PressBoxDraftPoolRowProps) {
  return (
    <button
      type="button"
      data-testid="pressbox-draft-pool-row"
      onClick={() => onPress?.(player)}
      aria-label={`${player.name}, rank ${player.rank}${target ? ', next in your queue' : ''}`}
      className={cn(
        PB_TYPE,
        GRID,
        /* No `w-full`. A grid button is already block-level and fills its
           container, and `width:100%` would pin the target row to the
           CONTENT width — the negative margin then slides the row sideways
           instead of widening it, which is exactly what it did. */
        'text-left',
        target &&
          'bg-pressbox-orange/[0.06] shadow-[inset_3px_0_0_theme(colors.pressbox.orange)] -mx-3.5 px-3.5',
        className,
      )}
    >
      <span className="font-plex font-semibold text-[12px] tabular-nums text-pressbox-text/60">
        {player.rank}
      </span>

      <span className="flex items-center gap-2.5 min-w-0">
        <span
          aria-hidden="true"
          className="w-9 h-9 flex-none rounded-full overflow-hidden border-[1.5px] border-white/[0.16] bg-pressbox-tile-high"
        >
          {player.headshotUrl && (
            <img src={player.headshotUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block font-barlow font-bold text-[15px] truncate text-pressbox-text">
            {player.name}
            {player.queuePosition != null && (
              <>
                {' '}
                <span className="font-plex font-semibold text-[10px] text-pressbox-orange-soft">
                  &#9733; Q{player.queuePosition}
                </span>
              </>
            )}
          </span>
          {(player.metaLead || player.metaRest) && (
            <span className="block mt-[3px] font-plex font-medium text-[10px] text-pressbox-text/55 truncate">
              {player.metaLead && <b className="font-bold text-pressbox-text">{player.metaLead}</b>}
              {player.metaLead && player.metaRest ? ' · ' : ''}
              {player.metaRest}
            </span>
          )}
        </span>
      </span>

      <span className="text-right">
        <span className="block font-plex font-semibold text-[17px] tabular-nums text-pressbox-text">
          {player.projection == null ? '–' : Math.round(player.projection)}
        </span>
        {player.tierLine && (
          <span
            className={cn(
              'block font-plex font-medium text-[8px]',
              player.tierUrgent ? 'text-pressbox-orange-soft' : 'text-pressbox-text/45',
            )}
          >
            {player.tierLine}
          </span>
        )}
      </span>

      <span className="text-right font-plex font-medium text-[12px] tabular-nums text-pressbox-text/70">
        {player.adp == null ? '–' : player.adp.toFixed(1)}
      </span>
    </button>
  );
}

export default PressBoxDraftPoolRow;
