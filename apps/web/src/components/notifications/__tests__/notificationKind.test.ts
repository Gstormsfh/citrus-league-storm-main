// notificationKind — the pure half of the Citrus status card (2026-09-02).
//
// These live apart from the render tests because they need no Radix
// provider, no viewport and no DOM: the whole point of keeping the maps and
// the formatter in a .ts sibling (react-refresh, see the module header) is
// that they can be pinned directly.
//
// What this pins:
//   * relativeTime's boundaries, including the two that bite in production —
//     a future timestamp from a server clock ahead of the phone, and floor
//     rather than round at 119s;
//   * resolveKind's default ('info', the reason 292 call sites keep working)
//     and its one inference (variant: 'destructive' → error);
//   * every tone/icon map entry names a REAL Tailwind token. Tailwind drops
//     an unknown class silently, so a typo here is invisible until someone
//     photographs the screen.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KIND_ICON,
  KIND_ICON_CLASSES,
  STATUS_PILL_BASE,
  STATUS_TONE_CLASSES,
  SWAP_GLYPH,
  TOAST_MOTION_CLASSES,
  TOAST_SWIPE_CLASSES,
  isStatusCardKind,
  prefersReducedMotion,
  relativeTime,
  resolveKind,
} from '../notificationKind';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

describe('relativeTime', () => {
  it('is "now" for anything inside the first minute', () => {
    expect(relativeTime(NOW, NOW)).toBe('now');
    expect(relativeTime(NOW - 1, NOW)).toBe('now');
    expect(relativeTime(NOW - (MINUTE - 1), NOW)).toBe('now');
  });

  it('a FUTURE timestamp is "now", not a negative age', () => {
    // A server clock a few seconds ahead of the phone is routine; "-1m" on a
    // notification that just landed reads as a bug to the user.
    expect(relativeTime(NOW + 5_000, NOW)).toBe('now');
    expect(relativeTime(NOW + DAY, NOW)).toBe('now');
  });

  it('minutes from the 60s boundary to the hour, floored', () => {
    expect(relativeTime(NOW - MINUTE, NOW)).toBe('1m');
    // 119s is "1m" ago, not "2m" — floor, not round.
    expect(relativeTime(NOW - (2 * MINUTE - 1), NOW)).toBe('1m');
    expect(relativeTime(NOW - 2 * MINUTE, NOW)).toBe('2m');
    expect(relativeTime(NOW - (HOUR - 1), NOW)).toBe('59m');
  });

  it('hours from the 60m boundary to the day', () => {
    expect(relativeTime(NOW - HOUR, NOW)).toBe('1h');
    expect(relativeTime(NOW - (DAY - 1), NOW)).toBe('23h');
  });

  it('days beyond that', () => {
    expect(relativeTime(NOW - DAY, NOW)).toBe('1d');
    expect(relativeTime(NOW - 9 * DAY, NOW)).toBe('9d');
  });

  it('degrades to "now" rather than "NaNm" on a non-finite input', () => {
    expect(relativeTime(Number.NaN, NOW)).toBe('now');
    expect(relativeTime(Number.POSITIVE_INFINITY, NOW)).toBe('now');
    expect(relativeTime(Number.NEGATIVE_INFINITY, NOW)).toBe('now');
  });

  it('defaults `now` to the wall clock', () => {
    expect(relativeTime(Date.now())).toBe('now');
    expect(relativeTime(Date.now() - 3 * MINUTE)).toBe('3m');
  });
});

describe('resolveKind', () => {
  it('defaults to info — this is what keeps the existing call sites intact', () => {
    expect(resolveKind(undefined)).toBe('info');
    expect(resolveKind(undefined, null)).toBe('info');
    expect(resolveKind(undefined, 'default')).toBe('info');
  });

  it('reads variant: "destructive" as an error rather than throwing the signal away', () => {
    expect(resolveKind(undefined, 'destructive')).toBe('error');
  });

  it('an explicit kind always wins over the inferred one', () => {
    expect(resolveKind('player', 'destructive')).toBe('player');
    expect(resolveKind('success', 'destructive')).toBe('success');
    expect(resolveKind('move')).toBe('move');
  });
});

describe('isStatusCardKind', () => {
  it('is true for exactly the two card kinds', () => {
    expect(isStatusCardKind('player')).toBe(true);
    expect(isStatusCardKind('move')).toBe(true);
    for (const k of ['success', 'info', 'warning', 'error'] as const) {
      expect(isStatusCardKind(k)).toBe(false);
    }
  });
});

