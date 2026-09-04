// CitrusToaster + useNotificationCards: the realtime bridge (2026-09-03).
//
// The status card shipped a day earlier with no caller. This file pins the
// path that now fires it: a row landing in the notification store (the one
// Navbar keeps subscribed for the active league) becomes the card at the top
// of the screen, with the shared Mug, the name, the pill, the time and the
// mark; the face is then enriched by id; and everything that is not a
// fresh, unread, player-carrying row stays exactly as it was.
//
// Driven through the REAL zustand store (setState) rather than a mocked
// hook, because the bridge's whole job is to read that store correctly:
// what it treats as history, what it treats as news, and what it ignores.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// The store's import chain reaches the API client and, through it, the
// Supabase client that throws at module scope under the empty test env.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), auth: { getSession: vi.fn() } },
}));

const getPlayersByIds = vi.fn();
vi.mock('@/services/PlayerService', () => ({
  PlayerService: { getPlayersByIds: (...a: unknown[]) => getPlayersByIds(...a) },
}));

import { CitrusToaster } from '../CitrusToaster';
import { toast, useToast } from '@/hooks/use-toast';
import { useNotificationStore } from '@/stores/notificationStore';
import type { Notification } from '@/services/NotificationService';
import { teamCrestUrl } from '@/components/roster/headshot';
import { STATUS_PILLS } from '../notificationCard';
import { FRESH_WINDOW_MS, isFreshArrival } from '../useNotificationCards';

const LEAGUE = 'league-1';
const MUG = 'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png';

let n = 0;
const row = (over: Partial<Notification> = {}): Notification => ({
  id: `n-${(n += 1)}`,
  league_id: LEAGUE,
  user_id: 'me',
  type: 'ADD',
  title: 'Free Agent Added',
  message: 'Gstorms added Connor McDavid.',
  metadata: { team_id: 'T1', team_name: 'Gstorms', player_id: '8478402', player_name: 'Connor McDavid', source: 'Free Agent' },
  read_status: false,
  created_at: new Date(Date.now() - 5_000).toISOString(),
  read_at: null,
  ...over,
});

const stale = (over: Partial<Notification> = {}) =>
  row({ created_at: new Date(Date.now() - 60 * 60_000).toISOString(), ...over });

/** Replace the store's list for the league, the way loadNotifications does. */
function setList(list: Notification[]) {
  act(() => {
    useNotificationStore.setState({ notifications: new Map([[LEAGUE, list]]) });
  });
}

/** Prepend one row, the way the realtime subscribe callback does. */
function arrive(next: Notification) {
  const current = useNotificationStore.getState().notifications.get(LEAGUE) ?? [];
  setList([next, ...current]);
}

/** Mount, then seed history so the bridge has a baseline to diff against. */
function mountWithHistory(history: Notification[] = [stale(), stale(), stale()]) {
  const utils = render(<CitrusToaster />);
  setList(history);
  expect(screen.queryByTestId('citrus-toast')).toBeNull();
  return utils;
}

