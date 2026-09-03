// Phase 4.5 chunk 11g.5b / DR-4 — presence status, extracted from
// PresenceDot.tsx (2026-09-03).
//
// This is the pure half of the presence indicator. It lives in its own
// module so PresenceDot.tsx exports components ONLY and Vite's fast
// refresh can hot-swap the dot without a full reload
// (react-refresh/only-export-components). Behaviour is unchanged — the
// type and the function below are byte-for-byte what PresenceDot.tsx
// exported before the move.
//
// Three states (see PresenceDot.tsx for the rendering rules):
//
//   connected     — in `presentUserIds` (green)
//   away          — NOT in `presentUserIds` AND observed leaving this
//                   session (in `observedLeftUserIds`) (amber)
//   not-connected — in neither (neutral grey)

export type PresenceStatus = 'connected' | 'away' | 'not_connected';

/**
 * Compute the presence status for a userId given the current sets.
 * Pure — extracted so it can be unit-tested without React.
 */
export function computePresenceStatus(
  userId: string | null | undefined,
  presentUserIds: ReadonlySet<string>,
  observedLeftUserIds: ReadonlySet<string>,
): PresenceStatus {
  if (!userId) return 'not_connected';
  if (presentUserIds.has(userId)) return 'connected';
  if (observedLeftUserIds.has(userId)) return 'away';
  return 'not_connected';
}
