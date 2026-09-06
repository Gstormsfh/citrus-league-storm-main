import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/services/NotificationService';
const mocks = vi.hoisted(() => ({ load: vi.fn(), count: vi.fn(), subscribe: vi.fn(), close: vi.fn() }));
vi.mock('@/services/NotificationService', () => ({ NotificationService: {
  getNotifications: mocks.load, getUnreadCount: mocks.count, subscribeToNotifications: mocks.subscribe,
} }));
import { useNotificationStore } from '../notificationStore';
const message = { id: 'private-message', user_id: 'alice', league_id: 'league', type: 'CHAT', read_status: false } as Notification;
beforeEach(() => {
  useNotificationStore.getState().reset();
  vi.clearAllMocks();
  mocks.count.mockResolvedValue({ data: 1, error: null });
  mocks.subscribe.mockReturnValue(mocks.close);
});
describe('notification account isolation', () => {
  it('closes the previous account channel and clears its messages on account switch', async () => {
    mocks.load.mockResolvedValue({ data: [message], error: null });
    await useNotificationStore.getState().loadNotifications('league', 'alice');
    useNotificationStore.getState().subscribe('league', 'alice');
    const callback = mocks.subscribe.mock.calls[0][2] as (message: Notification) => void;
    useNotificationStore.getState().subscribe('league', 'bob');
    callback(message);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(useNotificationStore.getState().notifications.size).toBe(0);
    expect(useNotificationStore.getState().unreadCounts.size).toBe(0);
    expect(mocks.subscribe).toHaveBeenLastCalledWith('league', 'bob', expect.any(Function));
  });
  it('does not resurrect messages when an older load finishes after a blocking refresh', async () => {
    let finish!: (value: { data: Notification[]; error: null }) => void;
    mocks.load.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ data: [], error: null });
    const earlier = useNotificationStore.getState().loadNotifications('league', 'alice');
    await useNotificationStore.getState().loadNotifications('league', 'alice');
    finish({ data: [message], error: null });
    await earlier;
    expect(useNotificationStore.getState().notifications.get('league')).toEqual([]);
  });
  it('ignores an in-flight response after sign-out, even when the same account signs back in', async () => {
    let finish!: (value: { data: Notification[]; error: null }) => void;
    mocks.load.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = useNotificationStore.getState().loadNotifications('league', 'alice');
    useNotificationStore.getState().reset();
    useNotificationStore.getState().setAccount('alice');
    finish({ data: [message], error: null });
    await pending;
    expect(useNotificationStore.getState().notifications.size).toBe(0);
    expect(mocks.count).not.toHaveBeenCalled();
  });
});
