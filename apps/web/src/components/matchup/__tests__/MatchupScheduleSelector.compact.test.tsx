// MatchupScheduleSelector `compact` (2026-09-01, audit R4) — the `Wk 5 ▾`
// trigger the phone roster chrome puts beside the seven day chips.
//
// It is the SAME week select (same items, same handler) with a smaller
// trigger: no prev/next buttons, no varsity bar, no date-range label at rest
// — the label is the week number in the mono eyebrow style, and the date
// range appears in the list. The full variant is left exactly as it was.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MatchupScheduleSelector } from '../MatchupScheduleSelector';

// Radix Select needs two DOM APIs jsdom lacks in order to open.
beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => undefined);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);
});

const FIRST = new Date(2026, 9, 5); // Mon Oct 5 2026 — a week-1 anchor

const renderCompact = (onWeekChange = vi.fn()) => {
  const utils = render(
    <MatchupScheduleSelector
      compact
      currentWeek={5}
      scheduleLength={20}
      availableWeeks={[1, 2, 3, 4, 5, 6]}
      onWeekChange={onWeekChange}
      firstWeekStart={FIRST}
    />,
  );
  return { ...utils, onWeekChange };
};

describe('MatchupScheduleSelector compact', () => {
  it('is a single small trigger reading the week number, no arrows, no bar', () => {
    renderCompact();
    const trigger = screen.getByTestId('week-select-compact');
    expect(trigger).toHaveTextContent(/^Wk 5$/);
    expect(trigger).toHaveAttribute('aria-label', 'Week 5 of 20');
    expect(trigger.className).toContain('h-8');
    expect(trigger.className).toContain('font-jbmono');
    expect(trigger.className).toContain('uppercase');
    expect(screen.queryByText(/Week 5\/20/)).toBeNull();
    // The trigger is the select's combobox; there are no arrow buttons.
    expect(screen.getByRole('combobox')).toBe(trigger);
    expect(screen.queryAllByRole('button').length).toBe(0);
  });

  it('opens the existing week list and reports the picked week', () => {
    const { onWeekChange } = renderCompact();
    const trigger = screen.getByTestId('week-select-compact');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const option = screen.getByRole('option', { name: /Wk 3/ });
    expect(option).toBeInTheDocument();
    // The date range rides along in the list so the month is one tap away.
    expect(option).toHaveTextContent(/Wk 3\s*Oct \d+/);
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(onWeekChange).toHaveBeenCalledWith(3);
  });

  it('the full variant is untouched: arrows, varsity label and date-range trigger', () => {
    render(
      <MatchupScheduleSelector
        currentWeek={5}
        scheduleLength={20}
        availableWeeks={[1, 2, 3, 4, 5, 6]}
        onWeekChange={vi.fn()}
        firstWeekStart={FIRST}
      />,
    );
    expect(screen.getByText('Week 5/20')).toBeInTheDocument();
    expect(screen.queryByTestId('week-select-compact')).toBeNull();
    expect(screen.getAllByRole('button').length).toBe(2); // prev / next
    // Week 5 from an Oct 5 anchor lands in November — the date-range label.
    expect(screen.getByRole('combobox')).toHaveTextContent(/Nov \d+-\d+/);
  });
});
