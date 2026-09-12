import { describe, it, expect } from 'vitest';
import { instantToLocalInput, localInputToInstant } from '../draftTime';

describe('instantToLocalInput', () => {
  it('renders an instant as local wall time the input can show', () => {
    // Built from local parts so the assertion holds in any TZ the suite runs in.
    const when = new Date(2026, 8, 14, 19, 5); // 14 Sep 2026, 19:05 local
    expect(instantToLocalInput(when.toISOString())).toBe('2026-09-14T19:05');
  });

  it('zero-pads month, day, hour and minute', () => {
    const when = new Date(2026, 0, 2, 3, 4); // 2 Jan 2026, 03:04 local
    expect(instantToLocalInput(when.toISOString())).toBe('2026-01-02T03:04');
  });

  it('is empty for null, undefined and empty string', () => {
    expect(instantToLocalInput(null)).toBe('');
    expect(instantToLocalInput(undefined)).toBe('');
    expect(instantToLocalInput('')).toBe('');
  });

  it('is empty rather than "Invalid Date" for an unparseable instant', () => {
    expect(instantToLocalInput('not a date')).toBe('');
  });
});

describe('localInputToInstant', () => {
  const NOW = new Date(2026, 8, 11, 12, 0).getTime();

  it('reads the input as LOCAL time, not UTC', () => {
    const parsed = localInputToInstant('2026-09-14T19:00', NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Whatever the TZ, the instant must render back to the same wall clock.
    expect(instantToLocalInput(parsed.iso)).toBe('2026-09-14T19:00');
  });

  it('round-trips through instantToLocalInput unchanged', () => {
    const parsed = localInputToInstant('2027-01-02T03:04', NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(instantToLocalInput(parsed.iso)).toBe('2027-01-02T03:04');
  });

  it('clears the schedule on an empty value rather than erroring', () => {
    expect(localInputToInstant('', NOW)).toEqual({ ok: true, iso: null });
  });

  it('refuses a time in the past', () => {
    expect(localInputToInstant('2026-09-10T19:00', NOW)).toEqual({ ok: false, iso: null, reason: 'past' });
  });

  it('refuses the current instant — a draft cannot be scheduled for now', () => {
    const nowLocal = instantToLocalInput(new Date(NOW).toISOString());
    expect(localInputToInstant(nowLocal, NOW).ok).toBe(false);
  });

  it('refuses an unreadable value', () => {
    expect(localInputToInstant('tomorrow evening', NOW)).toEqual({ ok: false, iso: null, reason: 'unreadable' });
  });
});
