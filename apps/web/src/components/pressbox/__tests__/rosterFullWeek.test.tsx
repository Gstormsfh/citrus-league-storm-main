import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PressBoxRosterList } from '../RosterList';
import { readFileSync } from 'node:fs';

describe('complete roster week navigation', () => {
  it('the roster page passes the whole league week instead of a three-day future slice', () => {
    const source = readFileSync('src/pages/Roster.tsx', 'utf8');
    const mapping = source.slice(source.indexOf('const pressBoxDays ='), source.indexOf('const [weekView,'));
    expect(mapping).toContain('matchupWeekDates.map(');
    expect(mapping).not.toContain('.filter(');
  });
  it.each([
    ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  ])('every day stays selectable in league order (%s first)', (...days) => {
    const onDayChange = vi.fn();
    render(<PressBoxRosterList days={[...days, 'WEEK']} activeDay={days[5]} onDayChange={onDayChange} starters={[]} bench={[]} startersFilled={0} startersRequired={1} />);
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([...days, 'WEEK']);
    for (const day of [...days, 'WEEK']) fireEvent.click(screen.getByRole('tab', { name: day }));
    expect(onDayChange.mock.calls.map(([day]) => day)).toEqual([...days, 'WEEK']);
    expect(screen.getByRole('tab', { name: days[5] })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tablist')).toHaveClass('grid-cols-4', 'min-[360px]:grid-cols-8');
  });
});
