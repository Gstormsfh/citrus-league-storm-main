/**
 * DRAFT ROOM DECISION SUPPORT (2026-09-02) — source contracts.
 *
 * Everything here was found by LOOKING at the room, at 393x852 on
 * `harness/draft.html`, with the caller on the clock at round 2 pick 24.
 * jsdom has no layout engine and no network, so none of it is reachable by
 * mounting a page cheaply; these are source contracts in the shape this repo
 * already uses for `draftRoomMobileGuard`, `mobileSweepGuard` and
 * `stickyScrollContainerGuard`.
 *
 * The five findings, each pinned below:
 *
 * 1. THE PROJECTION WAS NEVER PASSED. `PlayerPool` has declared a
 *    `projectedFptsMap` prop since it shipped and `DraftRoomV2` never passed
 *    one, so the desktop table's four projection columns all read "-" and
 *    the phone row's dominant number was the player's SEASON TOTAL fantasy
 *    points. A draft is a forward-looking decision and the room showed
 *    history.
 *
 * 2. THE ON-CLOCK BAR CARRIED NO NUMBERS. 120px of the most valuable screen
 *    in the product: a label wrapped onto two lines, a second copy of the
 *    header countdown, and "Select a player from the pool, or click Draft on
 *    any row." clipped to nine characters.
 *
 * 3. NOTHING SAID WHAT WAS RUNNING OUT. No positional scarcity anywhere in
 *    the room, on any breakpoint.
 *
 * 4. THE PHONE ROW SPOKE ITS OWN DIALECT. A bespoke flex row with five type
 *    sizes inside seven pixels, a bare <img> that hid itself on error, and
 *    none of the shared row vocabulary the roster, matchup and free-agent
 *    lists agreed on a day earlier.
 *
 * 5. `harness/draft.html` HAD NO VIEWPORT META. Under mobile emulation a
 *    page without one lays out at 980px, so every phone screenshot ever
 *    taken of this room through the harness was actually the DESKTOP table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8');
/** Strip comments so the notes explaining a fix do not stand in for it. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROOM = read('../pages/DraftRoomV2.tsx');
const POOL = read('../components/draft/PlayerPool.tsx');
const ROW = read('../components/draft/DraftPoolRow.tsx');
const BAR = read('../components/draft/v2/OnClockActionBar.tsx');
const TIMER = read('../components/draft/v2/DraftTimerV2.tsx');
const DRAFT_HTML = read('../../harness/draft.html');

describe('the projection reaches the pool', () => {
  it('DraftRoomV2 passes projectedFptsMap and qualitySignals to PlayerPool', () => {
    const src = code(ROOM);
    expect(src).toContain('projectedFptsMap={projectedFptsMap}');
    expect(src).toContain('qualitySignals={qualitySignals}');
  });

  it('both are built from the ONE shared dashboard-index fetch', () => {
    const src = code(ROOM);
    expect(src).toContain("from '@/hooks/usePlayerDashboardIndex'");
    expect(src).toContain('usePlayerDashboardIndex()');
    // A second fetch of this payload is the thing the shared hook exists to
    // prevent; the room must not reach for the endpoint itself.
    expect(src).not.toContain('/api/players/dashboard-index');
  });

  it('the projection is scored through the league, not hardcoded anywhere', () => {
    const src = code(read('../components/draft/draftDecision.ts'));
    expect(src).toContain('ScoringCalculator');
    // Scoring weights live in ScoringCalculator. A literal weight here would
    // be a second set of scoring rules.
    expect(src).not.toMatch(/goals:\s*6\b/);
    expect(src).not.toMatch(/assists:\s*4\b/);
  });

  it('the pool ranks by the projection when it has one', () => {
    const src = code(POOL);
    expect(src).toContain('projectedFptsMap.get(p.id)');
  });
});

describe('the on-clock bar carries the decision, not just the verb', () => {
  it('renders the projection and the advanced read inline, with no modal step', () => {
    const src = code(BAR);
    expect(src).toContain('data-testid="on-clock-decision-line"');
    expect(src).toContain('qualitySignalLine');
  });

  it('renders positional scarcity', () => {
    const src = code(BAR);
    expect(src).toContain('data-testid="on-clock-scarcity"');
    expect(ROOM).toContain('scarcity={scarcity}');
    expect(code(ROOM)).toContain('scarcityStrip(');
  });

  it('scarcity is derived from the league roster settings, not assumed', () => {
    const src = code(ROOM);
    expect(src).toContain('startingSlots: rosterCaps');
    expect(src).toContain('teamCount: participatingTeamIds.size');
  });

  it('the empty-selection prompt wraps instead of truncating at 393px', () => {
    // It shipped inside a `truncate` line beside a large button and rendered
    // as "Select a ..." on a phone.
    const src = code(BAR);
    const promptAt = src.indexOf('Select a player');
    expect(promptAt).toBeGreaterThan(-1);
    const enclosingLine = src.slice(src.lastIndexOf('<div', promptAt), promptAt);
    expect(enclosingLine).not.toContain('truncate');
  });

  it('every decision surface degrades to nothing when the payload is missing', () => {
    const src = code(BAR);
    // Optional props with null/empty defaults are the whole degrade story:
    // a guest's 401 leaves them unset and the bar renders as it always did.
    expect(src).toContain('projection = null');
    expect(src).toContain('signal = null');
    expect(src).toContain('scarcity = EMPTY_SCARCITY');
  });
});

describe('no accuracy claim anywhere on the draft surfaces', () => {
  // There is no benchmark in this repo that could back one, and a projection
  // presented as a measurement is the fabrication this codebase already has
  // a guard for.
  const BANNED = /\b(most accurate|industry[- ]leading|guaranteed|proven|99(\.\d+)?%\s*accurate|beats?\s+(yahoo|espn|sleeper))\b/i;
  for (const [name, src] of [
    ['OnClockActionBar', BAR],
    ['DraftPoolRow', ROW],
    ['draftDecision', read('../components/draft/draftDecision.ts')],
  ] as const) {
    it(`${name} makes no accuracy claim`, () => {
      expect(BANNED.test(code(src))).toBe(false);
    });
  }

  it('the projection is labelled as Citrus’s model where it is printed', () => {
    expect(BAR).toContain('Citrus projection');
    expect(ROW).toContain('Citrus model');
  });
});

describe('no em dashes in the draft room’s user-facing copy', () => {
  /**
   * Comments and JSDoc are documentation and are exempt; string literals,
   * JSX text and `title` attributes are copy. A sibling branch is adding a
   * repo-wide guard for this; these three files are the ones this change
   * wrote copy into.
   */
  for (const [name, src] of [
    ['OnClockActionBar', BAR],
    ['DraftPoolRow', ROW],
  ] as const) {
    it(`${name} copy is free of em dashes`, () => {
      /**
       * `'—:—'` is exempt and is not prose: it is the glyph the countdown
       * stands in with when there is no deadline to count to, one dash per
       * missing digit, and `OnClockActionBar.test.tsx` has pinned that exact
       * string since the bar shipped. The rule is about SENTENCES.
       */
      const stripped = code(src).split("'—:—'").join("''");
      const offenders = stripped
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => line.includes('—'));
      expect(offenders.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
    });
  }
});

