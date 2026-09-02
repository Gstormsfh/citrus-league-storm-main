// DR-3.1 (2026-07-29) — F8 fix: sticky on-clock action bar.
//
// The Showcase run (2026-07-29) proved that action discoverability
// under time pressure is a Draft-Night-critical UX gap: the most
// system-literate user missed 2 of 3 human-pick turns hunting for the
// Draft button on 60-second clocks. Architect ratification: the fix is
// two-pronged — (1) inline Draft button per pool row when on-clock
// (see PlayerPool.tsx), and (2) THIS component: a persistent, high-
// contrast action bar pinned in the sticky header (visible in every
// tab of the room), with:
//   - "YOU'RE ON THE CLOCK" label
//   - Live MM:SS countdown from the current pick deadline
//   - Selected player name (or "Select a player" prompt)
//   - Large Draft button (disabled without a selection)
//
// Renders `null` when the caller is not on the clock — off-clock users
// see nothing. Zero plumbing changes to the DR-2 submit path: the
// Draft button calls the same onDraft callback the pool's inline
// buttons use, which routes to submitPick with the DR-2 optimistic
// flow.

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCountdownNow } from './countdownTick';
import type { Player } from '@/services/PlayerService';
import type { DraftProjection, PositionScarcity, QualitySignal } from '@/components/draft/draftDecision';
import { ordinalPercentile, qualitySignalLine } from '@/components/draft/draftDecision';

export interface OnClockActionBarProps {
  /** True iff derived.onClockTeamId === myTeamId. When false the bar
   *  returns null and renders nothing. */
  amIOnClock: boolean;
  /** ISO-8601 deadline for the current pick, from
   *  `snapshot.stateSnapshot.currentPickDeadline`.
   *
   *  Entry 87 Fix C (CLOCK-DISPLAY-35): the original DR-3.1 comment
   *  ("no clock-offset adjustment needed here") was wrong. Untreated,
   *  the bar's countdown reads `deadline − localNow` with zero
   *  correction for client-clock skew — on Garrett's PC that surfaced
   *  as a 30s deadline rendering as 35s. Now we apply the estimator
   *  offset (from useClockOffsetEstimator) and clamp to
   *  pickTimeLimitSec, so the bar matches DraftTimerV2's display
   *  frame-for-frame. */
  currentPickDeadline: string | null;
  /** Entry 87 Fix C — rolling estimate of `clientMs - serverMs`.
   *  Positive means the client clock runs ahead of the server. The
   *  bar's countdown applies this offset to the deadline before
   *  differencing against local now. Threaded from DraftRoomV2's
   *  useClockOffsetEstimator (same instance DraftTimerV2 reads). */
  clockOffsetMs?: number;
  /** Entry 87 Fix C — per-pick countdown window in seconds, extracted
   *  from draft_started. Upper-bound clamp on the rendered value.
   *  Null before draft_started has been observed. */
  pickTimeLimitSec?: number | null;
  /** Currently selected player in the pool (or null). Determines
   *  whether the Draft button is enabled and what name is displayed. */
  selectedPlayer: Player | null;
  /** Fires the DR-2 submit path — same callback used by the pool's
   *  inline Draft buttons. Disabled when no player is selected. */
  onDraft: (player: Player) => void;
  /** Optional pick number for the header line. */
  pickNumber: number | null;
  /** Optional round number for the header line. */
  roundNumber: number | null;
  /**
   * DR-4 (2026-07-30) — F11 fix (layer 1 GUARD): disable the Draft
   * button + show "Submitting…" while a pending pick is in flight
   * for this team. Prevents the double-submit → pick_out_of_order
   * → false clock-expiry copy chain. Same signal wired to
   * PlayerPool's inline row buttons.
   */
  isSubmitPending?: boolean;
  /**
   * DECISION SUPPORT ON THE CLOCK (2026-09-02).
   *
   * Measured on `harness/draft.html` at 393x852 with the caller on the clock
   * at round 2 pick 24: this bar was 120px of the most valuable screen in
   * the product carrying a wrapped label, a second copy of the header's
   * countdown, and the sentence "Select a player from the pool, or click
   * Draft on any row." clipped after nine characters. Not one number about
   * the player, the pick, or the roster. Citrus holds projections, xG and
   * GAR for every one of these players and none of it was on the screen at
   * the moment the decision was made.
   *
   * The three props below are what the bar now says. Every one of them is
   * OPTIONAL and renders nothing when absent: `/api/players/dashboard-index`
   * 401s for guests and demo visitors, and this bar must behave exactly as
   * it did before on that path.
   */
  /** Citrus's rest-of-season projection for the selected player, league-scored. */
  projection?: DraftProjection | null;
  /** One cohort-relative advanced read on the selected player. */
  signal?: QualitySignal | null;
  /**
   * Starter-caliber players left at each position this manager still has to
   * fill. The one thing on this bar that is useful BEFORE a player is
   * selected, which is why it renders whether or not one is.
   */
  scarcity?: readonly PositionScarcity[];
}

