import { cn } from '@/lib/utils';
import { Star, Info } from 'lucide-react';
import { Mug } from '@/components/roster/Mug';
import { mugFromDirectory } from '@/components/roster/headshot';
import { positionChipClasses, positionChipKey } from '@/components/roster/positionChip';
import { statusChipFor } from '@/components/player/statusChip';
import type { PoolHeadline } from './draftPoolHeadline';
import { ROW_HEADLINE, ROW_HEADLINE_LABEL, ROW_META, ROW_MICRO, ROW_NAME } from '@/components/phoneRowScale';
import type { Player } from '@/services/PlayerService';
import type { DraftProjection, QualitySignal } from './draftDecision';
import { ordinalPercentile } from './draftDecision';

/**
 * ONE DRAFT-POOL ROW ON A PHONE (2026-09-02).
 *
 * Measured before this existed, on `harness/draft.html` at 393x852 with the
 * caller on the clock: the row was 60px carrying a 9px rank, a 13px name, an
 * 11px stat line truncated mid-number ("C · ANA · 31 G · 56 A · …"), a 15px
 * headline and an 8px unit label — five sizes inside seven pixels of each
 * other, which is the flat band `phoneRowScale.ts` was written to fix on the
 * roster and matchup rows. Its headline number was the player's SEASON TOTAL
 * fantasy points, and its face was a bare <img> that set `display:none` on
 * error, so a row whose headshot failed showed no face at all.
 *
 * This row wears the vocabulary the rest of the app already speaks:
 * `Mug` for the face (headshot → team crest → initials, never a hole),
 * `positionChip` for the position, and the four rungs of `phoneRowScale`
 * for type. It is deliberately the same reading order as
 * `freeagents/FreeAgentRow` — where he ranks, who he is, what he plays, what
 * he is worth, the tap that gets him — because a manager who has learned one
 * pool should not have to learn a second.
 *
 * WHAT IS NEW HERE, and why each earns its pixels on a 393px screen:
 *
 *   * The headline is the REST-OF-SEASON PROJECTION scored through this
 *     league's own categories, not last season's total. A draft is a
 *     forward-looking decision.
 *   * Under it, a quality signal: xG/60 (or GAR/60, or save rate for a
 *     goalie) as a percentile inside the player's own cohort. One number,
 *     cohort-relative, from the Citrus model — the thing a manager cannot
 *     get from a raw stat line, and the thing that used to be two taps and a
 *     modal away.
 *
 * Neither is invented. `projection` and `signal` are both null when the
 * payload cannot support them (a guest's 401, a player the pipeline has not
 * scored), and the row then renders exactly what it rendered before they
 * existed: season fantasy points, and no signal line.
 */

export interface DraftPoolRowProps {
  /** 1-based position in the current filtered ordering. */
  rank: number;
  player: Player;
  /** Season fantasy points under league scoring. The fallback headline. */
  seasonFpts: number;
  /** Citrus's rest-of-season projection, league-scored. Null when absent. */
  projection: DraftProjection | null;
  /** The one cohort-relative advanced read. Null when absent. */
  signal: QualitySignal | null;
  /**
   * The stat the pool is currently sorted by, already resolved to a number
   * and a label by `poolHeadlineFor`. When set it REPLACES the projection as
   * the row's headline, because on a phone that number is the only thing the
   * manager can compare two players on, and it has to be the thing they
   * sorted by. Null (Overall Rank, Name) keeps the projection.
   */
  headlineOverride?: PoolHeadline | null;
  selected: boolean;
  drafted: boolean;
  queued: boolean;
  /** Show the inline Draft button: on the clock, or this row is selected. */
  canDraft: boolean;
  submitting: boolean;
  onSelect: () => void;
  onDraft: () => void;
  /** Undefined removes the queue star entirely (v1 call sites). */
  onToggleQueue?: () => void;
  /** Undefined removes the card affordance entirely (v1 call sites). */
  onShowCard?: () => void;
}

