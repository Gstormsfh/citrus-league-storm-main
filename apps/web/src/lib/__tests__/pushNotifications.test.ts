import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const push = vi.hoisted(() => ({
  checkPermissions: vi.fn(), requestPermissions: vi.fn(), addListener: vi.fn(),
  register: vi.fn(), unregister: vi.fn(), removeAllListeners: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));
let listeners: Map<string, (value: unknown) => void>;
let removers: Map<string, ReturnType<typeof vi.fn>>;
let rows: Array<{ user_id: string; token: string }>;
let upsert: ReturnType<typeof vi.fn>;
let client: SupabaseClient;

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  listeners = new Map(); removers = new Map(); rows = [];
  push.checkPermissions.mockResolvedValue({ receive: 'granted' });
  push.unregister.mockResolvedValue(undefined);
  push.addListener.mockImplementation(async (name, callback) => {
    listeners.set(name, callback);
    const remove = vi.fn(async () => { listeners.delete(name); });
    removers.set(name, remove);
    return { remove };
  });
  push.register.mockImplementation(async () => listeners.get('registration')?.({ value: 'this-phone' }));
  upsert = vi.fn(async (row) => { rows.push(row); return { error: null }; });
  client = { from: () => ({ upsert, delete: () => ({ eq: (key: string, value: string) => ({
    eq: async (second: string, secondValue: string) => {
      rows = rows.filter((row) => !(row[key as keyof typeof row] === value && row[second as keyof typeof row] === secondValue));
      return { error: null };
    },
  }) }) }) } as unknown as SupabaseClient;
});
afterEach(() => vi.useRealTimers());

describe('device push lifecycle', () => {
  it('keeps other phones and the tap listener working after sign-out and sign-in', async () => {
    const api = await import('../pushNotifications');
    const navigate = vi.fn();
    const unsubscribe = api.registerPushTapListener(navigate);
    await api.registerForPush(client, 'owner');
    rows.push({ user_id: 'owner', token: 'other-phone' });
    await api.unregisterDeviceToken(client, 'owner');
    expect(rows).toEqual([{ user_id: 'owner', token: 'other-phone' }]);
    expect(push.unregister).toHaveBeenCalledOnce();
    expect(push.removeAllListeners).not.toHaveBeenCalled();
    await api.registerForPush(client, 'next-owner');
    listeners.get('pushNotificationActionPerformed')?.({ notification: { data: {
      type: 'draft_on_the_clock', leagueId: 'league',
    } } });
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/draft-v2/league');
    expect(removers.get('registration')).toHaveBeenCalledOnce();
    expect(removers.get('registrationError')).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('still removes the server token if native unregister fails', async () => {
    const api = await import('../pushNotifications');
    await api.registerForPush(client, 'owner');
    push.unregister.mockRejectedValueOnce(new Error('native failure'));
    await api.unregisterDeviceToken(client, 'owner');
    expect(rows).toEqual([]);
  });

  it('remembers the installation token across a webview reload', async () => {
    const api = await import('../pushNotifications');
    await api.registerForPush(client, 'owner');
    rows.push({ user_id: 'owner', token: 'other-phone' });
    vi.resetModules();
    await (await import('../pushNotifications')).unregisterDeviceToken(client, 'owner');
    expect(rows).toEqual([{ user_id: 'owner', token: 'other-phone' }]);
  });

  it('waits for an in-flight registration write before sign-out cleanup', async () => {
    const api = await import('../pushNotifications');
    let complete!: () => void;
    upsert.mockImplementationOnce(async (row) => {
      await new Promise<void>((resolve) => { complete = resolve; });
      rows.push(row); return { error: null };
    });
    const registering = api.registerForPush(client, 'owner');
    await vi.waitFor(() => expect(upsert).toHaveBeenCalled());
    const unregistering = api.unregisterDeviceToken(client, 'owner');
    complete();
    await Promise.all([registering, unregistering]);
    expect(rows).toEqual([]);
  });

  it('cleans only its own listeners when APNs registration fails', async () => {
    const api = await import('../pushNotifications');
    push.register.mockRejectedValueOnce(new Error('offline'));
    expect(await api.registerForPush(client, 'owner')).toBe(false);
    expect(removers.get('registration')).toHaveBeenCalledOnce();
    expect(removers.get('registrationError')).toHaveBeenCalledOnce();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('cleans listeners after a registration timeout', async () => {
    const api = await import('../pushNotifications');
    vi.useFakeTimers();
    push.register.mockResolvedValue(undefined);
    const result = api.registerForPush(client, 'owner');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await result).toBe(false);
    expect(listeners.size).toBe(0);
  });
});