/** One shared empty array so the default prop keeps a stable identity. */
const EMPTY_SCARCITY: readonly PositionScarcity[] = Object.freeze([]);

// MOBILE PASS (2026-09-01): mm:ss, minutes padded — the SAME format
// DraftTimerV2 renders. The two countdowns share every other display
// decision (ceil rounding, offset correction, pickTimeLimitSec clamp);
// the format was the last visible difference between them ("00:19" in
// the header vs "0:20" in the bar reads as two different clocks even
// when the value agrees). The SAMPLING PHASE was the half that survived
// that pass; `countdownTick.ts` closes it.
function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return '00:00';
  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function OnClockActionBar({
  amIOnClock,
  currentPickDeadline,
  clockOffsetMs = 0,
  pickTimeLimitSec = null,
  selectedPlayer,
  onDraft,
  pickNumber,
  roundNumber,
  isSubmitPending = false,
  projection = null,
  signal = null,
  scarcity = EMPTY_SCARCITY,
}: OnClockActionBarProps) {
  /**
   * ONE TICK, SHARED WITH THE HEADER TIMER (2026-09-02). This was a private
   * `setInterval(500)` and `DraftTimerV2` had its own, started at a
   * different moment: same deadline, same rounding, same format, and still
   * 00:27 in the header against 00:28 here in one screenshot on the harness,
   * because the two sampled `Date.now()` on different phases. Both now wake
   * on the deadline's own second boundaries. See `countdownTick.ts`.
   *
   * The hook runs unconditionally — hooks cannot be called after the
   * off-clock early return below — and does nothing at all when it is handed
   * a null deadline, which is every off-clock render.
   */
  const deadlineMs = useMemo(() => {
    if (!currentPickDeadline) return null;
    const parsed = new Date(currentPickDeadline).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }, [currentPickDeadline]);
  const nowMs = useCountdownNow(amIOnClock ? deadlineMs : null, clockOffsetMs);

  if (!amIOnClock) return null;
  // Entry 87 Fix C — apply estimator offset (mirrors DraftTimerV2's
  // math) so the bar's countdown matches the sticky-header timer
  // and the true server deadline. Then clamp to pickTimeLimitSec so
  // the display cannot exceed the per-pick window.
  const rawRemainingSec =
    deadlineMs !== null
      ? Math.max(0, Math.ceil((deadlineMs + clockOffsetMs - nowMs) / 1000))
      : null;
  const secondsRemaining =
    rawRemainingSec !== null &&
    pickTimeLimitSec !== null &&
    pickTimeLimitSec > 0
      ? Math.min(rawRemainingSec, pickTimeLimitSec)
      : rawRemainingSec;

  const urgent = secondsRemaining !== null && secondsRemaining <= 10;
  // 2026-08-19 visual audit — the most important surface in a live draft
  // was unreadable in its normal state.
  //
  //   bg-fantasy-primary is #F9E076, a BRIGHT LEMON. Pairing it with
  //   text-white put white on near-yellow at ~1.3:1, so "You're on the
  //   clock", the player name, round and pick all but disappeared. The
  //   urgent (red-600) state was fine at 4.8:1, which is likely why this
  //   survived — it only looks broken when you are NOT about to time out.
  //
  // Lemon is a light surface, so it takes dark text: #0F1F15 gives 13.7:1.
  const barClass = urgent
    ? 'bg-red-600 text-white border-red-700'
    : 'bg-fantasy-primary text-[#0F1F15] border-fantasy-primary';

  const canDraft = selectedPlayer !== null;

  /**
   * The decision line under the player's name: what he is projected to be
   * worth to THIS league over the rest of the season, and the one
   * cohort-relative advanced read that changes a pick.
   *
   * Built as a string rather than as elements so the whole line truncates as
   * one unit at 393px instead of the projection surviving and the metric
   * being cut off mid-word. Empty when the payload supports neither, in
   * which case nothing renders at all.
   */
  const decisionParts: string[] = [];
  if (projection) {
    decisionParts.push(`${projection.total.toFixed(1)} proj`);
    decisionParts.push(`${projection.perGp.toFixed(1)}/gm over ${Math.round(projection.gamesRemaining)}`);
  }
  // `includeValue: false` — the full line with the raw xG/60 in it measured
  // 391px against the 353px this bar has at 393. The cohort stays, because a
  // percentile without one is not a fact; the raw value moves to the title.
  const signalLine = qualitySignalLine(signal ?? null, { includeValue: false });
  if (signalLine) decisionParts.push(signalLine);
  const decisionLine = decisionParts.join(' · ');
  const decisionTitle = [
    'Citrus projection, rest of season.',
    signal
      ? `${signal.metric} ${signal.value}, ${ordinalPercentile(signal.percentile)} percentile of ${signal.cohortSize} ${signal.cohortNoun}.`
      : null,
    signal?.lowSample ? 'Thin sample.' : null,
  ]
    .filter(Boolean)
    .join(' ');

  // Dark ink on the lemon bar, white on the red urgent one. Alpha comes from
  // `opacity-*` on the wrapper rather than a `text-white/NN` utility: on
  // #F9E076 a white alpha is invisible, and the dark-theme contrast guard
  // bans the mid-alpha range outright.
  const inkMuted = urgent ? 'text-white' : 'text-[#0F1F15]';

  return (
    <div
      className={`${barClass} rounded-md border-2 p-2.5 shadow-lg space-y-1.5`}
      data-testid="on-clock-action-bar"
      role="region"
      aria-label="You are on the clock"
    >
      {/* LINE 1 — who is up and how long is left. The label and the pick
          coordinates used to share a flex row with a 30px countdown and a
          large button, which is why "YOU'RE ON THE CLOCK" wrapped onto two
          lines at 393px. They own their own row now. */}
      <div className="flex items-baseline justify-between gap-2">
        {/* 10px, and the pick coordinates un-tracked: at 11px with
            `tracking-wider` on both halves the line measured 268px against a
            373px row that also has to hold a 26px countdown, so "PICK 24"
            truncated to "PICK…" at 393. */}
        <div className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wider opacity-90">
          You're on the clock
          {pickNumber !== null && roundNumber !== null && (
            <span className="ml-1.5 font-normal tracking-normal opacity-75">
              · Round {roundNumber} · Pick {pickNumber}
            </span>
          )}
        </div>
        <div
          className="shrink-0 text-[24px] font-mono font-bold tabular-nums leading-none"
          data-testid="on-clock-countdown"
          aria-label={
            secondsRemaining !== null
              ? `${secondsRemaining} seconds remaining`
              : 'No deadline'
          }
        >
          {secondsRemaining !== null ? formatCountdown(secondsRemaining) : '—:—'}
        </div>
      </div>

      {/* LINE 2 — the candidate and the verb. */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {canDraft ? (
            <div className="truncate text-[15px] font-semibold leading-tight">
              Draft <span className="font-bold">{selectedPlayer.full_name}</span>
              {selectedPlayer.position && (
                <span className="ml-2 text-sm font-normal opacity-75">
                  ({selectedPlayer.position}
                  {selectedPlayer.team ? ` · ${selectedPlayer.team}` : ''})
                </span>
              )}
            </div>
          ) : (
            /* WRAPS, never truncates. The old copy was one `truncate` line
               beside a large button and rendered as "Select a ..." at 393 —
               a sentence clipped after nine characters, in the bar a manager
               reads first. Two lines of 13px cost the same height as the
               name-plus-numbers the selected state puts here. */
            <div className="text-[13px] font-semibold leading-tight opacity-90">
              Select a player, or tap Draft on any row.
            </div>
          )}
        </div>
        <Button
          size="lg"
          // Was `bg-white text-fantasy-primary` — lemon-yellow label on a
          // white button, ~1.2:1. The single most-clicked control in the
          // product was effectively a blank white pill. Deep forest on
          // white reads at 16.9:1 and works on both the lemon and the red
          // urgent bar. (2026-08-19)
          className="shrink-0 bg-white text-[#0F1F15] hover:bg-white/90 font-bold px-4"
          disabled={!canDraft || isSubmitPending}
          onClick={() => canDraft && !isSubmitPending && onDraft(selectedPlayer)}
          data-testid="on-clock-draft-button"
        >
          {isSubmitPending ? 'Submitting…' : 'Draft'}
        </Button>
      </div>

      {/* LINE 2b — THE NUMBERS, FULL WIDTH. Beside the Draft button this line
          had 240px and wanted 391; across the whole bar it has 353 and the
          projection, the per-game rate, the games it covers and the cohort
          percentile all survive. It is the one row on this screen where a
          truncation costs a fact rather than a word. */}
      {canDraft && decisionLine && (
        <div
          className={cn(
            'truncate font-jbmono text-[11px] leading-none tabular-nums opacity-80',
            inkMuted,
          )}
          data-testid="on-clock-decision-line"
          /* The source is named, every time. This is Citrus's model, not a
             measurement, and the bar never claims otherwise. */
          title={decisionTitle}
        >
          {decisionLine}
        </div>
      )}

      {/* LINE 3 — POSITIONAL SCARCITY, the answer to the question a manager
          is actually asking under a shot clock: not "who is best" but "what
          runs out first". Counts only positions he still has to fill, and
          only players somebody in this league would start; the arithmetic
          and its deliberate conservatism are documented in
          `draftDecision.startersLeft`. Renders nothing when the payload
          cannot support it. */}
      {scarcity.length > 0 && (
        <div
          className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide overscroll-x-contain"
          data-testid="on-clock-scarcity"
        >
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] opacity-70">
            Starters left
          </span>
          {scarcity.map((row) => (
            <span
              key={row.position}
              data-testid="on-clock-scarcity-chip"
              data-position={row.position}
              data-urgent={row.urgent ? 'true' : 'false'}
              title={`${row.startersLeft} startable ${row.position} left in a league this size; you have ${row.openSlots} ${row.position} slot${row.openSlots === 1 ? '' : 's'} open`}
              className={cn(
                'shrink-0 whitespace-nowrap rounded px-1.5 py-px font-jbmono text-[11px] font-bold leading-tight tabular-nums',
                urgent ? 'bg-white/20' : 'bg-[#0F1F15]/10',
                row.urgent && !urgent && 'ring-1 ring-[#0F1F15]/45',
                row.urgent && urgent && 'ring-1 ring-white',
              )}
            >
              {row.position} {row.startersLeft}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
