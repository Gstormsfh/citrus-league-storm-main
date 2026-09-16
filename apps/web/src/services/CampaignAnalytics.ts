import { analyticsService } from './AnalyticsService';
import { ANALYTICS_CONSENT_EVENT, ANALYTICS_READY_EVENT } from '@/integrations/firebase/config';
import { readAcquisition, type Acquisition } from '@/lib/acquisition';

const PREFIX = 'citrus.campaign.';
const INTENT = PREFIX + 'auth-intent';
const HALF_HOUR = 30 * 60 * 1000;
type Method = 'email' | 'google' | 'apple';
interface Intent { method: Method; started: number; source: Acquisition }
interface Signup { userId: string; method: Method; source: Acquisition }
interface Dependencies {
  local: Storage; session: Storage; now: () => number;
  source: () => Acquisition | null;
  emit: (name: string, params: Record<string, string | number | boolean>) => boolean;
}
const label = (v: unknown, limit = 64) => typeof v === 'string' && /^[a-z0-9][a-z0-9_.-]*$/i.test(v.trim()) ? v.trim().toLowerCase().slice(0, limit) : '';
function sourceFields(source: Acquisition) {
  return { campaign_source: label(source.source), campaign_name: label(source.campaign),
    campaign_medium: label(source.medium, 32), attribution_model: 'first_touch' };
}

/** Optional, consented browser metrics. Not a backend account ledger or billing attribution. */
export class CampaignTracker {
  private visits = new Map<string, Acquisition>();
  private signups = new Map<string, Signup>();
  private sent = new Set<string>();
  private sentVisits = new Map<string, number>();
  constructor(private deps: Dependencies) {}
  private get(storage: Storage, key: string): string | null { try { return storage.getItem(key); } catch { return null; } }
  private put(storage: Storage, key: string, value: string): void { try { storage.setItem(key, value); } catch { /* memory dedupe still works */ } }
  private remove(storage: Storage, key: string): void { try { storage.removeItem(key); } catch { /* no storage */ } }
  private consent() { return this.get(this.deps.local, 'citrus_analytics_consent'); }

  visit(search: string): void {
    const query = new URLSearchParams(search);
    const source = label(query.get('utm_source') || query.get('ref'));
    if (!source || this.consent() === 'denied') return;
    // Count the tagged arrival separately from first-touch signup attribution.
    this.visits.set(source, { source, campaign: label(query.get('utm_campaign')),
      medium: label(query.get('utm_medium'), 32), landing: '/', at: new Date(this.deps.now()).toISOString() });
    this.flush();
  }

  beginAuth(method: Method): void {
    if (this.consent() !== 'granted') return;
    const source = this.deps.source();
    if (!source || !label(source.source)) return;
    this.put(this.deps.local, INTENT, JSON.stringify({ method, source, started: this.deps.now() }));
  }

  cancelAuth(): void { this.remove(this.deps.local, INTENT); }

  /** Called only after the server's create-user endpoint returned success. */
  confirmedSignup(userId: unknown): void {
    const intent = this.readIntent();
    if (!intent || typeof userId !== 'string' || !/^[a-f0-9-]{36}$/i.test(userId)) return;
    this.signups.set(userId, { userId, method: intent.method, source: intent.source });
    this.flush();
  }

  /** Email confirmation/OAuth callback: never turn an existing-account login into a signup. */
  authenticated(user: { id: string; created_at?: string; app_metadata?: { provider?: string } }): void {
    const intent = this.readIntent();
    if (!intent) return;
    const created = Date.parse(user.created_at ?? '');
    if (!Number.isFinite(created) || created < intent.started || created > this.deps.now()
      || (user.app_metadata?.provider && user.app_metadata.provider !== intent.method)) {
      this.cancelAuth(); return;
    }
    this.confirmedSignup(user.id);
  }

  private readIntent(): Intent | null {
    if (this.consent() !== 'granted') return null;
    try {
      const raw = this.get(this.deps.local, INTENT);
      if (!raw || raw.length > 2000) return null;
      const value = JSON.parse(raw) as Intent;
      if (!['email', 'google', 'apple'].includes(value.method) || !Number.isFinite(value.started)
        || value.started > this.deps.now() || this.deps.now() - value.started > 7 * 86400000
        || !value.source || !label(value.source.source)) return null;
      return value;
    } catch { return null; }
  }

  flush(): void {
    if (this.consent() === 'denied') { this.visits.clear(); this.signups.clear(); this.cancelAuth(); return; }
    if (this.consent() !== 'granted') return;
    for (const [source, value] of this.visits) {
      const key = PREFIX + 'visit.' + source;
      const recorded = Number(this.get(this.deps.session, key));
      const recent = recorded > 0 && this.deps.now() - recorded < HALF_HOUR;
      const memoryRecent = this.sentVisits.has(key) && this.deps.now() - this.sentVisits.get(key)! < HALF_HOUR;
      if (recent || memoryRecent) { this.visits.delete(source); continue; }
      if (this.deps.emit('campaign_visit', { ...sourceFields(value), attribution_model: 'tagged_arrival',
        first_touch_source: label(this.deps.source()?.source) })) {
        this.sentVisits.set(key, this.deps.now()); this.put(this.deps.session, key, String(this.deps.now())); this.visits.delete(source);
      }
    }
    for (const [id, value] of this.signups) {
      const key = PREFIX + 'signup.' + id;
      if (this.sent.has(key) || this.get(this.deps.local, key)) { this.signups.delete(id); this.cancelAuth(); continue; }
      if (this.deps.emit('sign_up', { ...sourceFields(value.source), method: value.method })) {
        this.sent.add(key); this.put(this.deps.local, key, 'sent'); this.signups.delete(id); this.cancelAuth();
      }
    }
  }
}

// Storage accessors remain guarded, including private browsers that throw on property access.
const storage = (kind: 'localStorage' | 'sessionStorage'): Storage => ({
  getItem: key => window[kind].getItem(key), setItem: (key, value) => window[kind].setItem(key, value),
  removeItem: key => window[kind].removeItem(key), clear: () => {}, key: () => null, length: 0,
});
export const campaignTracker = new CampaignTracker({ local: storage('localStorage'), session: storage('sessionStorage'),
  now: () => Date.now(), source: readAcquisition, emit: (name, params) => analyticsService.logEvent(name, params) });
if (typeof window !== 'undefined') {
  window.addEventListener(ANALYTICS_READY_EVENT, () => campaignTracker.flush());
  window.addEventListener(ANALYTICS_CONSENT_EVENT, () => campaignTracker.flush());
}
