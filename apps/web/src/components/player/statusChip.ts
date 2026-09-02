/**
 * THE AVAILABILITY CHIP THAT SITS BESIDE A PLAYER'S NAME, ON ANY LIST.
 *
 * Lifted out of `components/freeagents/freeAgentRow.ts` on 2026-09-02 so the
 * draft pool can wear the same chip. Not a style preference: `freeAgentRow.ts`
 * imports `ScheduleService` for its game line, which reaches `@/api/client` and
 * therefore the Supabase client, and that module CALLS `createClient()` at
 * module scope and throws when `VITE_SUPABASE_*` are unset — which the vitest
 * config deliberately leaves unset. Importing the chip from there took three
 * `PlayerPool` suites down with "Missing Supabase environment variables"
 * before a single assertion ran.
 *
 * A pure module with no imports at all, for the reason `phoneRowScale.ts` and
 * `roster/positionChip.ts` give: a file that exports both a component and
 * plain values breaks react-refresh.
 *
 * `freeAgentRow.ts` re-exports both symbols, so every existing Free Agents
 * call site and test keeps working against the name it already uses.
 */

/**
 * Dark-surface tokens, not the roster row's `bg-red-500 text-white` set: this
 * chip sits on #0F1F15 next to a 15px cream name, and a solid saturated fill
 * at 10px reads as a smudge there. A tinted fill with the bright text colour
 * keeps the same meaning at a tenth of the visual weight, which is right,
 * because on a pool list the status is a caveat on a pickup rather than the
 * headline it is on your own roster.
 *
 * Anything the map does not know about gets no chip. A player carrying an
 * unrecognised status string is not "fine", but inventing a chip for it would
 * print raw database text at 10px next to a player's name.
 */
export const PLAYER_STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  IR: { label: 'IR', cls: 'bg-fantasy-grapefruit-red/20 text-fantasy-grapefruit-red' },
  LTIR: { label: 'LTIR', cls: 'bg-fantasy-grapefruit-red/20 text-fantasy-grapefruit-red' },
  SUSP: { label: 'SUSP', cls: 'bg-pastel-orange/20 text-pastel-orange-soft' },
  GTD: { label: 'GTD', cls: 'bg-amber-500/20 text-amber-200' },
  DTD: { label: 'DTD', cls: 'bg-amber-500/20 text-amber-200' },
  WVR: { label: 'WVR', cls: 'bg-pastel-sage/20 text-pastel-sage-soft' },
};

/** The chip for a raw status string, or null when there is nothing to say. */
export function statusChipFor(status: string | null | undefined) {
  const key = (status ?? '').trim().toUpperCase();
  if (!key || key === 'ACTIVE' || key === 'ACT') return null;
  return PLAYER_STATUS_CHIP[key] ?? null;
}
