// Entry 25 U1 — Skeleton primitives render tests.
//
// Guards the shapes citrus2 skeleton primitives promise:
//   - Structural content matches what real pages will slot in
//   - Screen-reader "Loading…" text is present for a11y
//   - The decorative shimmer surface itself is aria-hidden
//   - prefers-reduced-motion honored via the global CSS override
//     (index.css:1773 — asserted here only that we use an animate-*
//     class, since the override targets all *animation-duration*).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SkeletonBlock,
  SkeletonCard,
  SkeletonRow,
  SkeletonStatTile,
} from '../Skeletons';

describe('SkeletonBlock', () => {
  it('renders with shimmer classes and aria-hidden by default', () => {
    const { container } = render(<SkeletonBlock className="h-4 w-40" />);
    const el = container.querySelector('[data-testid="skeleton-block"]');
    expect(el).toBeTruthy();
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    expect(el?.className).toMatch(/animate-citrus-shimmer/);
    expect(el?.className).toMatch(/h-4 w-40/);
  });

  it('drops aria-hidden when ariaHidden=false', () => {
    const { container } = render(<SkeletonBlock ariaHidden={false} />);
    const el = container.querySelector('[data-testid="skeleton-block"]');
    expect(el?.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('SkeletonCard', () => {
  it('renders the citrus2 card surface with title + N body lines + footer', () => {
    render(<SkeletonCard lines={4} />);
    const card = screen.getByTestId('skeleton-card');
    expect(card).toBeTruthy();
    expect(card.getAttribute('role')).toBe('status');
    expect(card.getAttribute('aria-label')).toBe('Loading content');
    expect(card.className).toMatch(/bg-\[#1A2A20\]/);
    // Header eyebrow + title + 4 body lines + footer accent = 7 shimmer blocks
    const blocks = card.querySelectorAll('[data-testid="skeleton-block"]');
    expect(blocks.length).toBe(1 + 1 + 4 + 1);
    // sr-only "Loading…" hidden text for screen readers
    expect(card.querySelector('.sr-only')?.textContent).toBe('Loading…');
  });

  it('omits the footer accent when showFooter=false', () => {
    render(<SkeletonCard lines={2} showFooter={false} />);
    const card = screen.getByTestId('skeleton-card');
    const blocks = card.querySelectorAll('[data-testid="skeleton-block"]');
    // Header eyebrow + title + 2 body lines = 4 (no footer)
    expect(blocks.length).toBe(1 + 1 + 2);
  });
});

describe('SkeletonRow', () => {
  it('renders avatar + name/label pair + value column by default', () => {
    render(<SkeletonRow />);
    const row = screen.getByTestId('skeleton-row');
    expect(row).toBeTruthy();
    expect(row.getAttribute('role')).toBe('status');
    expect(row.getAttribute('aria-label')).toBe('Loading row');
    // avatar (1) + name (1) + secondary (1) + value (1) = 4 shimmer blocks
    const blocks = row.querySelectorAll('[data-testid="skeleton-block"]');
    expect(blocks.length).toBe(4);
    expect(row.querySelector('.sr-only')?.textContent).toBe('Loading…');
  });

  it('omits the avatar when showAvatar=false', () => {
    render(<SkeletonRow showAvatar={false} />);
    const row = screen.getByTestId('skeleton-row');
    const blocks = row.querySelectorAll('[data-testid="skeleton-block"]');
    // name (1) + secondary (1) + value (1) = 3 shimmer blocks (no avatar)
    expect(blocks.length).toBe(3);
  });
});

describe('SkeletonStatTile', () => {
  it('renders the KPI shape (label + big number + trend)', () => {
    render(<SkeletonStatTile />);
    const tile = screen.getByTestId('skeleton-stat-tile');
    expect(tile).toBeTruthy();
    expect(tile.getAttribute('role')).toBe('status');
    expect(tile.getAttribute('aria-label')).toBe('Loading stat');
    expect(tile.className).toMatch(/bg-\[#1A2A20\]/);
    // label + big number + trend = 3 shimmer blocks
    const blocks = tile.querySelectorAll('[data-testid="skeleton-block"]');
    expect(blocks.length).toBe(3);
    expect(tile.querySelector('.sr-only')?.textContent).toBe('Loading…');
  });
});
