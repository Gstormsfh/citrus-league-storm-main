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
  // HQ MOBILE COMPOSITION (2026-09-01): league.name renders twice — once
  // in the phone chrome bar (single line, may truncate: it's a 48px bar,
  // the Sleeper pattern) and once as the page identity at sm+ (two-line
  // clamp, never truncated).
  const H1S = [...SOURCE.matchAll(/<h1[^>]*>\{league\.name\}<\/h1>/g)].map((m) => m[0]);

  it('the phone chrome bar carries the league name, not a generic label', () => {
    expect(H1S.length, 'chrome-bar h1 + page h1').toBeGreaterThanOrEqual(2);
    expect(SOURCE).not.toContain('>League</h1>');
  });

  it('the page-identity heading clamps at two lines and never truncates', () => {
    const pageH1 = H1S.find((h) => h.includes('font-calistoga')) ?? '';
    expect(pageH1).toContain('line-clamp-2');
    expect(pageH1).not.toContain('truncate');
  });

  it('phones skip the duplicate mega header — identity lives in the chrome bar', () => {
    const pageH1 = H1S.find((h) => h.includes('font-calistoga')) ?? '';
    expect(pageH1).toContain('hidden sm:block');
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

  // HQ PROFESSIONAL PASS (2026-09-01): league life before setup facts —
  // timeline and teams render ABOVE the league-shape config tiles.
  it('demotes the config tiles below the timeline and teams list', () => {
    const timeline = SOURCE.indexOf('{/* T12 architect Entry 13');
    const teams = SOURCE.indexOf('{/* Teams List */}');
    const infoTiles = SOURCE.indexOf('{/* League Info Cards');
    expect(timeline, 'timeline must precede the config tiles').toBeLessThan(infoTiles);
    expect(teams, 'teams list must precede the config tiles').toBeLessThan(infoTiles);
  });

  it('the squad card carries state and sentence-case actions', () => {
    const squad = SOURCE.slice(SOURCE.indexOf('✦ Your Squad'), SOURCE.indexOf('✦ Your Squad') + 4000);
    // Data line, not filler copy, once the draft is done:
    expect(squad).toContain('Roster set ·');
    // Both actions override the varsity-caps button base:
    const overrides = squad.match(/normal-case font-sans tracking-normal/g) ?? [];
    expect(overrides.length).toBeGreaterThanOrEqual(2);
  });

  it('every member can invite from the top of HQ', () => {
    const header = SOURCE.slice(0, SOURCE.indexOf('{/* Actions */}'));
    expect(header).toContain('<InvitePlayersButton');
    // Not commissioner-gated — the guard is the join code existing.
    const inviteAt = header.indexOf('<InvitePlayersButton');
    const gateWindow = header.slice(inviteAt - 200, inviteAt);
    expect(gateWindow).toContain('league.join_code &&');
    expect(gateWindow).not.toContain('isCommissioner &&');
  });

  it('makes the draft CTA hot when the viewer can actually act', () => {
    expect(SOURCE).toMatch(
      /isCommissioner && league\.draft_status === 'not_started' && teams\.length >= \(league\.settings\?\.teamsCount \|\| 12\)/,
    );
  });
});
