import { cn } from '@/lib/utils';
import { Star, Info } from 'lucide-react';
import { Mug } from '@/components/roster/Mug';
import { mugFromDirectory } from '@/components/roster/headshot';
import { positionChipKey } from '@/components/roster/positionChip';
import { statusChipFor } from '@/components/player/statusChip';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import type { PoolHeadline } from './draftPoolHeadline';
import type { Player } from '@/services/PlayerService';
import type { DraftProjection, QualitySignal } from './draftDecision';
import { ordinalPercentile } from './draftDecision';

/**
 * ONE DRAFT-POOL ROW ON A PHONE — the Press Box cut (2026-09-04).
 *
 * The 2026-09-02 row below this one fixed the reading order and the data:
 * `Mug` for the face, the rest-of-season projection as the headline, the
 * cohort percentile as the one advanced read. All of that survives. What
 * changes is the geometry, which is now artboard 4a's — grid
 * `22px 1fr 54px 40px` at gap 10 on a 62px floor — and the type, which is
 * the Press Box ladder instead of `phoneRowScale`.
 *
 * WHERE THE V1 CONTROLS WENT, because the artboard drew five rows and no
 * controls at all, and the founder's ruling was to bake them in rather than
 * lose them:
 *
 *   * THE QUEUE STAR sits OVER THE RANK in the 22px column. That is the
 *     Players screen's own vocabulary on artboard 1a — an 18px glyph stacked
 *     on a number in a 22px column — so it costs no width and reads as part
 *     of the language rather than a bolt-on. One tap queues, exactly as
 *     before, and the row grows the artboard's `★ Q2` after the name so the
 *     queue POSITION is visible without opening the Queue tab.
 *   * THE 40px SLOT AT THE RIGHT is the artboard's ADP column. This codebase
 *     carries no ADP, so the column was going to be empty; it is the action
 *     slot instead, in the 40px `rounded-[10px]` shape every Players-row
 *     action wears on 1a. Off the clock it is the card (`ⓘ`); on the clock it
 *     is DRAFT, solid orange, because under a shot clock the eye should land
 *     on the verb. The 2026-09-02 rule holds: never both, so the name always
 *     has room for a real name.
 *   * SELECTED is the artboard's target row — a 6% orange wash and a 3px
 *     inset rail that reaches the screen edge — not a ring. The list is
 *     full-bleed and each row carries its own 14px gutter so the rail can.
 *
 * The headline's unit (`proj`, `fpts`, or the sort stat) takes the 8px line
 * under the number where the artboard prints a tier. It is uppercased by CSS
 * and left lowercase in the DOM, because that is the string every test and
 * every screen reader has always read.
 *
 * Everything that made the previous row honest still does: `projection` and
 * `signal` are null when the payload cannot support them, and the row then
 * renders exactly what it rendered before they existed.
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
  /** 1-based place in the caller's queue. Renders the artboard's `★ Q2`. */
  queuePosition?: number | null;
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

