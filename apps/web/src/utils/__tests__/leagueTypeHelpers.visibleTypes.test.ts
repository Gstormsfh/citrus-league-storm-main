/**
 * SEASON-AGNOSTIC (2026-08-13) — which league types the create-league
 * picker offers.
 *
 * THE REGRESSION THIS EXISTS FOR: the rule used to be hard-coded inside
 * CreateLeague's JSX as "only show playoff types (we're in playoff
 * season)", with `?type=all` as a documented backdoor. That put the
 * calendar in the source. The consequence was not cosmetic — with the
 * NHL season approaching, **nobody could create a season-long fantasy
 * league at all**, which blocked draft testing for THE TWELVE. It was
 * found by a founder trying to run a test, not by anything automated.
 *
 * The first test below is the one that matters: a bare `/create-league`
 * must offer Fantasy Hockey. If that ever goes false again, the product
 * is unusable for its primary purpose and this suite says so.
 */

import { describe, it, expect } from 'vitest';
import { visibleLeagueTypes, isPlayoffPoolLeague } from '../leagueTypeHelpers';
import { LEAGUE_TYPE_LABELS } from '@citrus/shared';
import type { LeagueType } from '@/types/leagueTypes';

const ALL = Object.keys(LEAGUE_TYPE_LABELS) as LeagueType[];
const PLAYOFF: LeagueType[] = [
  'playoff-bracket-pickem',
  'playoff-confidence-pool',
  'playoff-roster-pool',
];

describe('visibleLeagueTypes — the default must be usable', () => {
  it('a bare /create-league offers Fantasy Hockey', () => {
    // THE regression guard. False here = no one can start a fantasy
    // league = the draft product is unreachable.
    expect(visibleLeagueTypes(null)).toContain('fantasy');
  });

  it('a bare /create-league offers the FULL catalogue', () => {
    expect(visibleLeagueTypes(null)).toEqual(ALL);
  });

  it('lists Fantasy Hockey first, so it is the visually default choice', () => {
    expect(visibleLeagueTypes(null)[0]).toBe('fantasy');
  });

  it('treats undefined the same as absent', () => {
    expect(visibleLeagueTypes(undefined)).toEqual(ALL);
  });

  it('an unrecognised param does not silently hide everything', () => {
    // Fail OPEN. A typo'd or stale link must never produce an empty
    // picker — that reads as "the site is broken".
    expect(visibleLeagueTypes('seasonlong')).toEqual(ALL);
    expect(visibleLeagueTypes('')).toEqual(ALL);
    expect(visibleLeagueTypes('PLAYOFF')).toEqual(ALL); // case-sensitive by design
  });
});

describe('visibleLeagueTypes — ?type=playoff still narrows', () => {
  // Every playoff CTA in the app passes ?type=playoff (Navbar,
  // MobileMenuButton, MobileBottomNav, NHLPlayoffBracket). That funnel
  // must be unchanged by the inversion.
  it('shows exactly the three playoff formats', () => {
    expect(visibleLeagueTypes('playoff')).toEqual(PLAYOFF);
  });

  it('does NOT offer season-long types on the playoff funnel', () => {
    const shown = visibleLeagueTypes('playoff');
    expect(shown).not.toContain('fantasy');
    expect(shown).not.toContain('pickem');
    expect(shown).not.toContain('survivor');
    expect(shown).not.toContain('confidence-pool');
  });

  it('everything it returns really is a playoff type', () => {
    expect(visibleLeagueTypes('playoff').every(isPlayoffPoolLeague)).toBe(true);
  });
});

describe('visibleLeagueTypes — no existing link breaks', () => {
  it('?type=all keeps showing everything', () => {
    // Was the backdoor; now just falls through to the default. Any
    // bookmark or doc referencing it must keep working.
    expect(visibleLeagueTypes('all')).toEqual(ALL);
  });

  it('never returns an empty list for any input', () => {
    for (const p of [null, undefined, '', 'all', 'playoff', 'fantasy', 'nonsense', '../../etc']) {
      expect(visibleLeagueTypes(p).length).toBeGreaterThan(0);
    }
  });
});
