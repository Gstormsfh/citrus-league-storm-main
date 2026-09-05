/**
 * PR3 GUARD — the phone never loads behind a loader that looks nothing like
 * the screen. Source-level, so a refactor that puts Stormy or a pulsing
 * block back on a phone path fails here before it ships.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8');

describe('the five early-return pages load through PressBoxPageLoading', () => {
  it.each([
    ['pages/Standings.tsx', 'standings', 'Loading the standings…'],
    ['pages/Matchup.tsx', 'matchup', 'Loading the matchup…'],
    ['pages/LeagueDashboard.tsx', 'hq', 'Loading your league…'],
    ['pages/PlayoffBracket.tsx', 'bracket', 'Loading the playoff bracket…'],
  ])('%s', (file, kind, message) => {
    const src = read(file);
    expect(src).toContain("import { PressBoxPageLoading } from '@/components/pressbox/PageLoading';");
    expect(src).toMatch(new RegExp(`<PressBoxPageLoading[\\s\\S]{0,200}kind="${kind}"`));
    expect(src).toContain(`message="${message}"`);
    expect(src).not.toMatch(/<StormyLoading/);
  });

  it('PressBoxPageLoading keeps Stormy on the desktop and puts the chrome over the skeleton on the phone', () => {
    const src = read('components/pressbox/PageLoading.tsx');
    expect(src).toContain('const isMobile = useIsMobile();');
    expect(src).toMatch(/if \(!isMobile\) \{[\s\S]*<StormyLoading message=\{message\} \/>/);
    expect(src).toContain('<PressBoxLeagueChrome');
    expect(src).toContain('<PressBoxSkeletonScreen kind={kind} />');
  });
});

describe('Roster and Players', () => {
  it('the roster list loads as itself below lg; Stormy from lg', () => {
    const src = read('pages/Roster.tsx');
    expect(src).toMatch(/if \(rosterDisplayLoading\) \{[\s\S]{0,600}return isMobile \? \([\s\S]{0,80}<PressBoxSkeletonRoster \/>[\s\S]{0,200}<StormyLoading message="Loading your roster…" \/>/);
  });

  it('PlayersPhone draws its own skeleton; the page no longer hands it Stormy', () => {
    expect(read('pages/FreeAgents.tsx')).not.toContain('loadingSlot=');
    const phone = read('components/freeagents/PlayersPhone.tsx');
    expect(phone).toContain('<PressBoxSkeletonRows rows={8} rank action />');
  });
});

describe('no pulsing blocks on a phone component', () => {
  it.each([
    'components/news/NewsPhone.tsx',
    'components/schedule/SchedulePhone.tsx',
    'components/trades/TradesPhone.tsx',
    'components/waivers/WaiversPhone.tsx',
    'components/players/PlayersBrowsePhone.tsx',
    'components/freeagents/PlayersPhone.tsx',
    'components/scores/GameDetailPanel.tsx',
    'pages/Scores.tsx',
  ])('%s', (file) => {
    const src = read(file);
    expect(src).not.toContain('animate-pulse');
    expect(src).toMatch(/PressBoxSkeleton(Rows|Card|Bar|List)/);
  });
});

describe('the route fallback', () => {
  it('is the skeleton of the screen the URL names below lg, the overlay it was from lg', () => {
    const src = read('components/LoadingScreen.tsx');
    expect(src).toContain("import { routeSkeleton } from '@/lib/routeSkeleton';");
    expect(src).toContain('if (isMobile && !message) return <RouteSkeleton className={className} />;');
    expect(src).toContain('bg-pressbox-surface');
    expect(src).not.toContain('bg-pastel-surface');
  });
});

describe('the floor', () => {
  it('is the board\'s 600ms, once, on every page that holds a loading state', () => {
    expect(read('hooks/useMinimumLoadingTime.ts')).toContain('export const PB_LOADING_MIN_MS = 600;');
    for (const page of ['Standings', 'Roster', 'FreeAgents', 'PlayoffBracket', 'Matchup']) {
      const src = read(`pages/${page}.tsx`);
      expect(src, page).toMatch(/useMinimumLoadingTime\([^)]+, PB_LOADING_MIN_MS\)/);
      expect(src, page).not.toMatch(/useMinimumLoadingTime\([^)]+, \d+\)/);
    }
  });
});

describe('one loader per wait', () => {
  it("Roster's league-switch overlay stays on the desktop; the phone has the skeleton", () => {
    expect(read('pages/Roster.tsx')).toMatch(/showLoadingOverlay && \(\s*<div className="fixed inset-0 [^"]*z-overlay hidden lg:flex/);
  });
});

describe('home on a phone in a browser', () => {
  it('holds the home skeleton while the leagues load, never the storefront', () => {
    const src = read('pages/Index.tsx');
    expect(src).toMatch(/if \(auth\?\.user && !native && isMobile && \(auth\.loading \|\| league\?\.loading\)\) \{\s*return <LoadingScreen \/>;/);
  });
});
