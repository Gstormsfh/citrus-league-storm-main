import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resolvePlayerAvailability, type CanonicalProjectionContext } from '@citrus/shared';
import { PlayerAvailabilityDetails } from '../PlayerAvailabilityDetails';
import { PlayerAffiliationDetails } from '../PlayerAffiliationDetails';

const context: CanonicalProjectionContext = { season: 2026, run_id: 'run', revision: 'revision', activated_at: '2026-09-12',
  availability: { status: 'injured', authority: 'reviewed_report', as_of: '2026-09-12', review_after: '2026-09-19',
    reason: 'Owner reports an upper-body injury; return timing is unknown.',
    source: { file: 'owner.xlsx', workbook_sha256: 'a'.repeat(64), confirmation_scope: 'owner_adopted_workbook_baseline' } },
  role: null, sources: [], team_notes: [], provenance: 'MODEL', status: 'projected', issues: [], refresh: { at: null, status: null, error: null } };
afterEach(() => vi.useRealTimers());
describe('dynamic card status and affiliation context', () => {
  it('renders the supplied full injury reason and refreshes changed context without a remount', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13'));
    const availability = resolvePlayerAvailability({ canonical_context: context });
    const view = render(<PlayerAvailabilityDetails playerId="123" name="Example Player" context={context} availability={availability} />);
    expect(screen.getByRole('region', { name: 'Availability explanation' }).textContent).toContain('upper-body injury');
    const updated = { ...context, availability: { ...context.availability, reason: 'Owner updated the injury explanation.' } };
    view.rerender(<PlayerAvailabilityDetails playerId="123" name="Example Player" context={updated} availability={availability} />);
    expect(screen.getByText(/Owner updated the injury explanation/)).toBeTruthy();
    expect(screen.getByRole('region').textContent).toContain('Return timing is unconfirmed');
  });
  it('does not resurrect an review-due injury explanation', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-20'));
    const availability = resolvePlayerAvailability({ canonical_context: context });
    render(<PlayerAvailabilityDetails playerId="123" name="Example Player" context={context} availability={availability} />);
    expect(screen.getByRole('region').textContent).toContain('maintained designation has not been cleared');
    expect(screen.getByRole('region').textContent).toContain('Fantasy IR: eligible');
    expect(screen.getByRole('region').textContent).toContain('upper-body injury');
  });
  it('keeps retirement, unknown club and projection scenario distinct', () => {
    const view = render(<PlayerAffiliationDetails affiliation={{ status: 'retired', team: null, authority: 'official_transaction' }} projectionTeam="FA" />);
    expect(screen.getByText('Retired')).toBeTruthy();
    expect(screen.getByText(/Retained projection scenario: FA/)).toBeTruthy();
    view.rerender(<PlayerAffiliationDetails affiliation={{ status: 'unknown', team: null }} projectionTeam="PIT" />);
    expect(screen.getByText('NHL affiliation unconfirmed')).toBeTruthy();
  });
});
