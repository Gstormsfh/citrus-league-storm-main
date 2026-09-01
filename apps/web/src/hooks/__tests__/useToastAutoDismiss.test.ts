/**
 * TOAST AUTO-DISMISS (2026-09-01) — "The lineup optimized badge doesn't
 * disappear, it seems like user has to do it manually." The shadcn
 * scaffold never started a dismiss timer, so every toast in the app sat
 * until tapped. Contract: toasts dismiss themselves; duration: Infinity
 * opts out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toast, useToast } from '../use-toast';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
});

describe('toasts dismiss themselves', () => {
  it('a default toast closes on its own within ~4s', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: 'Lineup Optimized' });
    });
    expect(result.current.toasts[0]?.open).toBe(true);

    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(result.current.toasts[0]?.open).toBe(false);
  });

  it('duration: Infinity opts a toast out of self-dismiss', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: 'Sticky on purpose', duration: Infinity });
    });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(result.current.toasts[0]?.open).toBe(true);
  });
});