export function DraftPoolRow({
  rank,
  player,
  seasonFpts,
  projection,
  signal,
  headlineOverride,
  selected,
  drafted,
  queued,
  canDraft,
  submitting,
  onSelect,
  onDraft,
  onToggleQueue,
  onShowCard,
}: DraftPoolRowProps) {
  const posKey = positionChipKey(player.position);
  const status = statusChipFor(player.status);
  const fallbackHeadline = projection ? projection.total : seasonFpts;
  const headline = headlineOverride ? headlineOverride.value : fallbackHeadline;
  const headlineDecimals = headlineOverride ? headlineOverride.decimals : 1;
  const headlineLabel = headlineOverride
    ? headlineOverride.label
    : (projection ? 'proj' : 'fpts');
  // +/- is the one stat where a leading sign carries meaning.
  const headlineText =
    headlineOverride?.label === '+/-' && headline > 0
      ? `+${headline.toFixed(headlineDecimals)}`
      : headline.toFixed(headlineDecimals);

  return (
    <div
      data-testid="draft-pool-row"
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-2 min-h-[64px] transition-colors active:bg-pastel-surface-high/60',
        !drafted && 'cursor-pointer',
        selected && 'bg-fantasy-primary/10 ring-1 ring-inset ring-fantasy-primary/40',
        drafted && 'opacity-40',
      )}
      onClick={() => !drafted && onSelect()}
    >
      <span
        className={cn(
          'w-5 shrink-0 text-right font-jbmono tabular-nums leading-none text-white/55',
          ROW_MICRO,
        )}
        data-testid="draft-pool-rank"
      >
        {rank}
      </span>

      <Mug p={mugFromDirectory(player)} size="sm" crest />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {queued && (
            <Star
              className="h-3 w-3 shrink-0 fill-fantasy-tertiary text-fantasy-tertiary"
              aria-hidden="true"
            />
          )}
          <span className={cn(ROW_NAME, 'text-pastel-cream')}>{player.full_name}</span>
          {status && (
            <span
              data-testid="draft-pool-status-chip"
              className={cn(
                ROW_MICRO,
                'leading-none font-bold px-1 py-px rounded-sm whitespace-nowrap shrink-0',
                status.cls,
              )}
            >
              {status.label}
            </span>
          )}
        </div>

        <div className={cn(ROW_META, 'mt-1 flex items-center gap-1.5 overflow-hidden')}>
          {/* The roster's own position palette shrunk to a second line, the
              same `cn` trick FreeAgentRow uses: tailwind-merge lets the
              geometry here replace the chip's 32px box while every colour
              and ring in positionChip.ts survives. One palette, two sizes. */}
          <span
            data-testid="draft-pool-position-chip"
            className={cn(
              positionChipClasses(posKey),
              'w-auto h-[18px] min-w-[26px] px-1.5 rounded text-[10px]',
            )}
          >
            {posKey}
          </span>
          <span className="text-white/55 font-semibold shrink-0">{player.team}</span>
          {signal ? (
            <>
              {/* NO SEPARATOR DOT, and the reason is measured, not stylistic:
                  the name column is 112px at 393 and the meta line needs
                  110px for chip + team + signal. The dot plus its two gaps is
                  10px, which is exactly what was pushing the percentile off
                  the row ("xG 9…" on every row). The signal is sage against a
                  white-alpha team code, so it separates on colour instead.

                  The moat, on the row. `title` carries the cohort in full;
                  the row itself has 393px and prints the short form. */}
              <span
                data-testid="draft-pool-signal"
                className="text-pastel-sage font-semibold truncate"
                title={`${signal.metric} ${signal.value}, ${ordinalPercentile(signal.percentile)} percentile of ${signal.cohortSize} ${signal.cohortNoun}. Citrus model${signal.lowSample ? '. Thin sample' : ''}`}
              >
                {signal.shortMetric} {ordinalPercentile(signal.percentile)}
                {signal.lowSample ? '*' : ''}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end text-right">
        <span
          className={cn(ROW_HEADLINE, 'text-pastel-sage-soft')}
          data-testid="draft-pool-projection"
        >
          {headlineText}
        </span>
        <span
          className={cn(ROW_HEADLINE_LABEL, 'text-white/55 mt-1')}
          data-testid="draft-pool-projection-label"
        >
          {headlineLabel}
        </span>
      </div>

      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
        {/* THE MODAL STEP STANDS DOWN UNDER THE CLOCK (2026-09-02).
            Measured at 393x852: rank, face, name, projection, info, star and
            Draft together left the name column 90px, so every row read "Leo
            Car…" and the quality signal was clipped off the second line
            entirely. Something had to go, and the info button is the right
            thing: this row now carries the projection and the cohort
            percentile inline, which is exactly the information the modal was
            being opened for, and nobody opens a modal with twenty seconds on
            the clock. Off the clock the button is back and the card is one
            tap away. Never more than two controls, so the name always has
            room for a real name. */}
        {onShowCard && !canDraft && (
          <button
            type="button"
            className="h-9 w-8 flex items-center justify-center rounded-md active:bg-white/5"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onShowCard();
            }}
            title={`View ${player.full_name} card`}
            aria-label={`View ${player.full_name} player card`}
            data-testid="pool-row-card-button"
          >
            <Info className="h-4 w-4 text-pastel-cream/70" aria-hidden="true" />
          </button>
        )}
        {onToggleQueue && (
          <button
            type="button"
            className="h-9 w-8 flex items-center justify-center rounded-md active:bg-white/5"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleQueue();
            }}
            title={queued ? 'Remove from queue' : 'Add to queue'}
            aria-label={
              queued
                ? `Remove ${player.full_name} from your queue`
                : `Add ${player.full_name} to your queue`
            }
            aria-pressed={queued}
            data-testid="pool-queue-star"
          >
            <Star
              className={cn(
                'h-4 w-4',
                queued ? 'fill-fantasy-tertiary text-fantasy-tertiary' : 'text-pastel-cream/70',
              )}
              aria-hidden="true"
            />
          </button>
        )}
        {canDraft && (
          <button
            type="button"
            className={cn(
              'ml-0.5 h-9 px-2 rounded-lg font-display font-bold text-[11px] leading-none whitespace-nowrap',
              'bg-pastel-orange text-pastel-surface active:scale-95 transition-transform',
              'disabled:opacity-50',
            )}
            disabled={submitting}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onDraft();
            }}
            data-testid="pool-row-draft-button"
          >
            {submitting ? 'Submitting…' : 'Draft'}
          </button>
        )}
      </div>
    </div>
  );
}

export default DraftPoolRow;
