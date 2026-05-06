// Phase 4.5 chunk 11g.5b — PendingPickIndicator tests.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingPickIndicator } from '../PendingPickIndicator';

describe('PendingPickIndicator (chunk 11g.5b)', () => {
  it('renders children unchanged when optimisticState is null (confirmed pick)', () => {
    const { container } = render(
      <PendingPickIndicator optimisticState={null}>
        <span>Confirmed pick: McDavid</span>
      </PendingPickIndicator>,
    );
    expect(screen.getByText('Confirmed pick: McDavid')).toBeInTheDocument();
    // No wrapping div with the data attribute when confirmed.
    expect(container.querySelector('[data-optimistic-state]')).toBeNull();
  });

  it('renders pending state with Submitting caption + animate-pulse class', () => {
    const { container } = render(
      <PendingPickIndicator optimisticState="pending">
        <span>Pending pick: McDavid</span>
      </PendingPickIndicator>,
    );
    expect(screen.getByText('Pending pick: McDavid')).toBeInTheDocument();
    expect(screen.getByText(/Submitting…/)).toBeInTheDocument();
    expect(
      container.querySelector('[data-optimistic-state="pending"]'),
    ).toHaveClass('animate-pulse');
  });

  it('Submitting caption is aria-live=polite (transient announcement)', () => {
    render(
      <PendingPickIndicator optimisticState="pending">
        <span>x</span>
      </PendingPickIndicator>,
    );
    expect(screen.getByText(/Submitting…/)).toHaveAttribute('aria-live', 'polite');
  });

  it('renders rolled_back state with rejection-reason caption + role=alert', () => {
    render(
      <PendingPickIndicator
        optimisticState="rolled_back"
        rejectionReason="That player was just taken. Try another."
      >
        <span>Rejected pick</span>
      </PendingPickIndicator>,
    );
    expect(screen.getByText(/just taken/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('falls back to "Rejected" when no rejectionReason is provided', () => {
    render(
      <PendingPickIndicator optimisticState="rolled_back">
        <span>x</span>
      </PendingPickIndicator>,
    );
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });
});
