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

/**
 * An IR occupant the NHL no longer lists IR or LTIR (2026-09-03,
 * WORLD_CLASS_READINESS gap B): the roster is illegal until he moves, and
 * the row should say so instead of leaving it to a one-time toast.
 *
 * `is_ir_eligible` is the flag the page has gated IR slots on since the
 * column arrived (migration 20260103151931; player_talent_metrics, through
 * the players API) and now the flag the
 * server refuses a new IR placement without (`validateIrPlacements` in
 * server/src/lib/leagueRules.ts). Explicit `false` only: the API always
 * sends a boolean, so `undefined` means the row came from somewhere that
 * never asked, and a cue built on it would be a guess.
 */
export function shouldMoveOffIr(p: { is_ir_eligible?: boolean }): boolean {
  return p.is_ir_eligible === false;
}
