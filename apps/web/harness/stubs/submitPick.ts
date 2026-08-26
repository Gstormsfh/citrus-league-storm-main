/** Stand-in for @/lib/draftClient/submitPick — always succeeds, drives the runner. */
export function isSubmitPickFailure(r: unknown): boolean {
  return !!r && typeof r === 'object' && 'error' in (r as Record<string, unknown>);
}
export async function submitPick(args: Record<string, unknown>) {
  (window as unknown as { __harnessAdvance?: () => void }).__harnessAdvance?.();
  return { ok: true, pickNumber: args.pickNumber ?? null };
}
export default submitPick;
