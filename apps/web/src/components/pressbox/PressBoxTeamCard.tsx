/**
 * THE ROSTER'S TEAM CARD — who you are, how you are doing, and the four
 * things you came here to do.
 *
 * Read out of the reference artboard, node by node:
 *
 *   card   background:#16241B;border:1px solid rgba(255,255,255,.08);
 *          border-radius:14px;padding:10px 12px
 *   disc   40px round, background rgba(255,107,26,.2),
 *          border 2px solid #FF6B1A, font:700 14px 'Barlow Condensed'
 *   name   font:700 16px Barlow  +  record font:500 11px Plex at .5
 *   win    font:500 10px Plex #FF9F66, then a 3px bar, then
 *          font:600 11px Plex with the leading score in #84A57D
 *   bar    height:3px;border-radius:2px;background:#8DCDFF  (the OPPONENT's
 *          ice, full width) with an inner div at your win% in #FF6B1A
 *   action flex, gap 6, height 32, radius 8, font:600 10px Plex ls .08em;
 *          the first is background:#FF6B1A;color:#2a1000, the rest are
 *          rgba(255,255,255,.06) with a 1px rgba(255,255,255,.1) border
 *
 * THE BAR IS THE ONE PLACE ORANGE AND ICE MEET, and the direction is the
 * point: your share grows from the left in orange over their ice. That is the
 * same "orange = you, ice = them" the matchup screen uses, so a manager who
 * has seen one has read the other.
 *
 * Every figure arrives as a prop and every one of them is optional. A card
 * with no win probability draws no bar rather than a 50% one, and a card with
 * no record prints the name alone -- the roster page can render before the
 * standings call comes back, and a placeholder number on the screen a manager
 * makes lineup decisions from is worse than an absence.
 */
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

export interface PressBoxTeamAction {
  /** `⚡`, `⇄`, `+`, `☰` — drawn before the label. */
  glyph: string;
  label: string;
  /**
   * An in-app destination. Renders a `Link` rather than a button, so the
   * action is a real anchor: middle-click and long-press work, and
   * `linkGraphIntegrity` can see the route. `onPress` is for the actions that
   * do something on THIS page (open a sheet, switch a tab) rather than go
   * somewhere.
   */
  to?: string;
  onPress?: () => void;
  /** The one orange action. Exactly one per card, by contract. */
  primary?: boolean;
}

export interface PressBoxTeamCardProps {
  teamName: string;
  /** `4–1`. */
  record?: string | null;
  /** `2ND`. */
  rank?: string | null;
  /** Your win probability, 0-100. Draws the bar; omit and no bar is drawn. */
  winPct?: number | null;
  /** Your projected total and theirs, for the pair under the bar. */
  yourScore?: number | null;
  theirScore?: number | null;
  actions?: PressBoxTeamAction[];
  className?: string;
}

const MONO = 'font-plex tabular-nums';

export function PressBoxTeamCard({
  teamName,
  record,
  rank,
  winPct,
  yourScore,
  theirScore,
  actions = [],
  className,
}: PressBoxTeamCardProps) {
  const meta = [record, rank].filter(Boolean).join(' · ');
  const leading = yourScore != null && theirScore != null && yourScore >= theirScore;

  return (
    <div
      className={cn(
        'bg-pressbox-tile border border-white/[0.08] rounded-[14px] px-3 py-2.5',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="w-10 h-10 flex-shrink-0 rounded-full bg-pressbox-orange/20 border-2 border-pressbox-orange flex items-center justify-center font-condensed font-bold text-[14px] text-pressbox-text"
          aria-hidden="true"
        >
          {teamName.slice(0, 1).toUpperCase()}
        </span>

        <div className="flex-1 min-w-0">
          <div className="font-barlow font-bold text-[16px] text-pressbox-text truncate">
            {teamName}
            {meta && (
              <span className={cn(MONO, 'font-medium text-[11px] text-pressbox-text/50 ml-1.5')}>
                {meta}
              </span>
            )}
          </div>

          {winPct != null && (
            <div className="flex items-center gap-1.5 mt-[3px]">
              <span className={cn(MONO, 'font-medium text-[10px] text-pressbox-orange-soft whitespace-nowrap')}>
                {Math.round(winPct)}% WIN
              </span>
              <span className="flex-1 h-[3px] rounded-[2px] bg-pressbox-ice overflow-hidden">
                <span
                  className="block h-full bg-pressbox-orange"
                  style={{ width: `${Math.max(0, Math.min(100, winPct))}%` }}
                />
              </span>
              {yourScore != null && theirScore != null && (
                <span className={cn(MONO, 'font-semibold text-[11px] text-pressbox-text whitespace-nowrap')}>
                  <span className={cn(leading && 'text-pressbox-sage')}>{yourScore.toFixed(1)}</span>
                  {' · '}
                  {theirScore.toFixed(1)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {actions.length > 0 && (
        <div className="flex gap-1.5 mt-2.5">
          {actions.map((a) => {
            const cls = cn(
              'flex-1 h-8 rounded-[8px] flex items-center justify-center gap-1.5',
              'font-plex font-semibold text-[10px] uppercase tracking-[0.08em]',
              a.primary
                ? 'bg-pressbox-orange text-pressbox-orange-ink'
                : 'bg-white/[0.06] border border-white/10 text-pressbox-text',
            );
            const body = (
              <>
                <span aria-hidden="true">{a.glyph}</span>
                {a.label}
              </>
            );
            return a.to ? (
              <Link key={a.label} to={a.to} className={cn('focus-citrus', cls)}>
                {body}
              </Link>
            ) : (
              <button key={a.label} type="button" onClick={a.onPress} className={cn('focus-citrus', cls)}>
                {body}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PressBoxTeamCard;
