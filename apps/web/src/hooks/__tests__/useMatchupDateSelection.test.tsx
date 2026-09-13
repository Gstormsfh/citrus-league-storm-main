import { act, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { useMatchupDateSelection } from '../useMatchupDateSelection';

function usePageDate(defaultDate: string | null) {
  const selection = useMatchupDateSelection();
  const { selectedDate, initializeDate } = selection;
  useEffect(() => {
    if (selectedDate === null) initializeDate(defaultDate);
  }, [defaultDate, selectedDate, initializeDate]);
  return selection;
}

describe('explicit Full Week selection', () => {
  it('keeps day → Full Week → day through default/stat effects', () => {
    const { result, rerender } = renderHook(({ day }) => usePageDate(day), { initialProps: { day: '2026-09-27' } });
    expect(result.current.selectedDate).toBe('2026-09-27');
    act(() => result.current.selectDate('2026-10-03'));
    act(() => result.current.selectDate(null));
    expect(result.current.selectedDate).toBeNull();
    rerender({ day: '2026-10-02' });
    expect(result.current.selectedDate).toBeNull();
    act(() => result.current.selectDate('2026-10-01'));
    expect(result.current.selectedDate).toBe('2026-10-01');
  });

  it('initializes the next matchup after a programmatic reset', () => {
    const { result, rerender } = renderHook(({ day }) => usePageDate(day), { initialProps: { day: '2026-09-27' } });
    act(() => result.current.selectDate(null));
    act(() => result.current.resetDate());
    rerender({ day: '2026-10-04' });
    expect(result.current.selectedDate).toBe('2026-10-04');
  });

  it('waits for a past-week default, but never overrides an explicit full week', () => {
    const { result, rerender } = renderHook(({ day }: { day: string | null }) => usePageDate(day), { initialProps: { day: null as string | null } });
    act(() => result.current.selectDate(null));
    rerender({ day: '2026-09-10' });
    expect(result.current.selectedDate).toBeNull();
  });
});
