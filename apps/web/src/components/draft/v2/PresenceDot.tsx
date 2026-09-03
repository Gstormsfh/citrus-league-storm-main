// Phase 4.5 chunk 11g.5b — PresenceDot primitive.
// DR-4 (2026-07-30) — extended to a three-state indicator:
//
//   connected     — in `presentUserIds` (green)
//   away          — NOT in `presentUserIds` AND observed leaving this
//                   session (in `observedLeftUserIds`) (amber)
//   not-connected — in neither (neutral grey)
//
// Architect ruling 2026-07-30 (DR-4 Phase 1): show AWAY only for a
// user OBSERVED leaving during THIS session (a positive observation).
// On a fresh page load, anyone not currently in the presence set is
// simply "not connected" (grey) — we do not claim a user "never
// joined" when we merely weren't watching. Unowned teams (harness
// slots, spectator team rows) render neutral, which is correct.

import { useMemo } from 'react';
import {
  usePresence,
  useObservedLeftUserIds,
} from '@/stores/draftClientStore';
import { cn } from '@/lib/utils';
// The pure status computation lives in a sibling module so this file
// exports components ONLY — that is what lets fast refresh hot-swap the
// dot instead of reloading the page (react-refresh/only-export-components).
import { computePresenceStatus, type PresenceStatus } from './presenceStatus';

export type { PresenceStatus };

interface PresenceDotProps {
  /**
   * User id whose presence we render. Pass `null` or `undefined` for
   * an unowned team (renders neutral).
   */
  userId?: string | null;
  /** Optional className passthrough for layout / sizing overrides. */
  className?: string;
}

const STATUS_META: Record<
  PresenceStatus,
  { color: string; label: string }
> = {
  connected: { color: 'bg-green-500', label: 'connected' },
  away: { color: 'bg-amber-500', label: 'away' },
  not_connected: { color: 'bg-gray-400', label: 'not connected' },
};

export function PresenceDot({ userId, className }: PresenceDotProps) {
  const presentUserIds = usePresence();
  const observedLeftUserIds = useObservedLeftUserIds();
  const status = useMemo(
    () => computePresenceStatus(userId, presentUserIds, observedLeftUserIds),
    [userId, presentUserIds, observedLeftUserIds],
  );
  const { color, label } = STATUS_META[status];
  const ariaUser = userId ?? 'unowned team';

  return (
    <span
      role="status"
      aria-label={`${ariaUser} is ${label}`}
      data-testid="presence-dot"
      data-presence-status={status}
      className={cn('inline-block h-2 w-2 rounded-full', color, className)}
    />
  );
}