const SLOT =
  'h-10 w-10 flex items-center justify-center rounded-[10px] border transition-transform active:scale-95';

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
  queuePosition = null,
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
        PB_TYPE,
        'grid grid-cols-[22px_1fr_54px_40px] gap-2.5 items-center min-h-[62px] px-3.5',
        'border-t border-white/[0.06] transition-colors active:bg-white/5',
        !drafted && 'cursor-pointer',
        selected && 'bg-pressbox-orange/[0.06] shadow-[inset_3px_0_0_theme(colors.pressbox.orange)]',
        drafted && 'opacity-40',
      )}
      onClick={() => !drafted && onSelect()}
    >
      {/* 1 — the star over the rank. */}
      <span className="flex flex-col items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {onToggleQueue && (
          <button
            type="button"
            className="focus-citrus relative flex h-[18px] w-[18px] items-center justify-center after:absolute after:-inset-[13px] after:content-['']"
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
                'h-3.5 w-3.5',
                queued
                  ? 'fill-pressbox-orange-soft text-pressbox-orange-soft'
                  : 'text-pressbox-text/45',
              )}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        )}
        <span
          className="font-plex font-semibold text-[12px] tabular-nums text-pressbox-text/60"
          data-testid="draft-pool-rank"
        >
          {rank}
        </span>
      </span>

      {/* 2 — the player. */}
      <span className="flex items-center gap-2.5 min-w-0">
        <Mug p={mugFromDirectory(player)} size="sm" crest />
        <span className="min-w-0">
          <span className="block font-barlow font-bold text-[15px] truncate text-pressbox-text">
            {player.full_name}
            {queued && (
              <>
                {' '}
                <span
                  className="font-plex font-semibold text-[10px] text-pressbox-orange-soft"
                  data-testid="draft-pool-queue-badge"
                >
                  &#9733;{queuePosition != null ? ` Q${queuePosition}` : ''}
                </span>
              </>
            )}
            {status && (
              <>
                {' '}
                <span
                  data-testid="draft-pool-status-chip"
                  className={cn(
                    'font-plex font-bold text-[9px] px-1 py-px rounded-[3px] whitespace-nowrap align-[1px]',
                    'bg-pressbox-grapefruit/[0.18] text-pressbox-grapefruit-text',
                  )}
                >
                  {status.label}
                </span>
              </>
            )}
          </span>
          <span className="block mt-[3px] font-plex font-medium text-[10px] text-pressbox-text/55 truncate">
            {posKey && (
              <b data-testid="draft-pool-position-chip" className="font-bold text-pressbox-text">
                {posKey}
              </b>
            )}
            {posKey && player.team ? ' · ' : ''}
            {player.team}
            {signal ? (
              <>
                {' · '}
                {/* The moat, on the row. `title` carries the cohort in full;
                    the row itself has 393px and prints the short form. */}
                <span
                  data-testid="draft-pool-signal"
                  className="text-pressbox-sage"
                  title={`${signal.metric} ${signal.value}, ${ordinalPercentile(signal.percentile)} percentile of ${signal.cohortSize} ${signal.cohortNoun}. Citrus model${signal.lowSample ? '. Thin sample' : ''}`}
                >
                  {signal.shortMetric} {ordinalPercentile(signal.percentile)}
                  {signal.lowSample ? '*' : ''}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </span>

      {/* 3 — the number the row exists to show, and what it is. */}
      <span className="text-right">
        <span
          className="block font-plex font-semibold text-[17px] tabular-nums text-pressbox-text"
          data-testid="draft-pool-projection"
        >
          {headlineText}
        </span>
        <span
          className="block font-plex font-medium text-[8px] uppercase tracking-[0.04em] text-pressbox-text/45"
          data-testid="draft-pool-projection-label"
        >
          {headlineLabel}
        </span>
      </span>

      {/* 4 — the action slot. The verb on the clock, the card off it, never
          both. */}
      <span className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
        {canDraft ? (
          <button
            type="button"
            className={cn(
              SLOT,
              'border-transparent bg-pressbox-orange text-pressbox-orange-ink',
              'font-condensed font-bold text-[10px] uppercase tracking-[0.06em] disabled:opacity-50',
            )}
            disabled={submitting}
            aria-busy={submitting}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onDraft();
            }}
            data-testid="pool-row-draft-button"
          >
            {submitting ? (
              <>
                <span aria-hidden="true">&hellip;</span>
                <span className="sr-only">Submitting…</span>
              </>
            ) : (
              'Draft'
            )}
          </button>
        ) : onShowCard ? (
          <button
            type="button"
            className={cn(SLOT, 'border-white/[0.12] bg-white/[0.06] text-pressbox-text/70')}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onShowCard();
            }}
            title={`View ${player.full_name} card`}
            aria-label={`View ${player.full_name} player card`}
            data-testid="pool-row-card-button"
          >
            <Info className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

export default DraftPoolRow;
