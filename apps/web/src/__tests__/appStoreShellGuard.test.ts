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
    expect(html).toMatch(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*Barlow\+Condensed[^"]*" media="print" onload="this\.media='all'" \/>/);
    expect(html).toMatch(/<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
  });

  it('every harness page links the same sheet, so the harness draws the real faces', () => {
    const html = read('index.html');
    const url = html.match(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]*)"/)![1];
    for (const page of ['page', 'skeleton', 'boot', 'draft', 'pressbox']) {
      expect(read(`harness/${page}.html`), page).toContain(url);
    }
  });
});
