import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeekStrip, heatColorFor, weekMaxFor } from '../WeekStrip';

const days = [
  { dateStr: '2026-09-13', dayLabel: 'Sunday', totalGames: 0, rosterGames: 0 },
  { dateStr: '2026-09-14', dayLabel: 'Monday', totalGames: 0, rosterGames: 0 },
  { dateStr: '2026-09-15', dayLabel: 'Tuesday', totalGames: 5, rosterGames: 2 },
  { dateStr: '2026-09-16', dayLabel: 'Wednesday', totalGames: 3, rosterGames: 4 },
  { dateStr: '2026-09-17', dayLabel: 'Thursday', totalGames: 8, rosterGames: 6 },
  { dateStr: '2026-09-18', dayLabel: 'Friday', totalGames: 5, rosterGames: 8 },
  { dateStr: '2026-09-19', dayLabel: 'Saturday', totalGames: 13, rosterGames: 17 },
];

describe('WeekStrip', () => {
  it('renders one row per day with the day, the NHL count and your count', () => {
    render(<WeekStrip days={days} todayStr="2026-09-18" />);
    const rows = screen.getAllByTestId('week-strip-day');
    expect(rows).toHaveLength(7);
    expect(rows[6]).toHaveTextContent('Sat');
    expect(rows[6]).toHaveTextContent('13');
    expect(rows[6]).toHaveTextContent('17');
  });

  it('marks today and off-nights, and a dark day is not an off-night', () => {
    render(<WeekStrip days={days} todayStr="2026-09-18" />);
    const rows = screen.getAllByTestId('week-strip-day');
    expect(rows[5].getAttribute('data-today')).toBe('true');
    expect(rows.filter((r) => r.getAttribute('data-today') === 'true')).toHaveLength(1);
    // Wednesday: three games, off-night. Sunday: no games at all, no OFF tag.
    expect(rows[3].getAttribute('data-off-night')).toBe('true');
    expect(rows[3]).toHaveTextContent('Off');
    expect(rows[0].getAttribute('data-off-night')).toBeNull();
    expect(rows[0]).not.toHaveTextContent('Off');
  });

  it('scales the bars to the busiest day, with a floor of eight', () => {
    expect(weekMaxFor(days)).toBe(13);
    expect(weekMaxFor([{ totalGames: 2 }, { totalGames: 1 }])).toBe(8);
    render(<WeekStrip days={days} todayStr="2026-09-18" />);
    const bars = screen.getAllByTestId('week-strip-day').map(
      (r) => (r.querySelector('span[style*="width"]') as HTMLElement).style.width,
    );
    expect(bars[6]).toBe('100%');
    expect(bars[0]).toBe('0%');
  });

  it('colours by the same thresholds as before', () => {
    expect(heatColorFor(0)).toBe(heatColorFor(1));
    expect(heatColorFor(2)).toBe(heatColorFor(3));
    expect(heatColorFor(4)).toBe(heatColorFor(13));
    expect(new Set([heatColorFor(0), heatColorFor(2), heatColorFor(4)]).size).toBe(3);
  });
});
