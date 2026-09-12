import type { CanonicalProjectionContext } from './types/playerDashboard';

export type AvailabilityStatus = 'healthy' | 'injured' | 'out' | 'ir' | 'ltir' | 'day_to_day' | 'suspended' | 'unknown';
export interface PlayerAvailability {
  status: AvailabilityStatus;
  basis: 'reviewed_report' | 'projection_scenario' | 'reported_status' | 'unknown';
  as_of: string | null;
  expires_at: string | null;
  source: string | null;
  revision: string | null;
  stale: boolean;
  /** Workload scenario, never evidence of a current injury/designation. */
  projection_scenario?: { status: AvailabilityStatus; as_of: string; expires_at: string; stale: boolean } | null;
}
export interface AvailabilityInput {
  canonical_context?: CanonicalProjectionContext | null;
  roster_status?: string | null;
  roster_status_source?: string | null;
  roster_status_updated_at?: string | null;
}
const labels: Record<AvailabilityStatus, string> = {
  healthy: 'Healthy', injured: 'INJ', out: 'OUT', ir: 'IR', ltir: 'LTIR',
  day_to_day: 'DTD', suspended: 'SUSP', unknown: 'Status unknown',
};
const DAY = 86_400_000;
const normalize = (value: unknown): AvailabilityStatus => ({
  healthy: 'healthy', active: 'healthy', ACT: 'healthy', ACTIVE: 'healthy', injured: 'injured',
  out: 'out', OUT: 'out', ir: 'ir', IR: 'ir', ltir: 'ltir', LTIR: 'ltir',
  day_to_day: 'day_to_day', DTD: 'day_to_day', GTD: 'day_to_day',
  suspended: 'suspended', SUSP: 'suspended', unknown: 'unknown',
} as Record<string, AvailabilityStatus>)[String(value)] ?? 'unknown';
const date = (value: unknown): number => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const unknown = (stale = false): PlayerAvailability => ({ status: 'unknown', basis: 'unknown', as_of: null, expires_at: null, source: null, revision: null, stale });

/** Display evidence only. Never reads GP, starts, narratives or IR eligibility,
 * and never changes official roster/lineup/eligibility fields. Expiry means
 * unknown, not recovered. Imported scenarios are explicitly labelled as such. */
export function resolvePlayerAvailability(input: AvailabilityInput, now = Date.now()): PlayerAvailability {
  const candidates: PlayerAvailability[] = [];
  let scenario: PlayerAvailability['projection_scenario'] = null;
  const context = input.canonical_context;
  const a = context?.availability;
  if (a && context?.revision) {
    const status = normalize(a.status);
    const asOf = date(a.as_of);
    const basis = a.authority === 'reviewed_report' ? 'reviewed_report'
      : a.authority === 'imported_scenario' || a.authority === 'reviewed_scenario' ? 'projection_scenario' : 'unknown';
    const reviewAt = a.review_after == null ? asOf + (status === 'day_to_day' ? 2 : 7) * DAY : date(a.review_after);
    if (status !== 'unknown' && basis !== 'unknown' && Number.isFinite(asOf) && Number.isFinite(reviewAt) && reviewAt > asOf && asOf <= now) {
      const source = a.source && typeof a.source === 'object' ? a.source as Record<string, unknown> : {};
      const evidence: PlayerAvailability = { status, basis, as_of: new Date(asOf).toISOString(), expires_at: new Date(reviewAt).toISOString(),
        source: typeof source.url === 'string' ? source.url : typeof source.file === 'string' ? source.file : null,
        revision: context.revision, stale: now >= reviewAt };
      if (basis === 'projection_scenario') scenario = { status, as_of: evidence.as_of!, expires_at: evidence.expires_at!, stale: evidence.stale };
      else candidates.push(evidence);
    }
  }
  // Only this identified adapter owns the current reported-status fields.
  // Undated/unknown-provider values and absence from a feed are not healthy.
  const reportedAt = date(input.roster_status_updated_at);
  const reportedStatus = normalize(input.roster_status);
  if (input.roster_status_source === 'espn-injuries' && reportedStatus !== 'unknown' && Number.isFinite(reportedAt) && reportedAt <= now) {
    candidates.push({ status: reportedStatus, basis: 'reported_status', as_of: new Date(reportedAt).toISOString(),
      expires_at: new Date(reportedAt + DAY).toISOString(), source: 'ESPN injuries', revision: null, stale: now >= reportedAt + DAY });
  }
  // Latest dated explicit evidence wins; a later expired report must not
  // resurrect an older scenario. Equal timestamps favour the reviewed source.
  candidates.sort((left, right) => date(right.as_of) - date(left.as_of));
  const chosen = candidates[0];
  if (!chosen) return { ...unknown(), projection_scenario: scenario };
  return { ...chosen, status: chosen.stale ? 'unknown' : chosen.status, projection_scenario: scenario };
}

/** Re-evaluate cached display evidence at render time without inventing facts. */
export function currentPlayerAvailability(value: PlayerAvailability | null | undefined, now = Date.now()): PlayerAvailability {
  if (!value) return unknown();
  const expiresAt = date(value.expires_at);
  const asOf = date(value.as_of);
  const projection_scenario = value.projection_scenario ? { ...value.projection_scenario,
    stale: !Number.isFinite(date(value.projection_scenario.expires_at)) || now >= date(value.projection_scenario.expires_at),
  } : null;
  if (value.status === 'unknown') return { ...value, projection_scenario };
  const invalid = !Number.isFinite(expiresAt) || !Number.isFinite(asOf) || asOf > now || expiresAt <= asOf;
  if (invalid || value.basis === 'projection_scenario' || value.basis === 'unknown') return { ...unknown(), projection_scenario };
  return { ...value, projection_scenario, ...(now >= expiresAt ? { status: 'unknown' as const, stale: true } : {}) };
}
export function availabilityLabel(value: PlayerAvailability): string {
  return labels[value.status];
}
export function availabilityDescription(value: PlayerAvailability): string {
  if (value.status === 'unknown') {
    const current = value.stale ? 'Status evidence has expired; current availability is unknown.' : 'Current availability is not confirmed.';
    return value.projection_scenario ? `${current} ${value.projection_scenario.stale ? 'Expired projection scenario' : 'Projection scenario'}: ${labels[value.projection_scenario.status]}, as of ${value.projection_scenario.as_of.slice(0, 10)}. This does not establish current injury or IR eligibility.` : current;
  }
  const basis = value.basis === 'projection_scenario' ? 'Reviewed projection availability scenario; not an official roster designation'
    : value.basis === 'reviewed_report' ? 'Reviewed status report; not an IR eligibility decision' : 'Reported status from ESPN; not an IR eligibility decision';
  return `${labels[value.status]}. ${basis}. As of ${value.as_of?.slice(0, 10)}; review due ${value.expires_at?.slice(0, 10)}.${value.source ? ` Source: ${value.source}.` : ''}`;
}
