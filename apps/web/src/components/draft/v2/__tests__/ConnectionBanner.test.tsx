// Phase 4.5 chunk 11g.5b — ConnectionBanner tests.
//
// React Testing Library + accessibility-driven queries. Establishes
// the convention for `.test.tsx` files in apps/web (5b is the first;
// 5a was all `.test.ts`).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectionBanner } from '../ConnectionBanner';
import { useDraftClientStore } from '@/stores/draftClientStore';
import type { DraftClientState } from '@/lib/draftClient/types';

const setStateTo = (state: DraftClientState) =>
  useDraftClientStore.getState().setConnectionState(state);

const renderBanner = (onRetryNow?: () => void) =>
  render(
    <MemoryRouter>
      <ConnectionBanner onRetryNow={onRetryNow} />
    </MemoryRouter>,
  );

beforeEach(() => {
  useDraftClientStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionBanner — transient states', () => {
  it('renders nothing in idle state', () => {
    setStateTo({ kind: 'idle' });
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing in connected state (steady state)', () => {
    setStateTo({
      kind: 'connected',
      wsUrl: 'ws://x',
      lastSeenSeq: 5,
      sessionId: 'sess-1',
    });
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders Connecting indicator with aria-live polite for fetching_token', () => {
    setStateTo({ kind: 'fetching_token', attempt: 0 });
    renderBanner();
    const indicator = screen.getByText(/Connecting to draft/);
    expect(indicator).toBeInTheDocument();
    // The indicator div is itself the aria-live region (text is its
    // direct child).
    expect(indicator).toHaveAttribute('aria-live', 'polite');
  });

  it('renders Connecting indicator for connecting state', () => {
    setStateTo({
      kind: 'connecting',
      wsUrl: 'ws://x',
      attempt: 0,
    });
    renderBanner();
    expect(screen.getByText(/Connecting to draft/)).toBeInTheDocument();
  });

  it('renders Catching up indicator for resyncing state', () => {
    setStateTo({
      kind: 'resyncing',
      wsUrl: 'ws://x',
      sinceSeq: 5,
      sessionId: 'sess-1',
    });
    renderBanner();
    expect(screen.getByText(/Catching up/)).toBeInTheDocument();
  });
});

describe('ConnectionBanner — reconnecting state', () => {
  it('renders the destructive banner with countdown', () => {
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

  it('"Retry now" button calls onRetryNow', () => {
    const onRetryNow = vi.fn();
    setStateTo({
      kind: 'reconnecting',
      attempt: 1,
      nextAttemptAt: Date.now() + 3000,
      lastError: null,
    });
    renderBanner(onRetryNow);
    const button = screen.getByRole('button', { name: /Retry now/i });
    fireEvent.click(button);
    expect(onRetryNow).toHaveBeenCalledTimes(1);
  });

  it('does NOT render Retry button when onRetryNow is not provided', () => {
    setStateTo({
      kind: 'reconnecting',
      attempt: 1,
      nextAttemptAt: Date.now() + 3000,
      lastError: null,
    });
    renderBanner(); // no onRetryNow
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });
});

describe('ConnectionBanner — fatal states', () => {
  it('renders auth_failure banner with "Return to dashboard" link', () => {
    setStateTo({
      kind: 'fatal',
      reason: 'auth_failure',
      errorMessage: 'Token expired',
    });
    renderBanner();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/no longer authorized/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return to dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('renders invalid_lobby banner with "Back to dashboard" link', () => {
    setStateTo({
      kind: 'fatal',
      reason: 'invalid_lobby',
      errorMessage: 'Draft not found',
    });
    renderBanner();
    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to dashboard/i })).toBeInTheDocument();
  });

  it('renders permanent_server_error banner with DR-4 honest copy (no auto-retry promise)', () => {
    setStateTo({
      kind: 'fatal',
      reason: 'permanent_server_error',
      errorMessage: 'WebSocket closed with server code 4500',
    });
    renderBanner();
    // DR-4: copy must NOT promise auto-retry behavior the code doesn't
    // perform (invariant I2 generalizes beyond the clock).
    expect(screen.getByText(/Can.t reach the draft server/i)).toBeInTheDocument();
    expect(screen.getByText(/isn.t reachable right now/i)).toBeInTheDocument();
    expect(screen.getByText(/your picks are safe/i)).toBeInTheDocument();
    // Absent: the pre-DR-4 title, and any "we'll keep trying" language.
    expect(screen.queryByText(/^Connection error$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/we.ll keep trying/i)).not.toBeInTheDocument();
    // Technical details collapsed by default (details element present,
    // pre content not visible without expanding — but the raw text is
    // still in the DOM behind a summary).
    expect(screen.getByText(/Technical details/)).toBeInTheDocument();
    // Reload-page button remains as a blunt option, but Retry-now is
    // the primary path.
    expect(screen.getByRole('button', { name: /Reload page/i })).toBeInTheDocument();
  });

  // DR-4 (2026-07-30) — 4400 waiting-room disposition test. Pre-DR-4
  // this case fell through to the generic permanent_server_error
  // banner and rendered "Connection error" — misleading. Now renders
  // the explicit "waiting on your commissioner" copy per architect.
  it('renders draft_not_initialized banner with waiting-room copy + manual Retry', () => {
    setStateTo({
      kind: 'fatal',
      reason: 'draft_not_initialized',
      errorMessage: 'Draft not yet configured (code 4400)',
    });
    const onRetryNow = vi.fn();
    renderBanner(onRetryNow);
    expect(screen.getByText(/Waiting on your commissioner/i)).toBeInTheDocument();
    expect(
      screen.getByText(/hasn.t been set up yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/still needs to set the draft order/i),
    ).toBeInTheDocument();
    // Manual Retry button present + wired.
    const retryBtn = screen.getByRole('button', { name: /Retry now/i });
    fireEvent.click(retryBtn);
    expect(onRetryNow).toHaveBeenCalledTimes(1);
    // Absent: the wrong pre-DR-4 fallthrough copy.
    expect(screen.queryByText(/^Connection error$/)).not.toBeInTheDocument();
  });
});

describe('ConnectionBanner — countdown ticks', () => {
  it('updates the countdown display as time passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    try {
      setStateTo({
        kind: 'reconnecting',
        attempt: 1,
        nextAttemptAt: Date.now() + 3000,
        lastError: null,
      });
      renderBanner();
      expect(screen.getByText(/Reconnecting in 3s/)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      // After 1.5s elapsed of a 3s deadline, ~2s remaining (ceil).
      expect(screen.getByText(/Reconnecting in 2s/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
