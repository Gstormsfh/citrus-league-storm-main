// CitrusToaster (2026-09-02) — the Sleeper-parity status card that replaces
// the shadcn toast scaffold.
//
// The single most important test in this file is
// "the OLD calling convention still renders": 292 `toast({ title,
// description })` call sites across 35 files were written against the
// scaffold and none of them were touched. If `kind` ever stops defaulting to
// 'info', that test is what says so.
//
// jsdom has no layout and no cascade, so everything here is a DOM/class
// contract: which element the kind draws, which token it wears, what a
// screen reader can name. Geometry is asserted as classes, not pixels.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { CitrusToaster } from '../CitrusToaster';
import { toast } from '@/hooks/use-toast';
import { teamCrestUrl } from '@/components/roster/headshot';
import { KIND_ICON_CLASSES, STATUS_TONE_CLASSES } from '../notificationKind';

const MCDAVID = {
  name: 'Connor McDavid',
  image: 'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png',
  team: 'EDM',
  teamAbbreviation: 'EDM',
};

type ToastArgs = Parameters<typeof toast>[0];

/**
 * Mount the toaster, then push one toast through the real store.
 *
 * Through `toast()` on purpose rather than by rendering a card directly: the
 * hook's reducer, its TOAST_LIMIT of 1 and its auto-dismiss are the machinery
 * the call sites actually use, and a card test that bypasses them would not
 * notice the payload being dropped on the way in.
 */
let open: { dismiss: () => void } | null = null;

function show(props: ToastArgs) {
  render(<CitrusToaster />);
  act(() => {
    open = toast(props);
  });
  return screen.getByTestId('citrus-toast');
}

// The store is a module singleton that outlives a test file's renders.
// TOAST_LIMIT is 1 so the next `toast()` would replace a leftover anyway,
// but closing it keeps each test's DOM its own.
afterEach(() => {
  act(() => {
    open?.dismiss();
  });
  open = null;
});

