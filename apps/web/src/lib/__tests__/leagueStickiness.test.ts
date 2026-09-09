import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LEAGUE_STICKY_MS,
  markLeagueVisit,
  isLeagueVisitFresh,
  clearLeagueVisit,
} from '../leagueStickiness';

const USER = 'user-1';
const KEY = `citrus:lastLeagueVisit:${USER}`;

describe('leagueStickiness', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('is twelve hours', () => {
    expect(LEAGUE_STICKY_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('is not fresh with no stamp — a first open lands on the selector', () => {
    expect(isLeagueVisitFresh(USER)).toBe(false);
  });

  it('is fresh immediately after a visit', () => {
    markLeagueVisit(USER, 1_000_000);
    expect(isLeagueVisitFresh(USER, 1_000_000)).toBe(true);
  });

  it('is fresh one minute before the window closes', () => {
    markLeagueVisit(USER, 0);
    expect(isLeagueVisitFresh(USER, LEAGUE_STICKY_MS - 60_000)).toBe(true);
  });

  it('is stale exactly at the window and beyond', () => {
    markLeagueVisit(USER, 0);
    expect(isLeagueVisitFresh(USER, LEAGUE_STICKY_MS)).toBe(false);
    expect(isLeagueVisitFresh(USER, LEAGUE_STICKY_MS + 1)).toBe(false);
  });

  it('slides: re-stamping inside the window extends it', () => {
    markLeagueVisit(USER, 0);
    const elevenHours = 11 * 60 * 60 * 1000;
    expect(isLeagueVisitFresh(USER, elevenHours)).toBe(true);
    markLeagueVisit(USER, elevenHours);
    // 22h after the FIRST visit, but 11h after the latest one.
    expect(isLeagueVisitFresh(USER, elevenHours * 2)).toBe(true);
  });

  it('treats a future stamp as stale — a clock change must not pin a league forever', () => {
    markLeagueVisit(USER, 5_000_000);
    expect(isLeagueVisitFresh(USER, 1_000_000)).toBe(false);
  });

  it('treats an unparseable stamp as stale', () => {
    localStorage.setItem(KEY, 'not-a-number');
    expect(isLeagueVisitFresh(USER)).toBe(false);
  });

  it('is scoped per user — one account cannot pin another', () => {
    markLeagueVisit(USER, 1_000);
    expect(isLeagueVisitFresh('user-2', 1_000)).toBe(false);
  });

  it('does nothing without a user id', () => {
    markLeagueVisit(null);
    markLeagueVisit(undefined);
    expect(localStorage.length).toBe(0);
    expect(isLeagueVisitFresh(null)).toBe(false);
  });

  it('clearLeagueVisit sends the next open back to the selector', () => {
    markLeagueVisit(USER, 1_000);
    clearLeagueVisit(USER);
    expect(isLeagueVisitFresh(USER, 1_000)).toBe(false);
  });

  it('degrades to the selector when localStorage throws', () => {
    markLeagueVisit(USER, 1_000);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: private mode');
    });
    expect(isLeagueVisitFresh(USER, 1_000)).toBe(false);
  });

  it('a write that throws does not break the caller', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => markLeagueVisit(USER)).not.toThrow();
  });
});
