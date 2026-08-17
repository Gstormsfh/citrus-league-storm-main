/**
 * Turn a caught error into something a manager should read.
 *
 * WHY
 * ---
 * 44 call sites used the shape:
 *
 *     err instanceof Error ? err.message : "Couldn't load the league — refresh."
 *
 * The fallback copy was written for people. The problem is `err.message` takes
 * precedence over it, so a person only ever sees the fallback when the thrown
 * value is NOT an Error — which is the rare case. In practice they got the raw
 * message. On 2026-08-14 the matchup page rendered its entire error state as:
 *
 *     Failed to fetch
 *
 * That is Chrome's internal string for a dropped network request. On opening
 * night, one blip puts browser internals in front of a manager mid-matchup.
 *
 * APPROACH
 * --------
 * Block the messages we know come from the platform rather than from us, and
 * pass everything else through. Server-authored messages ("You are not in any
 * leagues") are written for people and stay useful, so they are not discarded.
 */

/** Patterns that are browser/runtime internals, never written for a person. */
const INTERNAL: ReadonlyArray<{ test: RegExp; say: string }> = [
  {
    // Chrome "Failed to fetch", Firefox "NetworkError when attempting...",
    // Safari "Load failed" / "The Internet connection appears to be offline."
    test: /failed to fetch|networkerror|load failed|connection appears to be offline|err_(internet|network|connection)/i,
    say: "Can't reach Citrus right now — check your connection and try again.",
  },
  {
    // Deliberately NOT a bare /timeout/ match. "Your pick timed out" and
    // "Waiver claim timed out" are real, user-meaningful domain messages this
    // app sends; swallowing them would be worse than the bug being fixed.
    // Only the platform's own abort strings are matched here.
    test: /^aborterror|the (user|operation) aborted|signal is aborted/i,
    say: 'That took longer than expected — try again in a moment.',
  },
  {
    // "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON" — an HTML
    // error page parsed as JSON, i.e. the API returned the SPA shell.
    test: /unexpected token|is not valid json|json\.parse|unexpected end of (json|input)/i,
    say: 'Citrus sent something we could not read — try again in a moment.',
  },
  {
    // Programming errors that leaked to the UI. Show the caller's copy instead.
    test: /^(typeerror|referenceerror|syntaxerror|rangeerror)\b|cannot read propert|is not a function|is not defined|undefined is not|null is not/i,
    say: '',
  },
];

/**
 * @param err       the caught value
 * @param fallback  human copy for this specific action; also used when the
 *                  error turns out to be a programming fault
 */
export function userMessage(err: unknown, fallback: string): string {
  // Only an Error contributes a message. This preserves the exact contract of
  // the `err instanceof Error ? err.message : fallback` expression it replaced —
  // a thrown string or object still yields the caller's copy. UserAccountService
  // has a test pinning that behaviour, and it is right to.
  const raw = err instanceof Error ? err.message : '';
  if (!raw) return fallback;
  for (const { test, say } of INTERNAL) {
    if (test.test(raw)) return say || fallback;
  }
  return raw;
}
