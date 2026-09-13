import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAvailability } from '@citrus/shared';
const mock = vi.hoisted(() => ({ players: [] as Array<{ id: number; availability: PlayerAvailability }> }));
vi.mock('../usePlayerDashboardIndex', () => ({ usePlayerDashboardIndex: () => mock }));
import { useFantasyIrEligibility } from '../useFantasyIrEligibility';
const availability = (status: PlayerAvailability['status']): PlayerAvailability => ({ status, basis: 'reviewed_report',
  as_of: '2026-09-12', expires_at: null, maintained: true, review_due_at: '2026-09-17', revision: 'current', source: 'Owner-reviewed record', stale: false });
afterEach(() => { vi.useRealTimers(); });
describe('live roster IR affordance', () => {
  it('enables all four statuses and follows a clear/expiry without remounting or trusting stored flags', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13'));
    const player = { id: 1, availability: availability('out'), is_ir_eligible: false };
    mock.players = [{ id: 1, availability: availability('out') }];
    const { result, rerender } = renderHook(() => useFantasyIrEligibility());
    for (const status of ['ir', 'ltir', 'out', 'injured'] as const) {
      mock.players = [{ id: 1, availability: availability(status) }]; rerender();
      expect(result.current(player)).toBe(true);
    }
    mock.players = [{ id: 1, availability: availability('healthy') }]; rerender();
    const storedEligible = { ...player, is_ir_eligible: true };
    expect(result.current(storedEligible)).toBe(false);
    mock.players = [{ id: 1, availability: availability('out') }]; rerender();
    vi.setSystemTime(new Date('2026-09-18'));
    expect(result.current(player)).toBe(true); // A review reminder is not a clearance.
    mock.players = [{ id: 1, availability: { ...availability('out'), valid_until: '2026-09-17' } }]; rerender();
    expect(result.current(player)).toBe(false); // Explicit validity boundary.
  });
});
