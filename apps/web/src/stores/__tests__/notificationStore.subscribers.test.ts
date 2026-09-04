// notificationStore: one realtime channel per league, shared by every mounted
// holder, closed by the last one.
//
// Measured 2026-09-03 by reading: Navbar.tsx subscribes app-wide and the
// matchup rail (LeagueNotifications.tsx) subscribes while mounted, both on
// the same leagueId. The rail's cleanup called unsubscribe(), which tore
// down the ONE channel, so after the first visit to /matchup no realtime
// notification (and no rich card) arrived until a league switch or reload.
// Nothing errored; the feed just went quiet. The store now counts holders.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const closeSpy = vi.fn();
const subscribeSpy = vi.fn((..._args: unknown[]) => closeSpy);

vi.mock('@/services/NotificationService', () => ({
  NotificationService: {
    subscribeToNotifications: (...args: unknown[]) => subscribeSpy(...args),
  },
}));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/userMessage', () => ({ userMessage: (_e: unknown, fallback: string) => fallback }));

import { useNotificationStore } from '../notificationStore';

const LEAGUE = 'league-a';
const USER = 'user-1';

beforeEach(() => {
  closeSpy.mockClear();
  subscribeSpy.mockClear();
  useNotificationStore.setState({ subscriptions: new Map(), subscriberCounts: new Map() });
});

describe('notificationStore subscriptions are reference counted', () => {
  it('a second holder shares the channel instead of reopening it', () => {
    const store = useNotificationStore.getState();
    store.subscribe(LEAGUE, USER);
    store.subscribe(LEAGUE, USER);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().subscriberCounts.get(LEAGUE)).toBe(2);
  });

  it('the first holder leaving does not close the channel the second still needs', () => {
    const store = useNotificationStore.getState();
    store.subscribe(LEAGUE, USER);
    store.subscribe(LEAGUE, USER);
    store.unsubscribe(LEAGUE);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().subscriptions.has(LEAGUE)).toBe(true);
    expect(useNotificationStore.getState().subscriberCounts.get(LEAGUE)).toBe(1);
  });

  it('the last holder leaving closes it and forgets it', () => {
    const store = useNotificationStore.getState();
    store.subscribe(LEAGUE, USER);
    store.subscribe(LEAGUE, USER);
    store.unsubscribe(LEAGUE);
    store.unsubscribe(LEAGUE);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(useNotificationStore.getState().subscriptions.has(LEAGUE)).toBe(false);
    expect(useNotificationStore.getState().subscriberCounts.has(LEAGUE)).toBe(false);
  });

  it('an unsubscribe with no holders is a no-op, never a negative count', () => {
    const store = useNotificationStore.getState();
    store.unsubscribe(LEAGUE);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().subscriberCounts.has(LEAGUE)).toBe(false);
  });

  it('leagues are counted independently', () => {
    const store = useNotificationStore.getState();
    store.subscribe(LEAGUE, USER);
    store.subscribe('league-b', USER);
    store.unsubscribe(LEAGUE);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(useNotificationStore.getState().subscriptions.has('league-b')).toBe(true);
  });
});
