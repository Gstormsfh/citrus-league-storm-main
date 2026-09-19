import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectionSettings, type BufferedDraftEvent } from '@citrus/shared';
import { ConnectedDraftDesk, DraftDeskPanel, type DeskLiveState } from '../ConnectedDraftDesk';
import { useDraftClientStore } from '@/stores/draftClientStore';
import { deskFixture } from './deskFixture';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }));

const live: DeskLiveState = { status: 'live', unavailableIds: new Set(), sequence: 0 };
const scoring = projectionSettings(deskFixture().kit.weights);
const stateSnapshot = { totalPicks: 6, draftStatus: 'in_progress' as const, currentPickNumber: 1, currentRoundNumber: 1, onClockTeamId: 'one', picksMade: 0, currentPickDeadline: null };
async function upload(content = JSON.stringify(deskFixture())) {
  const file = { size: content.length, text: async () => content };
  fireEvent.change(screen.getByLabelText(/Load (your Citrus draft desk|another desk)/), { target: { files: [file] } });
  await screen.findByText('My custom league');
}
beforeEach(() => useDraftClientStore.getState().reset());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Citrus connected draft desk', () => {
  it('directs external draft customers to their host instead of the Citrus Players tab', async () => {
    render(<DraftDeskPanel live={{...live, sourceLabel:'ESPN'}} scoring={scoring} scoringReady />);
    await upload();
    expect(screen.getByText(/Make your picks in your ESPN draft room/)).toBeInTheDocument();
    expect(screen.queryByText(/Make your picks in the Players tab/)).not.toBeInTheDocument();
  });
  it('follows confirmed picks, undos and keepers through the real room store', async () => {
    const store = useDraftClientStore.getState();
    store.setSnapshot({ lobbyId: 'lobby', format: 'snake', recentEvents: [], stateSnapshot });
    useDraftClientStore.setState({ connectionState: { kind: 'connected', wsUrl: '', lastSeenSeq: 0, sessionId: 'test' } });
    render(<ConnectedDraftDesk leagueId="league-one" scoring={scoring} scoringReady />);
    await upload();
    expect(screen.getByRole('button', { name: 'Connor McDavid' })).toBeInTheDocument();
    const pick: BufferedDraftEvent = { kind: 'pick_submitted', seq: 1, timestamp: '2026-09-16T00:00:00Z', teamId: 'one', playerId: 8478402, pickNumber: 1, roundNumber: 1, correlationId: 'one' };
    act(() => store.applyEvent(pick));
    expect(screen.queryByRole('button', { name: 'Connor McDavid' })).not.toBeInTheDocument();
    act(() => store.applyEvent({ ...pick, kind: 'pick_undone', seq: 2, undoneSeq: 1 }));
    expect(screen.getByRole('button', { name: 'Connor McDavid' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Target: Connor McDavid' })).toHaveAttribute('aria-pressed', 'true');
    act(() => useDraftClientStore.setState(s => ({ derivedState: { ...s.derivedState!, keepers: [{ playerId: '8482116', teamId: 'one', round: 4 }] } })));
    expect(screen.queryByRole('button', { name: 'Tim Stützle' })).not.toBeInTheDocument();
  });
  it('warns on reconnect and event gaps, then clears after resync', async () => {
    useDraftClientStore.getState().setSnapshot({ lobbyId: 'lobby', format: 'snake', recentEvents: [], stateSnapshot });
    render(<ConnectedDraftDesk leagueId="league-one" scoring={scoring} scoringReady />);
    await upload();
    act(() => useDraftClientStore.setState({ connectionState: { kind: 'reconnecting', nextAttemptAt: 0, attempt: 1, lastError: 'offline' } }));
    expect(screen.getByRole('status')).toHaveTextContent('Connection interrupted');
    act(() => useDraftClientStore.setState({ connectionState: { kind: 'connected', wsUrl: '', lastSeenSeq: 2, sessionId: 'test' }, lastFoldGaps: [1] }));
    expect(screen.getByRole('status')).toHaveTextContent('Catching up');
    act(() => useDraftClientStore.setState({ lastFoldGaps: [] }));
    expect(screen.getByRole('status')).toHaveTextContent('Following Citrus picks');
  });
  it('clears the imported desk on league switch', async () => {
    const view = render(<ConnectedDraftDesk leagueId="one" scoring={scoring} scoringReady />);
    await upload();
    view.rerender(<ConnectedDraftDesk leagueId="two" scoring={scoring} scoringReady />);
    expect(screen.queryByText('My custom league')).not.toBeInTheDocument();
  });
  it('edits notes, filters accented names and never exposes a pick submission action', async () => {
    render(<DraftDeskPanel live={live} scoring={scoring} scoringReady />); await upload();
    fireEvent.click(screen.getByRole('button', { name: 'Connor McDavid' }));
    const note = screen.getByLabelText('Your note for Connor McDavid');
    expect(note).toHaveValue('My first option');
    fireEvent.change(note, { target: { value: 'Wait for my next turn' } });
    expect(note).toHaveValue('Wait for my next turn');
    fireEvent.change(screen.getByLabelText('Find a player'), { target: { value: 'stutzle' } });
    expect(screen.getByRole('button', { name: 'Tim Stützle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connor McDavid' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draft player|Submit pick/i })).not.toBeInTheDocument();
  });
  it('makes a scoring mismatch or failed scoring read explicit', async () => {
    const view = render(<DraftDeskPanel live={live} scoring={scoring} scoringReady={false} />); await upload();
    expect(screen.getByRole('alert')).toHaveTextContent('not been verified');
    view.rerender(<DraftDeskPanel live={live} scoring={{ ...scoring, skater: { ...scoring.skater, hits: 3 } }} scoringReady />);
    expect(screen.getByRole('alert')).toHaveTextContent('skater: hits');
    expect(screen.getByText('900')).toBeInTheDocument();
  });
  it('keeps the current desk after invalid input and requires confirmation to replace notes', async () => {
    render(<DraftDeskPanel live={live} scoring={scoring} scoringReady />); await upload();
    await upload('{}');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not a supported Citrus'));
    await upload();
    await screen.findByRole('button', { name: 'Replace current desk' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replacement' }));
    expect(screen.getByRole('button', { name: 'Target: Connor McDavid' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('exports a session with live availability and offline-compatible progress', async () => {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((b: Blob) => { blobs.push(b); return 'blob:test'; }) });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<DraftDeskPanel live={{ ...live, unavailableIds: new Set(['8482116']) }} scoring={scoring} scoringReady />); await upload();
    fireEvent.click(screen.getByRole('button', { name: 'Save session file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save offline progress' }));
    const read = (b: Blob) => new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(b); });
    const session = JSON.parse(await read(blobs[0])); const progress = JSON.parse(await read(blobs[1]));
    expect(session.kit).toEqual(deskFixture().kit);
    expect(session.progress).toEqual(progress);
    expect(progress.rows.map((r: { drafted: boolean }) => r.drafted)).toEqual([false, true]);
  });
  it('hides availability without verified access', async () => {
    render(<DraftDeskPanel live={{ ...live, status: 'denied' }} scoring={scoring} scoringReady />); await upload();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/Availability is hidden/)).toBeInTheDocument();
  });
});
