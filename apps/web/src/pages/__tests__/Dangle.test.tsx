import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dangle, { DANGLE_SOURCE } from '../Dangle';
import { clearAcquisition, readAcquisition } from '@/lib/acquisition';

vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/citrus2', () => ({
  DarkLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  HockeyFooter: () => null,
  MascotAvatar: () => null,
}));
const logEvent = vi.fn();
vi.mock('@/services/AnalyticsService', () => ({ analyticsService: { logEvent: (...a: unknown[]) => logEvent(...a) } }));

describe('/dangle', () => {
  beforeEach(() => {
    clearAcquisition();
    logEvent.mockClear();
  });

  it('attributes the visit to the podcast and logs the landing', () => {
    render(<MemoryRouter><Dangle /></MemoryRouter>);
    expect(readAcquisition()).toMatchObject({ source: DANGLE_SOURCE, medium: 'podcast', landing: '/dangle' });
    expect(logEvent).toHaveBeenCalledWith('campaign_landing', { campaign: DANGLE_SOURCE });
  });

  it('offers the three doors and carries the source on the lead-gen ones', () => {
    render(<MemoryRouter><Dangle /></MemoryRouter>);
    expect(screen.getAllByTestId('dangle-door')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /create a league/i })).toHaveAttribute('href', '/create-league');
    expect(screen.getByRole('link', { name: /make my picks/i })).toHaveAttribute('href', `/opening-night?ref=${DANGLE_SOURCE}`);
    expect(screen.getByRole('link', { name: /move my league/i })).toHaveAttribute('href', `/bring-your-league?ref=${DANGLE_SOURCE}`);
  });
});