describe('the glyph and the icon table', () => {
  it('reuses the roster chip glyph exactly, not a lookalike', () => {
    // MobileRosterList's position chip teaches the user what this means.
    const list = readFileSync(
      resolve(fileURLToPath(import.meta.url), '../../../roster/MobileRosterList.tsx'),
      'utf8',
    );
    expect(SWAP_GLYPH).toBe('⇄');
    expect(list).toContain(SWAP_GLYPH);
  });

  it('names a distinct lucide icon for each generic kind', () => {
    const names = (['success', 'info', 'warning', 'error'] as const).map(
      (k) => KIND_ICON[k].displayName ?? KIND_ICON[k].name,
    );
    expect(new Set(names).size).toBe(4);
    expect(names.every(Boolean)).toBe(true);
  });
});

describe('colour tokens', () => {
  const TAILWIND = readFileSync(
    resolve(fileURLToPath(import.meta.url), '../../../../../tailwind.config.ts'),
    'utf8',
  );

  /** `text-fantasy-grapefruit-red` → the config must define grapefruit-red. */
  const definesToken = (cls: string) => {
    const leaf = cls.replace(/^(?:bg|text)-/, '').split('/')[0];
    // Longest match first so 'orange-deep' is not satisfied by 'orange'.
    const parts = leaf.split('-');
    for (let i = 1; i < parts.length; i += 1) {
      const key = parts.slice(i).join('-');
      if (new RegExp(`['"]?${key}['"]?\\s*:`).test(TAILWIND)) return true;
    }
    return false;
  };

  it('every tone pill class resolves to a real token (Tailwind drops the rest silently)', () => {
    const classes = Object.values(STATUS_TONE_CLASSES).flatMap((c) => c.split(/\s+/));
    expect(classes.length).toBeGreaterThan(0);
    for (const c of classes) {
      expect(definesToken(c), `${c} is not a token in tailwind.config.ts`).toBe(true);
    }
  });

  it('every icon tint resolves to a real token', () => {
    for (const c of Object.values(KIND_ICON_CLASSES)) {
      expect(definesToken(c), `${c} is not a token in tailwind.config.ts`).toBe(true);
    }
  });

  it('the pill base carries geometry only — the tone map owns the text colour', () => {
    // Same rule as positionChip.ts: a background and the text that survives
    // on it are one decision, so the base may not set a colour of its own.
    expect(STATUS_PILL_BASE).not.toMatch(/\btext-(?!\[)/);
    for (const tone of ['good', 'attention', 'bad'] as const) {
      expect(STATUS_TONE_CLASSES[tone]).toMatch(/\bbg-/);
      expect(STATUS_TONE_CLASSES[tone]).toMatch(/\btext-/);
    }
  });

  it('no muted text below the /50 the contrast guard allows', () => {
    const all = [STATUS_PILL_BASE, ...Object.values(STATUS_TONE_CLASSES), ...Object.values(KIND_ICON_CLASSES)];
    for (const m of all.join(' ').matchAll(/text-white\/(\d{1,3})/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(50);
    }
  });
});

describe('motion class strings', () => {
  it('the swipe translates are on the Y axis, matching swipeDirection="up"', () => {
    // The shadcn scaffold wires X. Against an upward swipe those classes drag
    // the card sideways while it dismisses upward.
    expect(TOAST_SWIPE_CLASSES).toContain('--radix-toast-swipe-move-y');
    expect(TOAST_SWIPE_CLASSES).toContain('--radix-toast-swipe-end-y');
    expect(TOAST_SWIPE_CLASSES).not.toContain('-x)');
    expect(TOAST_SWIPE_CLASSES).not.toContain('translate-x');
  });

  it('the enter/exit set is separable from the swipe set, so reduced motion can drop just it', () => {
    expect(TOAST_MOTION_CLASSES).toContain('animate-in');
    expect(TOAST_MOTION_CLASSES).toContain('animate-out');
    expect(TOAST_SWIPE_CLASSES).not.toContain('animate-');
  });
});

describe('prefersReducedMotion', () => {
  it('is false when the environment has no matchMedia (jsdom default)', () => {
    expect(typeof window.matchMedia).toBe('undefined');
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is false, not a crash, when matchMedia throws on an unsupported query', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('unsupported');
      },
    });
    expect(prefersReducedMotion()).toBe(false);
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });
});
