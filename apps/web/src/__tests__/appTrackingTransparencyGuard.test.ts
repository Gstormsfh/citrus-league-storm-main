/**
 * APP STORE 5.1.2(i) — THE POSTURE WE TOLD APP REVIEW WE HAVE.
 *
 * Build 17 (submission d711fe8e-56c8-4b4e-837b-c744d19560b4, reviewed
 * 2026-09-11 on an iPad Air 11-inch M3) was rejected because the app showed
 * a cookie consent prompt and never called App Tracking Transparency. Apple
 * offered two remedies; we take the second one, which is theirs verbatim:
 * "If you do not collect cookies for tracking purposes on Apple devices,
 * remove the cookie prompts."
 *
 * That answer is only true for as long as four things stay true, and all
 * four are one ordinary edit away from being false:
 *
 *   1. the cookie banner is not mounted in a native build;
 *   2. no tracking framework is linked into the iOS project;
 *   3. the analytics ad-linkage flags stay off;
 *   4. the disclosure that replaced the banner is still in the binary.
 *
 * `scripts/build-native.mjs` refuses a build that breaks 1 to 3, but that
 * script runs on one person's laptop at archive time. This file runs on
 * every pull request, which is where the edit that breaks one of them
 * actually lands. The two are deliberately redundant: the cost of a second
 * rejection on an expedited review is a week of the season.
 *
 * If a future feature genuinely needs to track, this file is the right
 * place to discover that the App Privacy labels and the Review Notes have
 * to change with it. Do not relax a check here on its own.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const read = (p: string) => readFileSync(resolve(WEB, p), 'utf8');

/**
 * The IDFA is reachable only through these. `AdSupport` is the framework
 * that vends it, `AppTrackingTransparency` is the permission gate, and
 * `NSUserTrackingUsageDescription` is the Info.plist string without which
 * the prompt cannot even be shown. None of the three appears in this
 * project, which is what makes "the app cannot track" a statement about the
 * binary rather than a promise about our intentions.
 */
const TRACKING_SYMBOLS = ['AppTrackingTransparency', 'AdSupport', 'NSUserTrackingUsageDescription'];

describe('the iOS app cannot track, mechanically', () => {
  it.each([
    ['the Xcode project', 'ios/App/App.xcodeproj/project.pbxproj'],
    ['Info.plist', 'ios/App/App/Info.plist'],
  ])('%s links no tracking framework', (_label, path) => {
    const contents = read(path);
    for (const symbol of TRACKING_SYMBOLS) {
      expect(contents, `${path} must not reference ${symbol}`).not.toContain(symbol);
    }
  });

  it('analytics is initialised with both Google ad-linkage switches off', () => {
    const config = read('src/integrations/firebase/config.ts');
    expect(config).toMatch(/allow_google_signals\s*:\s*false/);
    expect(config).toMatch(/allow_ad_personalization_signals\s*:\s*false/);
    // Neither may be turned on anywhere else in the file either.
    expect(config).not.toMatch(/allow_google_signals\s*:\s*true/);
    expect(config).not.toMatch(/allow_ad_personalization_signals\s*:\s*true/);
  });

  it('no advertising SDK reaches the native dependency graph', () => {
    const pkg = JSON.parse(read('package.json'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const advertising = deps.filter((d) =>
      /(^|[-/])(admob|facebook|appsflyer|adjust|branch|amplitude|mixpanel|idfa)([-/]|$)/i.test(d),
    );
    expect(advertising, `advertising or attribution SDK in package.json: ${advertising.join(', ')}`).toEqual([]);
  });
});

describe('the cookie prompt is gone from the native build and only from it', () => {
  it('App.tsx mounts the banner behind a VITE_NATIVE gate', () => {
    const app = read('src/App.tsx');
    // A statically foldable condition, so Rollup drops the component rather
    // than shipping it hidden. `hidden` is not removed, and a reviewer
    // reading the bundle would find the copy either way.
    expect(app).toMatch(/import\.meta\.env\.VITE_NATIVE !== '1' && <CookieConsent \/>/);
  });

  it('the web app still has a banner to show, with its copy intact', () => {
    // The website is a website. Its cookies are real and EU visitors need
    // the prompt; the fix was scoped to the native shell on purpose.
    expect(read('src/components/CookieConsent.tsx')).toContain('We use analytics cookies');
  });

  it('the native build refuses a bundle that kept the banner', () => {
    const script = read('scripts/build-native.mjs');
    expect(script).toContain("blob.includes('We use analytics cookies')");
  });

  it('the native build refuses a project that linked a tracking framework', () => {
    const script = read('scripts/build-native.mjs');
    for (const symbol of TRACKING_SYMBOLS) expect(script).toContain(symbol);
  });

  it('the native build refuses an ad-linkage flag that is not provably off', () => {
    const script = read('scripts/build-native.mjs');
    expect(script).toContain('allow_google_signals');
    expect(script).toContain('allow_ad_personalization_signals');
  });
});

describe('what replaced the banner is in the binary', () => {
  /**
   * With the prompt gone, this is the only place an iOS user is told what
   * is collected and that it is off by default. "We removed the prompt" is
   * a defensible answer to App Review only while the information the prompt
   * carried still reaches the user somewhere.
   */
  it('the analytics toggle carries the disclosure, not a link to one', () => {
    const pref = read('src/components/AnalyticsPreference.tsx');
    expect(pref).toContain('first-party analytics');
    expect(pref).toMatch(/nothing is shared with advertisers or\s+data brokers/);
    expect(pref).toMatch(/never linked to data from other apps/);
    expect(pref).toMatch(/off unless you\s+turn it on here/);
  });

  it('the toggle renders on every surface that offers it, including the privacy screen', () => {
    for (const host of [
      'src/pages/Profile.tsx',
      'src/components/account/ProfilePhone.tsx',
      'src/components/LegalDocument.tsx',
    ]) {
      expect(read(host), host).toContain('<AnalyticsPreference />');
    }
  });

  it('the privacy policy states the Apple posture in its own words', () => {
    const policy = read('public/privacy-policy.html');
    expect(policy).toContain('No Tracking on Apple Devices');
    expect(policy).toContain('App Tracking Transparency');
    expect(policy).toMatch(/IDFA/);
    // The prompt's absence on native is itself a disclosure.
    expect(policy).toMatch(/do not use browser cookies for this and do not show that prompt/);
  });
});
