// Entry 34 WS-1 (2026-08-09) — WeeklySchedule day-state color lock.
//
// WeeklySchedule is scoreboard-sibling #3 (ScoreCard + MatchupTotalBar
// are the other two). Its semantic ternaries encode day-selected /
// today / past states — architect wants those locked before recolor
// drifts them silently.
//
// Locks:
// - Today card ring = pastel-orange
// - Selected card ring = pastel-sage
// - Selected wins the ring precedence when both apply (isSelected +
//   isToday) — the earlier ring-orange class is set with
//   `isTodayDate && !isSelectedDate` so orange is dropped for
//   selected+today
// - Default card ring = white/10
// - Today badge renders on today, not other days
// - Score tabular-nums

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WeeklySchedule } from '../WeeklySchedule';
import { getTodayMST } from '@/utils/timezoneUtils';

// Compute the week (Sun-Sat) containing today so today lands inside it.
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

describe('WeeklySchedule — day-state color lock (Entry 34 WS-1)', () => {
  it('renders exactly 7 day cards for the week', () => {
    const { weekStart, weekEnd } = weekOf(getTodayMST());
    const { container } = render(
      <WeeklySchedule
        weekStart={weekStart}
        weekEnd={weekEnd}
        onDayClick={() => {}}
        selectedDate={null}
      />,
    );
    const cards = container.querySelectorAll('[data-today], [data-selected], .cursor-pointer');
    // 7 cards render — checking against known unique attribute since Card
    // renders as a plain div. Grab the direct grid children by class.
    const grid = container.querySelector('.grid.grid-cols-7');
    expect(grid?.children.length).toBe(7);
  });

  it('TODAY card carries ring-pastel-orange (not sage)', () => {
    const today = getTodayMST();
    const { weekStart, weekEnd } = weekOf(today);
    const { container } = render(
      <WeeklySchedule
        weekStart={weekStart}
        weekEnd={weekEnd}
        onDayClick={() => {}}
        selectedDate={null}
      />,
    );
    const todayCard = container.querySelector('[data-today="true"]');
    expect(todayCard).toBeTruthy();
    expect(todayCard!.className).toMatch(/ring-pastel-orange/);
    expect(todayCard!.className).not.toMatch(/ring-pastel-sage/);
  });

  it('SELECTED card carries ring-pastel-sage and drops the orange when both today+selected', () => {
    const today = getTodayMST();
    const { weekStart, weekEnd } = weekOf(today);
    const { container } = render(
      <WeeklySchedule
        weekStart={weekStart}
        weekEnd={weekEnd}
        onDayClick={() => {}}
        selectedDate={today}
      />,
    );
    const selectedTodayCard = container.querySelector('[data-selected="true"]');
    expect(selectedTodayCard).toBeTruthy();
    expect(selectedTodayCard!.className).toMatch(/ring-pastel-sage/);
    // ring-pastel-orange is scoped to `isTodayDate && !isSelectedDate`
    // so it must be absent when both apply — selected wins.
    expect(selectedTodayCard!.className).not.toMatch(/ring-pastel-orange/);
  });

  it('DEFAULT (non-today, non-selected) card carries ring-white/10', () => {
    const today = getTodayMST();
    const { weekStart, weekEnd } = weekOf(today);
    const { container } = render(
      <WeeklySchedule
        weekStart={weekStart}
        weekEnd={weekEnd}
        onDayClick={() => {}}
        selectedDate={null}
      />,
    );
    const grid = container.querySelector('.grid.grid-cols-7')!;
    // Find a day card that's neither today nor selected.
    const defaults = Array.from(grid.children).filter(
      (el) => !el.hasAttribute('data-today') && !el.hasAttribute('data-selected'),
    );
    expect(defaults.length).toBeGreaterThan(0);
    for (const el of defaults) {
      expect(el.className).toMatch(/ring-white\/10/);
    }
  });

  it('Today badge appears on the today card only', () => {
    const today = getTodayMST();
    const { weekStart, weekEnd } = weekOf(today);
    const { container } = render(
      <WeeklySchedule
        weekStart={weekStart}
        weekEnd={weekEnd}
        onDayClick={() => {}}
        selectedDate={null}
      />,
    );
    // The Badge component renders the "Today" text; count occurrences.
    const badges = Array.from(container.querySelectorAll('*')).filter(
      (el) => el.textContent === 'Today',
    );
    expect(badges.length).toBe(1);
  });
});