/** Close whatever the last test left in the module-singleton toast store. */
function DismissAll() {
  const { dismiss } = useToast();
  React.useEffect(() => {
    dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  return null;
}

beforeEach(() => {
  getPlayersByIds.mockReset();
  getPlayersByIds.mockResolvedValue([]);
  useNotificationStore.setState({
    notifications: new Map(),
    unreadCounts: new Map(),
    loading: new Map(),
    errors: new Map(),
    subscriptions: new Map(),
  });
});

afterEach(() => {
  act(() => {
    render(<DismissAll />);
  });
});

describe('what is history and what is news', () => {
  it('the first sight of a league list is history: nothing is replayed on load', () => {
    render(<CitrusToaster />);
    // Unread and recent, but they were there when the list first appeared.
    setList([row(), row(), row()]);
    expect(screen.queryByTestId('citrus-toast')).toBeNull();
  });

  it('a row that arrives after the baseline becomes a card', () => {
    mountWithHistory();
    arrive(row());
    expect(screen.getByTestId('citrus-toast')).toBeInTheDocument();
  });

  it('a never-seen row that is already read, or older than the window, is not news', () => {
    mountWithHistory();
    // The chat RPC inserts the sender's own copy already read; a reconnect
    // can re-order last hour's rows to the front. Neither is a card.
    arrive(row({ read_status: true }));
    expect(screen.queryByTestId('citrus-toast')).toBeNull();
    arrive(row({ created_at: new Date(Date.now() - FRESH_WINDOW_MS - 1_000).toISOString() }));
    expect(screen.queryByTestId('citrus-toast')).toBeNull();
  });

  it('isFreshArrival: unread and inside the window, and the future counts as now', () => {
    const now = 1_800_000_000_000;
    const at = (delta: number) => new Date(now + delta).toISOString();
    expect(isFreshArrival({ read_status: false, created_at: at(-1_000) }, now)).toBe(true);
    expect(isFreshArrival({ read_status: false, created_at: at(-FRESH_WINDOW_MS) }, now)).toBe(true);
    expect(isFreshArrival({ read_status: false, created_at: at(-FRESH_WINDOW_MS - 1) }, now)).toBe(false);
    expect(isFreshArrival({ read_status: false, created_at: at(+5_000) }, now)).toBe(true);
    expect(isFreshArrival({ read_status: true, created_at: at(-1_000) }, now)).toBe(false);
    expect(isFreshArrival({ read_status: false, created_at: 'garbage' }, now)).toBe(false);
  });

  it('a burst leaves the NEWEST event on screen (TOAST_LIMIT is 1)', () => {
    mountWithHistory();
    const older = row({ metadata: { ...row().metadata, player_name: 'Cale Makar' } });
    const newer = row({ metadata: { ...row().metadata, player_name: 'Connor McDavid' } });
    // The store prepends, so the list reads newest-first.
    setList([newer, older, ...(useNotificationStore.getState().notifications.get(LEAGUE) ?? [])]);
    expect(screen.getByTestId('citrus-toast-headline')).toHaveTextContent('Connor McDavid');
    expect(screen.queryByText('Cale Makar', { selector: 'div' })).toBeNull();
  });
});

describe('the rich card, from a row', () => {
  it('an ADD renders the shared Mug, the name, the meta line, the pill, the time and the mark', () => {
    const { container } = mountWithHistory();
    arrive(row());

    const card = screen.getByTestId('citrus-toast');
    expect(card.getAttribute('data-kind')).toBe('player');

    // The face is the shared Mug at its initials fallback: the row has no
    // headshot, and a private <img> is exactly what this component must
    // not grow. `data-mug-state` is Mug's own attribute.
    const mug = container.querySelector('[data-mug-state]');
    expect(mug?.getAttribute('data-mug-state')).toBe('initials');
    expect(screen.getByRole('img', { name: 'Connor McDavid' })).toHaveTextContent('CM');
    // 36px, the `sm` box, the same rail the move card uses.
    expect(mug?.className).toContain('w-9');
    expect(mug?.className).toContain('h-9');

    expect(screen.getByTestId('citrus-toast-headline')).toHaveTextContent('Connor McDavid');
    expect(screen.getByTestId('citrus-toast-meta')).toHaveTextContent('Gstorms · free agent pickup');
    const pill = screen.getByTestId('citrus-toast-status');
    expect(pill).toHaveTextContent(STATUS_PILLS.added.label);
    expect(pill.getAttribute('data-tone')).toBe('good');
    expect(screen.getByTestId('citrus-toast-time')).toHaveTextContent('now');
    expect(screen.getByTestId('citrus-toast-mark')).toHaveTextContent('Citrus');
    // No generic icon on a status card.
    expect(screen.queryByTestId('citrus-toast-icon')).toBeNull();
  });

  it('the time is the row\'s created_at, not the moment the card appeared', () => {
    mountWithHistory();
    arrive(row({ created_at: new Date(Date.now() - 90_000).toISOString() }));
    expect(screen.getByTestId('citrus-toast-time')).toHaveTextContent('1m');
  });

  it('a waiver claim that cleared, a drop and a trade each wear their own pill', () => {
    mountWithHistory();
    arrive(row({ metadata: { ...row().metadata, source: 'Waiver Processing' } }));
    let pill = screen.getByTestId('citrus-toast-status');
    expect(pill).toHaveTextContent(STATUS_PILLS.waiverCleared.label);
    expect(pill.getAttribute('data-tone')).toBe('good');

    arrive(row({ type: 'DROP', title: 'Player Dropped' }));
    pill = screen.getByTestId('citrus-toast-status');
    expect(pill).toHaveTextContent(STATUS_PILLS.dropped.label);
    expect(pill.getAttribute('data-tone')).toBe('neutral');
    expect(screen.getByTestId('citrus-toast-meta')).toHaveTextContent('Gstorms · released');

    arrive(row({ type: 'TRADE', title: 'Trade Completed', metadata: { ...row().metadata, source: 'Trade in' } }));
    pill = screen.getByTestId('citrus-toast-status');
    expect(pill).toHaveTextContent(STATUS_PILLS.tradeAccepted.label);
  });

  it('the face is enriched by id after the card is already on screen', async () => {
    getPlayersByIds.mockResolvedValue([
      { id: '8478402', full_name: 'Connor McDavid', headshot_url: MUG, team: 'EDM' },
    ]);
    const { container } = mountWithHistory();
    arrive(row());
    // Shown at once, before the directory answers.
    expect(container.querySelector('[data-mug-state]')?.getAttribute('data-mug-state')).toBe('initials');
    expect(getPlayersByIds).toHaveBeenCalledWith(['8478402']);

    await waitFor(() => {
      expect(container.querySelector('[data-mug-state]')?.getAttribute('data-mug-state')).toBe('image');
    });
    const img = screen.getByAltText('Connor McDavid') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(MUG);
    expect(screen.getByTestId('mug-crest-badge').getAttribute('src')).toBe(teamCrestUrl('EDM'));
    // The headline did not change under the face.
    expect(screen.getByTestId('citrus-toast-headline')).toHaveTextContent('Connor McDavid');
  });

  it('a directory that does not know the player leaves the initials standing', async () => {
    getPlayersByIds.mockResolvedValue([{ id: '1', full_name: 'Someone Else', headshot_url: MUG, team: 'TOR' }]);
    const { container } = mountWithHistory();
    arrive(row());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-mug-state]')?.getAttribute('data-mug-state')).toBe('initials');
  });

  it('a directory failure is a card with initials, not a rejected promise', async () => {
    getPlayersByIds.mockRejectedValue(new Error('offline'));
    const { container } = mountWithHistory();
    arrive(row());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-mug-state]')?.getAttribute('data-mug-state')).toBe('initials');
    expect(screen.getByTestId('citrus-toast')).toBeInTheDocument();
  });
});

