import { describe, expect, it } from 'vitest';
import { isFantasyIrEligible, resolvePlayerAvailability } from '../playerAvailability';
import type { CanonicalProjectionContext } from '../types/playerDashboard';
import fixtures from '../editorial/__tests__/fixtures/ownerAvailability20260912.json';
const now = Date.parse('2026-09-13T12:00:00Z');
const evidence = (status: string, extra = {}) => ({ revision: 'current', availability: { authority: 'reviewed_report', status,
  as_of: '2026-09-12', review_after: '2026-09-17', ...extra } }) as unknown as CanonicalProjectionContext;
describe('user-approved fantasy IR eligibility', () => {
  it('all 13 current owner/reviewed injury cards qualify under the new policy', () => {
    expect(fixtures).toHaveLength(13);
    for (const player of fixtures) {
      const afterReview = Date.parse('2026-10-01');
      const status = resolvePlayerAvailability({ canonical_context: player.context as unknown as CanonicalProjectionContext }, afterReview);
      expect(isFantasyIrEligible(status, afterReview), player.name).toBe(true);
    }
    for (const player of fixtures) expect(isFantasyIrEligible(resolvePlayerAvailability({ canonical_context: player.context as unknown as CanonicalProjectionContext }, now), now), player.name).toBe(true);
  });
  it.each(['ir', 'IR', 'ltir', 'LTIR', 'out', 'OUT', 'injured', 'INJ'])('%s qualifies from current reviewed evidence', status => {
    expect(isFantasyIrEligible(resolvePlayerAvailability({ canonical_context: evidence(status) }, now), now)).toBe(true);
  });
  it.each(['healthy', 'unknown', 'suspended', 'day_to_day'])('%s does not qualify', status => {
    expect(isFantasyIrEligible(resolvePlayerAvailability({ canonical_context: evidence(status) }, now), now)).toBe(false);
  });
  it('a newer explicit clear, expiry, or unreviewed scenario removes eligibility', () => {
    const value = resolvePlayerAvailability({ canonical_context: evidence('out') }, now);
    expect(value.expires_at).toBe('2026-09-17T00:00:00.000Z'); // Preserve legacy payload compatibility.
    expect(value.valid_until).toBeNull();
    expect(isFantasyIrEligible(value, Date.parse('2026-09-18'))).toBe(true);
    const expiring = resolvePlayerAvailability({ canonical_context: evidence('out', { valid_until: '2026-09-17' }) }, now);
    expect(isFantasyIrEligible(expiring, Date.parse('2026-09-18'))).toBe(false);
    expect(isFantasyIrEligible(resolvePlayerAvailability({ canonical_context: evidence('healthy') }, now), now)).toBe(false);
    expect(isFantasyIrEligible(resolvePlayerAvailability({ canonical_context: evidence('out', { authority: 'imported_scenario' }) }, now), now)).toBe(false);
  });
});
