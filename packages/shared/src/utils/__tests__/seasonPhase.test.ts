/**
 * The cases here are the real schedule, not invented ones. Every date comes
 * out of the 2026-09-02 production audit recorded in seasonPhase.ts:
 *
 *   regular  2025  1312 games  2025-10-07 .. 2026-04-16
 *   playoff  2025    82 games  2026-04-18 .. 2026-06-14
 *   regular  2026  1344 games  2026-09-29 .. 2027-04-10
 */

import { describe, it, expect } from 'vitest';
import {
  deriveSeasonStatus,
  dormantHeadline,
  daysBetween,
  type ScheduleFacts,
} from '../seasonPhase';

const facts = (over: Partial<ScheduleFacts>): ScheduleFacts => ({
  today: '2026-09-02',
  gamesToday: 0,
  lastGameDate: '2026-06-14',
  nextGameDate: '2026-09-29',
  lastGameType: 'playoff',
  nextGameType: 'regular',
  ...over,
});

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-09-02', '2026-09-29')).toBe(27);
    expect(daysBetween('2026-06-14', '2026-09-02')).toBe(80);
  });

  it('is signed', () => {
    expect(daysBetween('2026-09-29', '2026-09-02')).toBe(-27);
  });

  // Parsing at UTC midnight is what makes this exact. A local-midnight parse
  // would land on 26.958... days across the 2026-11-01 DST fall-back and
  // Math.round would paper over it; here there is nothing to round.
  it('is exact across a DST boundary', () => {
    expect(daysBetween('2026-10-25', '2026-11-15')).toBe(21);
    expect(daysBetween('2027-03-01', '2027-03-31')).toBe(30);
  });

  it('rejects malformed input rather than guessing', () => {
    expect(daysBetween('not-a-date', '2026-09-29')).toBeNull();
    expect(daysBetween('2026-9-2', '2026-09-29')).toBeNull();
  });
});

describe('deriveSeasonStatus — the offseason this was written for', () => {
  const s = deriveSeasonStatus(facts({}));

  it('is the offseason on 2026-09-02', () => {
    expect(s.phase).toBe('offseason');
  });

  it('is dormant, which is what suppresses "tonight" and "0.0"', () => {
    expect(s.isDormant).toBe(true);
    expect(s.hasGamesToday).toBe(false);
  });

  it('knows where the season went, in both directions', () => {
    expect(s.daysUntilNextGame).toBe(27);
    expect(s.daysSinceLastGame).toBe(80);
    expect(s.nextGameDate).toBe('2026-09-29');
    expect(s.lastGameDate).toBe('2026-06-14');
  });
});

