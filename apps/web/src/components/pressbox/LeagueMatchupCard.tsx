/**
 * ONE LEAGUE MATCHUP, ON THE HQ SCREEN (artboard 1a).
 *
 * Grid `1fr 64px 1fr` in a 12px-radius tile. Both teams face outward from a
 * centre column that carries `VS` over `27 · 26 LEFT` — the games each side
 * still has to play, which is the single fact that turns a scoreline into a
 * prediction. A 40-point lead with four games left and a 40-point lead with
 * forty are not the same league week, and this is the only place on the
 * screen that says which one you are in.
 *
 * YOUR CARD TAKES AN ORANGE BORDER, not a fill: the row is already a card on
 * a dark surface, and a tint on top of a tile reads as "disabled" more often
 * than "yours". The border at 35% is enough to find in a stack of six.
 *
 * The win-probability bar under each name is 3px and MIRRORED — your side
 * fills from the left, the opponent's from the right (`direction: rtl`) — so
 * the two bars grow toward each other and the gap between them is the margin.
 * Orange for you, ice for them, sage for a neutral matchup you are only
 * watching: the same three-colour rule as every other Press Box surface.
 */
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxLeagueMatchupSide {
  name: string;
  /** 0–100. Absent hides the bar rather than drawing a guess. */
  winPct?: number | null;
  points?: number | null;
  gamesLeft?: number | null;
  isYou?: boolean;
}

export interface PressBoxLeagueMatchupCardProps {
  home: PressBoxLeagueMatchupSide;
  away: PressBoxLeagueMatchupSide;
  to?: string;
  onPress?: () => void;
  className?: string;
}

const pct = (n: number | null | undefined) => (n == null ? null : `${Math.round(n)}%`);
const fig = (n: number | null | undefined) => (n == null ? null : n.toFixed(1));

function Disc({ side, mine }: { side: PressBoxLeagueMatchupSide; mine: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'w-[30px] h-[30px] flex-none rounded-full flex items-center justify-center font-condensed font-bold text-[11px] text-pressbox-text',
        mine ? 'bg-pressbox-orange/20 border-2 border-pressbox-orange' : 'bg-[#2a3a30]',
      )}
    >
      {side.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The leading score is sage on WHICHEVER side leads (artboard 1a: `118.4`
 * sage on the left of the first card, `127.5` sage on the right of the
 * third); the trailing one stays in the line's own colour. A tie is nobody's.
 */
function Side({ side, mirrored, leading }: { side: PressBoxLeagueMatchupSide; mirrored: boolean; leading: boolean }) {
  const mine = !!side.isYou;
  const bar = mine ? 'bg-pressbox-orange' : mirrored ? 'bg-pressbox-ice' : 'bg-pressbox-sage';
  const line = [pct(side.winPct), fig(side.points)];
  const points = leading ? 'text-pressbox-sage' : mine ? 'text-pressbox-orange-soft' : 'text-pressbox-text/55';
  return (
    <span className={cn('flex items-center gap-2 min-w-0', mirrored && 'flex-row-reverse text-right')}>
      <Disc side={side} mine={mine} />
      <span className="min-w-0 flex-1">
        <span className="block font-barlow font-bold text-[13px] truncate text-pressbox-text">
          {side.name}
        </span>
        <span
          className={cn(
            'block font-plex font-medium text-[10px] truncate',
            mine ? 'text-pressbox-orange-soft' : 'text-pressbox-text/55',
          )}
        >
          {mirrored ? (
            <>
              {line[1] && <span className={points}>{line[1]}</span>}
              {line[1] && line[0] ? ' · ' : ''}
              {line[0]}
            </>
          ) : (
            <>
              {line[0]}
              {line[0] && line[1] ? ' · ' : ''}
              {line[1] && <span className={points}>{line[1]}</span>}
            </>
          )}
        </span>
        {side.winPct != null && (
          <span
            aria-hidden="true"
            className="block h-[3px] mt-1 rounded-[2px] bg-white/[0.08] overflow-hidden"
            style={mirrored ? { direction: 'rtl' } : undefined}
          >
            <span className={cn('block h-full', bar)} style={{ width: `${Math.max(0, Math.min(100, side.winPct))}%` }} />
          </span>
        )}
      </span>
    </span>
  );
}

export function PressBoxLeagueMatchupCard({
  home,
  away,
  to,
  onPress,
  className,
}: PressBoxLeagueMatchupCardProps) {
  const yours = !!(home.isYou || away.isYou);
  const left = home.gamesLeft;
  const right = away.gamesLeft;
  const leftLine = left != null && right != null ? `${left} · ${right} LEFT` : null;
  const homeLeads = home.points != null && away.points != null && home.points > away.points;
  const awayLeads = home.points != null && away.points != null && away.points > home.points;

  const body = (
    <>
      <Side side={home} mirrored={false} leading={homeLeads} />
      <span className="text-center font-plex font-semibold text-[9px] text-pressbox-text/40">
        VS
        {leftLine && <span className="block mt-0.5 text-pressbox-text/70">{leftLine}</span>}
      </span>
      <Side side={away} mirrored leading={awayLeads} />
    </>
  );

  const shell = cn(
    PB_TYPE,
    'grid grid-cols-[1fr_64px_1fr] items-center gap-1.5 px-3 py-2.5 rounded-[12px] bg-pressbox-tile border text-left',
    yours ? 'border-pressbox-orange/35' : 'border-white/[0.08]',
    className,
  );

  if (to) {
    // A router Link, not an anchor (2026-09-05): an `<a href>` inside the
    // app is a full page load -- the whole bundle again, for one tap.
    return (
      <Link to={to} className={cn(shell, 'focus-citrus')} aria-label={`${home.name} versus ${away.name}`}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onPress} className={cn(shell, 'focus-citrus w-full')} aria-label={`${home.name} versus ${away.name}`}>
      {body}
    </button>
  );
}

export default PressBoxLeagueMatchupCard;
