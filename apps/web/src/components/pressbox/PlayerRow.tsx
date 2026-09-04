/**
 * THE PRESS BOX PLAYERS ROW — the pool, ranked, with what the league is doing
 * about each name.
 *
 * `display:flex;gap:8px;min-height:64px;border-top:1px solid rgba(255,255,255,.06)`
 * straight off the artboard. 64px rather than the roster's 56 because this row
 * carries TWO meta lines: what he is doing tonight, and what he is worth. A
 * manager scanning the pool is making a different decision from a manager
 * checking a lineup, and it needs one more line of evidence.
 *
 * FIVE COLUMNS: the rank badge (22px), the face (40px — twice the roster's,
 * because here the face IS the recognition and the row is a decision surface),
 * the name and its two meta lines, the 24-hour movement, and the action.
 *
 * THE POSITION TAG IS TINTED HERE, and that is not a contradiction of the
 * colour-restraint rule. The rule retires per-position colour from the 30px
 * SLOT CHIP, where five saturated fills down a roster read as decoration. This
 * is a 10px inline tag inside a sentence — `G COL · vs LAK 8:00` — and the
 * artboard draws it `rgba(132,165,125,.2)` with `#C8DCC4` text: a sage tint at
 * 20%, not a saturated fill, doing the job of telling a scanning eye which
 * position a name plays before it reads the name. Taken from the artboard,
 * which is the spec.
 *
 * NOTHING IS INVENTED. Every figure is optional and absent when unknown: no
 * ownership renders no ownership segment, no 24-hour movement renders no
 * movement column, and a player with no game gets no game clause rather than
 * "No game" manufactured at this layer.
 */
import { cn } from '@/lib/utils';
import { Mug } from '@/components/roster/Mug';
import type { MugPlayer } from '@/components/roster/headshot';
import { getTeamColor } from '@/utils/teamColors';

import { PB_TYPE, PB_ROW_META, PB_ROW_NAME } from './rowScale';

/** What tapping the action does. The glyph and tint follow the meaning. */
export type PressBoxPlayerAction = 'add' | 'claim' | 'swap' | 'none';

export interface PressBoxPlayerRowPlayer extends MugPlayer {
  id: string | number;
  name: string;
  teamAbbreviation?: string;
  /** `C`, `G` — the tinted inline tag. */
  position?: string;
  /** `vs LAK 8:00`. Sage when the game has started. */
  gameLabel?: string;
  isLiveOrFinal?: boolean;
  /** `CONFIRMED START`, `LOWER BODY`, `PP1 (NEW)`. */
  note?: string;
  /** Injury or roster status, e.g. `DTD`. */
  status?: string | null;
  rosteredPct?: number | null;
  startedPct?: number | null;
  weekProjection?: number | null;
  gamesThisWeek?: number | null;
}

export interface PressBoxPlayerRowProps {
  player: PressBoxPlayerRowPlayer;
  /** Position in the list. Absent renders no rank column. */
  rank?: number | null;
  /** Net adds over 24h. Positive is sage, negative grapefruit. */
  adds24h?: number | null;
  /** `→ Puck Norris`, `FREE AGENT`, `ON YOUR TEAM`. */
  destination?: string | null;
  action?: PressBoxPlayerAction;
  /** `THU` — the day a waiver claim clears, under the W. */
  claimDay?: string | null;
  actionDisabled?: boolean;
  onAction?: () => void;
  onPress?: () => void;
  className?: string;
}

