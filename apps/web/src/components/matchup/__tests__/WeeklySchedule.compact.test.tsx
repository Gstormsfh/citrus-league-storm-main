// WeeklySchedule compact mode (2026-09-01, Sleeper parity audit M8).
//
// On a phone the matchup page stacked four bands of chrome before the first
// player row; the day strip's "Week Overview" header was the third. In
// compact mode that row is desktop-only, the way back to the full week
// survives as a tap on the selected day (phone) plus a one-line "Full week"
// link that appears only while a day is selected, and everything
// WeeklySchedule.test.tsx locks — 7 cards, today = orange ring, selected =
// sage ring, default = white/10 — stays true.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

let originalWidth: number;
const setWidth = (w: number) =>
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

beforeEach(() => {
  originalWidth = window.innerWidth;
});
afterEach(() => {
  setWidth(originalWidth);
});

const today = getTodayMST();
const { weekStart, weekEnd } = weekOf(today);

describe('WeeklySchedule — compact (phone) mode', () => {
  it('drops the "Week Overview" header row below lg and keeps it for desktop', () => {
    const { container } = render(
      <WeeklySchedule weekStart={weekStart} weekEnd={weekEnd} onDayClick={() => {}} selectedDate={null} compact />,
    );
    const header = screen.getByText('Week Overview').closest('.rounded-xl') as HTMLElement;
    expect(header.className).toMatch(/\bhidden\b/);
    expect(header.className).toMatch(/lg:flex/);
    expect(container.firstElementChild).toHaveAttribute('data-compact', 'true');
  });

  it('the header row is plain flex when not compact (desktop and Roster unchanged)', () => {
    render(<WeeklySchedule weekStart={weekStart} weekEnd={weekEnd} onDayClick={() => {}} selectedDate={null} />);
    const header = screen.getByText('Week Overview').closest('.rounded-xl') as HTMLElement;
    expect(header.className).toMatch(/\bflex\b/);
    expect(header.className).not.toMatch(/\bhidden\b/);
    expect(screen.queryByTestId('weekly-schedule-full-week')).toBeNull();
  });

  it('still renders exactly 7 day cards with the locked rings', () => {
    const { container } = render(
      <WeeklySchedule weekStart={weekStart} weekEnd={weekEnd} onDayClick={() => {}} selectedDate={null} compact />,
    );
    const grid = container.querySelector('.grid.grid-cols-7')!;
    expect(grid.children.length).toBe(7);
    const todayCard = container.querySelector('[data-today="true"]')!;
    expect(todayCard.className).toMatch(/ring-pastel-orange/);
    const defaults = Array.from(grid.children).filter(
      (el) => !el.hasAttribute('data-today') && !el.hasAttribute('data-selected'),
    );
    for (const el of defaults) expect(el.className).toMatch(/ring-white\/10/);
  });

  it('selected day: sage ring, and a phone-only "Full week" link appears under the strip', () => {
    const onDayClick = vi.fn();
    const { container } = render(
      <WeeklySchedule weekStart={weekStart} weekEnd={weekEnd} onDayClick={onDayClick} selectedDate={today} compact />,
    );
    expect(container.querySelector('[data-selected="true"]')!.className).toMatch(/ring-pastel-sage/);
    const back = screen.getByTestId('weekly-schedule-full-week');
    expect(back.parentElement!.className).toMatch(/lg:hidden/);
    expect(back).toHaveTextContent(/Full week/i);
    fireEvent.click(back);
    expect(onDayClick).toHaveBeenCalledWith(null);
  });

  it('no "Full week" link while the whole week is showing — the strip is the only chrome', () => {
    render(<WeeklySchedule weekStart={weekStart} weekEnd={weekEnd} onDayClick={() => {}} selectedDate={null} compact />);
    expect(screen.queryByTestId('weekly-schedule-full-week')).toBeNull();
  });

  it('on a phone, tapping the selected day again returns to the full week', () => {
    setWidth(390);
    const onDayClick = vi.fn();
    const { container } = render(
      <WeeklySchedule weekStart={weekStart} weekEnd={weekEnd} onDayClick={onDayClick} selectedDate={today} compact />,
    );
    fireEvent.click(container.querySelector('[data-selected="true"]')!);
    expect(onDayClick).toHaveBeenCalledWith(null);
  });

  it('tapping a different day selects it as before', () => {
    setWidth(390);
    const onDayClick = vi.fn();
    const { container } = render(
      <WeeklySchedule weekStart={weekStart} weekEnd={weekEnd} onDayClick={onDayClick} selectedDate={today} compact />,
    );
    const grid = container.querySelector('.grid.grid-cols-7')!;
    const other = Array.from(grid.children).find((el) => !el.hasAttribute('data-selected'))!;
    fireEvent.click(other);
    expect(onDayClick).toHaveBeenCalledTimes(1);
    expect(onDayClick.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(onDayClick.mock.calls[0][0]).not.toBe(today);
  });

  it('on desktop the selected day is not a toggle (the header row has its own button)', () => {
    setWidth(1280);
    const onDayClick = vi.fn();
    const { container } = render(
      <WeeklySchedule weekStart={weekStart} weekEnd={weekEnd} onDayClick={onDayClick} selectedDate={today} compact />,
    );
    fireEvent.click(container.querySelector('[data-selected="true"]')!);
    expect(onDayClick).toHaveBeenCalledWith(today);
  });

  it('non-compact never toggles, on any viewport', () => {
    setWidth(390);
    const onDayClick = vi.fn();
    const { container } = render(
      <WeeklySchedule weekStart={weekStart} weekEnd={weekEnd} onDayClick={onDayClick} selectedDate={today} />,
    );
    fireEvent.click(container.querySelector('[data-selected="true"]')!);
    expect(onDayClick).toHaveBeenCalledWith(today);
  });
});
