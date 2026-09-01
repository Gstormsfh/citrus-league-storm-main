/**
 * DAILY-SCORES STEADY STATE (2026-09-01) — /api/matchups/:id/daily-scores
 * measured at 834ms mean / 2.9s max on prod. Anatomy: the route ran
 * ensureMatchupRosters AND calculateDailyMatchupScores, and the
 * calculator backfills both teams itself — so the whole lineup/roster
 * existence dance ran twice per request, and the backfill read
 * team_lineups up to three times per team even when every row already
 * existed. Worse, for a week entirely in the past the backfill can never
 * write anything (the Task 1B past-date rule), yet still paid all reads.
 *
 * Contracts pinned here:
 *   1. The route delegates the backfill to exactly one layer (the
 *      calculator) — no ensureMatchupRosters call in /daily-scores.
 *   2. backfillDailyRostersIfMissing computes its eligible-date window
 *      BEFORE any database read and bails on an empty window.
 *   3. Callers that already hold the team's lineup hand it down instead
 *      of forcing a duplicate read.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(here, '../routes/matchups.ts'), 'utf-8');
const SERVICE = readFileSync(resolve(here, '../services/MatchupService.ts'), 'utf-8');

describe('the daily-scores route backfills through one layer only', () => {
  it('does not run ensureMatchupRosters inside /daily-scores', () => {
    const start = ROUTES.indexOf("matchupRoutes.get('/:matchupId/daily-scores'");
    const end = ROUTES.indexOf('matchupRoutes.', start + 10);
    const route = ROUTES.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    // The CALL must be gone (the incident comment may name the method).
    expect(route).not.toContain('await service.ensureMatchupRosters');
    expect(route).toContain('calculateDailyMatchupScores');
  });
});

describe('the daily-roster backfill is cheap when it has nothing to do', () => {
  const start = SERVICE.indexOf('private async backfillDailyRostersIfMissing');
  const body = SERVICE.slice(start, SERVICE.indexOf('\n  async ', start));

  it('computes the eligible-date window before any database read', () => {
    const dateMath = body.indexOf('const today = getTodayMST()');
    const emptyBail = body.indexOf('if (dates.length === 0) return;');
    const firstRead = body.indexOf('await admin');
    expect(dateMath).toBeGreaterThan(-1);
    expect(emptyBail).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(-1);
    expect(dateMath, 'date math must precede the first read').toBeLessThan(firstRead);
    expect(emptyBail, 'the empty-window bail must precede the first read').toBeLessThan(firstRead);
  });

  it('accepts a caller-provided lineup instead of re-reading it', () => {
    expect(body).toContain('preloadedLineup');
    // …and ensureMatchupRosters actually passes its read down.
    const ensure = SERVICE.slice(SERVICE.indexOf('async ensureMatchupRosters'));
    expect(ensure).toMatch(/backfillDailyRostersIfMissing\([\s\S]*?effectiveLineup,\s*\)/);
  });
});
