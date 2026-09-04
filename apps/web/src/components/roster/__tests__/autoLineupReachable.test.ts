/**
 * THE AUTO LINEUP BUTTON HAS TO ANSWER A TAP (2026-09-04).
 *
 * Reported from a phone, four days before the first test drafts: "Auto lineup
 * button doesn't work brother."
 *
 * It was `disabled` whenever `seasonDormant`, which is true on every day with
 * no hockey today and none within the dormancy window. Production `nhl_games`
 * on 4 September: the earliest scheduled game is 29 September. So the control
 * had been dead for weeks, and would have stayed dead through the TestFlight
 * window and every one of the Sept 8 test drafts - where the first thing a
 * manager does after drafting is open their roster and reach for it.
 *
 * The failure was silent by construction. The button's only explanation was a
 * `title` attribute, and `title` is a HOVER affordance: on iOS it does not
 * exist at all. A greyed-out control that gives no reason is indistinguishable
 * from a broken one, and this one was worse than that - the sheet behind it
 * has always carried the right sentence ("No games scheduled, so there is
 * nothing to set") and nobody could reach it.
 *
 * These are source contracts. `Roster.tsx` is a five-thousand-line page whose
 * auto-lineup handler is a closure over a dozen pieces of component state;
 * mounting it to assert one toast would test the mock harness, not the page.
 * What matters is structural and greppable: no disable, and a spoken branch
 * for every refusal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROSTER = readFileSync(resolve(here, '../../../pages/Roster.tsx'), 'utf-8');

/** The Auto Lineup button's JSX opening tag, from `onClick` to the first `>`. */
function autoLineupButton(): string {
  const at = ROSTER.indexOf('onClick={handleAutoLineup}');
  expect(at, 'the Auto Lineup button is gone from Roster.tsx').toBeGreaterThan(-1);
  const close = ROSTER.indexOf('>', ROSTER.indexOf('className', at));
  return ROSTER.slice(at, close);
}

/** The body of `handleAutoLineup`, to its closing brace at component indent. */
function handlerBody(): string {
  const at = ROSTER.indexOf('const handleAutoLineup = () => {');
  expect(at, 'handleAutoLineup is gone').toBeGreaterThan(-1);
  const end = ROSTER.indexOf('\n  };', at);
  return ROSTER.slice(at, end === -1 ? undefined : end);
}

describe('the Auto Lineup button is never a dead control', () => {
  it('is not disabled', () => {
    // The assertion that fails against the pre-fix code. Every reason it used
    // to disable for is now answered by a toast instead.
    const btn = autoLineupButton();
    expect(
      /\bdisabled=\{/.test(btn),
      'Auto Lineup is disabled again. On a phone that is a button that does nothing and says nothing - `title` does not render without a pointer.',
    ).toBe(false);
  });

  it('says something during the offseason instead of going quiet', () => {
    // 25 days of dormancy sat between this build and opening night, and every
    // one of them would have produced a dead tap.
    const body = handlerBody();
    expect(body).toContain('seasonDormant');
    const branch = body.indexOf('if (seasonDormant)');
    expect(branch, 'the dormant branch is gone; the button will go silent again all offseason').toBeGreaterThan(-1);
    // It has to be a toast, not a bare `return`.
    const toastAfter = body.indexOf('toast(', branch);
    const returnAfter = body.indexOf('return;', branch);
    expect(toastAfter, 'the dormant branch no longer speaks').toBeGreaterThan(-1);
    expect(toastAfter, 'the dormant branch returns before it says anything').toBeLessThan(returnAfter);
  });

  it('names the date hockey comes back, rather than just refusing', () => {
    // "No games" is true and useless. "No hockey until Tuesday, September 29"
    // is the answer to the question the tap was actually asking.
    const body = handlerBody();
    expect(body).toContain('seasonStatus.nextGameDate');
    expect(body).toMatch(/toLocaleDateString/);
  });

  it('every other refusal still speaks too', () => {
    // These four already toasted; they were unreachable only because the
    // button swallowed the tap. Now that it does not, each must still answer.
    const body = handlerBody();
    for (const [reason, marker] of [
      ['best ball', 'bestBallEnabled'],
      ['demo league', 'isDemoLeague'],
      ['past date', 'isPastDate'],
      ['projections loading', 'projectionsReadyForSelectedDate'],
    ] as const) {
      const at = body.indexOf(marker);
      expect(at, `the ${reason} branch is gone`).toBeGreaterThan(-1);
      expect(
        body.indexOf('toast(', at),
        `the ${reason} branch refuses without saying why`,
      ).toBeGreaterThan(-1);
    }
  });

  it('keeps the hover explanation for people who have a pointer', () => {
    // Removing the disable is not a reason to remove the tooltip. Desktop
    // still gets the cheaper affordance.
    expect(autoLineupButton()).toContain('title=');
  });
});
