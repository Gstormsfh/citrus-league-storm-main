import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PlayerAvailability } from '@citrus/shared';
import HockeyPlayerCard, { type HockeyPlayer } from '../HockeyPlayerCard';

const evidence = (status: PlayerAvailability['status']): PlayerAvailability => ({
  status, basis: 'reviewed_report', as_of: '2026-09-10T00:00:00Z',
  expires_at: '2026-09-17T00:00:00Z', source: 'Primary report', revision: 'published', stale: false,
});
const player = (availability?: PlayerAvailability): HockeyPlayer => ({
  id: '8477942', name: 'Kevin Fiala', position: 'LW', team: 'LAK', number: 22,
  starter: false, stats: {}, status: 'IR', roster_status: 'IR', is_ir_eligible: true, availability,
});
afterEach(() => vi.useRealTimers());
describe('HockeyPlayerCard dated availability', () => {
  it.each([['out', 'OUT'], ['suspended', 'SUSP'], ['day_to_day', 'DTD'], ['ir', 'IR']] as const)(
    'renders %s without collapsing it to IR', (status, label) => {
      vi.setSystemTime(new Date('2026-09-12'));
      render(<HockeyPlayerCard player={player(evidence(status))} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      if (label !== 'IR') expect(screen.queryByText('IR')).not.toBeInTheDocument();
    });
  it('does not turn a legacy injured/IR-eligible field into current evidence', () => {
    render(<HockeyPlayerCard player={player()} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('IR')).not.toBeInTheDocument();
  });
  it('expires a cached report without claiming recovery', () => {
    vi.setSystemTime(new Date('2026-09-18'));
    render(<HockeyPlayerCard player={player(evidence('out'))} />);
    expect(screen.getByText('Unknown')).toHaveAttribute('title', expect.stringContaining('expired'));
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });
});