/** `41200` -> `+41.2K`; small numbers stay whole. */
export function formatAdds(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '–' : '';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${abs}`;
}

const ACTION_GLYPH: Record<PressBoxPlayerAction, string> = {
  add: '+',
  claim: 'W',
  swap: '⇄',
  none: '',
};

export function PressBoxPlayerRow({
  player,
  rank,
  adds24h,
  destination,
  action = 'add',
  claimDay,
  actionDisabled,
  onAction,
  onPress,
  className,
}: PressBoxPlayerRowProps) {
  const teamColor = player.teamAbbreviation ? getTeamColor(player.teamAbbreviation) : null;
  const rising = adds24h != null && adds24h >= 0;
  const ownership: string[] = [];
  if (player.rosteredPct != null) ownership.push(`ROS ${player.rosteredPct}%`);
  if (player.startedPct != null) ownership.push(`START ${player.startedPct}%`);

  return (
    <div
      data-testid="pressbox-player-row"
      className={cn(PB_TYPE, 'flex items-center gap-2 min-h-[64px] border-t border-white/[0.06]', className)}
    >
      {rank != null && (
        <span className="w-[22px] flex-none flex flex-col items-center gap-0.5">
          <span
            aria-hidden="true"
            className={cn(
              'w-[18px] h-[18px] rounded-full flex items-center justify-center font-plex font-bold text-[11px]',
              rising
                ? 'bg-pressbox-sage/20 text-pressbox-sage'
                : 'bg-pressbox-grapefruit/20 text-pressbox-grapefruit-text',
            )}
          >
            {rising ? '+' : '–'}
          </span>
          <span className="font-plex font-semibold text-[11px] text-pressbox-text/60">{rank}</span>
        </span>
      )}

      <span
        className="w-10 h-10 flex-none box-border rounded-full overflow-hidden border-[1.5px] border-white/[0.16]"
        style={teamColor ? { borderColor: teamColor } : undefined}
        data-team-ring={player.teamAbbreviation || undefined}
      >
        <Mug p={player} size="md" className="w-full h-full" crest />
      </span>

      <button type="button" onClick={onPress} className="flex-1 min-w-0 text-left" aria-label={`Open player card for ${player.name}`}>
        <span className={cn(PB_ROW_NAME, 'block text-pressbox-text')}>
          {player.name}
          {player.status && (
            <span className="ml-1.5 font-plex font-bold text-[9px] leading-none px-1 py-px rounded-[3px] bg-pressbox-grapefruit/[0.18] text-pressbox-grapefruit-text align-[1px]">
              {player.status}
            </span>
          )}
        </span>

        <span className={cn(PB_ROW_META, 'block mt-0.5 text-pressbox-text/55')}>
          {player.position && (
            <span className="font-bold px-1.5 py-px rounded-[3px] bg-pressbox-sage/20 text-pressbox-sage-soft">
              {player.position}
            </span>
          )}
          {player.teamAbbreviation && <> {player.teamAbbreviation}</>}
          {player.gameLabel && (
            <>
              {' · '}
              <span className={cn(player.isLiveOrFinal && 'text-pressbox-sage')}>{player.gameLabel}</span>
            </>
          )}
          {player.note && <> · {player.note}</>}
        </span>

        {(ownership.length > 0 || player.weekProjection != null) && (
          <span className={cn(PB_ROW_META, 'block mt-0.5 text-pressbox-text/55')}>
            {ownership.join(' · ')}
            {player.weekProjection != null && (
              <>
                {ownership.length ? ' · ' : ''}WK PROJ{' '}
                <b className="text-pressbox-text font-semibold">{player.weekProjection.toFixed(1)}</b>
              </>
            )}
            {player.gamesThisWeek != null && <> · {player.gamesThisWeek} GP</>}
          </span>
        )}
      </button>

      {(adds24h != null || destination) && (
        <span className="w-[60px] flex-none text-right">
          {adds24h != null && (
            <span
              className={cn(
                'block font-plex font-semibold text-[15px] tabular-nums',
                rising ? 'text-pressbox-sage' : 'text-pressbox-grapefruit-text',
              )}
            >
              {formatAdds(adds24h)}
            </span>
          )}
          {destination && (
            <span className="block font-plex font-medium text-[9px] text-pressbox-text/45 truncate">
              {destination}
            </span>
          )}
        </span>
      )}

      {action !== 'none' && (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          aria-label={
            action === 'add' ? `Add ${player.name}`
            : action === 'claim' ? `Claim ${player.name} on waivers`
            : `Swap for ${player.name}`
          }
          className={cn(
            // 40px square: the iOS minimum, so the face and the tap target
            // agree instead of the face being decoration inside a bigger box.
            'w-10 h-10 flex-none rounded-[10px] border flex flex-col items-center justify-center',
            'font-plex font-semibold text-[16px] leading-none disabled:opacity-40',
            action === 'add' && 'bg-pressbox-orange/[0.15] border-pressbox-orange/[0.45] text-pressbox-orange-soft',
            action === 'claim' && 'bg-pressbox-sage/[0.15] border-pressbox-sage/40 text-pressbox-sage',
            action === 'swap' && 'bg-white/[0.06] border-white/10 text-pressbox-text',
          )}
        >
          <span>{ACTION_GLYPH[action]}</span>
          {action === 'claim' && claimDay && (
            <span className="font-plex font-medium text-[8px] leading-none mt-0.5">{claimDay}</span>
          )}
        </button>
      )}
    </div>
  );
}

export default PressBoxPlayerRow;
