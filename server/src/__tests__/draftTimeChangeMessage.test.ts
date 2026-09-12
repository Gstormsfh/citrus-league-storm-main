/**
 * The sentence the whole league reads when the commissioner moves the draft.
 *
 * Worth its own test for two reasons. It is the only place in the product that
 * renders a timestamp on the SERVER, so nothing else would catch it drifting
 * out of Mountain Time; and since start_due_scheduled_drafts went live, this
 * sentence is how a manager learns that a draft will now begin without anyone
 * pressing anything.
 *
 * The expected strings below were produced by Intl on Node 22 rather than
 * written by hand, so they pin the real output, including the DST shift.
 */
import { describe, it, expect } from 'vitest';
import { draftTimeChangeMessage } from '../services/LeagueService';

describe('draftTimeChangeMessage', () => {
  it('renders a September draft in Mountain DAYLIGHT time (UTC-6)', () => {
    // 2026-09-27T01:00:00Z is the evening of the 26th in Denver while DST is on.
    expect(draftTimeChangeMessage('2026-09-27T01:00:00Z')).toBe(
      'The draft is set for Sat, Sep 26, 7:00 PM MT.',
    );
  });

  it('renders a January draft in Mountain STANDARD time (UTC-7)', () => {
    // The same wall-clock arithmetic with DST off. If this ever matches the
    // daylight offset, someone has hardcoded a fixed -6 somewhere.
    expect(draftTimeChangeMessage('2027-01-15T03:30:00Z')).toBe(
      'The draft is set for Thu, Jan 14, 8:30 PM MT.',
    );
  });

  it('names the season opener correctly', () => {
    expect(draftTimeChangeMessage('2026-09-30T01:00:00Z')).toBe(
      'The draft is set for Tue, Sep 29, 7:00 PM MT.',
    );
  });

  it('says the time was cleared when it is null', () => {
    // Reachable since validate.ts made scheduled_draft_time nullable: before
    // that a commissioner could move a draft but never un-schedule one.
    expect(draftTimeChangeMessage(null)).toBe(
      'The commissioner cleared the scheduled draft time.',
    );
  });

  it('never broadcasts "Invalid Date" to a league', () => {
    // A value the column accepted but Date cannot parse is still a real
    // change. The league should hear that it changed, not see a JS artifact.
    const msg = draftTimeChangeMessage('not-a-timestamp');
    expect(msg).not.toMatch(/Invalid Date/i);
    expect(msg).toBe('The commissioner changed the scheduled draft time.');
  });

  it('writes no em dash, which the shipped-copy guard forbids', () => {
    for (const input of ['2026-09-27T01:00:00Z', null, 'nonsense']) {
      expect(draftTimeChangeMessage(input)).not.toMatch(/—/);
    }
  });
});
