// ARCHITECT 2026-08-12 (LOBBY-WAIT / inbox E124) — the waiting-for-
// start banner variant.
//
// Eleven of THE TWELVE will open the draft room before the
// commissioner presses START. Before this fix every one of them was
// shown a red destructive alert reading "Connection lost /
// Reconnecting in 1s — Draft is not active. Current status:
// not_started" — an accurate server message wrapped in the wrong
// emotion. Verified in the browser on staging, not inferred.
//
// This file locks the three things that must stay true: the copy is
// calm, the styling is not destructive, and the OTHER two variants
// (real disconnect, watchdog stale) are untouched.

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

describe('ConnectionBanner — waitingForStart variant', () => {
  it('says the draft has not started, not that the connection is lost', () => {
    setStateTo(waiting);
    renderBanner();
    expect(screen.getByText(/Waiting for the draft to start/)).toBeInTheDocument();
    expect(screen.queryByText(/Connection lost/)).toBeNull();
  });

  it('reassures rather than counting down', () => {
    setStateTo(waiting);
    renderBanner();
    expect(screen.getByText(/commissioner starts the draft/)).toBeInTheDocument();
    expect(screen.queryByText(/Reconnecting in/)).toBeNull();
  });

  it('is a status, not an alert — no destructive styling, no assertive role', () => {
    setStateTo(waiting);
    renderBanner();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
    const el = document.querySelector('[data-banner-kind="reconnecting"]');
    expect(el?.getAttribute('data-waiting-for-start')).toBe('true');
  });

  it('never leaks the raw server string at the user', () => {
    setStateTo({ ...waiting, lastError: 'Draft is not active. Current status: not_started' });
    renderBanner();
    expect(screen.queryByText(/Current status: not_started/)).toBeNull();
  });
});

describe('ConnectionBanner — the other two variants are untouched', () => {
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
});
