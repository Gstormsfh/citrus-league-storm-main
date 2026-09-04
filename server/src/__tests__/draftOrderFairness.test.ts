/**
 * THE COMMISSIONER DOES NOT PICK FIRST EVERY TIME (2026-09-04).
 *
 * Found in the Tuesday-funnel sweep. `initializeDraftOrder` fell back to
 * `teams.map(t => t.id)`, and `get_league_teams()` ends `ORDER BY
 * t.created_at`. The commissioner's team is created by `createLeague` before
 * anyone can join, so his team was first in the array, first in round one, and
 * first overall in every draft the product had ever run.
 *
 * Measured on production 2026-09-04: `commissioner's team = first-created
 * team` held for 12 of 12 leagues, and in the completed 252-pick draft of that
 * morning all twelve round-one slots matched join order exactly.
 *
 * The v1 room had a Fisher-Yates shuffle behind a button; the v2 room that
 * replaced it on 2026-08-18 passes no `customTeamOrder`, so this was lost in
 * a migration rather than decided against.
 *
 * These tests pin the fix as a property, not as an output: a shuffle has no
 * single correct answer, so what is asserted is that it preserves the roster
 * exactly, that it does not mutate its input, and that it actually moves teams
 * around. The last one is the assertion that fails against the old behaviour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shuffleTeamOrder } from '../services/DraftService';

const here = dirname(fileURLToPath(import.meta.url));
const SERVICE = readFileSync(resolve(here, '../services/DraftService.ts'), 'utf-8');

const twelve = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);

describe('shuffleTeamOrder', () => {
  it('returns exactly the teams it was given, no more and no fewer', () => {
    // The one property a draft order can never get wrong: every team drafts,
    // and nobody drafts twice.
    for (let trial = 0; trial < 200; trial++) {
      const out = shuffleTeamOrder(twelve);
      expect(out).toHaveLength(twelve.length);
      expect([...out].sort()).toEqual([...twelve].sort());
      expect(new Set(out).size).toBe(twelve.length);
    }
  });

  it('does not mutate the array it was handed', () => {
    // The caller passes `teams.map(t => t.id)` today, but a future caller
    // passing a live array would otherwise have it reordered underneath it.
    const input = [...twelve];
    shuffleTeamOrder(input);
    expect(input).toEqual(twelve);
  });

  it('gives every team a shot at the first overall pick', () => {
    // THIS is the test that fails against the old code, which returned join
    // order unchanged and therefore put team-1 first 100% of the time.
    //
    // With 12 teams and 2,000 draws, the chance any particular team never
    // lands first is (11/12)^2000, which is around 10^-75. A failure here is
    // a broken shuffle, not bad luck.
    const firstPickCounts = new Map<string, number>();
    for (let trial = 0; trial < 2000; trial++) {
      const first = shuffleTeamOrder(twelve)[0];
      firstPickCounts.set(first, (firstPickCounts.get(first) ?? 0) + 1);
    }
    expect(firstPickCounts.size).toBe(twelve.length);
    for (const team of twelve) {
      expect(firstPickCounts.get(team), `${team} never picked first in 2000 drafts`).toBeGreaterThan(0);
    }
  });

  it('is not lopsided', () => {
    // A crude uniformity check. Expected share of first picks is 1/12 of
    // 6,000 = 500; the band below is ±40%, wide enough that it will not flake
    // and narrow enough to catch a shuffle that only ever swaps two slots.
    const counts = new Map<string, number>();
    for (let trial = 0; trial < 6000; trial++) {
      const first = shuffleTeamOrder(twelve)[0];
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    for (const team of twelve) {
      const n = counts.get(team) ?? 0;
      expect(n, `${team} got ${n} first picks, expected about 500`).toBeGreaterThan(300);
      expect(n, `${team} got ${n} first picks, expected about 500`).toBeLessThan(700);
    }
  });

  it('handles the degenerate sizes without complaint', () => {
    expect(shuffleTeamOrder([])).toEqual([]);
    expect(shuffleTeamOrder(['only-team'])).toEqual(['only-team']);
    expect([...shuffleTeamOrder(['a', 'b'])].sort()).toEqual(['a', 'b']);
  });
});

describe('initializeDraftOrder uses it', () => {
  it('falls back to a shuffle, not to join order', () => {
    // A source contract, because the behavioural path needs a Supabase client
    // and the property that matters is which expression supplies the default.
    expect(
      SERVICE,
      'initializeDraftOrder is back to join order; the commissioner will pick first in every draft',
    ).toMatch(/customTeamOrder \?\? shuffleTeamOrder\(teams\.map\(\(t\) => t\.id\)\)/);
    expect(SERVICE).not.toContain('customTeamOrder || teams.map((t) => t.id)');
  });

  it('an explicit order from the commissioner still wins', () => {
    // Setting an order on purpose is a different thing from not having one.
    expect(SERVICE).toContain('customTeamOrder ??');
  });

  it('draws from a source without modulo bias', () => {
    // This draw decides who gets the first overall pick. Math.random is fine
    // for shuffling a playlist and not for this.
    expect(SERVICE).toContain("import { randomInt } from 'node:crypto'");
    expect(
      /const j = Math\.floor\(Math\.random\(\)/.test(SERVICE),
      'the shuffle is back on Math.random',
    ).toBe(false);
  });
});
