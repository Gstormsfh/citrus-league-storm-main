import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CanonicalProjectionContext } from '@citrus/shared';
import { ProjectionProvenance } from '../ProjectionProvenance';

const base: CanonicalProjectionContext = {
  season: 2026, run_id: 'run', revision: 'rev', activated_at: '2026-09-13',
  availability: null, role: null, sources: [], team_notes: [], issues: [],
  provenance: 'MODEL', status: 'projected', refresh: { at: null, status: null, error: null },
};

describe('ProjectionProvenance', () => {
  it('renders nothing without a published context', () => {
    const { container } = render(<ProjectionProvenance context={null} />);
    expect(container.innerHTML).toBe('');
  });

  it.each([
    ['MODEL', 'Model forecast'],
    ['MANUAL', 'Manual forecast'],
    ['DEFAULT', 'Cohort prior'],
  ])('labels %s provenance as "%s"', (provenance, label) => {
    render(<ProjectionProvenance context={{ ...base, provenance }} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('prints the conditional per-game rates for a rates_only skater, and says there is no season total', () => {
    render(<ProjectionProvenance context={{
      ...base, provenance: 'MANUAL', status: 'rates_only', exposure_policy: 'unallocated',
      rates: { goals: 0.18, assists: 0.28, shots_on_goal: 2.08 },
    }} />);
    expect(screen.getByText('Conditional rates')).toBeTruthy();
    const note = screen.getByTestId('projection-provenance').textContent ?? '';
    expect(note).toContain('0.18 G · 0.28 A · 2.08 SOG');
    expect(note).toContain('No NHL workload is allocated');
    expect(note).toContain('Manual forecast');
  });

  it('uses goalie rate labels per start', () => {
    render(<ProjectionProvenance isGoalie context={{
      ...base, status: 'rates_only', rates: { wins: 0.5, saves: 27.4, shutouts: 0.05, goals_against: 2.6 },
    }} />);
    const note = screen.getByTestId('projection-provenance').textContent ?? '';
    expect(note).toContain('Per start');
    expect(note).toContain('0.50 W · 27.40 SV · 0.05 SO · 2.60 GA');
  });

  it('flags an organization opportunity prior on an allocated projection', () => {
    render(<ProjectionProvenance context={{ ...base, provenance: 'DEFAULT', exposure_policy: 'organization_prior_remaining' }} />);
    const note = screen.getByTestId('projection-provenance').textContent ?? '';
    expect(note).toContain('Cohort prior');
    expect(note).toContain('organization opportunity assumption');
  });

  it('says when nothing supported is published', () => {
    render(<ProjectionProvenance context={{ ...base, provenance: null, status: 'unresolved' }} />);
    expect(screen.getByText('No supported forecast')).toBeTruthy();
  });

  it('ignores an unknown provenance string rather than inventing a label', () => {
    const { container } = render(<ProjectionProvenance context={{ ...base, provenance: 'MYSTERY', status: 'projected' }} />);
    expect(container.innerHTML).toBe('');
  });
});