describe('the phone row speaks the shared row vocabulary', () => {
  it('uses Mug, the shared position key and the Press Box type', () => {
    // PRESS BOX (2026-09-04): the row's type is the Press Box ladder now —
    // `PB_TYPE` from pressbox/rowScale — imported by file, never through the
    // barrel, which reaches LeagueContext and the Supabase client. The face
    // and the position key are unchanged.
    const src = code(ROW);
    expect(src).toContain("from '@/components/roster/Mug'");
    expect(src).toContain("from '@/components/roster/positionChip'");
    expect(src).toContain("from '@/components/pressbox/rowScale'");
    expect(src).not.toContain("from '@/components/pressbox'");
  });

  it('has no private headshot <img> that can hide itself on error', () => {
    // Free Agents shipped one of these and a failed CDN reflowed the row
    // into a faceless list. `Mug` falls back headshot -> crest -> initials.
    expect(code(ROW)).not.toMatch(/<img/);
  });

  it('the pool renders the shared row rather than a fourth bespoke one', () => {
    const src = code(POOL);
    expect(src).toContain('<DraftPoolRow');
    // The old inline row's tell: a hand-rolled 13px name inside the pool.
    expect(src).not.toContain('text-[13px] text-pastel-cream');
  });
});

describe('one tick behind both draft countdowns', () => {
  it('neither component keeps a private interval any more', () => {
    // Two `setInterval(500)`s started at different moments sample Date.now()
    // on different phases, so the two clocks disagreed by a second for up to
    // half of every second. Measured: header 00:27, bar 00:28.
    expect(code(BAR)).not.toContain('setInterval');
    expect(code(TIMER)).not.toContain('setInterval');
    expect(BAR).toContain("from './countdownTick'");
    expect(TIMER).toContain("from './countdownTick'");
  });
});

describe('the harness renders the draft room at a phone width', () => {
  it('draft.html declares a viewport, or every phone screenshot is a lie', () => {
    // Without this meta, mobile emulation lays the page out at 980px CSS —
    // so `md:hidden` hides the phone pool and `hidden md:block` shows the
    // 1400px desktop table. Every mobile screenshot ever taken of this room
    // through the harness was the desktop layout scaled down.
    expect(DRAFT_HTML).toMatch(/<meta\s+name="viewport"[^>]*width=device-width/);
  });
});
