/**
 * IMPORT (2026-09-14): the review screen shows what was read, lets the
 * commissioner correct it, and refuses to import a page with no season.
 */
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ScreenshotPage } from '@/api/imports';
import { ScreenshotReview } from '../ScreenshotReview';
import { seasonsIn, tidyPages } from '../reviewHelpers';

const standings: ScreenshotPage = {
  index: 0, platform: 'yahoo', kind: 'standings', season: 2023, leagueName: 'Puck', confidence: 'medium', notes: 'Last row may be cut off.',
  standings: [
    { rank: 1, teamName: 'Dangle Dynasty', managerName: 'Alice', wins: 15, losses: 5, ties: 2, pointsFor: 1234.5, pointsAgainst: 980, isChampion: true },
    { rank: 2, teamName: 'Bench Bosses', managerName: 'Bob', wins: 12, losses: 8, ties: 2, pointsFor: 1100, pointsAgainst: 1010 },
  ],
};
const draft: ScreenshotPage = { index: 1, platform: 'yahoo', kind: 'draft', season: null, leagueName: null, confidence: 'high', notes: null, picks: [{ overall: 1, round: 1, teamName: 'Bench Bosses', playerName: 'Connor McDavid', playerTeamAbbr: 'EDM', isKeeper: true }] };
const roster: ScreenshotPage = { index: 2, platform: 'fantrax', kind: 'roster', season: 2023, leagueName: null, confidence: 'high', notes: null, roster: [{ teamName: 'Bench Bosses', players: [{ playerName: 'Connor McDavid' }, { playerName: 'Zach Hyman' }] }] };

function Harness({ initial, onConfirm }: { initial: ScreenshotPage[]; onConfirm: (o: { finished: Record<string, boolean>; rostersAsKeepers: boolean }) => Promise<void> }) {
  const [pages, setPages] = useState(initial);
  return <ScreenshotReview pages={pages} previews={[]} platform="yahoo" onChange={setPages} onConfirm={onConfirm} onBack={() => undefined} />;
}

describe('ScreenshotReview', () => {
  it('shows each page with its kind, season, the reader\'s note, and the rows as inputs', () => {
    render(<Harness initial={[standings]} onConfirm={async () => undefined} />);
    const card = screen.getByTestId('page-card-0');
    expect(within(card).getByLabelText('Page kind for image 1')).toHaveValue('standings');
    expect(within(card).getByLabelText('Season for image 1')).toHaveValue('2023');
    expect(card.textContent).toContain('2023-24 season');
    expect(card.textContent).toContain("Reader's note: Last row may be cut off.");
    expect(card.textContent).toContain('Worth a look');
    expect(within(card).getByLabelText('Team row 1')).toHaveValue('Dangle Dynasty');
    expect(within(card).getByLabelText('PF row 1')).toHaveValue('1234.5');
    expect(within(card).getByLabelText('Champ row 1')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Import 1 season' })).toBeInTheDocument();
  });

  it('a corrected cell, a removed row and an added row all flow back as pages', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(<Harness initial={[standings]} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText('Manager row 2'), { target: { value: 'Robert' } });
    fireEvent.change(screen.getByLabelText('W row 2'), { target: { value: '13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    fireEvent.change(screen.getByLabelText('Team row 3'), { target: { value: 'Crease Lightning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove row 1' }));
    expect(screen.getByLabelText('Team row 1')).toHaveValue('Bench Bosses');
    expect(screen.getByLabelText('Manager row 1')).toHaveValue('Robert');
    expect(screen.getByLabelText('W row 1')).toHaveValue('13');
    expect(screen.getByLabelText('Team row 2')).toHaveValue('Crease Lightning');
  });

  it('a page with no season blocks the import until one is typed, then the season list follows', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(<Harness initial={[standings, draft]} onConfirm={onConfirm} />);
    expect(screen.getByRole('alert').textContent).toBe('Which season is this page? Type the start year.');
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 season' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((a) => a.textContent === 'Set the season on image 2 first.')).toBe(true));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Season for image 2'), { target: { value: '2022' } });
    expect(screen.getByRole('button', { name: 'Import 2 seasons' })).toBeInTheDocument();
    expect(screen.getByTestId('review-seasons').textContent).toContain('2022-23');
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 seasons' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ finished: {}, rostersAsKeepers: false }));
  });

  it('finished and dynasty choices ride along with the confirm', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(<Harness initial={[standings, roster]} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByLabelText('2023-24 finished'));
    fireEvent.click(screen.getByLabelText('Dynasty league: keep whole rosters as keepers'));
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 season' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ finished: { '2023': false }, rostersAsKeepers: true }));
  });

  it('the server\'s refusal is shown and the screen stays', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('That reading has already been imported.'); });
    render(<Harness initial={[standings]} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 season' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That reading has already been imported.'));
    expect(screen.getByTestId('screenshot-review')).toBeInTheDocument();
  });

  it('removing a page or marking it "not a league page" takes it out of the import', () => {
    render(<Harness initial={[standings, draft]} onConfirm={async () => undefined} />);
    fireEvent.change(screen.getByLabelText('Page kind for image 2'), { target: { value: 'other' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    expect(screen.queryByTestId('page-card-1')).toBeNull();
  });
});

describe('ScreenshotReview: champions and awards pages', () => {
  const champions: ScreenshotPage = { index: 3, platform: 'yahoo', kind: 'champions', season: null, leagueName: null, confidence: 'high', notes: null, champions: [
    { season: 2021, championTeam: 'Crease Lightning', championManager: 'Cy', runnerUpTeam: 'Old Dangle', runnerUpManager: 'Alice' },
    { season: 2020, championTeam: 'Old Dangle', championManager: 'Alice' },
  ] };
  const awards: ScreenshotPage = { index: 4, platform: 'unknown', kind: 'awards', season: null, leagueName: null, confidence: 'high', notes: null, awards: [{ season: 2021, award: 'The Sacko', winnerManager: 'Dee' }, { season: null, award: 'Commissioner of the Decade', winnerManager: 'Alice' }] };

  it('a champions page needs no page season: each row has its own, and the seasons list follows', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(<Harness initial={[champions, awards]} onConfirm={onConfirm} />);
    expect(screen.queryByLabelText('Season for image 4')).toBeNull();
    expect(screen.getByTestId('page-card-0').textContent).toContain('Each row carries its own season.');
    expect(screen.getByTestId('page-card-0').textContent).toContain('League History');
    expect(screen.getByLabelText('Champion row 1')).toHaveValue('Crease Lightning');
    expect(screen.getByLabelText('Award row 1')).toHaveValue('The Sacko');
    expect(screen.getByRole('button', { name: 'Import 2 seasons' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getAllByLabelText('Season (start year) row 2')[0], { target: { value: '2019' } });
    expect(screen.getByTestId('review-seasons').textContent).toContain('2019-20');
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 seasons' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });
});

describe('review helpers', () => {
  it('tidyPages drops empty-named rows and pages marked other; seasonsIn lists the seasons that will import', () => {
    const tidy = tidyPages([{ ...standings, standings: [...standings.standings!, { teamName: '' }] }, { ...draft, kind: 'other' }]);
    expect(tidy).toHaveLength(1);
    expect(tidy[0].standings).toHaveLength(2);
    expect(seasonsIn([standings, { ...draft, season: 2021 }, { ...roster, season: 2023 }])).toEqual([2021, 2023]);
  });
});
