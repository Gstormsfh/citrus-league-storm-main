/**
 * xG (2026-08-13) — expected goals must survive the season-stats merge.
 *
 * Reported from the field as "xG isn't there (all 0.0) but I think
 * that's an issue with the database". It was not a database issue.
 * Measured on staging the same day:
 *
 *   select count(*), count(*) filter (where x_goals is not null),
 *          count(*) filter (where x_goals > 0), max(x_goals)
 *   from player_season_stats;
 *   -> 1066 | 1066 | 928 | 36.47
 *
 * Every row populated, in the very table this hook already reads, in
 * the very row it already merges. `x_goals` was just missing from the
 * select list, and `directoryRowToPlayer` initialises `xGoals: 0`. So
 * the pool rendered 0.0 for everyone and nothing errored — a
 * hard-coded zero is indistinguishable from a real zero, which is why
 * this survived until someone eyeballed a roster.
 *
 * These tests assert the two halves of that failure separately: the
 * column is REQUESTED, and once returned it is APPLIED. A test for
 * only the second half would still pass with the column absent from
 * the query, because the merge helper would simply never see it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SOURCE = readFileSync(resolve(HERE, '..', 'usePreloadedPlayers.ts'), 'utf8');

/** The exact column list handed to PostgREST. */
function selectList(): string[] {
  const m = SOURCE.match(/'player_id, games_played,[^']*'/);
  if (!m) throw new Error('season-stats select list not found');
  return m[0].replace(/'/g, '').split(',').map((c) => c.trim());
}

describe('usePreloadedPlayers — the season-stats query', () => {
  it('requests x_goals (without it the merge can never see xG)', () => {
    expect(selectList()).toContain('x_goals');
  });

  it('still requests everything the roster and pool already render', () => {
    // Guards against someone "tidying" the select list and silently
    // zeroing a different stat the same way xG was zeroed.
    const cols = selectList();
    for (const required of [
      'player_id',
      'games_played',
      'nhl_goals',
      'nhl_assists',
      'nhl_points',
      'nhl_shots_on_goal',
      'nhl_hits',
      'nhl_blocks',
      'nhl_ppp',
      'nhl_shp',
      'nhl_plus_minus',
      'nhl_wins',
      'nhl_saves',
      'nhl_gaa',
      'nhl_save_pct',
      'x_goals',
    ]) {
      expect(cols, `${required} dropped from the select list`).toContain(required);
    }
  });

  it('pages the query — the table is 1,066 rows against a 1,000-row cap', () => {
    // PostgREST's db-max-rows is 1000. An unpaged read returns 1000
    // rows with no error, so 66 players would silently keep their
    // hard-coded zeros. This has bitten this codebase before
    // (player_directory, 2,035 rows, autopick position caps).
    expect(SOURCE).toMatch(/\.range\(statsOffset, statsOffset \+ PAGE_SIZE - 1\)/);
    expect(SOURCE).toMatch(/statsOffset \+= PAGE_SIZE/);
  });
});

describe('usePreloadedPlayers — the merge', () => {
  it('assigns x_goals onto the player, rather than leaving the initial 0', () => {
    expect(SOURCE).toMatch(/p\.xGoals\s*=\s*n\(s\.x_goals\)/);
  });

  it('types x_goals on the row interface so a rename breaks the build', () => {
    expect(SOURCE).toMatch(/x_goals:\s*number\s*\|\s*null/);
  });

  it('the directory seed still starts xG at 0 (the merge is what fills it)', () => {
    // Deliberate: a player with no season row genuinely has no xG, and
    // 0 is the honest value there. The bug was never this line — it was
    // that nothing ever overwrote it.
    expect(SOURCE).toMatch(/xGoals:\s*0/);
  });
});
