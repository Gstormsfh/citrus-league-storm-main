/**
 * PR18 GUARD — the native shell around the Press Box app.
 *
 * Each of these was found broken or missing on 2026-09-05, the night of the
 * App Store submission, and each is a one-line regression away from coming
 * back: a status bar nobody can read, a white launch ground under a dark
 * app, a first paint that waits on Google.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const read = (p: string) => readFileSync(resolve(WEB, p), 'utf8');

describe('the status bar is readable over a dark header', () => {
  it('Info.plist asks for light status-bar content and the dark appearance', () => {
    const plist = read('ios/App/App/Info.plist');
    expect(plist).toMatch(/<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleLightContent<\/string>/);
    expect(plist).toMatch(/<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/);
  });
});

describe('the cold start is one ground', () => {
  it('the launch storyboard paints the Press Box surface, not the system background', () => {
    const sb = read('ios/App/App/Base.lproj/LaunchScreen.storyboard');
    expect(sb).not.toContain('systemBackgroundColor');
    expect(sb).toMatch(/backgroundColor" red="0\.0470\d*" green="0\.0941\d*" blue="0\.0666\d*"/);
    expect(sb).toContain('image="Splash"');
  });

  it('the web view, the page and the native hold agree on #0C1811', () => {
    expect(JSON.parse(read('capacitor.config.json')).backgroundColor.toUpperCase()).toBe('#0C1811');
    expect(read('index.html')).toMatch(/<html lang="en" style="background: #0C1811;">/);
    expect(read('src/index.css')).toMatch(/html \{[^}]*background: #0C1811;/);
    expect(read('src/pages/Index.tsx')).toContain("background: '#0C1811'");
  });

  it('the boot splash stands on the same ground', () => {
    expect(read('src/components/NativeBootSplash.tsx')).toContain('bg-pressbox-surface');
  });
});

describe('the first paint does not wait on Google', () => {
  it('the fonts sheet is a non-blocking link in index.html, not an @import in index.css', () => {
    expect(read('src/index.css')).not.toMatch(/@import url\(['"]https:\/\/fonts\.googleapis\.com/);
    const html = read('index.html');
    expect(html).toMatch(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" media="print" onload="this\.media='all'" \/>/);
    expect(html).toMatch(/<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
  });

  it('the three Press Box faces are bundled, not fetched, and not fetched twice', () => {
    const fonts = read('src/pressboxFonts.ts');
    for (const face of [
      'barlow-condensed/latin-700', 'barlow-condensed/latin-800',
      'barlow/latin-400', 'barlow/latin-500', 'barlow/latin-600', 'barlow/latin-700',
      'ibm-plex-mono/latin-500', 'ibm-plex-mono/latin-600',
    ]) {
      expect(fonts).toContain(`import '@fontsource/${face}.css';`);
    }
    const main = read('src/main.tsx');
    expect(main.indexOf("import './pressboxFonts'")).toBeGreaterThan(-1);
    expect(main.indexOf("import './pressboxFonts'")).toBeLessThan(main.indexOf("import './index.css'"));
    const google = read('index.html').match(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]*)"/)![1];
    expect(google).not.toMatch(/Barlow|IBM\+Plex/);
    const pkg = JSON.parse(read('package.json'));
    for (const dep of ['@fontsource/barlow-condensed', '@fontsource/barlow', '@fontsource/ibm-plex-mono']) {
      expect(pkg.dependencies[dep] ?? pkg.devDependencies?.[dep], dep).toBeTruthy();
    }
  });

  it('every harness page links the same sheet, so the harness draws the real faces', () => {
    const html = read('index.html');
    const url = html.match(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]*)"/)![1];
    for (const page of ['page', 'skeleton', 'boot', 'draft', 'pressbox']) {
      expect(read(`harness/${page}.html`), page).toContain(url);
      expect(read(`harness/${page}.tsx`), page).toContain("import '../src/pressboxFonts';");
    }
  });
});

describe('44pt under the finger', () => {
  it('the hit-area utilities exist and grow the target to 44px without moving the visual', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/\.pb-hit,\s*\.pb-hit-y \{\s*position: relative;/);
    expect(css).toMatch(/\.pb-hit::after,\s*\.pb-hit-y::after \{[^}]*height: max\(100%, 44px\);/);
    expect(css).toMatch(/\.pb-hit::after \{\s*width: max\(100%, 44px\);/);
  });

  it('every chip, segment, tab and roster slot chip carries one', () => {
    expect(read('src/components/pressbox/Chips.tsx')).toContain("'pb-hit-y rounded-full whitespace-nowrap'");
    expect(read('src/components/pressbox/Segmented.tsx')).toContain("'pb-hit-y whitespace-nowrap'");
    expect(read('src/components/pressbox/Tabs.tsx')).toContain("'pb-hit-y whitespace-nowrap uppercase'");
    expect(read('src/components/pressbox/RosterRow.tsx')).toContain("'pb-hit active:scale-95 transition-transform'");
  });

  it('a chip strip that scrolls sideways is tall enough not to clip the hit area', () => {
    for (const f of [
      'src/components/freeagents/PlayersPhone.tsx',
      'src/components/news/NewsPhone.tsx',
      'src/components/players/PlayersBrowsePhone.tsx',
      'src/components/waivers/WaiversPhone.tsx',
    ]) {
      expect(read(f), f).toMatch(/py-2\.5 -my-2\.5 overflow-x-auto/);
    }
    expect(read('src/pages/Matchup.tsx')).toMatch(/pt-2 pb-2\.5 -mb-2 overflow-x-auto scrollbar-hide/);
  });
});
