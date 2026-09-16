import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/AnalyticsService', () => ({ analyticsService: { logEvent: vi.fn() } }));
vi.mock('@/integrations/firebase/config', () => ({ ANALYTICS_READY_EVENT: 'ready', ANALYTICS_CONSENT_EVENT: 'consent' }));
import { CampaignTracker } from '../CampaignAnalytics';
const userId = '11111111-2222-4333-8444-555555555555';
const arrival = { source: 'sdpn', campaign: 'hockey', landing: '/', at: '2026-09-16T00:00:00Z' };
let now: number;
const emit = vi.fn((_name: string, _params: Record<string, string | number | boolean>): boolean => true);
function tracker(source = arrival) { return new CampaignTracker({ local: localStorage, session: sessionStorage,
  now: () => now, source: () => source, emit }); }
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); now = Date.parse(arrival.at); emit.mockReset(); emit.mockReturnValue(true); });
describe('consented campaign reporting', () => {
  it('waits for consent and SDK readiness, without marking a dropped event sent', () => {
    const t = tracker(); emit.mockReturnValue(false); t.visit('?ref=sdpn');
    expect(emit).not.toHaveBeenCalled(); localStorage.setItem('citrus_analytics_consent', 'granted'); t.flush();
    expect(emit).toHaveBeenCalledTimes(1); emit.mockReturnValue(true); t.flush(); t.flush();
    expect(emit).toHaveBeenCalledTimes(2);
  });
  it('deduplicates reloads, strict-mode repeats and short return visits, but allows another arrival after 30 minutes', () => {
    localStorage.setItem('citrus_analytics_consent', 'granted'); const t = tracker();
    t.visit('?ref=sdpn'); t.visit('?ref=sdpn'); tracker().visit('?ref=sdpn');
    expect(emit).toHaveBeenCalledTimes(1); now += 31 * 60000; t.visit('?ref=sdpn');
    expect(emit).toHaveBeenCalledTimes(2);
  });
  it('distinguishes the latest tagged arrival from first-touch signup attribution', () => {
    localStorage.setItem('citrus_analytics_consent', 'granted'); const t = tracker({ ...arrival, source: 'original-podcast' });
    t.visit('?ref=sdpn'); t.beginAuth('email'); t.confirmedSignup(userId);
    expect(emit).toHaveBeenNthCalledWith(1, 'campaign_visit', expect.objectContaining({ campaign_source: 'sdpn', first_touch_source: 'original-podcast' }));
    expect(emit).toHaveBeenNthCalledWith(2, 'sign_up', expect.objectContaining({ campaign_source: 'original-podcast', method: 'email' }));
  });
  it('carries attribution through a fresh instance after OAuth, but never counts an older account', () => {
    localStorage.setItem('citrus_analytics_consent', 'granted'); tracker().beginAuth('google');
    now += 5000;
    tracker().authenticated({ id: userId, created_at: new Date(now - 1000).toISOString(), app_metadata: { provider: 'google' } });
    expect(emit).toHaveBeenCalledWith('sign_up', expect.objectContaining({ campaign_source: 'sdpn', method: 'google' }));
    emit.mockClear(); tracker().beginAuth('google');
    tracker().authenticated({ id: userId, created_at: '2025-01-01T00:00:00Z', app_metadata: { provider: 'google' } });
    expect(emit).not.toHaveBeenCalled();
  });
  it('does not count failed signup or repeated session callbacks as new users', () => {
    localStorage.setItem('citrus_analytics_consent', 'granted'); const t = tracker();
    t.beginAuth('email'); t.cancelAuth(); t.confirmedSignup(userId); expect(emit).not.toHaveBeenCalled();
    t.beginAuth('email'); t.confirmedSignup(userId); t.confirmedSignup(userId);
    tracker().beginAuth('email'); tracker().confirmedSignup(userId);
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it('clears pending reports on denial and does not send them after later consent', () => {
    const t = tracker(); t.visit('?ref=sdpn'); localStorage.setItem('citrus_analytics_consent', 'denied'); t.flush();
    t.beginAuth('email'); t.confirmedSignup(userId); localStorage.setItem('citrus_analytics_consent', 'granted'); t.flush();
    expect(emit).not.toHaveBeenCalled();
  });
  it('does not transmit query strings, emails or malformed campaign labels', () => {
    localStorage.setItem('citrus_analytics_consent', 'granted'); const t = tracker();
    t.visit('?ref=person%40example.com'); expect(emit).not.toHaveBeenCalled();
    t.visit('?ref=sdpn&email=person%40example.com&token=secret');
    expect(JSON.stringify(emit.mock.calls)).not.toContain('example.com'); expect(JSON.stringify(emit.mock.calls)).not.toContain('secret');
  });
  it('does not crash when storage is blocked', () => {
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } } as unknown as Storage;
    const t = new CampaignTracker({ local: blocked, session: blocked, now: () => now, source: () => arrival, emit });
    expect(() => { t.visit('?ref=sdpn'); t.beginAuth('email'); t.confirmedSignup(userId); t.flush(); }).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });
  it('fails closed for expired auth intents or provider mismatch', () => {
    localStorage.setItem('citrus_analytics_consent', 'granted'); const t = tracker(); t.beginAuth('google');
    now += 8 * 86400000; t.confirmedSignup(userId); expect(emit).not.toHaveBeenCalled();
    t.beginAuth('google'); now += 1000; t.authenticated({ id: userId, created_at: new Date(now).toISOString(), app_metadata: { provider: 'email' } });
    expect(emit).not.toHaveBeenCalled();
  });
});
