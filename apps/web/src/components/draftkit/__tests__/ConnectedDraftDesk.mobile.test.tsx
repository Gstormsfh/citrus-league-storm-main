import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectionSettings } from '@citrus/shared';
import { DraftDeskPanel, type DeskLiveState } from '../ConnectedDraftDesk';
import { deskFixture } from './deskFixture';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }));
const kit = deskFixture();
const live: DeskLiveState = { status: 'live', unavailableIds: new Set(), sequence: 0 };
const props = { initialFile: kit, live, scoring: projectionSettings(kit.kit.weights), scoringReady: true };
function viewport(width: number) {
  vi.stubGlobal('matchMedia', undefined);
  vi.stubGlobal('innerWidth', width);
  fireEvent(window, new Event('resize'));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Draft desk mobile hierarchy', () => {
  it('shows signed plus/minus on the phone board and player notebook when supplied', () => {
    viewport(390);
    const file = deskFixture(); file.kit.weights.skater.plus_minus = .5;
    file.kit.players[0].totals.plus_minus = -12;
    render(<DraftDeskPanel {...props} initialFile={file} scoring={projectionSettings(file.kit.weights)} />);
    const stats = within(screen.getByLabelText('Projected season totals for Connor McDavid'));
    expect(stats.getByText('+/−')).toHaveAttribute('title', 'Plus/minus');
    expect(screen.getByLabelText('Projected season totals for Connor McDavid')).toHaveAttribute('data-stat-count', '9');
    expect(stats.getByText('-12')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    expect(within(screen.getByRole('dialog')).getByText('-12')).toBeInTheDocument();
  });
  it('keeps a published remaining-season backup distinct from a full-season offline edition', () => {
    viewport(390);
    const saved = deskFixture(); saved.kit.projectionBasis = 'remaining_season';
    render(<DraftDeskPanel {...props} initialFile={saved} />);
    expect(screen.getByLabelText('Projected remaining totals for Connor McDavid')).toBeInTheDocument();
    expect(screen.queryByLabelText('Projected season totals for Connor McDavid')).not.toBeInTheDocument();
    expect(screen.getByText('Remaining-season projections · Scored for your kit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desk options' }));
    expect(screen.queryByRole('button', { name: 'Save offline progress' })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot restore progress into that edition/)).toBeInTheDocument();
  });
  it('advertises player-name search and includes skater projections directly in the board', () => {
    viewport(390); render(<DraftDeskPanel {...props} />);
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Player name');
    const stats = within(screen.getByLabelText('Projected season totals for Connor McDavid'));
    expect(stats.getByText('G')).toBeInTheDocument();
    expect(stats.getByText('40')).toBeInTheDocument();
    expect(stats.getByText('80')).toBeInTheDocument();
    expect(stats.getAllByText('N/A')).toHaveLength(6);
    expect(stats.queryByText('SV')).not.toBeInTheDocument();
  });
  it.each([390, 1280])('shows SHP and PIM in player details at width %s', width => {
    viewport(width);
    const file = deskFixture();
    Object.assign(file.kit.players[0].totals, { short_handed_points: 3, penalty_minutes: 48 });
    render(<DraftDeskPanel {...props} initialFile={file} />);
    if (width === 390) {
      const row = within(screen.getByLabelText('Projected season totals for Connor McDavid'));
      expect(row.getByText('SHP').nextElementSibling).toHaveTextContent('3');
      expect(row.getByText('PIM').nextElementSibling).toHaveTextContent('48');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    const detail = within(screen.getByRole(width === 390 ? 'dialog' : 'complementary'));
    expect(detail.getByText('SHP').nextElementSibling).toHaveTextContent('3');
    expect(detail.getByText('PIM').nextElementSibling).toHaveTextContent('48');
  });
  it('uses goalie-specific labels and existing goalie values', () => {
    viewport(390);
    const goalieKit = deskFixture();
    Object.assign(goalieKit.kit.players[0], { goalie: true, position: 'G', totals: { wins: 30, saves: 1500, goals_against: 125, shutouts: 4 } });
    render(<DraftDeskPanel {...props} initialFile={goalieKit} />);
    const stats = within(screen.getByLabelText('Projected season totals for Connor McDavid'));
    expect(stats.getByText('SV')).toBeInTheDocument();
    expect(stats.getByText('1,500')).toBeInTheDocument();
    expect(stats.queryByText('G')).not.toBeInTheDocument();
    expect(stats.queryByText('PPP')).not.toBeInTheDocument();
  });
  it('returns to the draft from the header or sheet without changing notes', async () => {
    viewport(390); const back = vi.fn();
    render(<DraftDeskPanel {...props} onReturnToDraft={back} />);
    fireEvent.click(screen.getByRole('button', { name: '← Back to draft' }));
    expect(back).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    fireEvent.change(screen.getByLabelText('Your note for Connor McDavid'), { target: { value: 'Keep this on return' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to draft · Players' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(back).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    expect(screen.getByLabelText('Your note for Connor McDavid')).toHaveValue('Keep this on return');
  });
  it('starts with the board and opens an accessible sheet only on selection', async () => {
    viewport(390); render(<DraftDeskPanel {...props} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Connor McDavid' });
    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Connor McDavid' });
    expect(within(sheet).getByRole('heading', { name: 'Connor McDavid' })).toHaveFocus();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
  it('retains search, notes and targets when returning to the board', async () => {
    viewport(390); render(<DraftDeskPanel {...props} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'mcdavid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    fireEvent.change(screen.getByLabelText('Your note for Connor McDavid'), { target: { value: 'My saved thought' } });
    fireEvent.click(screen.getByRole('button', { name: '★ On your shortlist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('searchbox')).toHaveValue('mcdavid');
    expect(screen.getByRole('button', { name: 'Target: Connor McDavid' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    expect(screen.getByLabelText('Your note for Connor McDavid')).toHaveValue('My saved thought');
  });
  it('updates an open sheet on picks and undos, then safely restores focus if its row disappears', async () => {
    viewport(390); const view = render(<DraftDeskPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    view.rerender(<DraftDeskPanel {...props} live={{ ...live, unavailableIds: new Set(['8478402']), sequence: 1 }} />);
    expect(within(screen.getByRole('dialog')).getByText('Drafted or kept')).toBeInTheDocument();
    view.rerender(<DraftDeskPanel {...props} live={{ ...live, sequence: 2 }} />);
    expect(within(screen.getByRole('dialog')).getByText('Available', { exact: true })).toBeInTheDocument();
    view.rerender(<DraftDeskPanel {...props} live={{ ...live, unavailableIds: new Set(['8478402']), sequence: 3 }} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });
  it('shows interrupted availability inside the open sheet', () => {
    viewport(390); const view = render(<DraftDeskPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    view.rerender(<DraftDeskPanel {...props} live={{ ...live, status: 'disconnected' }} />);
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByText(/Connection interrupted/)).toBeInTheDocument();
    expect(sheet.getByText('Last seen available')).toBeInTheDocument();
    view.rerender(<DraftDeskPanel {...props} live={{ ...live, status: 'denied' }} />);
    expect(sheet.getByText('Availability unverified')).toBeInTheDocument();
  });
  it('exposes secondary controls on request without hiding scoring warnings', () => {
    viewport(390); render(<DraftDeskPanel {...props} scoringReady={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent('League scoring has not been verified');
    const options = screen.getByRole('button', { name: 'Desk options' });
    expect(options).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(options);
    expect(options).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Save session file' })).toBeInTheDocument();
  });
  it('keeps desktop details beside the board and preserves notes across breakpoints', async () => {
    viewport(1280); render(<DraftDeskPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your note for Connor McDavid'), { target: { value: 'Keep through resize' } });
    viewport(390);
    expect(screen.getByRole('dialog', { name: 'Connor McDavid' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your note for Connor McDavid')).toHaveValue('Keep through resize');
    viewport(1280);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Your note for Connor McDavid')).toHaveValue('Keep through resize');
  });
});
