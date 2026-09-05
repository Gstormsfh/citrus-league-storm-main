/**
 * NativeBootSplash — the app-open motion plays only in the native shell,
 * exactly once per cold start, and never renders in a browser.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { isNativePlatformMock } = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => false),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: isNativePlatformMock },
}));

import NativeBootSplash from '../NativeBootSplash';

afterEach(() => {
  cleanup();
  isNativePlatformMock.mockReset();
  isNativePlatformMock.mockReturnValue(false);
});

describe('NativeBootSplash', () => {
  it('renders nothing in a browser', () => {
    isNativePlatformMock.mockReturnValue(false);
    const { container } = render(<NativeBootSplash />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the branded overlay in the native shell, once per cold start', () => {
    isNativePlatformMock.mockReturnValue(true);
    const first = render(<NativeBootSplash />);
    // Module-scope once-flag: the FIRST native mount in this process
    // owns the boot moment…
    const overlay = first.container.querySelector('[aria-hidden="true"]');
    expect(overlay, 'first native mount shows the overlay').not.toBeNull();
    expect(first.container.textContent).toContain('CITRUS');
    first.unmount();
    // …and any later mount (route remount) must NOT replay it.
    const second = render(<NativeBootSplash />);
    expect(second.container.firstChild).toBeNull();
  });
});

describe('boot splash source contracts', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const SPLASH = readFileSync(resolve(here, '../NativeBootSplash.tsx'), 'utf-8');
  const CSS = readFileSync(resolve(here, '../../index.css'), 'utf-8');
  const APP = readFileSync(resolve(here, '../../App.tsx'), 'utf-8');

  it('App mounts the splash', () => {
    expect(APP).toContain('<NativeBootSplash />');
  });

  it('the motion respects prefers-reduced-motion — every loop and transform is off', () => {
    for (const k of ['citrus-boot-bob', 'citrus-boot-spin', 'citrus-boot-sweep', 'citrus-boot-dot']) {
      expect(CSS).toContain(`@keyframes ${k}`);
    }
    const reduced = CSS.slice(CSS.lastIndexOf('prefers-reduced-motion'));
    for (const c of ['.citrus-boot-puck', '.citrus-boot-spin', '.citrus-boot-sweep', '.citrus-boot-dot', '.citrus-boot-tip']) {
      expect(reduced).toContain(c);
    }
  });

  it('the bar is driven by real stages with a 600ms floor and a 6s ceiling, and the stage names itself at 4s', () => {
    // Motion board 2a (PR3): auth 25 -> league 55 -> paint 100; never
    // fake-complete; min display 600ms; show content anyway at 6s; a stage
    // that exceeds 4s shows its name under the bar.
    expect(Number(SPLASH.match(/MIN_MS = (\d+)/)?.[1])).toBe(600);
    expect(Number(SPLASH.match(/CEILING_MS = (\d+)/)?.[1])).toBe(6000);
    expect(Number(SPLASH.match(/STAGE_NAME_AFTER_MS = (\d+)/)?.[1])).toBe(4000);
    expect(SPLASH).toContain('useBootProgress()');
    expect(SPLASH).not.toMatch(/setInterval\([^)]*pct/);
    const STAGES = readFileSync(resolve(here, '../../lib/bootStages.ts'), 'utf-8');
    expect(STAGES).toMatch(/key: 'auth'[^}]*pct: 25/);
    expect(STAGES).toMatch(/key: 'league'[^}]*pct: 55/);
    expect(STAGES).toMatch(/key: 'paint'[^}]*pct: 100/);
    // The three reporters exist where the stages actually happen.
    expect(readFileSync(resolve(here, '../../contexts/AuthContext.tsx'), 'utf-8')).toContain("reportBootStage('auth')");
    expect(readFileSync(resolve(here, '../../contexts/LeagueContext.tsx'), 'utf-8')).toContain("reportBootStage('league')");
    expect(APP).toContain("reportBootStage('paint')");
    expect(APP).toContain('<BootPaintReporter />');
  });
});
