// T13 architect Entry 13 (2026-08-09) — completion-moment polish
// offline render tests.
//
// Contract locked here:
//   1. Banner renders on completed-draft state (existing DR-4
//      data-testid preserved).
//   2. Art slot present with stable data-completion-art-slot marker
//      + alt="" (decorative — no accessibility burden on screen
//      readers, headline conveys the moment).
//   3. Controls-disabled contract emitted so E2E can assert the
//      commissioner/pick controls are gone at completion.
//   4. Top-pick line renders when both name fields provided; falls
//      back to "Rosters are set" otherwise.
//   5. prefers-reduced-motion mode skips the animation.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CompletionMomentBanner } from '../CompletionMomentBanner';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CompletionMomentBanner — DR-4 data-testid + art slot', () => {
  it('renders with data-testid="completed-draft-banner" (DR-4 contract preserved)', () => {
    render(<CompletionMomentBanner totalPicks={192} skipAnimationForTests />);
    const banner = screen.getByTestId('completed-draft-banner');
    expect(banner).toBeInTheDocument();
  });

  it('emits data-completion-controls-disabled="true" (parent removes controls at completion)', () => {
    render(<CompletionMomentBanner totalPicks={192} skipAnimationForTests />);
    const banner = screen.getByTestId('completed-draft-banner');
    expect(banner.getAttribute('data-completion-controls-disabled')).toBe('true');
  });

  it('renders art slot with stable data-completion-art-slot marker + decorative alt=""', () => {
    render(<CompletionMomentBanner totalPicks={192} skipAnimationForTests />);
    const banner = screen.getByTestId('completed-draft-banner');
    const img = banner.querySelector('img[data-completion-art-slot="scene-cup"]');
    expect(img).not.toBeNull();
    // Decorative — should carry alt="" so screen readers skip; the
    // headline text conveys the moment.
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('CompletionMomentBanner — headline (top-pick vs fallback)', () => {
  it('shows top-pick line when both team + player provided', () => {
    render(
      <CompletionMomentBanner
        totalPicks={192}
        topPickTeamName="The Ironmen"
        topPickPlayerName="Connor McDavid"
        skipAnimationForTests
      />,
    );
    expect(screen.getByText('The Ironmen took Connor McDavid #1 overall')).toBeInTheDocument();
  });

  it('falls back to "Rosters are set" when only team is provided', () => {
    render(
      <CompletionMomentBanner
        totalPicks={192}
        topPickTeamName="The Ironmen"
        topPickPlayerName={null}
        skipAnimationForTests
      />,
    );
    expect(screen.getByText('Rosters are set')).toBeInTheDocument();
  });

  it('falls back to "Rosters are set" when neither name provided', () => {
    render(<CompletionMomentBanner totalPicks={192} skipAnimationForTests />);
    expect(screen.getByText('Rosters are set')).toBeInTheDocument();
  });

  it('includes total-picks count in the sub-copy', () => {
    render(<CompletionMomentBanner totalPicks={144} skipAnimationForTests />);
    expect(screen.getByText(/All 144 picks are in/)).toBeInTheDocument();
  });
});

describe('CompletionMomentBanner — roster CTA (T11a link discipline)', () => {
  it('renders roster CTA with default href="/roster" (App.tsx:184)', () => {
    render(<CompletionMomentBanner totalPicks={192} skipAnimationForTests />);
    const cta = screen.getByTestId('completion-roster-cta');
    expect(cta.getAttribute('href')).toBe('/roster');
    expect(cta.textContent).toContain('View your roster');
  });

  it('accepts custom rosterHref (parent may pass league-scoped variant)', () => {
    render(
      <CompletionMomentBanner
        totalPicks={192}
        rosterHref="/roster?league=abc"
        skipAnimationForTests
      />,
    );
    const cta = screen.getByTestId('completion-roster-cta');
    expect(cta.getAttribute('href')).toBe('/roster?league=abc');
  });
});

describe('CompletionMomentBanner — prefers-reduced-motion', () => {
  it('renders in already-shown state when prefers-reduced-motion is set (no animation)', () => {
    // Mock matchMedia to signal reduced motion.
    const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = matchMediaMock;
    render(<CompletionMomentBanner totalPicks={192} />);
    const banner = screen.getByTestId('completed-draft-banner');
    // In reduced-motion mode `shown` initializes true → opacity-100.
    expect(banner.className).toContain('opacity-100');
    // Confirm matchMedia was consulted with the reduced-motion query.
    expect(matchMediaMock).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('accepts skipAnimationForTests to bypass animation without a matchMedia mock', () => {
    render(<CompletionMomentBanner totalPicks={192} skipAnimationForTests />);
    const banner = screen.getByTestId('completed-draft-banner');
    expect(banner.className).toContain('opacity-100');
  });
});

describe('CompletionMomentBanner — a11y', () => {
  it('sets role="status" + aria-live="polite" so screen readers announce arrival', () => {
    render(<CompletionMomentBanner totalPicks={192} skipAnimationForTests />);
    const banner = screen.getByTestId('completed-draft-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });
});
