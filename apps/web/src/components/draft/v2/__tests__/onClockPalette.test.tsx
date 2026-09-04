// THE DRAFT ROOM SPEAKS ONE LANGUAGE (2026-09-04).
//
// Written after the first live test draft, where the founder's verdict on the
// two most-looked-at controls in the product was: "Autopick is the ugliest
// button of all time, same with timer."
//
// The cause was not taste, it was vocabulary. `OnClockActionBar` painted
// itself `bg-fantasy-primary` (#F9E076) - a MASCOT colour, not an app one -
// and dropped to a stock `bg-red-600` when the clock got short. The compact
// header timer was a shadcn `bg-card` pill carrying `text-green-600`,
// `text-orange-600` and `text-red-600`: three Tailwind defaults that appear
// nowhere else in Citrus, pinned to the top of a room built entirely from
// forest, sage and orange.
//
// These tests fail against that code. Every assertion below is one the
// pre-2026-09-04 components lose.
//
// They deliberately assert on class names. That is usually a smell, but here
// the class name IS the defect: the bug was never behavioural, and a test
// that only checked behaviour would have passed the whole time the bar was
// wearing the wrong palette.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OnClockActionBar } from '../OnClockActionBar';
import { DraftTimerV2 } from '../DraftTimerV2';
import type { Player } from '@/services/PlayerService';

afterEach(() => {
  cleanup();
});

function mkPlayer(over: Partial<Player> = {}): Player {
  return {
    id: '8478402',
    full_name: 'Connor McDavid',
    position: 'C',
    eligible_positions: ['C'],
    team: 'EDM',
    jersey_number: null,
    status: null,
    headshot_url: null,
    last_updated: null,
    games_played: 0,
    goals: 0,
    assists: 0,
    points: 0,
    plus_minus: 0,
    shots: 0,
    hits: 0,
    blocks: 0,
    xGoals: 0,
    wins: null,
    losses: null,
    ot_losses: null,
    saves: null,
    goals_against_average: null,
    save_percentage: null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
  } as Player;
}

/** A deadline `secs` from now, which is how both components take their time. */
const deadlineIn = (secs: number) => new Date(Date.now() + secs * 1000).toISOString();

function renderBar(secs: number) {
  render(
    <OnClockActionBar
      amIOnClock={true}
      currentPickDeadline={deadlineIn(secs)}
      pickTimeLimitSec={60}
      selectedPlayer={mkPlayer()}
      onDraft={() => {}}
      pickNumber={29}
      roundNumber={3}
    />,
  );
  return screen.getByTestId('on-clock-action-bar');
}

/**
 * The source of a sibling module, with comments stripped.
 *
 * The palette words under test appear in the explanatory comments of both
 * components on purpose - that is where the old values are recorded and
 * explained - so a naive grep would match the very prose describing the fix.
 */
