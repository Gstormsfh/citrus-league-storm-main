/**
 * ACQUISITION SOURCE (2026-09-09, Steve Dangle campaign).
 *
 * Where a visitor came from, remembered in this browser so it can be tied to
 * what they do next: a waitlist row, a sign-up, a league. Two ways in:
 *
 *   * a campaign landing page calls `rememberAcquisition('steve-dangle')`;
 *   * any URL carrying `utm_source` (or `ref`) is captured on route change.
 *
 * The first source wins for the life of the browser (first touch), so a
 * listener who lands on /dangle, leaves, and comes back through Google a
 * week later still counts for the podcast. `readAcquisition()` is what the
 * waitlist metadata and the analytics user property read.
 *
 * localStorage only: it is a marketing breadcrumb, not account data. Every
 * read and write is guarded; private windows and blocked storage just mean
 * no attribution, never an error.
 */
const KEY = 'citrus.acquisition';

export interface Acquisition {
  source: string;
  campaign?: string;
  medium?: string;
  landing: string;
  at: string;
}

export function readAcquisition(): Acquisition | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Acquisition>;
    return typeof parsed.source === 'string' && parsed.source ? (parsed as Acquisition) : null;
  } catch {
    return null;
  }
}

export function rememberAcquisition(source: string, extra: { campaign?: string; medium?: string; landing?: string } = {}): Acquisition | null {
  const existing = readAcquisition();
  if (existing) return existing; // first touch wins
  const record: Acquisition = {
    source: source.trim().toLowerCase().slice(0, 64),
    campaign: extra.campaign?.trim().toLowerCase().slice(0, 64) || undefined,
    medium: extra.medium?.trim().toLowerCase().slice(0, 32) || undefined,
    landing: (extra.landing ?? (typeof location !== 'undefined' ? location.pathname : '/')).slice(0, 200),
    at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* storage blocked: attribution is best effort */
  }
  return record;
}

/** Capture `utm_source` / `ref` from a URL's query string. Returns what was stored, if anything. */
export function captureAcquisitionFromSearch(search: string, pathname = '/'): Acquisition | null {
  if (!search) return null;
  const params = new URLSearchParams(search);
  const source = params.get('utm_source') || params.get('ref');
  if (!source) return null;
  return rememberAcquisition(source, {
    campaign: params.get('utm_campaign') || undefined,
    medium: params.get('utm_medium') || undefined,
    landing: pathname,
  });
}

/** Test helper. */
export function clearAcquisition(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
