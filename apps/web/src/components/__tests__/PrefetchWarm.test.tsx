/** 2026-09-09 (#22): the player pool is asked for once, after sign-in, not on a draft path. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const getAllPlayers = vi.fn(async () => []);
let user: { id: string } | null = { id: 'u1' };

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }));
vi.mock('@/services/PlayerService', () => ({ PlayerService: { getAllPlayers: () => getAllPlayers() } }));

import PrefetchWarm, { isDraftPath } from '../PrefetchWarm';

beforeEach(() => {
  vi.useFakeTimers();
  getAllPlayers.mockClear();
  user = { id: 'u1' };
});
afterEach(() => vi.useRealTimers());

describe('PrefetchWarm', () => {
  it('asks for the pool once, shortly after mount, when signed in', () => {
    render(<MemoryRouter initialEntries={['/gm-office']}><PrefetchWarm /></MemoryRouter>);
    expect(getAllPlayers).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1300); });
    expect(getAllPlayers).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(getAllPlayers).toHaveBeenCalledTimes(1);
  });

  it('does nothing signed out', () => {
    user = null;
    render(<MemoryRouter initialEntries={['/gm-office']}><PrefetchWarm /></MemoryRouter>);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(getAllPlayers).not.toHaveBeenCalled();
  });

  it('stays out of the draft room', () => {
    render(<MemoryRouter initialEntries={['/draft-v2/L1']}><PrefetchWarm /></MemoryRouter>);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(getAllPlayers).not.toHaveBeenCalled();
    expect(isDraftPath('/draft-room')).toBe(true);
    expect(isDraftPath('/draft-kit')).toBe(false);
  });
});