function sourceWithoutComments(file: string): string {
  // `new URL('../x', import.meta.url)` does not resolve to a real path under
  // vitest's module graph; resolve against the test file's own directory the
  // way every other source-contract test in this repo does.
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(resolve(here, '..', file), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Utilities that belong to no Citrus surface. */
const FOREIGN_UTILITIES = [
  'bg-fantasy-primary',
  'bg-red-600',
  'text-green-600',
  'text-orange-600',
  'text-red-600',
  'bg-card',
  'border-border',
];

// PRESS BOX (2026-09-04, later the same day). The bar's half of this file
// was written against the dark-tile-and-ring bar that replaced the lemon
// slab that morning; by the afternoon the founder's ruling was to bake the
// whole room into the Press Box design reference, and the bar is now
// artboard 4a's pick bar. Same intent, new contract:
//
//   * still never lemon, never stock red — now `bg-pressbox-surface`;
//   * time left is a 34px MONO FIGURE, sage until ten seconds and grapefruit
//     after, instead of a ring. At that size the number is the shape;
//   * the verb takes the width beside the clock (`flex-1`), not the whole
//     bar, and it is the only orange thing;
//   * the rule across the top is DRAFT progress in sage — what has happened
//     — and it never pretends to know a total it was not given.
describe('the on-clock bar wears the app palette, not the mascot one', () => {
  const surface = (bar: HTMLElement) => bar.firstElementChild as HTMLElement;

  it('is the Press Box surface, at rest and under pressure', () => {
    expect(surface(renderBar(47)).className).toContain('bg-pressbox-surface');
    cleanup();
    // Ten seconds or fewer is the urgent branch. It used to become a slab of
    // stock red; it keeps the surface and moves only its accents.
    expect(surface(renderBar(6)).className).toContain('bg-pressbox-surface');
  });

  it('never paints itself lemon or stock red', () => {
    for (const secs of [47, 6]) {
      const html = renderBar(secs).innerHTML;
      expect(html).not.toContain('bg-fantasy-primary');
      expect(html).not.toContain('bg-red-600');
      cleanup();
    }
  });

  it('draws the clock as a 34px figure, sage while there is room', () => {
    renderBar(47);
    const countdown = screen.getByTestId('on-clock-countdown');
    expect(countdown.className).toContain('text-[34px]');
    expect(countdown.className).toContain('text-pressbox-sage');
    // And it still says exactly what every other clock in the room says.
    expect(countdown.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('carries draft progress across its top, and draws none when it was not told the total', () => {
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={deadlineIn(47)}
        pickTimeLimitSec={null}
        selectedPlayer={mkPlayer()}
        onDraft={() => {}}
        pickNumber={29}
        roundNumber={3}
      />,
    );
    const rule = screen.getByTestId('on-clock-action-bar').querySelector('.bg-pressbox-sage') as HTMLElement;
    // A track with nothing in it. A width with no denominator would be a
    // guess drawn as a fact, on the one control a manager is trusting with
    // their turn.
    expect(rule.style.width).toBe('0%');
    cleanup();
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={deadlineIn(47)}
        pickTimeLimitSec={60}
        selectedPlayer={mkPlayer()}
        onDraft={() => {}}
        pickNumber={29}
        roundNumber={3}
        picksMade={28}
        totalPicks={112}
      />,
    );
    const told = screen.getByTestId('on-clock-action-bar').querySelector('.bg-pressbox-sage') as HTMLElement;
    expect(told.style.width).toBe('25%');
  });

  it('gives the verb the width beside the clock, and nothing else is orange', () => {
    // It was a small pill wedged beside a name up to twenty characters long,
    // which is how the most-clicked control in the product became the least
    // reachable thing on the screen. It is a 52px block now, with the name in
    // it, filling everything the clock does not use.
    expect(screen.queryByTestId('on-clock-draft-button')).toBeNull();
    const bar = renderBar(47);
    const btn = screen.getByTestId('on-clock-draft-button');
    expect(btn.className).toContain('flex-1');
    expect(btn.className).toContain('h-[52px]');
    expect(btn.className).toContain('bg-pressbox-orange');
    expect(bar.innerHTML.split('bg-pressbox-orange ').length - 1).toBe(1);
  });

  it('keeps urgency in the accents so the Draft button stays the brightest thing', () => {
    const bar = renderBar(6);
    // The clock goes grapefruit...
    expect(screen.getByTestId('on-clock-countdown').className).toContain('text-pressbox-grapefruit-text');
    // ...and the button stays orange, which is the whole point: under a shot
    // clock the eye should land on the verb.
    expect(screen.getByTestId('on-clock-draft-button').className).toContain('bg-pressbox-orange');
    expect(bar.innerHTML).not.toContain('bg-red-600');
  });
});

describe('the header timer speaks the same language', () => {
  it('uses Citrus tones rather than three Tailwind defaults', () => {
    // > 30s sage, > 10s orange, else grapefruit. Same thresholds the old
    // component used; only the vocabulary changed.
    const cases: Array<[number, string]> = [
      [45, 'text-pastel-sage'],
      [20, 'text-pastel-orange'],
      [6, 'text-fantasy-grapefruit-red'],
    ];
    for (const [secs, expected] of cases) {
      render(
        <DraftTimerV2
          variant="compact"
          currentPickDeadline={deadlineIn(secs)}
          draftStatus="in_progress"
          wsOpen={true}
          clockOffsetMs={0}
          pickTimeLimitSec={60}
        />,
      );
      const timer = screen.getByRole('timer');
      expect(timer.innerHTML, `${secs}s should read ${expected}`).toContain(expected);
      for (const foreign of ['text-green-600', 'text-orange-600', 'text-red-600', 'bg-card']) {
        expect(timer.innerHTML + timer.className).not.toContain(foreign);
      }
      cleanup();
    }
  });

  it('adds the ring without adding a single character of text', () => {
    // countdownTick.test.tsx asserts this element's whole textContent equals
    // the on-clock bar's countdown, character for character, at forty
    // sampling points. Anything textual added here breaks that silently, in a
    // file nobody would think to open.
    render(
      <DraftTimerV2
        variant="compact"
        currentPickDeadline={deadlineIn(45)}
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
        pickTimeLimitSec={60}
      />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.querySelectorAll('svg circle').length).toBe(2);
    expect(timer.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('still dims and drops the ring when the socket is gone', () => {
    render(
      <DraftTimerV2
        variant="compact"
        currentPickDeadline={deadlineIn(45)}
        draftStatus="in_progress"
        wsOpen={false}
        clockOffsetMs={0}
        pickTimeLimitSec={60}
      />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('opacity-60');
    // A draining ring would keep promising a countdown the server can no
    // longer re-arm. The offline glyph replaces it.
    expect(timer.querySelectorAll('svg circle').length).toBe(0);
    expect(timer.getAttribute('aria-label')).toContain('connection lost');
  });
});

describe('source contract', () => {
  it('neither component references a utility that belongs to no Citrus surface', () => {
    for (const file of ['OnClockActionBar.tsx', 'DraftTimerV2.tsx']) {
      const src = sourceWithoutComments(file);
      for (const foreign of FOREIGN_UTILITIES) {
        expect(src, `${file} still references ${foreign}`).not.toContain(foreign);
      }
    }
  });
});
