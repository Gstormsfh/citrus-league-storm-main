/**
 * LEAGUE HQ COMPOSITION (2026-08-31) — the founder's read: "our League HQ
 * kind of stinks." Held against the Sleeper/ESPN/Yahoo bar, four concrete
 * failures, each pinned here so a future edit cannot quietly reintroduce it:
 *
 * 1. The page truncated the league's own name at desktop widths
 *    ("LAUNCH DRY RUN" → "LAUNCH DRY R…"). A league's identity outranks a
 *    tidy single line: clamp at two lines, never truncate.
 * 2. Three stacked stat cards (three integers!) filled the first phone
 *    screen before any action was reachable. They render as one compact
 *    row at every width.
 * 3. Actions (Draft Room / Your Squad) rendered BELOW the stat tiles.
 *    Pre-season, entering the draft is the page's #1 job; the action grid
 *    now precedes the info tiles in the document.
 * 4. The Draft Room button was a ghost outline even when pressing it was
 *    the next real action. It goes hot for a live draft and for a
 *    commissioner whose league is full.
 *
 * jsdom has no layout engine — these are source contracts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(here, '../pages/LeagueDashboard.tsx'), 'utf-8');

describe('League HQ composition', () => {
  it('never truncates the league name — two-line clamp at every breakpoint', () => {
    const h1 = SOURCE.match(/<h1[^>]*>\{league\.name\}<\/h1>/)?.[0] ?? '';
    expect(h1).toContain('line-clamp-2');
    expect(h1).not.toContain('truncate');
  });

  it('renders the three league-shape tiles as one row at every width', () => {
    expect(SOURCE).toMatch(/"grid grid-cols-3 gap-2 sm:gap-4/);
    expect(SOURCE).not.toMatch(/"grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"/);
  });

  it('puts the action cards before the info tiles in the document', () => {
    const actions = SOURCE.indexOf('{/* Actions */}');
    const infoTiles = SOURCE.indexOf('{/* League Info Cards');
    expect(actions).toBeGreaterThan(-1);
    expect(infoTiles).toBeGreaterThan(-1);
    expect(actions, 'actions must precede the stat tiles').toBeLessThan(infoTiles);
  });

  it('makes the draft CTA hot when the viewer can actually act', () => {
    expect(SOURCE).toMatch(
      /isCommissioner && league\.draft_status === 'not_started' && teams\.length >= \(league\.settings\?\.teamsCount \|\| 12\)/,
    );
  });
});
