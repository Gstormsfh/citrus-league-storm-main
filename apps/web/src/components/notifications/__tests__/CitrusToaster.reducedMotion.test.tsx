// CitrusToaster — prefers-reduced-motion (2026-09-02).
//
// WHY THIS IS A CLASS-LIST TEST, not a visual one. jsdom has no layout and
// no cascade: it never runs an animation, never composites, and never
// evaluates a `motion-reduce:` variant. So a card built with
// `motion-reduce:animate-none` would look identical to an unguarded one from
// inside a test — the guard would be unassertable, and an accidental
// deletion of it would ship silently.
//
// CitrusToaster therefore READS the media query (notificationKind's
// prefersReducedMotion) and omits TOAST_MOTION_CLASSES outright when it
// matches. The element's own class list becomes the contract, and that is
// what these two tests compare. `matchMedia` is installed and removed per
// test the way useIsMobile's tests do it, because jsdom ships without it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { CitrusToaster } from '../CitrusToaster';
import { toast } from '@/hooks/use-toast';
import { TOAST_MOTION_CLASSES, TOAST_SWIPE_CLASSES } from '../notificationKind';

function installMatchMedia(reduced: boolean) {
  const matchMedia = vi.fn((query: string) => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  return matchMedia;
}

afterEach(() => {
  // Put jsdom back the way it ships.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

function card() {
  render(<CitrusToaster />);
  act(() => {
    toast({ kind: 'player', title: 'Connor McDavid', meta: 'C · EDM · Goal' });
  });
  return screen.getByTestId('citrus-toast');
}

const MOTION = TOAST_MOTION_CLASSES.trim().split(/\s+/);

describe('CitrusToaster — prefers-reduced-motion: reduce', () => {
  it('drops every enter/exit animation class', () => {
    const matchMedia = installMatchMedia(true);
    const el = card();
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    for (const cls of MOTION) {
      expect(el.className, `${cls} survived reduced motion`).not.toContain(cls);
    }
    // The blanket names too, in case the class strings are ever re-spelled.
    expect(el.className).not.toContain('animate-in');
    expect(el.className).not.toContain('animate-out');
    expect(el.className).not.toContain('slide-in-from-top-full');
  });

  it('keeps the card itself — reduced motion removes the motion, not the toast', () => {
    installMatchMedia(true);
    const el = card();
    expect(screen.getByText('Connor McDavid')).toBeInTheDocument();
    expect(screen.getByText('C · EDM · Goal')).toBeInTheDocument();
    expect(el.className).toContain('bg-pastel-surface-tile/95');
  });

  it('keeps the swipe translates — a dismiss gesture is input, not decoration', () => {
    // Suppressing the swipe follow would make the card feel broken under the
    // thumb; the reduced-motion request is about unrequested animation.
    installMatchMedia(true);
    const el = card();
    for (const cls of TOAST_SWIPE_CLASSES.trim().split(/\s+/)) {
      expect(el.className).toContain(cls);
    }
  });
});

describe('CitrusToaster — no reduced-motion preference', () => {
  it('animates: the same classes are present when the query does not match', () => {
    installMatchMedia(false);
    const el = card();
    for (const cls of MOTION) {
      expect(el.className, `${cls} missing without reduced motion`).toContain(cls);
    }
  });

  it('animates when the environment has no matchMedia at all (jsdom default)', () => {
    expect(typeof window.matchMedia).toBe('undefined');
    const el = card();
    expect(el.className).toContain('animate-in');
  });
});
