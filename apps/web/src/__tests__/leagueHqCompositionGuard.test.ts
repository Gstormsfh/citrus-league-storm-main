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
 *
 * THE RITUAL (2026-09-03, Sleeper-gap 4) adds a fifth pin, in the second
 * describe below: the mock draft entry lives inside the Draft Room card as a
 * tertiary ghost, only before the draft starts, and never as a second orange
 * verb beside the real action.
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
    // PRESS BOX (2026-09-04): the phone's identity row is the shared
    // LeagueHeader — it prints the league's name and crest by contract
    // (pressboxChromeGuard) — so the page keeps ONE h1 of its own, the
    // desktop identity at sm+. The phone must still mount the header.
    expect(H1S.length, 'page h1').toBeGreaterThanOrEqual(1);
    const phoneChrome = SOURCE.slice(SOURCE.indexOf('className="lg:hidden pt-[env(safe-area-inset-top)]"'));
    expect(phoneChrome).toContain('<LeagueHeader');
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

/**
 * THE RITUAL (2026-09-03, Sleeper-gap 4, "the mock draft"). A league learns
 * to draft by drafting, so the practice entry sits where the real action
 * is. Three things about it must survive every future HQ pass:
 *
 *   1. It is IN the Draft Room card, under the real button, and it goes to
 *      the public client-side simulator (the target mockDraftNavGuard pins
 *      for every other mock-draft affordance). No new surface, no writes.
 *   2. It is a ghost. DESIGN_DIRECTION.md rule 3: one #FF6B1A verb per
 *      screen. The Draft Room CTA owns the orange; the practice entry may
 *      never take a hot fill, and the action grid keeps exactly one.
 *   3. It is gone the moment the draft is live. A card with a hot "Join
 *      Draft Room" and a practice link beside it is a card that asks a
 *      manager which draft is real. Pre-draft only, and behind the flag so
 *      a one-line commit can pull it.
 *
 * And the sentence under it stays on the page: a practice pick must never
 * leave a manager wondering whether it counted.
 */
describe('League HQ practice entry', () => {
  const MOCK_TARGET = '/armchair-gm?tab=mockdraft';
  const LINK = `<Link to="${MOCK_TARGET}">`;
  const cardStart = SOURCE.indexOf('{/* Draft Room - visible to ALL');
  const cardEnd = SOURCE.indexOf('✦ Your Squad');
  const DRAFT_CARD = SOURCE.slice(cardStart, cardEnd);

  it('lives inside the Draft Room card and points at the public simulator', () => {
    expect(cardStart, 'Draft Room card comment anchor').toBeGreaterThan(-1);
    expect(cardEnd, 'squad card kicker anchor').toBeGreaterThan(cardStart);
    expect(DRAFT_CARD).toContain(LINK);
    expect(DRAFT_CARD).toContain('Run a mock draft');
  });

  it('is gated by the launch flag and only shown before the draft starts', () => {
    expect(SOURCE).toMatch(/import \{ FEATURE_PRACTICE_DRAFT \} from '@\/lib\/featureFlags'/);
    expect(DRAFT_CARD).toMatch(/FEATURE_PRACTICE_DRAFT && league\.draft_status === 'not_started' && \(/);
    // The gate wraps the link: the flag check precedes it within the card and
    // nothing renders the target outside that gate.
    const gateAt = DRAFT_CARD.indexOf('FEATURE_PRACTICE_DRAFT &&');
    const linkAt = DRAFT_CARD.indexOf(LINK);
    expect(gateAt).toBeGreaterThan(-1);
    expect(linkAt).toBeGreaterThan(gateAt);
    // PRESS BOX (2026-09-04): two in the SOURCE, one per screen — the phone
    // layer (`lg:hidden`) and the desktop card (`hidden lg:block`) each
    // carry it, and a viewer only ever sees one. Both are behind the same
    // gate; the phone's is checked here because it is outside DRAFT_CARD.
    expect(SOURCE.split(MOCK_TARGET).length - 1, 'one practice entry per screen').toBe(2);
    const phoneMockAt = SOURCE.indexOf(MOCK_TARGET);
    expect(SOURCE.slice(phoneMockAt - 160, phoneMockAt)).toMatch(
      /FEATURE_PRACTICE_DRAFT && league\.draft_status === 'not_started'/,
    );
  });

  it('is a ghost, never a second orange verb beside Draft Room', () => {
    const linkAt = DRAFT_CARD.indexOf(LINK);
    const button = DRAFT_CARD.slice(DRAFT_CARD.lastIndexOf('<Button', linkAt), linkAt);
    expect(button).toContain('asChild');
    expect(button).toContain('bg-transparent');
    expect(button).toContain('border-pastel-cream/25');
    expect(button).not.toContain('bg-pastel-orange');
    expect(button).not.toContain('shadow-[');
    // Exactly one hot fill in the whole action grid, and it is the Draft
    // Room CTA, which stays where the HQ pass put it.
    const actions = SOURCE.slice(SOURCE.indexOf('{/* Actions */}'), SOURCE.indexOf('{/* T12 architect Entry 13'));
    expect(actions.split('bg-pastel-orange text-[#581E00]').length - 1).toBe(1);
    expect(actions.indexOf('bg-pastel-orange text-[#581E00]')).toBeLessThan(actions.indexOf(LINK));
  });

  it('says on the page that nothing there touches the league', () => {
    expect(DRAFT_CARD).toContain('Nothing there touches this league.');
  });
});
