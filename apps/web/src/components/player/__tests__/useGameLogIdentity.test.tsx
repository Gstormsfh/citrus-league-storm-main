import { useEffect } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useGameLogIdentity } from '../useGameLogIdentity';

describe('game log request identity', () => {
  it('keeps an in-flight request alive when player enrichment replaces the object', () => {
    const cancel = vi.fn();
    const start = vi.fn();
    const { rerender, unmount } = renderHook(({ player }) => {
      const identity = useGameLogIdentity(player);
      useEffect(() => { start(identity); return cancel; }, [identity]);
    }, { initialProps: { player: { id: '8478402', team: 'EDM', position: 'C' } } });
    rerender({ player: { id: '8478402', team: 'EDM', position: 'C' } });
    expect(start).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    rerender({ player: { id: '8479318', team: 'TOR', position: 'C' } });
    expect(start).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    unmount();
  });
});
