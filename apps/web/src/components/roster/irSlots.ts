/**
 * How many Injured Reserve slots this league has (2026-09-01, audit R8).
 *
 * The server is the authority: `resolveSlotConfig` in
 * server/src/lib/leagueRules.ts reads `settings.rosterSlots.IR` and falls
 * back to 3, and `validateSlotAssignments` strips any `ir-slot-N` past that
 * count on save. This mirrors that rule exactly so the "0/3" the roster
 * shows is the number the save will honour — a label that disagrees with
 * the server would be worse than no label.
 */
export const DEFAULT_IR_SLOT_COUNT = 3;

export function resolveIrSlotCount(
  rosterSlots: Record<string, unknown> | null | undefined,
): number {
  const raw = rosterSlots?.IR;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : DEFAULT_IR_SLOT_COUNT;
}

/** The slot ids the count implies, in order: ir-slot-1 … ir-slot-N. */
export function irSlotIds(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => `ir-slot-${i + 1}`);
}