describe('CitrusToaster — the call sites that already exist', () => {
  it('the OLD calling convention still renders: title, description, no crash', () => {
    const card = show({ title: 'Lineup Optimized', description: '3 changes saved' });
    expect(screen.getByText('Lineup Optimized')).toBeInTheDocument();
    expect(screen.getByText('3 changes saved')).toBeInTheDocument();
    // No `kind` means 'info' — the default that makes this true for all 292.
    expect(card.getAttribute('data-kind')).toBe('info');
  });

  it('a title with no description renders on its own', () => {
    show({ title: 'Saved' });
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('a description with no title renders on its own', () => {
    show({ description: 'Roster unchanged' });
    expect(screen.getByText('Roster unchanged')).toBeInTheDocument();
  });

  it('variant: "destructive" still renders, and reads as an error', () => {
    // 166 existing call sites pass this. It is the only failure signal the
    // scaffold could express, so it is mapped rather than discarded.
    const card = show({
      title: 'Swap Failed',
      description: 'Failed to complete swap. Your roster is unchanged.',
      variant: 'destructive',
    });
    expect(screen.getByText('Swap Failed')).toBeInTheDocument();
    expect(screen.getByText('Failed to complete swap. Your roster is unchanged.')).toBeInTheDocument();
    expect(card.getAttribute('data-kind')).toBe('error');
    expect(screen.getByTestId('citrus-toast-icon').getAttribute('class')).toContain('lucide-circle-alert');
    // The tile stays glass; only the rim carries the failure.
    expect(card.className).toContain('bg-pastel-surface-tile/95');
    expect(card.className).toContain('border-fantasy-grapefruit-red/40');
  });

  it('`variant` is consumed here, not leaked onto the DOM node', () => {
    // Radix's Root spreads unknown props onto the <li>; `variant` reaching it
    // is a React "unrecognized prop" warning on 166 call sites.
    const card = show({ title: 'Swap Failed', variant: 'destructive' });
    expect(card.hasAttribute('variant')).toBe(false);
  });

  it('an explicit kind beats the destructive inference', () => {
    const card = show({ title: 'Dropped', variant: 'destructive', kind: 'success' });
    expect(card.getAttribute('data-kind')).toBe('success');
  });
});

describe('CitrusToaster — kind: player', () => {
  it('draws the shared Mug, the name, the meta line, the pill, the time and the mark', () => {
    const card = show({
      kind: 'player',
      title: 'Connor McDavid',
      meta: 'C · EDM · Goal + 2 assists',
      status: { label: 'Final', tone: 'good' },
      at: Date.now(),
      player: MCDAVID,
    });
    expect(card.getAttribute('data-kind')).toBe('player');

    // The mug is the shared component, not a private <img>: alt is the
    // player's name and the crest badge rides on its shoulder.
    const mug = screen.getByAltText('Connor McDavid') as HTMLImageElement;
    expect(mug.getAttribute('src')).toBe(MCDAVID.image);
    expect(screen.getByTestId('mug-crest-badge').getAttribute('src')).toBe(teamCrestUrl('EDM'));

    expect(screen.getByText('Connor McDavid')).toBeInTheDocument();
    expect(screen.getByText('C · EDM · Goal + 2 assists')).toBeInTheDocument();
    expect(screen.getByTestId('citrus-toast-status')).toHaveTextContent('Final');
    expect(screen.getByTestId('citrus-toast-time')).toHaveTextContent('now');
    expect(screen.getByTestId('citrus-toast-mark')).toHaveTextContent('Citrus');
  });

  it('falls back to the player name when the call site passes only the player', () => {
    show({ kind: 'player', player: MCDAVID, meta: 'C · EDM' });
    // The name appears twice — the mug's alt text and the headline — so this
    // asserts the headline element specifically.
    expect(screen.getByText('Connor McDavid', { selector: 'div' })).toBeInTheDocument();
  });

  it('renders a relative age from `at`', () => {
    show({ kind: 'player', title: 'Connor McDavid', player: MCDAVID, at: Date.now() - 2 * 60_000 });
    expect(screen.getByTestId('citrus-toast-time')).toHaveTextContent('2m');
  });

  it('stamps its own arrival when the call site forgets `at`', () => {
    // A status card without a timestamp is not the Sleeper shape; the honest
    // value is the moment the card appeared.
    show({ kind: 'player', title: 'Connor McDavid', player: MCDAVID });
    expect(screen.getByTestId('citrus-toast-time')).toHaveTextContent('now');
  });

  it('`meta` wins over `description` — a status card has room for one line', () => {
    show({ kind: 'player', title: 'Connor McDavid', player: MCDAVID, meta: 'C · EDM', description: 'ignored' });
    expect(screen.getByText('C · EDM')).toBeInTheDocument();
    expect(screen.queryByText('ignored')).toBeNull();
  });

  it('falls back to `description` when there is no `meta`', () => {
    show({ kind: 'player', title: 'Connor McDavid', player: MCDAVID, description: 'Added from waivers' });
    expect(screen.getByText('Added from waivers')).toBeInTheDocument();
  });

  it.each([
    ['good', 'Final'],
    ['attention', 'Action needed'],
    ['bad', 'Claim lost'],
  ] as const)('the %s pill wears its own background AND the text that survives on it', (tone, label) => {
    show({ kind: 'player', title: 'Connor McDavid', player: MCDAVID, status: { label, tone } });
    const pill = screen.getByTestId('citrus-toast-status');
    expect(pill.getAttribute('data-tone')).toBe(tone);
    for (const cls of STATUS_TONE_CLASSES[tone].split(' ')) {
      expect(pill.className).toContain(cls);
    }
  });
});

describe('CitrusToaster — kind: move', () => {
  it('puts the roster swap glyph where the mug goes, and keeps the card structure', () => {
    const card = show({
      kind: 'move',
      title: 'Makar → D',
      meta: 'Bench · Cale Makar started',
      at: Date.now() - 60 * 60_000,
    });
    expect(card.getAttribute('data-kind')).toBe('move');
    const glyph = screen.getByTestId('citrus-toast-swap');
    // The exact character the roster chip uses, not a lookalike arrow.
    expect(glyph).toHaveTextContent('⇄');
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    // Same 36px box as Mug size="sm", so a move card and a player card line
    // their text up on the same x.
    expect(glyph.className).toContain('h-9');
    expect(glyph.className).toContain('w-9');

    expect(screen.getByText('Makar → D')).toBeInTheDocument();
    expect(screen.getByText('Bench · Cale Makar started')).toBeInTheDocument();
    expect(screen.getByTestId('citrus-toast-time')).toHaveTextContent('1h');
    // The Citrus mark rides on `move` too, not just `player`: both kinds land
    // in the same stream and a footer that appears on one card and not the
    // next reads as a rendering bug. Deliberate; pinned so it stays that way.
    expect(screen.getByTestId('citrus-toast-mark')).toHaveTextContent('Citrus');
  });

  it('draws no mug and no generic icon', () => {
    const { container } = render(<CitrusToaster />);
    act(() => {
      toast({ kind: 'move', title: 'Makar → D' });
    });
    expect(container.querySelector('[data-mug-state]')).toBeNull();
    expect(screen.queryByTestId('citrus-toast-icon')).toBeNull();
  });
});

describe('CitrusToaster — the four generic kinds', () => {
  it.each([
    ['success', 'lucide-circle-check-big'],
    ['info', 'lucide-info'],
    ['warning', 'lucide-triangle-alert'],
    ['error', 'lucide-circle-alert'],
  ] as const)('%s draws its own icon, tinted by kind', (kind, lucideClass) => {
    const card = show({ kind, title: 'Heads up', description: 'Something happened' });
    expect(card.getAttribute('data-kind')).toBe(kind);
    const icon = screen.getByTestId('citrus-toast-icon');
    expect(icon.getAttribute('class')).toContain(lucideClass);
    expect(icon.getAttribute('class')).toContain(KIND_ICON_CLASSES[kind]);
    expect(icon.getAttribute('data-kind')).toBe(kind);
    // A generic notice has no face and no swap rail.
    expect(screen.queryByTestId('citrus-toast-swap')).toBeNull();
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Something happened')).toBeInTheDocument();
  });

  it('the four icons are actually four different icons', () => {
    const seen = new Set<string>();
    for (const kind of ['success', 'info', 'warning', 'error'] as const) {
      const { unmount } = render(<CitrusToaster />);
      act(() => {
        toast({ kind, title: kind });
      });
      seen.add(screen.getByTestId('citrus-toast-icon').getAttribute('class') ?? '');
      unmount();
    }
    expect(seen.size).toBe(4);
  });
});

describe('CitrusToaster — surface and placement', () => {
  it('the card is the glass tile, never a mid-grey white wash', () => {
    // bg-white/40..84 composites to a mid-grey on #0F1F15 where neither
    // cream nor dark text reaches 4.5:1 — darkThemeContrastGuard pins the
    // whole range and this card must not be the file that reintroduces it.
    const card = show({ title: 'x' });
    expect(card.className).toContain('bg-pastel-surface-tile/95');
    expect(card.className).toContain('backdrop-blur');
    expect(card.className).toContain('border-white/10');
    expect(card.className).not.toMatch(/\b(?:bg|from|via|to)-white\/(?:[4-7]\d|8[0-4])\b/);
  });

  it('the viewport is pinned to the TOP, above the page chrome and the sheets', () => {
    render(<CitrusToaster />);
    const vp = screen.getByTestId('citrus-toast-viewport');
    expect(vp.className).toContain('fixed');
    expect(vp.className).toContain('top-0');
    expect(vp.className).toContain('inset-x-0');
    expect(vp.className).toContain('w-full');
    // Page sticky headers are z-40; the roster sheets that fire the `move`
    // toasts are z-[9999]. A notification behind the sheet that produced it
    // is not a notification.
    expect(vp.className).toContain('z-[10000]');
    // The notch. `pt-safe` alone is a bare padding-top: env(...) that
    // resolves to 0 on a non-notch phone and would beat the container pad.
    expect(vp.className).toContain('pt-[calc(env(safe-area-inset-top)+0.5rem)]');
    // sm: and up it narrows and centres — top-right is already Sonner's.
    expect(vp.className).toContain('sm:w-[420px]');
    expect(vp.className).toContain('sm:left-1/2');
    expect(vp.className).not.toContain('sm:bottom-0');
  });

  it('the swipe translates are on Y, matching swipeDirection="up"', () => {
    const card = show({ title: 'x' });
    expect(card.className).toContain('data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)]');
    expect(card.className).toContain('data-[swipe=end]:translate-y-[var(--radix-toast-swipe-end-y)]');
    expect(card.className).not.toContain('translate-x-[var(--radix-toast-swipe-move-x)]');
  });
});

describe('CitrusToaster — accessibility', () => {
  it('is a Radix Root li inside the viewport ol, wired for an upward swipe', () => {
    // Radix owns the announcement (a visually-hidden role="status" region it
    // portals to the body a frame later); what this file can pin
    // deterministically is that the Root is intact and that the provider's
    // swipeDirection reached it.
    const card = show({ title: 'Lineup Optimized', description: '3 changes saved' });
    expect(card.tagName).toBe('LI');
    expect(card.getAttribute('data-state')).toBe('open');
    expect(card.getAttribute('data-swipe-direction')).toBe('up');
    expect(card.parentElement?.tagName).toBe('OL');
    expect(card.parentElement?.getAttribute('data-testid')).toBe('citrus-toast-viewport');
  });

  it('title and description stay Radix Title/Description elements, not bare text', () => {
    // These are what getAnnounceTextContent reads to build the live region.
    const card = show({ title: 'Lineup Optimized', description: '3 changes saved' });
    const title = screen.getByText('Lineup Optimized');
    const description = screen.getByText('3 changes saved');
    expect(title.tagName).toBe('DIV');
    expect(description.tagName).toBe('DIV');
    expect(card.contains(title)).toBe(true);
    expect(card.contains(description)).toBe(true);
  });

  it('the close control has an accessible name and is not hover-only', () => {
    // The scaffold's close was an unlabelled icon that faded in on
    // group-hover — unreachable by touch, unnameable by a screen reader.
    const card = show({ title: 'Lineup Optimized' });
    const close = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(card.contains(close)).toBe(true);
    expect(close.className).not.toContain('opacity-0');
  });

  it('the decorative glyph and the kind icon are hidden from assistive tech', () => {
    show({ kind: 'move', title: 'Makar → D' });
    expect(screen.getByTestId('citrus-toast-swap').getAttribute('aria-hidden')).toBe('true');
    act(() => {
      toast({ kind: 'warning', title: 'Heads up' });
    });
    expect(screen.getByTestId('citrus-toast-icon').getAttribute('aria-hidden')).toBe('true');
  });
});
