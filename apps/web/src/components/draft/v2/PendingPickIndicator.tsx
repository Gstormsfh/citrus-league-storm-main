// Phase 4.5 chunk 11g.5b — optimistic pending-pick render wrapper.
//
// Wraps any rendered pick with subtle visual treatment when the pick
// is in flight (submitted but not yet confirmed by the server's
// broadcast). Three states map to three visual treatments:
//
//   - confirmed (default): no extra styling; render as-is.
//   - pending: subtle pulse animation + opacity-90 + "Submitting..."
//     caption underlay.
//   - rolled_back: brief flash-out, opacity-50, "Rejected" caption.
//     The store's `removeRolledBack` reducer (called after the
//     animation completes) drops the entry from `pendingActions`,
//     after which the wrapping caller stops rendering this component
//     for that correlationId.
//
// Composable wrapper — the wrapped children render the actual pick
// content (player name, team, etc.); this component just adorns.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { OptimisticState } from '@/lib/draftClient/optimistic';

interface PendingPickIndicatorProps {
  /**
   * `null` = pick is confirmed (no entry in pendingActions);
   * otherwise the optimistic state from the pending-actions map.
   */
  optimisticState: OptimisticState | null;
  children: ReactNode;
  /** Optional rejection reason to surface in the caption. */
  rejectionReason?: string;
}

export function PendingPickIndicator({
  optimisticState,
  children,
  rejectionReason,
}: PendingPickIndicatorProps) {
  if (optimisticState === null) {
    return <>{children}</>;
  }

  return (
    <div
      className={cn(
        'relative transition-opacity duration-500',
        optimisticState === 'pending' && 'animate-pulse opacity-90',
        optimisticState === 'rolled_back' && 'opacity-50',
      )}
      data-optimistic-state={optimisticState}
    >
      {children}
      {optimisticState === 'pending' && (
        <span
          className="block text-xs text-muted-foreground italic mt-1"
          aria-live="polite"
        >
          Submitting…
        </span>
      )}
      {optimisticState === 'rolled_back' && (
        <span
          className="block text-xs text-destructive italic mt-1"
          role="alert"
        >
          {rejectionReason ?? 'Rejected'}
        </span>
      )}
    </div>
  );
}
