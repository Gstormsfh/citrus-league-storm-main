/**
 * Yahoo's attribution is a condition of the API agreement: the exact words,
 * as a link to an official Yahoo Fantasy page, opened outside the app.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const ext = vi.hoisted(() => ({ interceptExternal: vi.fn(() => false) }));
vi.mock('@/lib/openExternal', () => ext);

import { YahooAttribution, YAHOO_ATTRIBUTION, YAHOO_FANTASY_URL } from '../YahooAttribution';

describe('YahooAttribution', () => {
  it('says exactly what the agreement asks, as a link to Yahoo Fantasy in a new tab', () => {
    render(<YahooAttribution />);
    const p = screen.getByTestId('yahoo-attribution');
    expect(p.textContent).toBe(YAHOO_ATTRIBUTION);
    const a = screen.getByRole('link', { name: 'Yahoo Fantasy' });
    expect(a).toHaveAttribute('href', YAHOO_FANTASY_URL);
    expect(YAHOO_FANTASY_URL).toMatch(/^https:\/\/sports\.yahoo\.com\/fantasy/);
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('inside the native shell the link is handed to the system browser instead of navigating the app', () => {
    ext.interceptExternal.mockReturnValueOnce(true);
    render(<YahooAttribution />);
    const a = screen.getByRole('link', { name: 'Yahoo Fantasy' });
    const event = fireEvent.click(a);
    expect(ext.interceptExternal).toHaveBeenCalledWith(YAHOO_FANTASY_URL);
    expect(event).toBe(false); // default prevented
  });
});
