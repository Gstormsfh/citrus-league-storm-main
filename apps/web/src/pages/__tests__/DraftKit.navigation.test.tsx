import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DraftKit from '../DraftKit';
import type { DraftKitBoard, DraftKitCard } from '@/components/draftkit/types';

const state = vi.hoisted(() => ({ reload: vi.fn(), error: null as string | null }));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/pressbox/AppHeader', () => ({ PressBoxAppHeader: () => null }));
vi.mock('@/components/citrus2', () => ({
  DarkLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HockeyFooter: () => null,
}));
vi.mock('@/contexts/LeagueContext', () => ({
  useLeague: () => ({ activeLeagueId: null, isDemoLeague: () => false }),
}));
vi.mock('@/hooks/useDraftKitBoard', () => ({
  useDraftKitBoard: () => ({ board, loading: false, refreshing: false, error: state.error, reload: state.reload }),
}));

function card(playerId: number, name: string, cohort: DraftKitCard['cohort']): DraftKitCard {
  return { playerId, name, cohort, team: 'EDM', position: cohort === 'F' ? 'C' : cohort,
    jersey: null, headshotUrl: null, rosterStatus: null, sampleGames: 20,
    cohortRank: 1, tier: 1, projectedFantasyPoints: 100, projectedFantasyPpg: 5,
    projectedGames: 20, valuePercentile: 90, previousTeam: null, metrics: [] };
}
const board: DraftKitBoard = {
  tier: 'kit', locked: false, metricsSeason: 2025, projectionSeason: 2026,
  cards: [card(1, 'Forward One', 'F'), card(2, 'Defender Two', 'D'), card(3, 'Goalie Three', 'G')],
  cohortSizes: { F: 1, D: 1, G: 1 }, totalCards: 3, totalRosterChanges: 1,
  rosterChanges: [{ playerId: 2, name: 'Defender Two', position: 'D', cohort: 'D',
    fromTeam: 'DAL', toTeam: 'EDM', projectedFantasyPoints: 100, cohortRank: 1 }], blurbs: [],
};

function open() { render(<MemoryRouter><DraftKit /></MemoryRouter>); }
beforeEach(() => { state.error = null; state.reload.mockClear(); });

describe('Draft Kit browsing', () => {
  it('changes the selected player with the position board', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('draft-kit-player-card')).toHaveAttribute('data-player-id', '1'));
    fireEvent.click(screen.getByRole('button', { name: 'Goalies 1' }));
    expect(screen.getByTestId('draft-kit-player-card')).toHaveAttribute('data-player-id', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Defence 1' }));
    expect(screen.getByTestId('draft-kit-player-card')).toHaveAttribute('data-player-id', '2');
  });

  it('opens the player card when a club move is selected', async () => {
    open();
    await screen.findByTestId('draft-kit-player-card');
    fireEvent.click(screen.getByRole('button', { name: 'Moves' }));
    fireEvent.click(screen.getByRole('button', { name: /Defender Two/ }));
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('draft-kit-player-card')).toHaveAttribute('data-player-id', '2');
  });

  it('lets a customer retry a refresh without hiding the loaded board', async () => {
    state.error = 'Could not refresh the Draft Kit. Showing the last loaded board.';
    open();
    await screen.findByTestId('draft-kit-player-card');
    expect(screen.getByRole('alert')).toHaveTextContent('Showing the last loaded board');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.reload).toHaveBeenCalledOnce();
    expect(screen.getByTestId('draft-kit-rankings')).toBeInTheDocument();
  });
});
