/**
 * THE SCHEDULE HAS TO BE REACHABLE BY THE PEOPLE IN THE LEAGUE (2026-09-04).
 *
 * Found while sweeping for the 2026-09-08 test drafts. Nothing in the product
 * creates a season schedule when a draft ends: the v2 engine's
 * `draft_completed` trigger syncs rosters and stops, and the only caller of
 * MatchupService.generateMatchupsForLeague outside this route is the v1 client
 * pick path, which the v2 draft room never touches. Measured on production
 * that day, league "Test at golf": 12 teams, 252 roster_assignments,
 * 0 matchups.
 *
 * So the schedule is built lazily, by whoever opens the Matchup tab first, via
 * POST /api/matchups/league/:leagueId/generate. That route was
 * commissionerMiddleware. Eleven of twelve managers in a test league would
 * have finished their draft, tapped Matchup, and hit a full-page
 * "Access denied: Commissioner privileges required" with no way forward.
 *
 * A member may now fill that void. The three conditions below are what keep it
 * from being a hole, and they are exactly what this file pins:
 *
 *   1. Only into an EMPTY league. A member can create a schedule where none
 *      exists; he can never edit or extend one.
 *   2. Only from teams that belong to the league, so a foreign team cannot be
 *      smuggled into the round robin.
 *   3. forceRegenerate is pinned to false for a member. It DELETES the
 *      schedule. Refusing the flag outright would have been the wrong shape:
 *      Matchup.tsx computes it as `!hasAnyMatchups`, so the empty league this
 *      route serves is the one whose client asks to force.
 *
 * And the write goes through the admin client on purpose, because the only
 * INSERT policy on `matchups` is "Commissioners can manage matchups" and RLS
 * would refuse the member's own token even after all three checks pass. That
 * is precisely why the checks have to be proven to run BEFORE it.
 *
 * Source-contract style, like auctionSnakeBleedGuard: the property under test
 * is the shape of the handler, and a behavioural test that mocked the client
 * would pass just as happily with the guards deleted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(here, '../routes/matchups.ts'), 'utf-8');

/**
 * One route handler: from its `matchupRoutes.<verb>(` declaration to the next
 * one. Follows the code rather than a byte count, so the comment above a
 * handler is free to grow without turning this file red.
 */
function handlerSource(marker: string): string {
  const at = ROUTES.indexOf(marker);
  expect(at, `${marker} not found in routes/matchups.ts`).toBeGreaterThan(-1);
  const rest = ROUTES.slice(at + marker.length);
  const next = rest.search(/\nmatchupRoutes\.(get|post|put|patch|delete)\(/);
  return next === -1 ? ROUTES.slice(at) : ROUTES.slice(at, at + marker.length + next);
}

const GENERATE = "matchupRoutes.post('/league/:leagueId/generate'";

describe('a league member can create the schedule his league is missing', () => {
  it('the generate route admits members, not only the commissioner', () => {
    const body = handlerSource(GENERATE);
    expect(body).toContain('membershipMiddleware');
    // The old gate. Its presence here is the bug this file exists to prevent
    // from coming back.
    expect(
      body.includes('commissionerMiddleware'),
      'generate is commissioner-gated again; every non-commissioner in a freshly drafted league is locked out of the Matchup tab',
    ).toBe(false);
  });

  it('the destructive flag is normalized away for a member, not refused', () => {
    const body = handlerSource(GENERATE);
    // This is the subtle one, and getting it wrong makes the whole fix inert.
    //
    // Matchup.tsx computes `forceRegenerate = !hasAnyMatchups`, so the EMPTY
    // league this route exists to serve is exactly the one whose client asks
    // to force. A guard that answered 403 to the flag would have locked out
    // every manager it was written to admit. The flag is pinned to false for
    // a member instead: costs him nothing, since the emptiness check has
    // already proven there is nothing to delete, and puts the DELETE inside
    // generateMatchupsForLeague permanently out of his reach.
    expect(body).toMatch(/isCommissioner \? body\.forceRegenerate : false/);
    expect(
      body.includes('if (body.forceRegenerate)'),
      'the flag is being refused again; Matchup.tsx sends it true on exactly the leagues this route unblocks',
    ).toBe(false);
  });

  it('a member may only fill a void, never touch an existing schedule', () => {
    const body = handlerSource(GENERATE);
    expect(body).toContain('existingMatchups');
    expect(
      body,
      'the emptiness check is gone; a member could now rewrite a live schedule',
    ).toMatch(/existingMatchups\s*\?\?\s*0\)\s*>\s*0/);
  });

  it('the round robin is built from this league\'s own teams', () => {
    const body = handlerSource(GENERATE);
    expect(body).toContain('ownTeams');
    expect(
      body,
      'the team-membership check is gone; a foreign team could be written into the schedule',
    ).toMatch(/some\(\(id\)\s*=>\s*!ownTeams\.has\(id\)\)/);
  });

  it('every guard runs before the admin client is ever handed to the service', () => {
    const body = handlerSource(GENERATE);
    // This is the assertion that matters. getSupabaseAdmin bypasses RLS, so a
    // guard that runs after the assignment guards nothing at all.
    const assign = body.indexOf('supabase = admin;');
    expect(assign, 'the admin client is no longer assigned; did the write path change?').toBeGreaterThan(-1);

    for (const guard of [
      'existingMatchups',
      'ownTeams',
    ]) {
      const at = body.indexOf(guard);
      expect(at, `${guard} missing`).toBeGreaterThan(-1);
      expect(at, `${guard} runs after the RLS-bypassing client is adopted`).toBeLessThan(assign);
    }

    // And the service call comes last of all.
    const call = body.indexOf('generateMatchupsForLeague');
    expect(call).toBeGreaterThan(assign);
  });

  it('a commissioner still writes with his own token', () => {
    const body = handlerSource(GENERATE);
    // The admin client is reached for only inside the non-commissioner branch;
    // the commissioner's write stays under RLS, where his own policy allows it.
    const branch = body.indexOf('if (!isCommissioner)');
    const admin = body.indexOf('getSupabaseAdmin()');
    expect(branch, 'the commissioner branch is gone').toBeGreaterThan(-1);
    expect(admin, 'getSupabaseAdmin is no longer used').toBeGreaterThan(branch);
  });
});

describe('the neighbouring routes did not lose their gates', () => {
  it('deleting a schedule is still commissioner-only', () => {
    const body = handlerSource("matchupRoutes.delete('/league/:leagueId'");
    expect(body).toContain('commissionerMiddleware');
  });
});
