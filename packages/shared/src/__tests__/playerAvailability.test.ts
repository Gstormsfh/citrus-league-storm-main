import { describe, expect, it } from 'vitest';
import { resolvePlayerAvailability, currentPlayerAvailability, availabilityDescription, availabilityLabel } from '../playerAvailability';
import type { CanonicalProjectionContext } from '../types/playerDashboard';
const now = Date.parse('2026-09-12T12:00:00Z');
const context = (availability: Record<string, unknown>) => ({ revision: 'reviewed-revision', availability } as CanonicalProjectionContext);
const reviewed = { status: 'out', authority: 'reviewed_report', as_of: '2026-09-10', review_after: '2026-09-17', source: { url: 'https://www.nhl.com/news/evidence' } };
describe('dated availability display contract', () => {
  it('keeps a current reviewed absence distinct from IR eligibility', () => {
    const input = { canonical_context: context(reviewed), roster_status: null, is_ir_eligible: false, games_played: 60 };
    const result = resolvePlayerAvailability(input, now);
    expect(result).toMatchObject({ status: 'out', basis: 'reviewed_report', revision: 'reviewed-revision', stale: false });
    expect(availabilityLabel(result)).toBe('OUT');
    expect(availabilityDescription(result)).toContain('not an IR eligibility decision');
    expect(input.is_ir_eligible).toBe(false);
    expect(input.roster_status).toBeNull();
  });
  it('never derives current injury from the imported Fiala workload scenario or zero-start surgery narrative', () => {
    expect(resolvePlayerAvailability({ canonical_context: context({ ...reviewed, authority: 'imported_scenario' }) }, now)).toMatchObject({ status: 'unknown', projection_scenario: { status: 'out' } });
    const merz = { canonical_context: { ...context({ status: 'unknown', authority: 'unknown', as_of: '2026-09-12' }), role: { notes: 'Shoulder surgery; no timetable', starts: 0 } } };
    expect(resolvePlayerAvailability(merz, now).status).toBe('unknown');
  });
  it('uses only identified dated feed facts, never absence as healthy', () => {
    for (const input of [{}, { roster_status: 'ACT' }, { roster_status: 'IR', roster_status_source: 'other', roster_status_updated_at: '2026-09-12' }]) {
      expect(resolvePlayerAvailability(input, now).status).toBe('unknown');
    }
    expect(resolvePlayerAvailability({ roster_status: 'ACT', roster_status_source: 'espn-injuries', roster_status_updated_at: '2026-09-12' }, now).status).toBe('healthy');
  });
  it('newer explicit report wins and suspension is never labelled IR', () => {
    const result = resolvePlayerAvailability({ canonical_context: context(reviewed), roster_status: 'SUSP', roster_status_source: 'espn-injuries', roster_status_updated_at: '2026-09-12' }, now);
    expect(result.status).toBe('suspended');
    expect(availabilityLabel(result)).toBe('SUSP');
  });
  it('equal timestamps favour reviewed evidence', () => {
    expect(resolvePlayerAvailability({ canonical_context: context({ ...reviewed, as_of: '2026-09-12' }), roster_status: 'ACT', roster_status_source: 'espn-injuries', roster_status_updated_at: '2026-09-12' }, now).status).toBe('out');
  });
  it('does not resurrect older injury after newer evidence expires', () => {
    expect(resolvePlayerAvailability({ canonical_context: context(reviewed), roster_status: 'ACT', roster_status_source: 'espn-injuries', roster_status_updated_at: '2026-09-11' }, now)).toMatchObject({ status: 'unknown', stale: true, basis: 'reported_status' });
  });
  it('expires cached evidence to unknown at the boundary, never recovery', () => {
    const value = resolvePlayerAvailability({ canonical_context: context(reviewed) }, now);
    expect(currentPlayerAvailability(value, Date.parse('2026-09-17')).status).toBe('unknown');
    expect(currentPlayerAvailability(value, Date.parse('2026-09-16')).status).toBe('out');
  });
  it.each([{ as_of: '2026-09-13' }, { as_of: 'bad' }, { review_after: 'bad' }, { review_after: '2026-09-09' }])('rejects future or malformed evidence %j', (invalid) => {
    expect(resolvePlayerAvailability({ canonical_context: context({ ...reviewed, ...invalid }) }, now).status).toBe('unknown');
  });
});
