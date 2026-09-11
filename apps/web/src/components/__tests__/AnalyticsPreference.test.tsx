import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AnalyticsPreference } from '@/components/AnalyticsPreference';

/**
 * THE ANALYTICS CONTROL SURFACE, WHICH IS NOW THE ONLY ONE ON iOS.
 *
 * App Store 5.1.2(i) took the cookie banner out of the native build
 * (see `__tests__/appTrackingTransparencyGuard.test.ts`), so this toggle is
 * where an iOS user learns what is collected, and the only place they can
 * change it. Two things therefore have to hold: the disclosure is on screen
 * without a tap, and the toggle still writes the consent the rest of the app
 * reads.
 */
describe('the analytics preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the disclosure without anyone having to tap for it', () => {
    render(<AnalyticsPreference />);
    const disclosure = screen.getByText(/Citrus collects anonymous usage data/);
    expect(disclosure).toBeTruthy();
    expect(disclosure.textContent).toContain('first-party analytics');
    expect(disclosure.textContent).toContain('nothing is shared with advertisers or data brokers');
    expect(disclosure.textContent).toContain('never linked to data from other apps');
    expect(disclosure.textContent).toContain('off unless you turn it on here');
  });

  it('is off when the user has never chosen', () => {
    render(<AnalyticsPreference />);
    expect(screen.getByRole('checkbox', { name: 'Optional usage analytics' })).not.toBeChecked();
  });

  it('writes the consent the rest of the app reads, both ways', () => {
    render(<AnalyticsPreference />);
    const toggle = screen.getByRole('checkbox', { name: 'Optional usage analytics' });

    fireEvent.click(toggle);
    expect(localStorage.getItem('citrus_analytics_consent')).toBe('granted');
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    // 'denied', not absent: a withdrawn consent is a choice on record, and
    // the web banner keys its own visibility off having one.
    expect(localStorage.getItem('citrus_analytics_consent')).toBe('denied');
    expect(toggle).not.toBeChecked();
  });

  it('reflects a consent granted before it mounted', () => {
    localStorage.setItem('citrus_analytics_consent', 'granted');
    render(<AnalyticsPreference />);
    expect(screen.getByRole('checkbox', { name: 'Optional usage analytics' })).toBeChecked();
  });
});
