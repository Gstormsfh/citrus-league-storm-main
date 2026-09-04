/**
 * THE PRESS BOX MATCHUP ROW — two players, one slot, mirrored.
 *
 * Grid `1fr 34px 1fr`, min-height 58, hairline BELOW (the roster row rules
 * above; this one below — both taken from the artboard, which draws the two
 * lists differently because the matchup has a header block above it and the
 * roster has a column header).
 *
 * Read out of `Citrus Redesign - Directions.dc.html`:
 *
 *     display:grid;grid-template-columns:1fr 34px 1fr;align-items:center;
 *     min-height:58px;border-bottom:1px solid rgba(255,255,255,.06)
 *
 * THE MIRROR IS THE WHOLE POINT. The opponent's side is not a second copy of
 * the same markup — it is the same side reversed, so both players' faces sit
 * against the outer edges of the screen and both numbers sit against the
 * centre chip. The artboard does it with three declarations, and so does
 * this: `flex-direction:row-reverse`, `text-align:right`, and `direction:rtl`
 * on the progress bar so it fills from the outside in. The team code also
 * swaps sides of the name — `McDavid EDM` on the left, `NSH Stamkos` on the
 * right — because on a mirrored row the code should still be the token
 * nearest the middle.
 *
 * THE 2px BAR under each name is points-over-projection, capped at 100%: it
 * says "how much of what he was worth has he delivered", which is the one
 * question a matchup row answers that a roster row does not. Sage on your
 * side, ice on theirs — the same pairing the score bar above uses, so a
 * manager reads the row and the header the same way.
 *
 * The name rung here is 14px, not the roster's 15. Two names and two numbers
 * share 393px on this screen where the roster gives one name the full column,
 * and the artboard drops the rung accordingly.
 */
import { cn } from '@/lib/utils';
import { Mug } from '@/components/roster/Mug';
import type { MugPlayer } from '@/components/roster/headshot';
import { getTeamColor } from '@/utils/teamColors';

import { PB_POSITION_CHIP_BASE, PB_CHIP_STARTER, PB_CHIP_BENCH } from './positionChip';
import { PB_TYPE, PB_ROW_HEADLINE, PB_ROW_HEADLINE_LABEL, PB_ROW_META } from './rowScale';

export interface PressBoxMatchupPlayer extends MugPlayer {
  id: string | number;
  /** Last name only on this screen — the column is half a phone wide. */
  name: string;
  teamAbbreviation?: string;
  /** `vs TOR 3RD · 1G 2A 4S`, `@ DAL · 8:30 PM · PP1`, `FINAL 4-2 · 2A 3S`. */
  metaLine?: string;
  /** True once the game is live, in intermission or final. */
  isLiveOrFinal?: boolean;
  points?: number | null;
  projection?: number | null;
}

export interface PressBoxMatchupRowProps {
  /** The slot both players occupy. `BN` renders the neutral chip. */
  slot: string;
  you: PressBoxMatchupPlayer | null;
  them: PressBoxMatchupPlayer | null;
  bench?: boolean;
  onPlayerPress?: (player: PressBoxMatchupPlayer) => void;
  className?: string;
}

const fig = (n: number | null | undefined) => (n == null ? '–' : n.toFixed(1));

/** How much of his projection he has delivered, 0-100. */
function progress(p: PressBoxMatchupPlayer | null): number {
  if (!p || !p.isLiveOrFinal || p.points == null || !p.projection) return 0;
  return Math.max(0, Math.min(100, (p.points / p.projection) * 100));
}

function Side({
  player,
  mine,
  onPress,
}: {
  player: PressBoxMatchupPlayer | null;
  mine: boolean;
  onPress?: (p: PressBoxMatchupPlayer) => void;
}) {
  if (!player) {
    return (
      <span className={cn(PB_ROW_META, 'text-pressbox-text/35 px-2', !mine && 'text-right block')}>
        Empty
      </span>
    );
  }
  const happened = !!player.isLiveOrFinal;
  const teamColor = player.teamAbbreviation ? getTeamColor(player.teamAbbreviation) : null;
  const code = player.teamAbbreviation ? (
    <span className="font-plex font-medium text-[10px] text-pressbox-text/50">
      {player.teamAbbreviation}
    </span>
  ) : null;

  return (
    <button
      type="button"
      onClick={() => onPress?.(player)}
      aria-label={`Open player card for ${player.name}`}
      className={cn(
        PB_TYPE,
        'flex items-center gap-[7px] min-w-0 w-full text-left',
        // The mirror: face to the outside, number against the centre chip.
        !mine && 'flex-row-reverse text-right',
      )}
    >
      <span
        className="w-[30px] h-[30px] flex-none box-border rounded-full overflow-hidden border-[1.5px] border-white/[0.16]"
        style={teamColor ? { borderColor: teamColor } : undefined}
        data-team-ring={player.teamAbbreviation || undefined}
      >
        <Mug p={player} size="xs" className="w-full h-full" crest />
      </span>

      <span className="flex-1 min-w-0 block">
        <span className="font-barlow font-bold text-[14px] leading-tight truncate block text-pressbox-text">
          {mine ? (
            <>
              {player.name} {code}
            </>
          ) : (
            <>
              {code} {player.name}
            </>
          )}
        </span>
        {player.metaLine && (
          <span
            className={cn(
              PB_ROW_META,
              'block mt-0.5',
              happened ? 'text-pressbox-sage' : 'text-pressbox-text/50',
            )}
          >
            {player.metaLine}
          </span>
        )}
        {/* Points over projection. RTL on the opponent's so it fills from the
            outside in, mirroring yours. */}
        <span
          className="block h-[2px] mt-1 rounded-[1px] bg-white/[0.08] overflow-hidden"
          style={!mine ? { direction: 'rtl' } : undefined}
        >
          <span
            className={cn('block h-full', mine ? 'bg-pressbox-sage' : 'bg-pressbox-ice')}
            style={{ width: `${progress(player)}%` }}
            data-testid="matchup-progress"
          />
        </span>
      </span>

      <span className={cn('flex-none', mine ? 'text-right' : 'text-left')}>
        <span
          className={cn(
            PB_ROW_HEADLINE,
            'block',
            happened ? 'text-pressbox-sage' : 'text-pressbox-text/60',
          )}
        >
          {fig(happened ? player.points : null)}
        </span>
        {player.projection != null && (
          <span className={cn(PB_ROW_HEADLINE_LABEL, 'block mt-0.5 text-pressbox-text/45')}>
            P {player.projection.toFixed(1)}
          </span>
        )}
      </span>
    </button>
  );
}

export function PressBoxMatchupRow({
  slot,
  you,
  them,
  bench = false,
  onPlayerPress,
  className,
}: PressBoxMatchupRowProps) {
  return (
    <div
      data-testid="pressbox-matchup-row"
      className={cn(
        'grid grid-cols-[1fr_34px_1fr] items-center min-h-[58px] border-b border-white/[0.06]',
        className,
      )}
    >
      <Side player={you} mine onPress={onPlayerPress} />
      {/* 28px here, not the roster's 30: this chip sits in a 34px gutter
          between two columns rather than at the head of a row. */}
      <span
        className={cn(
          PB_POSITION_CHIP_BASE,
          'w-[28px] h-[28px] mx-auto',
          bench ? PB_CHIP_BENCH : PB_CHIP_STARTER,
        )}
      >
        {slot}
      </span>
      <Side player={them} mine={false} onPress={onPlayerPress} />
    </div>
  );
}

export default PressBoxMatchupRow;
