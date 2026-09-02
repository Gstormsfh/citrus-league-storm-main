/**
 * SeasonPhaseService contract.
 *
 * The value of this service is entirely in what it stops the product from
 * saying. Everything below is a sentence the app printed on 2026-09-02, in
 * the middle of a 107-day gap with no games:
 *
 *   "0/13 starters play · proj 0.0"
 *   "Everyone with a game is already starting. Nothing to change tonight."
 *   "Win chance 50%"   "0 left"   "Final"
 *
 * So the tests are about honesty, not plumbing: does the read produce facts
 * that make those sentences impossible, and — the case that actually bites —
 * does a FAILED read produce `unknown` rather than a confident "offseason"?
 *
 * The fixture dates are the real 2026-09-02 production schedule:
 *   regular 2025  2025-10-07 .. 2026-04-16
 *   playoff 2025  2026-04-18 .. 2026-06-14
 *   regular 2026  2026-09-29 .. 2027-04-10
 */

import { describe, it, expect } from 'vitest';
import { SeasonPhaseService } from '../SeasonPhaseService';
import { deriveSeasonStatus } from '@citrus/shared';

interface GameRow {
  game_id: number;
  game_date: string;
  game_type: string;
}

/**
 * A fake of just the builder surface this service uses: a head+count read,
 * and two ordered limit(1) reads. `failOn` makes one table read fail so the
 * "no fabricated fallback" path can be exercised.
 */
function makeSupabase(rows: GameRow[], opts: { fail?: boolean } = {}) {
  return {
    from(_table: string) {
      const filters: Array<(r: GameRow) => boolean> = [];
      let asc = true;
      let head = false;

      const api = {
        select(_cols: string, o?: { count?: string; head?: boolean }) {
          head = Boolean(o?.head);
          return api;
        },
        eq(col: keyof GameRow, v: string) {
          filters.push((r) => r[col] === v);
          return api;
        },
        gt(col: keyof GameRow, v: string) {
          filters.push((r) => String(r[col]) > v);
          return api;
        },
        gte(col: keyof GameRow, v: string) {
          filters.push((r) => String(r[col]) >= v);
          return api;
        },
        lt(col: keyof GameRow, v: string) {
          filters.push((r) => String(r[col]) < v);
          return api;
        },
        lte(col: keyof GameRow, v: string) {
          filters.push((r) => String(r[col]) <= v);
          return api;
        },
        order(col: keyof GameRow, o?: { ascending?: boolean }) {
          asc = o?.ascending !== false;
          void col;
          return api;
        },
        limit(n: number) {
          return api.then_(n);
        },
        then_(n?: number) {
          if (opts.fail) {
            return Promise.resolve({ data: null, count: null, error: { message: 'boom' } });
          }
          const matched = rows.filter((r) => filters.every((f) => f(r)));
          matched.sort((a, b) =>
            asc ? a.game_date.localeCompare(b.game_date) : b.game_date.localeCompare(a.game_date),
          );
          const sliced = typeof n === 'number' ? matched.slice(0, n) : matched;
          return Promise.resolve({
            data: head ? null : sliced,
            count: matched.length,
            error: null,
          });
        },
        // A head+count read is awaited directly, with no limit() call.
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return api.then_().then(resolve, reject);
        },
      };
      return api;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const SCHEDULE: GameRow[] = [
  { game_id: 1, game_date: '2026-04-16', game_type: 'regular' },
  { game_id: 2, game_date: '2026-06-11', game_type: 'playoff' },
  { game_id: 3, game_date: '2026-06-14', game_type: 'playoff' },
  { game_id: 4, game_date: '2026-09-29', game_type: 'regular' },
  { game_id: 5, game_date: '2026-09-30', game_type: 'regular' },
];

describe('SeasonPhaseService — the 2026-09-02 offseason', () => {
  it('reads the gap on both sides', async () => {
    const svc = new SeasonPhaseService(makeSupabase(SCHEDULE));
    const { result, error } = await svc.getScheduleFacts('2026-09-02');

    expect(error).toBeNull();
    expect(result).toMatchObject({
      today: '2026-09-02',
      gamesToday: 0,
      lastGameDate: '2026-06-14',
      lastGameType: 'playoff',
      nextGameDate: '2026-09-29',
      nextGameType: 'regular',
    });
  });

  // The whole point: these facts must derive to a state in which no screen
  // can print "tonight", "live", or a points total.
  it('derives to a dormant offseason, which is what suppresses the lies', async () => {
    const svc = new SeasonPhaseService(makeSupabase(SCHEDULE));
    const { result } = await svc.getScheduleFacts('2026-09-02');
    const status = deriveSeasonStatus(result);

    expect(status.phase).toBe('offseason');
    expect(status.isDormant).toBe(true);
    expect(status.hasGamesToday).toBe(false);
    expect(status.daysUntilNextGame).toBe(27);
  });
});

describe('SeasonPhaseService — in season', () => {
  it('counts today’s games and reports not-dormant', async () => {
    const svc = new SeasonPhaseService(makeSupabase(SCHEDULE));
    const { result } = await svc.getScheduleFacts('2026-09-29');

    expect(result?.gamesToday).toBe(1);
    // "on or before today" — today's own game names the phase.
    expect(result?.lastGameDate).toBe('2026-09-29');
    expect(deriveSeasonStatus(result).isDormant).toBe(false);
    expect(deriveSeasonStatus(result).phase).toBe('regular');
  });

  it('reads a playoff day as the playoffs', async () => {
    const svc = new SeasonPhaseService(makeSupabase(SCHEDULE));
    const { result } = await svc.getScheduleFacts('2026-06-14');
    expect(deriveSeasonStatus(result).phase).toBe('playoffs');
  });
});

describe('SeasonPhaseService — failure is not an offseason', () => {
  // The expensive bug this prevents: a read error in January becoming a
  // confident "the season is over" on every screen at once.
  it('returns an error rather than synthesising facts', async () => {
    const svc = new SeasonPhaseService(makeSupabase(SCHEDULE, { fail: true }));
    const { result, error } = await svc.getScheduleFacts('2026-01-15');

    expect(result).toBeNull();
    expect(error?.message).toBe('boom');
  });

  it('a null result derives to unknown, which renders nothing seasonal', async () => {
    const status = deriveSeasonStatus(null);
    expect(status.phase).toBe('unknown');
    expect(status.isDormant).toBe(false);
  });

  it('rejects a malformed date without touching the database', async () => {
    const svc = new SeasonPhaseService(makeSupabase(SCHEDULE));
    const { result, error } = await svc.getScheduleFacts('09/02/2026');
    expect(result).toBeNull();
    expect(error?.message).toMatch(/YYYY-MM-DD/);
  });
});