describe('the plain shape is untouched', () => {
  it('a row with a null player id renders the plain card, with the server copy', () => {
    const { container } = mountWithHistory();
    arrive(row({ metadata: { ...row().metadata, player_id: null } }));
    const card = screen.getByTestId('citrus-toast');
    expect(card.getAttribute('data-kind')).toBe('info');
    expect(container.querySelector('[data-mug-state]')).toBeNull();
    expect(screen.queryByTestId('citrus-toast-status')).toBeNull();
    expect(screen.getByTestId('citrus-toast-icon')).toBeInTheDocument();
    expect(screen.getByText('Free Agent Added')).toBeInTheDocument();
    expect(screen.getByText('Gstorms added Connor McDavid.')).toBeInTheDocument();
    // No enrichment is attempted for a card with no face.
    expect(getPlayersByIds).not.toHaveBeenCalled();
  });

  it('SYSTEM and CHAT are plain cards; CHAT is headed by the sender', () => {
    mountWithHistory();
    arrive(row({ type: 'SYSTEM', title: 'Keepers Locked', message: '3 keepers locked.', metadata: {} }));
    expect(screen.getByTestId('citrus-toast').getAttribute('data-kind')).toBe('info');
    expect(screen.getByText('Keepers Locked')).toBeInTheDocument();

    arrive(
      row({
        type: 'CHAT',
        title: 'Lime sent a message',
        message: 'who wants Makar',
        metadata: { sender_id: 'U2', sender_name: 'Lime' },
      }),
    );
    expect(screen.getByText('Lime')).toBeInTheDocument();
    expect(screen.getByText('who wants Makar')).toBeInTheDocument();
    expect(screen.queryByText('Lime sent a message')).toBeNull();
  });

  it('the OLD calling convention still renders while the bridge is mounted', () => {
    mountWithHistory();
    act(() => {
      toast({ title: 'Lineup Optimized', description: '3 changes saved' });
    });
    const card = screen.getByTestId('citrus-toast');
    expect(card.getAttribute('data-kind')).toBe('info');
    expect(screen.getByText('Lineup Optimized')).toBeInTheDocument();
    expect(screen.getByText('3 changes saved')).toBeInTheDocument();
  });
});
