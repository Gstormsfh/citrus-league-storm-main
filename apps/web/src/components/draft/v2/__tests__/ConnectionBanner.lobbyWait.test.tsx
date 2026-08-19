// ARCHITECT 2026-08-12 (LOBBY-WAIT / inbox E124) — the waiting-for-start
// banner variant.
//
// Eleven of THE TWELVE will open the draft room before the commissioner
// presses START. Before that fix every one of them was shown a red
// destructive alert reading "Connection lost / Reconnecting in 1s —
// Draft is not active. Current status: not_started" — an accurate server
// message wrapped in the wrong emotion.
//
// ─────────────────────────────────────────────────────────────────────
// SUPERSEDED 2026-08-19. The intent above is unchanged and still
// enforced; the surface moved.
//
// When E124 was written there was no commissioner lobby, so a calm
// banner was the only place to say "not started yet". DraftLobbyV2 now
// owns that state completely: it names every team, shows who has joined,
// gives the commissioner the Start button, and explains what is blocking
// a start. Keeping the banner as well produced two stacked panels saying
// the same thing — the upper one headed "Waiting for the draft to start"
// with a RETRY NOW button, which invited the commissioner to retry a
// connection that was working perfectly while the actual next action sat
// underneath it. Observed on production 2026-08-19.
//
// So the banner is now SILENT for waitingForStart. This file locks:
//   1. silence during lobby wait (no duplicate, no misleading retry),
//   2. silence for the transient `connecting` blips that the discovery
//      poll produces every ~3s while waiting — the cause of the flicker,
//   3. the other two variants (real disconnect, watchdog stale) are
//      still fully intact, because those ARE connection problems.
// ─────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectionBanner } from '../ConnectionBanner';
import { useDraftClientStore } from '@/stores/draftClientStore';
import type { DraftClientState } from '@/lib/draftClient/types';

const setStateTo = (state: DraftClientState) =>
  useDraftClientStore.getState().setConnectionState(state);

const renderBanner = () =>
  render(
    <MemoryRouter>
      <ConnectionBanner />
    </MemoryRouter>,
  );

beforeEach(() => {
  cleanup();
  useDraftClientStore.getState().reset();
});

const waiting: DraftClientState = {
  kind: 'reconnecting',
  attempt: 0,
  nextAttemptAt: Date.now() + 3000,
  lastError: null,
  waitingForStart: true,
};

describe('ConnectionBanner — waitingForStart is the lobby’s job, not the banner’s', () => {
  it('renders nothing at all — DraftLobbyV2 owns this state', () => {
    setStateTo(waiting);
    const { container } = renderBanner();
    expect(container.textContent).toBe('');
  });

  it('offers no retry affordance, so nobody is told to fix a working connection', () => {
    setStateTo(waiting);
    renderBanner();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('never shows connection-failure language for a draft that simply has not started', () => {
    setStateTo({ ...waiting, lastError: 'Draft is not active. Current status: not_started' });
    renderBanner();
    expect(screen.queryByText(/Connection lost/)).toBeNull();
    expect(screen.queryByText(/Reconnecting in/)).toBeNull();
    // and it still never leaks the raw server string
    expect(screen.queryByText(/Current status: not_started/)).toBeNull();
  });

  it('stays silent through the transient connecting blip between discovery polls', () => {
    // This is the flicker fix. While waiting, the client cycles
    // reconnecting(waitingForStart) -> connecting -> reconnecting(...)
    // about every 3 seconds. Showing "Connecting to draft…" on that
    // cadence made the top of the room strobe above a healthy lobby.
    setStateTo(waiting);
    const view = renderBanner();
    setStateTo({ kind: 'connecting', attempt: 0 } as DraftClientState);
    expect(view.container.textContent).toBe('');
  });
});

describe('ConnectionBanner — real connection problems are untouched', () => {
  it('a real disconnect still renders the destructive "Connection lost" alert', () => {
    setStateTo({
      kind: 'reconnecting',
      attempt: 1,
      nextAttemptAt: Date.now() + 3000,
      lastError: 'WebSocket dropped',
    });
    renderBanner();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Connection lost/)).toBeInTheDocument();
    expect(screen.getByText(/Reconnecting in/)).toBeInTheDocument();
    expect(screen.getByText(/WebSocket dropped/)).toBeInTheDocument();
  });

  it('the watchdog-stale variant still renders its own title', () => {
    setStateTo({
      kind: 'reconnecting',
      attempt: 2,
      nextAttemptAt: Date.now() + 3000,
      lastError: 'WebSocket closed: code=4010',
      staleTriggered: true,
    });
    renderBanner();
    expect(screen.getByText(/Connection appears stale/)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the draft to start/)).toBeNull();
  });

  it('a plain connecting state (never having waited on a lobby) still says so', () => {
    setStateTo({ kind: 'connecting', attempt: 0 } as DraftClientState);
    renderBanner();
    expect(screen.getByText(/Connecting to draft/)).toBeInTheDocument();
  });
});
