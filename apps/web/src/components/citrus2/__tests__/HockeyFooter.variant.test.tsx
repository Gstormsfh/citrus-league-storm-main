// APP vs MARKETING FOOTER (2026-08-27)
//
// Every in-app page ended with the marketing footer: an elevator pitch and a
// "Create a league" CTA, shown to someone already standing inside their
// league. Selling to the already-sold is the "this section is a different
// app" failure — it reads as template leakage at exactly the moment a manager
// is making a decision.
//
// What this pins is the SPLIT, not the styling. The failure mode is a
// refactor that drops the variant check and silently restores the pitch to
// twenty in-app pages — invisible in CI, and invisible in review unless
// someone scrolls to the bottom of a page they weren't changing.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HockeyFooter } from '../HockeyFooter';

const renderFooter = (props: React.ComponentProps<typeof HockeyFooter> = {}) => {
  const { container } = render(
    <MemoryRouter>
      <HockeyFooter {...props} />
    </MemoryRouter>,
  );
  return within(container.querySelector('footer')!);
};

/** The CTA button, distinguished from the "Create a League" nav link in the
 *  Play column — both point at /create-league, only one is the pitch. */
const ctaButton = (f: ReturnType<typeof renderFooter>) =>
  f.queryAllByRole('link', { name: /create a league/i })
    .find((a) => /bg-pastel-orange/.test(a.className)) ?? null;

describe('HockeyFooter — the app variant drops the pitch', () => {
  it('marketing keeps the CTA and the elevator pitch', () => {
    const f = renderFooter();
    expect(ctaButton(f)).not.toBeNull();
    expect(f.getByText(/31-feature xG model/i)).toBeTruthy();
  });

  it('app drops both', () => {
    const f = renderFooter({ variant: 'app' });
    expect(ctaButton(f)).toBeNull();
    expect(f.queryByText(/31-feature xG model/i)).toBeNull();
  });

  it('marketing is the default, so a public page cannot lose its pitch by omission', () => {
    const f = renderFooter();
    expect(f.getByText(/31-feature xG model/i)).toBeTruthy();
  });
});

describe('HockeyFooter — the app variant keeps what in-app users navigate with', () => {
  it('keeps every link column', () => {
    const f = renderFooter({ variant: 'app' });
    // One representative link per column. Asserting the column HEADINGS is
    // ambiguous — "Citrus" is also the wordmark — and pinning contents is the
    // stronger contract anyway: a column that renders its title and no links
    // would pass a heading check and still be broken.
    for (const label of ['Daily Pickem', 'Trade Analyzer', 'About']) {
      expect(f.getByRole('link', { name: label })).toBeTruthy();
    }
    // The Play column's own "Create a League" LINK survives — it is
    // navigation, not a pitch. Dropping it would be over-correcting.
    expect(f.getByRole('link', { name: 'Create a League' })).toBeTruthy();
  });

  it('keeps the squad row and the legal row', () => {
    const f = renderFooter({ variant: 'app' });
    expect(f.getByText(/The Squad/i)).toBeTruthy();
    expect(f.getByText(/Privacy/i)).toBeTruthy();
    expect(f.getByText(/Terms/i)).toBeTruthy();
  });

  it('renders no dead links in either variant', () => {
    // 2026-08-18 found four `href="#"` social buttons on the public homepage.
    // Whatever the variant, a footer link goes somewhere real.
    for (const variant of ['marketing', 'app'] as const) {
      const f = renderFooter({ variant });
      for (const a of f.queryAllByRole('link')) {
        expect(a.getAttribute('href')).toBeTruthy();
        expect(a.getAttribute('href')).not.toBe('#');
      }
    }
  });
});
