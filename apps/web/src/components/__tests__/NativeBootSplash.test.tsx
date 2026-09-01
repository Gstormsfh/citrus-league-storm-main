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
    expect(first.container.textContent).toContain('Citrus');
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

  it('the motion respects prefers-reduced-motion', () => {
    expect(CSS).toContain('@keyframes citrus-boot-mark-in');
    const reduced = CSS.slice(CSS.lastIndexOf('prefers-reduced-motion'));
    expect(reduced).toContain('.citrus-boot-mark');
  });

  it('total splash time stays under the two-second guidance', () => {
    const hold = Number(SPLASH.match(/HOLD_MS = (\d+)/)?.[1]);
    const fade = Number(SPLASH.match(/FADE_MS = (\d+)/)?.[1]);
    expect(hold + fade).toBeLessThan(2000);
  });
});
