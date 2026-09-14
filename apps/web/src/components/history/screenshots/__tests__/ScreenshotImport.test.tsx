/**
 * IMPORT (2026-09-14): choose screenshots, read them, review, import.
 * Image preparation and the API are mocked; the flow is the subject.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ screenshotStatus: vi.fn(), readScreenshots: vi.fn(), confirmScreenshots: vi.fn() }));
vi.mock('@/api/imports', () => ({ importApi: api }));
const prep = vi.hoisted(() => ({ prepareImages: vi.fn() }));
vi.mock('../imagePrep', () => ({ prepareImages: prep.prepareImages }));

import { ScreenshotImport, type ScreenshotImportProps } from '../ScreenshotImport';

const page = { index: 0, platform: 'yahoo', kind: 'standings', season: 2023, leagueName: 'Puck', confidence: 'high', notes: null, standings: [{ rank: 1, teamName: 'Dangle Dynasty', managerName: 'Alice', wins: 15, losses: 5, ties: 2 }] };
const job = { id: 'job-1', league_id: 'l-1', platform: 'yahoo', method: 'screenshot', external_league_id: 'screenshots:puck', status: 'queued', seasons_discovered: [2023], seasons_imported: [], seasons_needing_credentials: [], progress: {}, error: null, started_at: null, finished_at: null };

function mount(props: Partial<ScreenshotImportProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onJob = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}><ScreenshotImport leagueId="l-1" leagueName="Puck" onJob={onJob} {...props} /></QueryClientProvider>,
  );
  return { ...utils, onJob };
}

const file = (name: string) => new File(['x'], name, { type: 'image/png' });

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(prep)]) fn.mockReset();
  api.screenshotStatus.mockResolvedValue({ data: { configured: true, maxImages: 12, platforms: ['yahoo', 'espn', 'fantrax', 'cbs', 'sleeper', 'manual'] } });
  prep.prepareImages.mockImplementation(async (files: File[]) => files.map((f) => ({ data: 'AAAA', mediaType: 'image/png', name: f.name, previewUrl: 'data:image/png;base64,AAAA', width: 10, height: 10 })));
});

describe('ScreenshotImport', () => {
  it('chosen files become thumbnails, Read sends them once with the platform and league name, and the review appears', async () => {
    api.readScreenshots.mockResolvedValue({ data: { job, pages: [page], usage: { inputTokens: 1, outputTokens: 1 } } });
    mount();
    expect(await screen.findByText('Screenshots. Any platform. No login.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read my screenshots' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'fantrax' } });
    fireEvent.change(screen.getByLabelText('Screenshots'), { target: { files: [file('a.png'), file('b.png')] } });
    await waitFor(() => expect(screen.getByTestId('screenshot-thumbs').querySelectorAll('img')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read 1 screenshot' }));
    await waitFor(() => expect(api.readScreenshots).toHaveBeenCalledWith('l-1', { platform: 'fantrax', leagueName: 'Puck', season: null, images: [{ data: 'AAAA', mediaType: 'image/png' }] }));
    expect(await screen.findByTestId('screenshot-review')).toBeInTheDocument();
    expect(screen.getByLabelText('Team row 1')).toHaveValue('Dangle Dynasty');
  });

  it('the guide names the pages in the chosen platform\'s own words and starts with past champions', async () => {
    mount();
    const guide = await screen.findByTestId('page-guide');
    expect(guide.textContent).toContain("in Yahoo's words");
    expect(guide.textContent).toContain('League History');
    expect(guide.textContent).toContain('Start here');
    expect(guide.textContent).toContain('Draft Results');
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'espn' } });
    expect(screen.getByTestId('page-guide').textContent).toContain('Draft Recap');
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'fantrax' } });
    expect(screen.getByTestId('page-guide').textContent).toContain('Draft Picks');
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'manual' } });
    expect(screen.getByTestId('page-guide').textContent).toContain('League awards');
  });

  it('import hands the reviewed pages and the job id back, and the job reaches the page', async () => {
    api.readScreenshots.mockResolvedValue({ data: { job, pages: [page], usage: { inputTokens: 1, outputTokens: 1 } } });
    api.confirmScreenshots.mockResolvedValue({ data: { ...job, status: 'importing' } });
    const { onJob } = mount();
    fireEvent.change(await screen.findByLabelText('Screenshots'), { target: { files: [file('a.png')] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 screenshot' }));
    fireEvent.change(await screen.findByLabelText('Manager row 1'), { target: { value: 'Alison' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 season' }));
    await waitFor(() => expect(api.confirmScreenshots).toHaveBeenCalledWith('l-1', 'job-1', expect.objectContaining({ platform: 'yahoo', leagueName: 'Puck', finished: {}, rostersAsKeepers: false })));
    expect(api.confirmScreenshots.mock.calls[0][2].pages[0].standings[0].managerName).toBe('Alison');
    await waitFor(() => expect(onJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1', status: 'importing' })));
  });

  it('a reader refusal is shown in its own words and the screenshots stay chosen', async () => {
    api.readScreenshots.mockRejectedValue(new Error('The reader is busy right now. Try again in a minute.'));
    mount();
    fireEvent.change(await screen.findByLabelText('Screenshots'), { target: { files: [file('a.png')] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 screenshot' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The reader is busy right now. Try again in a minute.'));
    expect(screen.getByTestId('screenshot-thumbs').querySelectorAll('img')).toHaveLength(1);
  });

  it('an unreadable file says so', async () => {
    prep.prepareImages.mockRejectedValue(new Error('photo.heic could not be read as an image. Use a screenshot saved as PNG or JPEG.'));
    mount();
    fireEvent.change(await screen.findByLabelText('Screenshots'), { target: { files: [file('photo.heic')] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/photo.heic could not be read/));
  });

  it('without a Citrus league chosen the button says so; without the reader configured the panel says so', async () => {
    mount({ leagueId: null });
    expect(await screen.findByRole('button', { name: 'Choose a Citrus league first' })).toBeDisabled();
    api.screenshotStatus.mockResolvedValue({ data: { configured: false, maxImages: 12, platforms: [] } });
    mount();
    expect(await screen.findByTestId('screenshots-unavailable')).toBeInTheDocument();
  });
});
