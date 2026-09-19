import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectionSettings } from '@citrus/shared';
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { id: 'buyer-a' } as { id: string } | null }));
const native = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/lib/nativeAuth', () => ({ isNativeShell: () => native.enabled }));
vi.mock('@/api/client', () => ({ apiClient: api }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
import { ConnectedDraftDesk } from '../ConnectedDraftDesk';
import { useDraftClientStore } from '@/stores/draftClientStore';
import { deskFixture } from './deskFixture';
const props = { leagueId: 'league-one', scoring: projectionSettings(deskFixture().kit.weights), scoringReady: true };
function reply() { return { data: { owned: true, file: deskFixture(), versions: { 'canonical:8478402': 3 } } }; }
beforeEach(() => {
  vi.clearAllMocks(); auth.user = { id: 'buyer-a' }; native.enabled=false;
  api.get.mockResolvedValue(reply()); api.put.mockResolvedValue({ data: { version: 4 } });
  useDraftClientStore.getState().reset();
  useDraftClientStore.getState().setSnapshot({ lobbyId: 'lobby', format: 'snake', recentEvents: [],
    stateSnapshot: { totalPicks: 6, draftStatus: 'in_progress', currentPickNumber: 1, currentRoundNumber: 1, onClockTeamId: 'one', picksMade: 0, currentPickDeadline: null } });
  useDraftClientStore.setState({ connectionState: { kind: 'connected', wsUrl: '', lastSeenSeq: 0, sessionId: 'test' } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('Purchased desk inside Citrus', () => {
  it.each([true,false])('never requests or unlocks a kit in native, even for an owner: %s', async owned => {
    native.enabled=true;api.get.mockResolvedValue(owned?reply():{data:{owned:false}});
    const {container}=render(<ConnectedDraftDesk {...props} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('shows failed-refresh health without losing the last published board or back navigation', async () => {
    const response = reply();
    api.get.mockResolvedValue({ data: { ...response.data, warning: 'The latest projection update failed. This board uses the last published projections, dated 2026-09-15.' } });
    const back = vi.fn(); render(<ConnectedDraftDesk {...props} onReturnToDraft={back} />);
    await screen.findByRole('button', { name: 'Connor McDavid' });
    expect(screen.getByText(/latest projection update failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '← Back to draft' }));
    expect(back).toHaveBeenCalledOnce();
  });
  it('passes return navigation through the automatic purchased-kit wrapper', async () => {
    const back = vi.fn(); render(<ConnectedDraftDesk {...props} onReturnToDraft={back} />);
    fireEvent.click(await screen.findByRole('button', { name: '← Back to draft' }));
    expect(back).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Connor McDavid' })).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
  it('loads without files or scoring entry and follows real store picks and undos without refetching', async () => {
    const ready = vi.fn(); render(<ConnectedDraftDesk {...props} onReady={ready} />);
    await screen.findByRole('button', { name: 'Connor McDavid' });
    expect(screen.queryByLabelText(/Load your Citrus/)).not.toBeInTheDocument();
    expect(ready).toHaveBeenCalledWith('league-one');
    expect(screen.getByText('Notes and targets saved to your account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Target: Connor McDavid' })).toHaveAttribute('aria-pressed','true');
    const pick = { kind: 'pick_submitted' as const, seq: 1, timestamp: '2026-09-16T00:00:00Z', teamId: 'one', playerId: 8478402, pickNumber: 1, roundNumber: 1, correlationId: 'test' };
    act(() => useDraftClientStore.getState().applyEvent(pick));
    expect(screen.queryByRole('button', { name: 'Connor McDavid' })).not.toBeInTheDocument();
    act(() => useDraftClientStore.getState().applyEvent({ ...pick, kind: 'pick_undone', seq: 2, undoneSeq: 1 }));
    expect(screen.getByRole('button', { name: 'Connor McDavid' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1); expect(api.put).not.toHaveBeenCalled();
  });
  it('saves notes automatically and preserves typing during an in-flight save', async () => {
    render(<ConnectedDraftDesk {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connor McDavid' }));
    vi.useFakeTimers();
    let finish!: (v: unknown) => void;
    api.put.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const note = screen.getByLabelText('Your note for Connor McDavid');
    fireEvent.change(note, { target: { value: 'First thought' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(550); });
    expect(api.put).toHaveBeenCalledWith(expect.stringContaining('canonical%3A8478402'),
      { note: 'First thought', target: true, version: 3 }, expect.anything());
    fireEvent.change(note, { target: { value: 'Better thought' } });
    api.put.mockResolvedValue({ data: { version: 5 } });
    await act(async () => { finish({ data: { version: 4 } }); });
    expect(api.put).toHaveBeenLastCalledWith(expect.anything(), { note: 'Better thought', target: true, version: 4 }, expect.anything());
    expect(screen.getByText('Notes and targets saved to your account.')).toBeInTheDocument();
  });
  it('retains unsaved notes after network failure and retries explicitly', async () => {
    render(<ConnectedDraftDesk {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connor McDavid' }));
    vi.useFakeTimers(); api.put.mockRejectedValueOnce(Error('Network interrupted.'));
    fireEvent.change(screen.getByLabelText('Your note for Connor McDavid'), { target: { value: 'Do not lose this' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(550); });
    expect(screen.getByRole('alert')).toHaveTextContent('Your edits are still in this tab');
    expect(screen.getByLabelText('Your note for Connor McDavid')).toHaveValue('Do not lose this');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); });
    expect(screen.getByText('Notes and targets saved to your account.')).toBeInTheDocument();
  });
  it('does not expose the buyer’s board or send pending notes after an account switch', async () => {
    const view = render(<ConnectedDraftDesk {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connor McDavid' }));
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Your note for Connor McDavid'), { target: { value: 'Private note' } });
    auth.user = { id: 'buyer-b' }; api.get.mockResolvedValue({ data: { owned: false } });
    await act(async () => { view.rerender(<ConnectedDraftDesk {...props} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.put).not.toHaveBeenCalled();
    expect(screen.queryByText('Private note')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connor McDavid' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View the draft kit' })).toBeInTheDocument();
  });
  it('shows a recoverable loading error, never a fake empty board', async () => {
    api.get.mockRejectedValueOnce(Error('Service unavailable.'));
    render(<ConnectedDraftDesk {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Connor McDavid' });
  });
  it('reloads saved notes on re-entry and discards an old league’s late response', async () => {
    let finish!: (v: unknown) => void;
    api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ConnectedDraftDesk {...props} />);
    api.get.mockResolvedValue({ data: { owned: false } });
    view.rerender(<ConnectedDraftDesk {...props} leagueId="other-league" />);
    await screen.findByRole('link', { name: 'View the draft kit' });
    await act(async () => { finish(reply()); });
    expect(screen.queryByRole('button', { name: 'Connor McDavid' })).not.toBeInTheDocument();
    api.get.mockResolvedValue(reply()); view.rerender(<ConnectedDraftDesk {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connor McDavid' }));
    expect(screen.getByLabelText('Your note for Connor McDavid')).toHaveValue('My first option');
  });
});
