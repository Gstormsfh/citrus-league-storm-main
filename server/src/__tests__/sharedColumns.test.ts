import { describe, it, expect } from 'vitest';
import { COLUMNS } from '@citrus/shared';

/**
 * Tripwire tests for the shared column constants in
 * `packages/shared/src/constants/columns.ts`.
 *
 * Why this file exists:
 *   During the April 10 2026 live draft disaster, `COLUMNS.GOALIE_GSAX`
 *   selected `'player_id, gsax'` from `goalie_gsax_primary` — a table
 *   whose real columns are `goalie_id, raw_gsax, regressed_gsax, ...`
 *   The rename happened when xG v3 landed but was never propagated to
 *   the shared constant. Result: every goalie player card returned a
 *   500 mid-draft. See docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md §2.
 *
 * These tests are a structural tripwire. They are NOT a substitute for
 * the real schema-aware integration test the postmortem calls for
 * (that's tracked as a P1 item). They WILL catch the exact regression
 * that happened in April by asserting on the column tokens a constant
 * must (or must not) contain.
 *
 * Guidelines for adding new assertions:
 *   - Assert on tokens you know must or must NOT appear, not on the full
 *     string. The constants are comma-separated lists and the whole
 *     purpose of this file is to catch drift one token at a time.
 *   - Word-boundary regexes avoid false positives (`gsax` vs `regressed_gsax`).
 */
describe('shared COLUMNS constants', () => {
  describe('GOALIE_GSAX', () => {
    // Word-boundary regex: matches `gsax` as a standalone token but NOT as
    // part of `regressed_gsax` or `raw_gsax`.
    const BARE_GSAX = /(^|[\s,])gsax(\s|,|$)/;

    it('selects goalie_id, not player_id', () => {
      expect(COLUMNS.GOALIE_GSAX).toMatch(/\bgoalie_id\b/);
      expect(COLUMNS.GOALIE_GSAX).not.toMatch(/\bplayer_id\b/);
    });

    it('selects regressed_gsax, not a bare gsax column', () => {
      expect(COLUMNS.GOALIE_GSAX).toMatch(/\bregressed_gsax\b/);
      // This is the exact regression from April 10 2026. A bare `gsax`
      // token here means the column rename has drifted again.
      expect(COLUMNS.GOALIE_GSAX).not.toMatch(BARE_GSAX);
    });
  });

  // ---------------------------------------------------------------------
  // Loose shape checks for the other high-traffic constants. These are
  // deliberately weak (just "must contain the known primary key") so
  // this file stays maintainable. Tighten them when you add a column
  // that must exist for a downstream query to work.
  // ---------------------------------------------------------------------
  describe('other column constants are non-empty and contain a plausible id', () => {
    it.each([
      ['PLAYER_DIRECTORY', /\bplayer_id\b/],
      ['PLAYER_TALENT_METRICS', /\bplayer_id\b/],
      ['PLAYER_STATS', /\bplayer_id\b/],
      ['MATCHUP', /\bid\b/],
      ['LEAGUE', /\bid\b/],
      ['TEAM', /\bid\b/],
      ['NOTIFICATION', /\buser_id\b/],
      ['ROSTER_ASSIGNMENT', /\bplayer_id\b/],
    ] as const)('%s contains %s', (key, pattern) => {
      const value = COLUMNS[key];
      expect(value).toBeTruthy();
      expect(typeof value).toBe('string');
      expect(value).toMatch(pattern);
    });
  });

  // ---------------------------------------------------------------------
  // TEAM has no record columns, and a query that names one is a 500.
  //
  // 2026-09-03: LeagueService.getStandings selected
  //   'id, team_name, owner_id, wins, losses, ties, points_for, points_against'
  // from `teams`. Production `teams` has six columns -- id, league_id,
  // owner_id, team_name, created_at, updated_at -- so every call came back
  // 42703 'column "wins" does not exist' and
  // GET /api/leagues/:leagueId/standings answered 500 on every request it
  // ever served. Standings are DERIVED from matchups (see
  // packages/shared/src/utils/standings.ts); there is no W/L/T to select.
  //
  // Same species as the GOALIE_GSAX case above: a query naming a column the
  // table does not have, shipped and unnoticed. This is the tripwire for it.
  // ---------------------------------------------------------------------
  describe('TEAM carries no derived record columns', () => {
    it.each(['wins', 'losses', 'ties', 'points_for', 'points_against'])(
      'does not select %s',
      (column) => {
        expect(COLUMNS.TEAM).not.toMatch(new RegExp(`\\b${column}\\b`));
      },
    );

    it('is exactly the six columns the table has', () => {
      const columns = COLUMNS.TEAM.split(',').map((c) => c.trim()).sort();
      expect(columns).toEqual([
        'created_at', 'id', 'league_id', 'owner_id', 'team_name', 'updated_at',
      ]);
    });
  });
});
