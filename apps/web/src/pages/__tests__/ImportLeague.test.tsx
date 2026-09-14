/**
 * IMPORT (2026-09-13): a public ESPN league is a pasted link and one button;
 * a private one is told the two honest ways forward; the job is watched to
 * the trophy room. Everything below the API client is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  discoverEspn: vi.fn(),
  startEspn: vi.fn(),
  getJob: vi.fn(),
  yahooConnection: vi.fn(),
  yahooLeagues: vi.fn(),
  yahooConnectUrl: vi.fn(),
  startYahoo: vi.fn(),
  screenshotStatus: vi.fn(),
  readScreenshots: vi.fn(),
  confirmScreenshots: vi.fn(),
}));
vi.mock('@/api/imports', () => ({ importApi: api }));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/pressbox/AppHeader', () => ({ PressBoxAppHeader: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('@/lib/nativeAuth', () => ({ isNativeShell: () => false }));
vi.mock('@/lib/pageMeta', () => ({ usePageMeta: () => undefined }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' }, loading: false }) }));
const leagueCtx = vi.hoisted(() => ({ userLeagues: [
  { id: 'l-1', name: 'The Puck Stops Here', commissioner_id: 'u-1' },
  { id: 'l-2', name: 'Someone Elses League', commissioner_id: 'u-2' },
], loading: false }));
vi.mock('@/contexts/LeagueContext', () => ({ useLeague: () => leagueCtx }));

import ImportLeague from '../ImportLeague';

function mount(path = '/import') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><ImportLeague /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1', league_id: 'l-1', platform: 'espn', external_league_id: '777', status: 'queued',
  seasons_discovered: [], seasons_imported: [], seasons_needing_credentials: [], progress: {}, error: null, started_at: null, finished_at: null, ...over,
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.yahooConnection.mockResolvedValue({ data: { connected: false, guid: null, grantedAt: null, revokedAt: null, configured: true } });
  api.screenshotStatus.mockResolvedValue({ data: { configured: true, maxImages: 12, platforms: ['yahoo', 'espn', 'fantrax', 'cbs', 'sleeper', 'manual'] } });
});

describe('ImportLeague: ESPN', () => {
  it('only leagues the user commissions are offered, and the one is preselected', async () => {
    mount();
    const select = await screen.findByLabelText('Citrus league') as HTMLSelectElement;
    expect(select.value).toBe('l-1');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Choose a league', 'The Puck Stops Here']);
  });

  it('a pasted link finds the league and one button starts the import, which is watched to done', async () => {
    api.discoverEspn.mockResolvedValue({ data: { externalLeagueId: '777', needsCredentials: false, leagueName: 'Old League', latestSeason: 2024, latestEspnSeason: 2025, seasons: [2019, 2024], isPublic: true, scoringType: 'h2h_categories', teamCount: 10 } });
    api.startEspn.mockResolvedValue({ data: job({ status: 'discovering' }) });
    api.getJob.mockResolvedValue({ data: job({ status: 'done', seasons_discovered: [2019, 2024], seasons_imported: [2019, 2024], progress: { seasons: [] } }) });
    mount();
    fireEvent.change(await screen.findByLabelText('ESPN league link'), { target: { value: 'https://fantasy.espn.com/hockey/league?leagueId=777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find my league' }));
    const found = await screen.findByTestId('espn-found');
    expect(found.textContent).toContain('Old League');
    expect(found.textContent).toContain('2 seasons (2019-20 to 2024-25) · 10 teams · H2H categories · public');
    expect(api.discoverEspn).toHaveBeenCalledWith('https://fantasy.espn.com/hockey/league?leagueId=777', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Import into The Puck Stops Here' }));
    await waitFor(() => expect(api.startEspn).toHaveBeenCalledWith('l-1', { externalLeagueId: '777', latestEspnSeason: 2025, credentials: undefined }));
    expect(await screen.findByTestId('import-progress')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 seasons imported'), { timeout: 5000 });
    expect(screen.getByRole('link', { name: 'Open the trophy room' })).toHaveAttribute('href', '/league/l-1/history');
  });

  it('a private league gets the two ways in, and the sign-in fields send the cookies once', async () => {
    api.discoverEspn.mockResolvedValueOnce({ data: { externalLeagueId: '777', needsCredentials: true, message: 'private' } });
    mount();
    fireEvent.change(await screen.findByLabelText('ESPN league link'), { target: { value: '777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find my league' }));
    const panel = await screen.findByTestId('espn-private');
    expect(panel.textContent).toContain('Make League Viewable to Public');
    expect(screen.getByTestId('espn-signin')).toBeInTheDocument();
    const again = screen.getByRole('button', { name: 'Find it with my sign-in' });
    expect(again).toBeDisabled();
    fireEvent.change(screen.getByLabelText('espn_s2 cookie'), { target: { value: 'AEB' + 'x'.repeat(40) } });
    fireEvent.change(screen.getByLabelText('SWID cookie'), { target: { value: '{9F2C1B22-8E2A-4D2A-9B3F-1A2B3C4D5E6F}' } });
    expect(again).toBeEnabled();
    api.discoverEspn.mockResolvedValueOnce({ data: { externalLeagueId: '777', needsCredentials: false, leagueName: 'Private League', seasons: [2022], teamCount: 8 } });
    fireEvent.click(again);
    await waitFor(() => expect(api.discoverEspn).toHaveBeenLastCalledWith('777', { espnS2: 'AEB' + 'x'.repeat(40), swid: '{9F2C1B22-8E2A-4D2A-9B3F-1A2B3C4D5E6F}' }));
    expect((await screen.findByTestId('espn-found')).textContent).toContain('Private League');
  });
});

describe('ImportLeague: screenshots', () => {
  it('the screenshot path is on the page for any platform, with the target league name prefilled', async () => {
    mount();
    const panel = await screen.findByTestId('import-screenshots');
    expect(panel.textContent).toContain('Yahoo, Fantrax, CBS, anywhere');
    expect(await screen.findByText('Screenshots. Any platform. No login.')).toBeInTheDocument();
    expect(screen.getByLabelText('League name on the other platform')).toHaveValue('The Puck Stops Here');
    expect(Array.from((screen.getByLabelText('Platform') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['yahoo', 'espn', 'fantrax', 'cbs', 'sleeper', 'manual']);
  });
});

describe('ImportLeague: Yahoo', () => {
  it('not connected: one Connect button that goes to Yahoo', async () => {
    api.yahooConnectUrl.mockResolvedValue({ data: { url: 'https://api.login.yahoo.com/oauth2/request_auth?x=1' } });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Yahoo' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://api.login.yahoo.com/oauth2/request_auth?x=1'));
  });

  it('connected: the leagues appear by chain with season counts, and Import starts the job', async () => {
    api.yahooConnection.mockResolvedValue({ data: { connected: true, guid: 'G', grantedAt: 'x', revokedAt: null, configured: true } });
    api.yahooLeagues.mockResolvedValue({ data: { guid: 'G', chains: [
      { key: '453.l.200', name: 'Puck', latestSeason: 2024, scoringType: 'h2h_categories', numTeams: 10, seasons: [{ leagueKey: '427.l.100', season: 2023, name: 'Puck', isFinished: true, scoringType: 'h2h_categories', numTeams: 10 }, { leagueKey: '453.l.200', season: 2024, name: 'Puck', isFinished: false, scoringType: 'h2h_categories', numTeams: 10 }] },
    ] } });
    api.startYahoo.mockResolvedValue({ data: job({ platform: 'yahoo', status: 'discovering', external_league_id: '453.l.200' }) });
    api.getJob.mockResolvedValue({ data: job({ platform: 'yahoo', status: 'done', seasons_discovered: [2023, 2024], seasons_imported: [2023, 2024] }) });
    mount();
    const list = await screen.findByTestId('yahoo-leagues');
    await waitFor(() => expect(list.textContent).toContain('2 seasons · 2023-24 to 2024-25 · 10 teams · H2H categories'));
    expect(list.textContent).toContain('In play');
    expect(list.textContent).toContain('Fantasy data provided by Yahoo Fantasy');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(api.startYahoo).toHaveBeenCalledWith('l-1', { leagueKey: '453.l.200' }));
    expect(await screen.findByTestId('import-progress')).toBeInTheDocument();
  });

  it('when Yahoo is not configured the panel says so and offers no button', async () => {
    api.yahooConnection.mockResolvedValue({ data: { connected: false, guid: null, grantedAt: null, revokedAt: null, configured: false } });
    mount();
    await waitFor(() => expect(screen.getByTestId('import-yahoo').textContent).toContain('on its way'));
    expect(screen.queryByRole('button', { name: 'Connect Yahoo' })).toBeNull();
  });
});
