/**
 * THE PHONE HEADER AND THE MENU.
 *
 * 2026-09-01 — iOS sim: League HQ, Profile, Trade Center, Analytics, Team
 * View, Playoffs, Schedule, Stormy and Create League rendered the mobile
 * chrome header as a centred title with no hamburger — from those
 * screens there was NO path to the league switcher, Create / Join League,
 * News or Contact. Only half the app's pages carried the menu, so
 * navigation depended on which tab you happened to be standing on.
 *
 * 2026-09-04 (PRESS BOX) — the old title bar and its hamburger are gone
 * from every page. A league screen mounts `PressBoxLeagueChrome`, which
 * is the LeagueHeader (crest, name, week, the sliders, the four sub-tabs)
 * and the LeagueMenu the sliders open, wired in one place; an account
 * screen mounts `PressBoxAppHeader`, and the app nav is the way around.
 * The league switcher on a phone is the LEAGUES tab (the home's league
 * list), which the menu's SWITCH reaches.
 *
 * Contract: every page that renders a phone header renders one of the two
 * Press Box headers; no page carries the legacy header string or the old
 * menu; and the chrome wires the sliders to the menu and SWITCH to home.
 * jsdom has no layout engine; this is a source contract across src/pages.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = resolve(here, '../pages');
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8');

const LEGACY_HEADER = 'lg:hidden sticky top-0 z-page-header bg-[#0F1F15]/95';

const pages: Array<[string, string]> = readdirSync(pagesDir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => [f, readFileSync(join(pagesDir, f), 'utf-8')] as [string, string]);

const LEAGUE_PAGES = [
  'LeagueDashboard.tsx', 'Matchup.tsx', 'Roster.tsx', 'FreeAgents.tsx', 'Standings.tsx',
  'WaiverWire.tsx', 'TradeAnalyzer.tsx', 'ScheduleManager.tsx', 'GMOffice.tsx', 'OtherTeam.tsx',
  'TeamAnalytics.tsx', 'PlayoffBracket.tsx',
  // The pools (2026-09-05): the same chrome, sub-tabs off.
  'PoolPickem.tsx', 'PoolSurvivor.tsx', 'PoolConfidence.tsx',
];
const APP_PAGES = ['Profile.tsx', 'CreateLeague.tsx', 'StormyAssistant.tsx', 'Scores.tsx', 'News.tsx', 'Players.tsx'];

describe('the legacy phone chrome is gone', () => {
  it('no page carries the old title bar', () => {
    const carriers = pages.filter(([, t]) => t.includes(LEGACY_HEADER)).map(([f]) => f);
    expect(carriers).toEqual([]);
  });

  it('the old menu sheet no longer exists and nothing imports it', () => {
    expect(existsSync(resolve(here, '../components/MobileMenuButton.tsx'))).toBe(false);
    const importers = pages.filter(([, t]) => t.includes('MobileMenuButton')).map(([f]) => f);
    expect(importers).toEqual([]);
  });
});

describe('every league screen wears the league chrome', () => {
  it.each(LEAGUE_PAGES)('%s mounts PressBoxLeagueChrome and nothing else as its phone header', (file) => {
    const text = pages.find(([f]) => f === file)?.[1] ?? '';
    expect(text, `${file} missing`).not.toBe('');
    expect(text).toContain('<PressBoxLeagueChrome');
    // The pair is assembled in the chrome, not by hand on the page.
    expect(text).not.toContain('<LeagueHeader');
    expect(text).not.toContain('<LeagueMenu');
  });
});

describe('every account screen wears the app header', () => {
  it.each(APP_PAGES)('%s mounts PressBoxAppHeader below lg', (file) => {
    const text = pages.find(([f]) => f === file)?.[1] ?? '';
    expect(text, `${file} missing`).not.toBe('');
    expect(text).toContain('<PressBoxAppHeader');
  });
});

describe('the chrome itself', () => {
  const chrome = read('../components/pressbox/LeagueChrome.tsx');

  it('opens the menu from the sliders, and mounts it only while open', () => {
    expect(chrome).toContain('onSettingsPress={() => setMenuOpen(true)}');
    // The menu's lines are react-query reads (2026-09-05); mounted on every
    // league page they put `useQuery` under page tests with no QueryClient.
    expect(chrome).toMatch(/\{menuOpen && \(tiles \? \(\s*<LeagueMenu\s+open/);
    expect(chrome).toContain('<LeagueMenuWithReads');
  });

  it('the league name and SWITCH ▾ open the switcher sheet; its foot is the league list (`/?all=1`)', () => {
    // THE SWITCHER (2026-09-05). Reported from the phone: "the league drop
    // down doesn't work any longer with the new visuals — click the dropdown
    // and nothing happens, I can't create a new league." The header's name
    // was a Link to the HQ you stood on. Now it opens the sheet, and so does
    // the menu's SWITCH ▾; a pick routes like the desktop switcher's pick.
    expect(chrome).toContain('onLeaguePress={() => setSwitcherOpen(true)}');
    expect(chrome).toContain('onSwitchLeague=');
    expect(chrome).toMatch(/const onSwitchLeague = \(\) => \{\s*setMenuOpen\(false\);\s*setSwitcherOpen\(true\);/);
    expect(chrome).toMatch(/\{switcherOpen && \(\s*<PressBoxLeagueSwitcher\s+open/);
    expect(chrome).toContain('leagueSwitchDestination(l.id, lType, location.pathname)');
    expect(chrome).toContain("navigate('/create-league')");
    expect(chrome).toContain("navigate('/?all=1')");
    // The header stays presentational: the opener arrives as a prop.
    const header = read('../components/pressbox/LeagueHeader.tsx');
    expect(header).toContain('onLeaguePress?: () => void;');
    expect(header).toContain('data-testid="league-switcher-trigger"');
    expect(header).not.toMatch(/useLeague\(\)/);
  });

  it('resolves the league once — URL, then the page, then the context — and hands it to both header and menu', () => {
    // The header is presentational (it reads no context, so the pressbox
    // barrel stays importable under the hermetic test env); the chrome is
    // where the league is resolved, and the same answer goes to both.
    expect(chrome).toContain("const resolvedId = params.leagueId ?? leagueId ?? league?.activeLeagueId ?? '';");
    expect(chrome).toContain('leagueId={resolvedId || null}');
    expect(chrome).toContain('leagueId={resolvedId}');
    expect(read('../components/pressbox/LeagueHeader.tsx')).not.toMatch(/useLeague\(\)/);
  });
});
