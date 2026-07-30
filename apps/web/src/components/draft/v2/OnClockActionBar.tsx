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

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Player } from '@/services/PlayerService';

export interface OnClockActionBarProps {
  /** True iff derived.onClockTeamId === myTeamId. When false the bar
   *  returns null and renders nothing. */
  amIOnClock: boolean;
  /** ISO-8601 deadline for the current pick, from
   *  `snapshot.stateSnapshot.currentPickDeadline`. The bar counts down
   *  to this in local time (no clock-offset adjustment needed here;
   *  the underlying deadline was set by the server RPC). */
  currentPickDeadline: string | null;
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
}

function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return '0:00';
  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function OnClockActionBar({
  amIOnClock,
  currentPickDeadline,
  selectedPlayer,
  onDraft,
  pickNumber,
  roundNumber,
  isSubmitPending = false,
}: OnClockActionBarProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Tick every 500ms while on-clock. Skips the interval when
  // off-clock (component returns null anyway; belt-and-suspenders).
  useEffect(() => {
    if (!amIOnClock) return;
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [amIOnClock]);

  if (!amIOnClock) return null;

  const deadlineMs = currentPickDeadline
    ? new Date(currentPickDeadline).getTime()
    : null;
  const secondsRemaining =
    deadlineMs !== null && Number.isFinite(deadlineMs)
      ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000))
      : null;

  const urgent = secondsRemaining !== null && secondsRemaining <= 10;
  const barClass = urgent
    ? 'bg-red-600 text-white border-red-700'
    : 'bg-fantasy-primary text-white border-fantasy-primary';

  const canDraft = selectedPlayer !== null;

  return (
    <div
      className={`${barClass} rounded-md border-2 p-3 flex items-center gap-3 shadow-lg`}
      data-testid="on-clock-action-bar"
      role="region"
      aria-label="You are on the clock"
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold uppercase tracking-wider opacity-90">
          You're on the clock
          {pickNumber !== null && roundNumber !== null && (
            <span className="ml-2 font-normal opacity-75">
              · Round {roundNumber} · Pick {pickNumber}
            </span>
          )}
        </div>
        <div className="text-lg font-semibold truncate">
          {canDraft ? (
            <>
              Draft <span className="font-bold">{selectedPlayer.full_name}</span>
              {selectedPlayer.position && (
                <span className="ml-2 text-sm font-normal opacity-75">
                  ({selectedPlayer.position}
                  {selectedPlayer.team ? ` · ${selectedPlayer.team}` : ''})
                </span>
              )}
            </>
          ) : (
            <span className="opacity-90">
              Select a player from the pool, or click Draft on any row.
            </span>
          )}
        </div>
      </div>
      <div
        className="text-3xl font-mono font-bold tabular-nums px-2"
        data-testid="on-clock-countdown"
        aria-label={
          secondsRemaining !== null
            ? `${secondsRemaining} seconds remaining`
            : 'No deadline'
        }
      >
        {secondsRemaining !== null ? formatCountdown(secondsRemaining) : '—:—'}
      </div>
      <Button
        size="lg"
        className="bg-white text-fantasy-primary hover:bg-white/90 font-bold px-6"
        disabled={!canDraft || isSubmitPending}
        onClick={() => canDraft && !isSubmitPending && onDraft(selectedPlayer)}
        data-testid="on-clock-draft-button"
      >
        {isSubmitPending ? 'Submitting…' : 'Draft'}
      </Button>
    </div>
  );
}
