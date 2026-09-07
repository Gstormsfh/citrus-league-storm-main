import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), log: vi.fn(), league: vi.fn(), format: vi.fn(), leagueId: 'test-league' }));
vi.mock('@/contexts/LeagueContext', () => ({ useLeague: () => ({ activeLeagueId: mocks.leagueId }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/services/LeagueService', () => ({ getLeagueFormat: mocks.format, LeagueService: { getLeague: mocks.league, getWatchlist: () => [] } }));
vi.mock('@/services/ScheduleService', () => ({ ScheduleService: { getGamesForTeam: mocks.schedule } }));
vi.mock('@/services/MatchupService', () => ({ MatchupService: {} }));
vi.mock('@/api/matchups', () => ({ matchupApi: { getPlayerGameLog: mocks.log } }));
vi.mock('@/api/players', () => ({ playerApi: { getDirectory: async () => ({ data: [] }), getRosProjectionForPlayer: async () => ({ data: [] }) } }));
vi.mock('@/hooks/usePlayerDashboardIndex', () => ({ usePlayerDashboardIndex: () => ({ players: [] }) }));
vi.mock('@/hooks/useCitrusPlayerNotes', () => ({ useCitrusPlayerNotes: () => ({ notes: [], items: [] }) }));
vi.mock('../usePlayerXgHistory', () => ({ usePlayerXgHistory: () => ({ points: [] }) }));
vi.mock('../PlayerAdvancedCard', () => ({ PlayerAdvancedCard: () => null }));
vi.mock('@/utils/playerWriteup', () => ({ generatePlayerWriteup: () => ({ headline: 'Player outlook', summary: '', tags: [] }) }));
vi.mock('@/utils/timezoneUtils', () => ({ getTodayMST: () => '2026-09-06' }));
import PlayerStatsModal from '@/components/PlayerStatsModal';

let playerId = 900000;
function openCard() {
  const player = { id: String(++playerId), name: 'Test Player', position: 'C', team: 'PIT', teamAbbreviation: 'PIT', stats: {} } as HockeyPlayer;
  return { ...render(<MemoryRouter><PlayerStatsModal player={player} isOpen onClose={() => {}} /></MemoryRouter>), player };
}
const scheduled = (date = '2026-10-01') => ({ game_date: date, game_type: 'regular', home_team: 'PIT', away_team: 'BOS' });
const payload = (goals = 2) => ({ data: { games: [], projections: [{ projection_date: '2026-10-01', projected_goals: goals }] } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.leagueId = 'test-league';
  mocks.schedule.mockResolvedValue({ games: [scheduled()], error: null });
  mocks.log.mockResolvedValue(payload());
  mocks.league.mockResolvedValue({ league: { scoring_settings: { skater: { goals: 10 } } } });
  mocks.format.mockReturnValue({ scoringFormat: 'h2h-points' });
});

describe('player-card projection availability and request recovery', () => {
  it('reweights the same raw games when the active league changes', async () => {
    const { rerender, player } = openCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'SZN PROJ breakdown' })).toHaveTextContent('20'));
    mocks.leagueId = 'second-league';
    mocks.league.mockResolvedValue({ league: { scoring_settings: { skater: { goals: 1 } } } });
    rerender(<MemoryRouter><PlayerStatsModal player={player} isOpen onClose={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'SZN PROJ breakdown' })).toHaveTextContent(/^2$/));
    expect(mocks.log).toHaveBeenCalledTimes(1);
  });
  it('does not turn a failed log request into cached DNPs; retry loads the projection', async () => {
    mocks.log.mockRejectedValueOnce(new Error('Offline'));
    openCard();
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load');
    expect(screen.queryByRole('button', { name: 'SZN PROJ breakdown' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry game log' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'SZN PROJ breakdown' })).toHaveTextContent('20'));
    expect(mocks.log).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('treats a failed schedule as an error, not an empty season', async () => {
    mocks.schedule.mockResolvedValueOnce({ games: [], error: new Error('Offline') });
    openCard();
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load');
    expect(screen.queryByText(/No games in/)).toBeNull();
  });
  it('hides the projection and its breakdown when the selected season only contains history', async () => {
    openCard();
    await screen.findByRole('button', { name: 'SZN PROJ breakdown' });
    fireEvent.click(screen.getByRole('button', { name: 'SZN PROJ breakdown' }));
    expect(screen.getByRole('region', { name: 'Projection breakdown' })).toBeTruthy();
    mocks.schedule.mockResolvedValue({ games: [scheduled('2026-01-01')], error: null });
    mocks.log.mockResolvedValue({ data: { games: [{ game_date: '2026-01-01', goals: 1 }], projections: [] } });
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    fireEvent.click(screen.getByTestId('gamelog-season-2025'));
    await screen.findByText('1 Game');
    expect(mocks.log).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'SZN PROJ breakdown' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Projection breakdown' })).toBeNull();
  });
  it('preserves a real zero projection as available', async () => {
    mocks.log.mockResolvedValue(payload(0));
    openCard();
    expect(await screen.findByRole('button', { name: 'SZN PROJ breakdown' })).toHaveTextContent('0');
  });
  it('discloses the missing plus/minus projection when that category is scored', async () => {
    mocks.league.mockResolvedValue({ league: { scoring_settings: { skater: { goals: 1, plus_minus: 1 } } } });
    openCard();
    fireEvent.click(await screen.findByRole('button', { name: 'SZN PROJ breakdown' }));
    expect(screen.getByText('Plus/minus isn’t projected; this total excludes it.')).toBeTruthy();
  });
  it('shows raw projections without a fantasy total in a category league', async () => {
    mocks.format.mockReturnValue({ scoringFormat: 'h2h-categories' });
    openCard();
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    await screen.findByText('Upcoming');
    expect(screen.queryByRole('button', { name: 'SZN PROJ breakdown' })).toBeNull();
    expect(screen.queryByText(/20\.0 PROJ/)).toBeNull();
    expect(screen.getByText('2.00')).toBeTruthy();
  });
  it('keeps fantasy projections unavailable if the league settings request fails', async () => {
    mocks.league.mockResolvedValue({ error: new Error('Offline'), league: null });
    openCard();
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    await screen.findByText('Upcoming');
    expect(screen.queryByRole('button', { name: 'SZN PROJ breakdown' })).toBeNull();
    expect(screen.queryByText(/20\.0 PROJ/)).toBeNull();
  });
});
