/**
 * DRAFT TIME CONVERSION (2026-09-12).
 *
 * `datetime-local` speaks local wall time with no offset; the column
 * `leagues.scheduled_draft_time` stores an instant. Two controls now write
 * that column — the draft card on the league dashboard, and the DRAFT tab in
 * league settings — so the conversion lives here once instead of inline in
 * both, where the two copies could drift and disagree about what "7pm" means.
 *
 * `new Date('2026-09-14T19:00')` parses a date-time form WITHOUT an offset as
 * LOCAL time per ECMAScript, which is what makes the round trip correct: a
 * commissioner in Edmonton picking 7:00 PM stores 7:00 PM MDT.
 */

/**
 * An instant → the `yyyy-MM-ddThh:mm` a `datetime-local` input expects,
 * rendered in the viewer's own timezone. Empty string for a null or
 * unparseable instant, so the input simply shows blank rather than `Invalid
 * Date`.
 */
export function instantToLocalInput(instant: string | null | undefined): string {
  if (!instant) return '';
  const when = new Date(instant);
  if (Number.isNaN(when.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}`
  );
}

/**
 * One shape rather than a discriminated union: tsconfig.app.json is still at
 * Phase 1 of the strict rollout (`strictNullChecks: false`), where `string |
 * null` collapses to `string` and narrowing on an `ok: true | false`
 * discriminant does not hold. Revisit when Phase 2 lands.
 */
export interface DraftTimeParse {
  ok: boolean;
  /** The instant to store; null clears the schedule. Read only when ok. */
  iso: string | null;
  /** Why it was refused. Set only when ok is false. */
  reason?: 'unreadable' | 'past';
}

/**
 * A `datetime-local` value → an ISO instant.
 *
 * An empty value clears the schedule (`iso: null`) rather than failing: that
 * is how a commissioner un-schedules a draft, and the API accepts null for
 * exactly that reason (validate.ts `.nullable().optional()`).
 *
 * `now` is injectable so the past-time rule is testable without faking clocks.
 */
export function localInputToInstant(value: string, now: number = Date.now()): DraftTimeParse {
  if (!value) return { ok: true, iso: null };
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return { ok: false, iso: null, reason: 'unreadable' };
  if (when.getTime() <= now) return { ok: false, iso: null, reason: 'past' };
  return { ok: true, iso: when.toISOString() };
}
