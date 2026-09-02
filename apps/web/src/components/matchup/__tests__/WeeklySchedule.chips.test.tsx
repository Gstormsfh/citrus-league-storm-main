// WeeklySchedule `chips` (2026-09-01, audit R4) — the one-row day picker
// the phone roster chrome sits beside the week trigger.
//
// What must survive from the full variant (Entry 34 WS-1 lock): seven cards,
// today = orange ring, selected = sage ring and selected wins when both
// apply, default = white/10. What is deliberately gone: the "Viewing:" /
// "Week Overview" header row, the Full Week button, the Today badge (the
// orange ring + orange text already say it, and the game-day strip's eyebrow
// says it in words), and the "Oct 14" label — the chip shows the weekday and
// the day number so seven of them fit a 360px phone beside `Wk 5 ▾`.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeeklySchedule } from '../WeeklySchedule';
import { getTodayMST } from '@/utils/timezoneUtils';

function weekOf(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const sun = new Date(dt);
  sun.setDate(dt.getDate() - dt.getDay());
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { weekStart: fmt(sun), weekEnd: fmt(sat) };
}

const renderCompact = (selectedDate: string | null, onDayClick = vi.fn()) => {
  const { weekStart, weekEnd } = weekOf(getTodayMST());
  const utils = render(
    <WeeklySchedule chips weekStart={weekStart} weekEnd={weekEnd} onDayClick={onDayClick} selectedDate={selectedDate} hideScores />,
  );
  return { ...utils, onDayClick, weekStart };
};

const grid = (container: HTMLElement) => container.querySelector('.grid.grid-cols-7') as HTMLElement;

describe('WeeklySchedule chips — the day-state lock still holds', () => {
  it('renders exactly 7 day cards and nothing above them', () => {
    const { container } = renderCompact(null);
    expect(grid(container).children.length).toBe(7);
    expect(screen.queryByText(/Viewing:/)).toBeNull();
    expect(screen.queryByText(/Week Overview/)).toBeNull();
    expect(screen.queryByText(/Full Week/)).toBeNull();
  });

  it('today wears the orange ring, not sage', () => {
    const { container } = renderCompact(null);
    const today = container.querySelector('[data-today="true"]')!;
    expect(today.className).toMatch(/ring-pastel-orange/);
    expect(today.className).not.toMatch(/ring-pastel-sage/);
  });

  it('selected wears the sage ring and wins over today', () => {
    const { container } = renderCompact(getTodayMST());
    const selected = container.querySelector('[data-selected="true"]')!;
    expect(selected.getAttribute('data-today')).toBe('true');
    expect(selected.className).toMatch(/ring-pastel-sage/);
    expect(selected.className).not.toMatch(/ring-pastel-orange/);
  });

  it('every other card wears ring-white/10', () => {
    const { container } = renderCompact(null);
    const others = Array.from(grid(container).children).filter(
      (el) => !el.hasAttribute('data-today') && !el.hasAttribute('data-selected'),
    );
    expect(others.length).toBe(6);
    for (const el of others) expect(el.className).toMatch(/ring-white\/10/);
  });
});

describe('WeeklySchedule chips — what changed on purpose', () => {
  it('drops the Today badge; the ring and the strip eyebrow carry it', () => {
    renderCompact(null);
    const badges = Array.from(document.querySelectorAll('*')).filter((el) => el.textContent === 'Today');
    expect(badges.length).toBe(0);
  });

  it('labels each chip with the weekday and the day number in the mono face', () => {
    const { container, weekStart } = renderCompact(null);
    const first = grid(container).children[0] as HTMLElement;
    const dayNumber = String(Number(weekStart.split('-')[2]));
    expect(first).toHaveTextContent(/^Sun\s*\d{1,2}$/);
    expect(first).toHaveTextContent(dayNumber);
    expect(first.textContent).not.toMatch(/[A-Z][a-z]{2} \d/); // no "Oct 14" on the chip
    const numberEl = Array.from(first.querySelectorAll('div')).find((d) => d.textContent === dayNumber)!;
    expect(numberEl.className).toContain('font-jbmono');
    expect(numberEl.className).toContain('tabular-nums');
  });

  it('each chip is a pressable button that reports its date', () => {
    const { container, onDayClick, weekStart } = renderCompact(null);
    const first = grid(container).children[0] as HTMLElement;
    expect(first).toHaveAttribute('role', 'button');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(first);
    expect(onDayClick).toHaveBeenCalledWith(weekStart);
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onDayClick).toHaveBeenCalledTimes(2);
  });

  it('the selected chip reads aria-pressed', () => {
    const { container } = renderCompact(getTodayMST());
    expect(container.querySelector('[data-selected="true"]')).toHaveAttribute('aria-pressed', 'true');
  });
});
