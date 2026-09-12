import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), log: vi.fn(), ros: vi.fn(), league: vi.fn(), format: vi.fn(), leagueId: 'test-league', dashboard: { players: [] as Record<string, unknown>[], status: 'ready' } }));
vi.mock('@/contexts/LeagueContext', () => ({ useLeague: () => ({ activeLeagueId: mocks.leagueId }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/services/LeagueService', () => ({ getLeagueFormat: mocks.format, LeagueService: { getLeague: mocks.league, getWatchlist: () => [] } }));
vi.mock('@/services/ScheduleService', () => ({ ScheduleService: { getGamesForTeam: mocks.schedule } }));
vi.mock('@/services/MatchupService', () => ({ MatchupService: {} }));
vi.mock('@/api/matchups', () => ({ matchupApi: { getPlayerGameLog: mocks.log } }));
vi.mock('@/api/players', () => ({ playerApi: { getDirectory: async () => ({ data: [] }), getRosProjectionForPlayer: mocks.ros } }));
vi.mock('@/hooks/usePlayerDashboardIndex', () => ({ usePlayerDashboardIndex: () => mocks.dashboard }));
vi.mock('@/hooks/useCitrusPlayerNotes', () => ({ useCitrusPlayerNotes: () => ({ notes: [], items: [] }) }));
vi.mock('../usePlayerXgHistory', () => ({ usePlayerXgHistory: () => ({ points: [] }) }));
vi.mock('../PlayerAdvancedCard', () => ({ PlayerAdvancedCard: () => null }));
vi.mock('@/utils/playerWriteup', () => ({ generatePlayerWriteup: () => ({ headline: 'Player outlook', summary: '', tags: [] }) }));
vi.mock('@/utils/timezoneUtils', () => ({ getTodayMST: () => '2026-09-06' }));
import PlayerStatsModal from '@/components/PlayerStatsModal';

let playerId = 900000;
function openCard(position = 'C') {
  const player = { id: String(++playerId), name: 'Test Player', position, team: 'PIT', teamAbbreviation: 'PIT', stats: {} } as HockeyPlayer;
  return { ...render(<MemoryRouter><PlayerStatsModal player={player} isOpen onClose={() => {}} /></MemoryRouter>), player };
}
const scheduled = (date = '2026-10-01') => ({ game_date: date, game_type: 'regular', home_team: 'PIT', away_team: 'BOS' });
const payload = (goals = 2) => ({ data: { games: [], projections: [{ projection_date: '2026-10-01', projected_goals: goals }] } });
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mocks.leagueId = 'test-league';
  mocks.dashboard = { players: [], status: 'ready' };
  mocks.schedule.mockResolvedValue({ games: [scheduled()], error: null });
  mocks.log.mockResolvedValue(payload(20));
  mocks.ros.mockResolvedValue({ data: [{ games_remaining: 40, projected_goals: 2 }] });
  mocks.league.mockResolvedValue({ league: { id: mocks.leagueId, scoring_settings: { skater: { goals: 10 } } } });
  mocks.format.mockReturnValue({ scoringFormat: 'h2h-points' });
});

describe('player-card projection availability and request recovery', () => {
  it('reweights the same ROS counts when the active league changes, independently of daily totals', async () => {
    const { rerender, player } = openCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent('20'));
    mocks.leagueId = 'second-league';
    mocks.league.mockResolvedValue({ league: { id: mocks.leagueId, scoring_settings: { skater: { goals: 1 } } } });
    rerender(<MemoryRouter><PlayerStatsModal player={player} isOpen onClose={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent(/^2$/));
    expect(mocks.log).toHaveBeenCalledTimes(1);
  });
  it('updates an open hero when its dashboard projection refreshes without refetching on generic renders', async () => {
    const { rerender, player } = openCard();
    await screen.findByRole('button', { name: 'PROJECTION breakdown' });
    mocks.dashboard = { status: 'ready', players: [{ id: Number(player.id), proj_gp: 40, proj_goals: 2 }] };
    rerender(<MemoryRouter><PlayerStatsModal player={player} isOpen onClose={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(mocks.ros).toHaveBeenCalledTimes(2));
    mocks.ros.mockResolvedValue({ data: [{ games_remaining: 30, projected_goals: 3 }] });
    mocks.dashboard = { status: 'ready', players: [{ id: Number(player.id), proj_gp: 30, proj_goals: 3 }] };
    rerender(<MemoryRouter><PlayerStatsModal player={player} isOpen onClose={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent('30'));
    const requests = mocks.ros.mock.calls.length;
    rerender(<MemoryRouter><PlayerStatsModal player={player} isOpen onClose={() => {}} /></MemoryRouter>);
    expect(mocks.ros).toHaveBeenCalledTimes(requests);
  });
  it('does not let a slower initial ROS response overwrite a refreshed projection', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.ros.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const { rerender, player } = openCard();
    await waitFor(() => expect(mocks.ros).toHaveBeenCalledTimes(1));
    mocks.ros.mockResolvedValue({ data: [{ games_remaining: 30, projected_goals: 3 }] });
    mocks.dashboard = { status: 'ready', players: [{ id: Number(player.id), proj_gp: 30, proj_goals: 3 }] };
    rerender(<MemoryRouter><PlayerStatsModal player={player} isOpen onClose={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent('30'));
    await act(async () => { resolveOld({ data: [{ games_remaining: 40, projected_goals: 2 }] }); });
    expect(screen.getByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent('30');
  });
  it('preserves the upcoming table’s intentionally hidden fantasy-point column', async () => {
    mocks.log.mockResolvedValue({ data: { games: [], projections: [{ projection_date: '2026-10-01', projected_goals: 2, total_projected_points: 999 }] } });
    openCard();
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    await screen.findByText('Upcoming');
    expect(screen.getByText('2.00')).toBeTruthy();
    expect(screen.queryByText('PROJ', { exact: true })).toBeNull();
    expect(screen.queryByText('999.0', { exact: true })).toBeNull();
  });
  it('separates three team games from expected goalie starts in the rendered upcoming table', async () => {
    const dates = ['2026-10-01', '2026-10-03', '2026-10-05'];
    mocks.schedule.mockResolvedValue({ games: dates.map(scheduled), error: null });
    mocks.log.mockResolvedValue({ data: { games: [], projections: dates.map(projection_date => ({
      projection_date, projection_basis: 'conditional_on_start', expected_starts: 0.2,
      projected_wins: 0.5, projected_saves: 25, projected_goals_against: 3, projected_shutouts: 0,
    })) } });
    mocks.ros.mockResolvedValue({ data: [{ games_remaining: 5, projected_saves_ros: 125 }] });
    openCard('G');
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    await screen.findByText('Upcoming');
    expect(screen.getByText(/3 TEAM GAMES/)).toBeTruthy();
    expect(screen.getByText('STARTS', { exact: true })).toBeTruthy();
    expect(screen.getAllByText('0.20', { exact: true })).toHaveLength(3);
    expect(screen.queryByText('25', { exact: true })).toBeNull();
  });
  it('keeps the ROS headline available while a failed game log can be retried', async () => {
    mocks.log.mockRejectedValueOnce(new Error('Offline'));
    openCard();
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load');
    expect(await screen.findByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent('20');
    fireEvent.click(screen.getByRole('button', { name: 'Retry game log' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent('20'));
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
  it('keeps the current season headline independent of the historical game-log picker', async () => {
    openCard();
    await screen.findByRole('button', { name: 'PROJECTION breakdown' });
    fireEvent.click(screen.getByRole('button', { name: 'PROJECTION breakdown' }));
    expect(screen.getByRole('region', { name: 'Projection breakdown' })).toBeTruthy();
    mocks.schedule.mockResolvedValue({ games: [scheduled('2026-01-01')], error: null });
    mocks.log.mockResolvedValue({ data: { games: [{ game_date: '2026-01-01', goals: 1 }], projections: [] } });
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    fireEvent.click(screen.getByTestId('gamelog-season-2025'));
    await screen.findByText('1 Game');
    expect(mocks.log).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent('20');
    expect(screen.getByRole('region', { name: 'Projection breakdown' })).toHaveTextContent('40 projected GP');
  });
  it('preserves a real zero projection as available', async () => {
    mocks.ros.mockResolvedValue({ data: [{ games_remaining: 0, projected_goals: 0 }] });
    openCard();
    expect(await screen.findByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent('0');
  });
  it('never falls back to conditional daily goalie totals when ROS is missing', async () => {
    mocks.ros.mockResolvedValue({ data: [] });
    mocks.log.mockResolvedValue({ data: { games: [], projections: [{ projection_date: '2026-10-01', projected_saves: 30, total_projected_points: 999 }] } });
    openCard('G');
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    await screen.findByText('Upcoming');
    expect(screen.queryByRole('button', { name: 'PROJECTION breakdown' })).toBeNull();
  });
  it('shows an available zero-start goalie ROS even with positive daily conditional forecasts', async () => {
    mocks.ros.mockResolvedValue({ data: [{ games_remaining: 0, projected_saves_ros: 0 }] });
    openCard('G');
    expect(await screen.findByRole('button', { name: 'PROJECTION breakdown' })).toHaveTextContent('0');
  });
  it('discloses the missing plus/minus projection when that category is scored', async () => {
    mocks.league.mockResolvedValue({ league: { id: mocks.leagueId, scoring_settings: { skater: { goals: 1, plus_minus: 1 } } } });
    openCard();
    fireEvent.click(await screen.findByRole('button', { name: 'PROJECTION breakdown' }));
    expect(screen.getByText('Plus/minus isn’t projected; this total excludes it.')).toBeTruthy();
  });
  it('shows raw projections without a fantasy total in a category league', async () => {
    mocks.format.mockReturnValue({ scoringFormat: 'h2h-categories' });
    openCard();
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    await screen.findByText('Upcoming');
    expect(screen.queryByRole('button', { name: 'PROJECTION breakdown' })).toBeNull();
    expect(screen.queryByText(/20\.0 PROJ/)).toBeNull();
    expect(screen.getByText('20.00')).toBeTruthy();
  });
  it('keeps fantasy projections unavailable if the league settings request fails', async () => {
    mocks.league.mockResolvedValue({ error: new Error('Offline'), league: null });
    openCard();
    fireEvent.click(screen.getByRole('tab', { name: 'Game log' }));
    await screen.findByText('Upcoming');
    expect(screen.queryByRole('button', { name: 'PROJECTION breakdown' })).toBeNull();
    expect(screen.queryByText(/20\.0 PROJ/)).toBeNull();
  });
});