describe('deriveSeasonStatus — in season', () => {
  it('a game night is regular season and not dormant', () => {
    const s = deriveSeasonStatus(
      facts({ today: '2025-12-10', gamesToday: 9, lastGameDate: '2025-12-10', lastGameType: 'regular', nextGameDate: '2025-12-11' }),
    );
    expect(s.phase).toBe('regular');
    expect(s.hasGamesToday).toBe(true);
    expect(s.isDormant).toBe(false);
  });

  // The NHL schedule has plenty of dark nights. A screen must not print
  // "proj 0.0 tonight" on any of them, but it also must not say the season
  // is over — hence dormant-but-regular. Christmas 2025 is the real gap:
  // 2025-12-23 -> 2025-12-27, four days.
  it('the christmas break is dormant but still regular season', () => {
    const s = deriveSeasonStatus(
      facts({ today: '2025-12-24', gamesToday: 0, lastGameDate: '2025-12-23', lastGameType: 'regular', nextGameDate: '2025-12-27', nextGameType: 'regular' }),
    );
    expect(s.phase).toBe('regular');
    expect(s.isDormant).toBe(true);
    expect(s.daysUntilNextGame).toBe(3);
  });

  // The longest in-season gap in the 2025 schedule: 2026-02-05 -> 2026-02-25.
  // At its midpoint the next game is still 10 days out, which a naive
  // forward-looking test would call the offseason. The whole gap is 20, which
  // is under the threshold, so it stays regular season.
  it('the olympic break is dormant but never the offseason', () => {
    const s = deriveSeasonStatus(
      facts({ today: '2026-02-15', gamesToday: 0, lastGameDate: '2026-02-05', lastGameType: 'regular', nextGameDate: '2026-02-25', nextGameType: 'regular' }),
    );
    expect(s.phase).toBe('regular');
    expect(s.isDormant).toBe(true);
    expect(dormantHeadline(s)).toBe('No games today — back in 10 days');
  });

  // The mirror image, and the case that forces the whole-gap rule: on
  // 2026-09-02 the next game is 27 days out — CLOSER than the Olympic break's
  // midpoint — yet this is unambiguously the offseason, because the last game
  // was 80 days ago. 27 alone cannot tell these apart; 107 vs 20 can.
  it('distinguishes the offseason from the olympic break by the whole gap', () => {
    const off = deriveSeasonStatus(facts({}));
    const oly = deriveSeasonStatus(
      facts({ today: '2026-02-15', gamesToday: 0, lastGameDate: '2026-02-05', lastGameType: 'regular', nextGameDate: '2026-02-25', nextGameType: 'regular' }),
    );
    expect(off.daysUntilNextGame).toBe(27);
    expect(oly.daysUntilNextGame).toBe(10);
    expect(off.phase).toBe('offseason');
    expect(oly.phase).toBe('regular');
  });

  it('no games today but hockey tomorrow is neither dormant nor offseason', () => {
    const s = deriveSeasonStatus(
      facts({ today: '2025-12-24', gamesToday: 0, lastGameDate: '2025-12-23', nextGameDate: '2025-12-25', nextGameType: 'regular' }),
    );
    expect(s.phase).toBe('regular');
    expect(s.isDormant).toBe(false);
  });

  it('reads the playoffs as their own phase', () => {
    const s = deriveSeasonStatus(
      facts({ today: '2026-05-04', gamesToday: 3, lastGameDate: '2026-05-04', lastGameType: 'playoff', nextGameDate: '2026-05-05' }),
    );
    expect(s.phase).toBe('playoffs');
    expect(s.hasGamesToday).toBe(true);
  });
});

describe('deriveSeasonStatus — unknown is not offseason', () => {
  // The important asymmetry. If the schedule has not loaded, a screen must
  // render its normal self, NOT an offseason state. Guessing "offseason"
  // here would tell users mid-January that the season is over.
  it('null facts yield unknown and are not dormant', () => {
    const s = deriveSeasonStatus(null);
    expect(s.phase).toBe('unknown');
    expect(s.isDormant).toBe(false);
  });

  it('a malformed today yields unknown and is not dormant', () => {
    const s = deriveSeasonStatus(facts({ today: 'yesterday' }));
    expect(s.phase).toBe('unknown');
    expect(s.isDormant).toBe(false);
  });

  it('unknown produces no headline, so no caller can render an empty one', () => {
    expect(dormantHeadline(deriveSeasonStatus(null))).toBeNull();
  });
});

describe('deriveSeasonStatus — nothing scheduled at all', () => {
  // Late June, next season not yet published. Dormant with nowhere to point.
  it('is dormant with a null next date', () => {
    const s = deriveSeasonStatus(
      facts({ today: '2026-07-01', nextGameDate: null, nextGameType: null }),
    );
    expect(s.isDormant).toBe(true);
    expect(s.phase).toBe('offseason');
    expect(s.daysUntilNextGame).toBeNull();
    expect(dormantHeadline(s)).toBe('No games scheduled');
  });
});

describe('dormantHeadline', () => {
  it('says nothing when there is hockey today', () => {
    const s = deriveSeasonStatus(facts({ today: '2025-12-10', gamesToday: 9 }));
    expect(dormantHeadline(s)).toBeNull();
  });

  it('names the wait during the offseason', () => {
    expect(dormantHeadline(deriveSeasonStatus(facts({})))).toBe('Season opens in 27 days');
  });

  it('names the opener on the eve of the season', () => {
    const s = deriveSeasonStatus(facts({ today: '2026-09-28', nextGameDate: '2026-09-29' }));
    // One day out is not dormant at all -- there is hockey tomorrow.
    expect(s.isDormant).toBe(false);
    expect(dormantHeadline(s)).toBeNull();
  });
});
