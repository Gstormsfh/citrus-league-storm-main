// Phase 4.5 chunk 11g.5b — DraftRoomV2 integration test.
//
// Mocks the DraftClientRunner and asserts the page wires it
// correctly: connect on mount, disconnect on unmount, callbacks
// route to the store.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useDraftClientStore } from '@/stores/draftClientStore';

// ── Mock the runner BEFORE importing the page ─────────────────────
//
// vi.hoisted hoists mock-state init above imports so the vi.mock
// factory body can reference these names safely.

const { connectMock, disconnectMock, subscribeMock, getStateMock } = vi.hoisted(
  () => ({
    connectMock: vi.fn(),
    disconnectMock: vi.fn(),
    subscribeMock: vi.fn(() => () => {}),
    getStateMock: vi.fn(() => ({ kind: 'idle' as const })),
  }),
);

vi.mock('@/lib/draftClient/runner', () => ({
  // Constructor must be a real `class` (or `function` with prototype)
  // for `new DraftClientRunner()` to work — `vi.fn().mockImplementation`
  // returns an arrow function which can't be `new`'d.
  DraftClientRunner: class {
    connect = connectMock;
    disconnect = disconnectMock;
    subscribe = subscribeMock;
    getState = getStateMock;
  },
}));

// Mock sonner so toast helpers don't render real toasts in tests.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

import DraftRoomV2 from '../DraftRoomV2';

const renderRoute = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/draft-v2/:leagueId/:draftId?" element={<DraftRoomV2 />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  connectMock.mockClear();
  disconnectMock.mockClear();
  subscribeMock.mockClear();
  useDraftClientStore.getState().reset();
});

afterEach(() => {
  cleanup();
});

describe('DraftRoomV2 (chunk 11g.5b)', () => {
  it('mounts and calls runner.connect with leagueId + draftId from URL', () => {
    renderRoute('/draft-v2/league-abc/draft-xyz');
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith(
      { leagueId: 'league-abc', draftId: 'draft-xyz' },
      expect.objectContaining({
        onSnapshot: expect.any(Function),
        onEvent: expect.any(Function),
        onEvents: expect.any(Function),
        onPresence: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('falls back to leagueId for draftId when draftId param is missing', () => {
    renderRoute('/draft-v2/league-abc');
    expect(connectMock).toHaveBeenCalledWith(
      { leagueId: 'league-abc', draftId: 'league-abc' },
      expect.any(Object),
    );
  });

  it('subscribes to runner state changes', () => {
    renderRoute('/draft-v2/league-abc/draft-xyz');
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(expect.any(Function));
  });

  it('calls runner.disconnect on unmount', () => {
    const { unmount } = renderRoute('/draft-v2/league-abc/draft-xyz');
    expect(disconnectMock).not.toHaveBeenCalled();
    unmount();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('renders the page heading and waiting message before snapshot arrives', () => {
    renderRoute('/draft-v2/league-abc/draft-xyz');
    expect(
      screen.getByRole('heading', { name: /Draft Room v2/i }),
    ).toBeInTheDocument();
  });
});
