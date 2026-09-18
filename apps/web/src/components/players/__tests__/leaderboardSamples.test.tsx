import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';
import { qualifiesForLeaderboard, sampleSize, sampleKindFor } from '../leaderboardSamples';
import { LeaderboardSampleFilter } from '../LeaderboardSampleFilter';

const player = (fields: Partial<DashboardIndexEntry>) => fields as DashboardIndexEntry;

describe('rate leaderboard qualification', () => {
  it('uses ice time, not games played, with an inclusive threshold', () => {
    expect(qualifiesForLeaderboard(player({ gp: 82, xg_per_60: 5, toi_seconds: 17999 }), 'xg_per_60', 300, false)).toBe(false);
    expect(qualifiesForLeaderboard(player({ gp: 20, xg_per_60: 1, toi_seconds: 18000 }), 'xg_per_60', 300, false)).toBe(true);
  });
  it('uses the GAR-specific denominator and permits negative GAR rates', () => {
    const p = player({ gar_per_60: -0.2, toi_seconds: 90000, toi_total_minutes: 100 });
    expect(qualifiesForLeaderboard(p, 'gar_per_60', 300, false)).toBe(false);
    expect(qualifiesForLeaderboard({ ...p, toi_total_minutes: 300 }, 'gar_per_60', 300, false)).toBe(true);
    expect(sampleSize({ ...p, toi_total_minutes: null }, 'garMinutes')).toBeNull();
  });
  it('qualifies goalie save percentage by shots faced', () => {
    const p = player({ save_pct: 0.91, saves: 273, goals_against: 27 });
    expect(sampleSize(p, 'shotsFaced')).toBe(300);
    expect(qualifiesForLeaderboard(p, 'save_pct', 300, false)).toBe(true);
    expect(qualifiesForLeaderboard(p, 'save_pct', 600, false)).toBe(false);
  });
  it.each([null, undefined, NaN, Infinity])('does not qualify unavailable or invalid rates: %s', value => {
    expect(qualifiesForLeaderboard(player({ xg_per_60: value, toi_seconds: 90000 }), 'xg_per_60', 0, false)).toBe(false);
  });
  it('does not treat absent sample data as evidence of qualification', () => {
    expect(qualifiesForLeaderboard(player({ xg_per_60: 2 }), 'xg_per_60', 300, false)).toBe(false);
    expect(qualifiesForLeaderboard(player({ xg_per_60: 2 }), 'xg_per_60', 0, false)).toBe(true);
    expect(sampleSize(player({ saves: 300, goals_against: NaN }), 'shotsFaced')).toBeNull();
  });
  it('keeps counting-stat rankings and player discovery unaffected', () => {
    expect(sampleKindFor('points')).toBeNull();
    expect(qualifiesForLeaderboard(player({}), 'points', 300, false)).toBe(true);
    expect(qualifiesForLeaderboard(player({}), 'xg_per_60', 300, true)).toBe(true);
  });
});

describe('sample control', () => {
  it('offers an explicitly labelled opt-out and changes the threshold', () => {
    const onChange = vi.fn();
    render(<LeaderboardSampleFilter kind="xgMinutes" minimum={300} onChange={onChange} searching={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Minimum ice time' }), { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith(0);
    expect(screen.getByRole('option', { name: 'All samples' })).toBeInTheDocument();
  });
  it('explains the search bypass and disables the inactive control', () => {
    render(<LeaderboardSampleFilter kind="shotsFaced" minimum={300} onChange={vi.fn()} searching />);
    expect(screen.getByRole('combobox', { name: 'Minimum shots faced' })).toBeDisabled();
    expect(screen.getByText(/Search includes all sample sizes/)).toBeInTheDocument();
  });
});
