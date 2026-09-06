import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ supported: vi.fn(), get: vi.fn(), enabled: vi.fn() }));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}), getApps: () => [] }));
vi.mock('firebase/analytics', () => ({ isSupported: mocks.supported, initializeAnalytics: mocks.get, setAnalyticsCollectionEnabled: mocks.enabled, setUserId: vi.fn() }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'AIzaSy-test-key-long-enough-for-config');
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project');
  mocks.supported.mockResolvedValue(true); mocks.get.mockReturnValue({ name: 'analytics' });
});
describe('optional analytics consent', () => {
  it('does not initialize before acceptance and stops after withdrawal', async () => {
    const config = await import('../config');
    expect(mocks.get).not.toHaveBeenCalled();
    config.grantAnalyticsConsent();
    await vi.waitFor(() => expect(mocks.enabled).toHaveBeenCalledWith({ name: 'analytics' }, true));
    expect(mocks.get).toHaveBeenCalledWith(expect.anything(), { config: {
      allow_google_signals: false, allow_ad_personalization_signals: false,
    } });
    config.denyAnalyticsConsent();
    expect(mocks.enabled).toHaveBeenLastCalledWith({ name: 'analytics' }, false);
    expect(config.getAnalyticsInstance()).toBeNull();
    config.grantAnalyticsConsent();
    expect(mocks.enabled).toHaveBeenLastCalledWith({ name: 'analytics' }, true);
  });
  it('does not initialize if consent is withdrawn while support detection is pending', async () => {
    let resolveSupport!: (value: boolean) => void;
    mocks.supported.mockReturnValue(new Promise<boolean>((resolve) => { resolveSupport = resolve; }));
    const config = await import('../config');
    config.grantAnalyticsConsent(); config.denyAnalyticsConsent();
    resolveSupport(true); await Promise.resolve();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
