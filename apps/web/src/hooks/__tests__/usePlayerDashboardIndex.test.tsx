/**
 * The shared dashboard-index fetch: one request per session, and a 401 that
 * costs the host surface nothing.
 *
 * The 401 path is the one that matters most. `/api/players/dashboard-index`
 * is behind `authMiddleware`, so on a guest, demo or expired-token surface
 * it fails — and a roster, a draft board or a free-agent list must look and
 * behave exactly as it did before this hook existed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

// The hook imports `@/api/client` LAZILY (it pulls the Supabase client, which
// throws at module scope with VITE_SUPABASE_* unset — and vitest.config pins
// those to empty strings). Vitest intercepts dynamic imports too, so one mock
// covers both shapes.
vi.mock('@/api/client', () => ({ apiClient: { get: getMock } }));

import {
  peekPlayerDashboardIndex,
  reloadPlayerDashboardIndex,
  resetPlayerDashboardIndex,
  usePlayerDashboardIndex,
  type DashboardIndexEntry,
} from '../usePlayerDashboardIndex';

function row(id: number, name: string): DashboardIndexEntry {
  return {
    id,
    name,
    team: 'EDM',
    position: 'C',
    jersey: 97,
    headshot_url: null,
    is_goalie: false,
    roster_status: null,
    gp: 40,
    goals: 20,
    assists: 20,
    points: 40,
    sog: 100,
    hits: 10,
    blocks: 10,
    ppp: 10,
    plus_minus: 0,
    x_goals: 18,
    wins: 0,
    saves: 0,
    save_pct: 0,
    gaa: 0,
    shutouts: 0,
    xg_per_60: 1,
    xg_rating: null,
    gar_per_60: 0.5,
    gar_evo: 0.3,
    gar_evd: 0.1,
    gar_ppo: 0.1,
    gar_ppd: 0,
    gar_pen: 0,
    proj_gp: 40,
    proj_fantasy_points: 300,
    proj_fantasy_ppg: 7.5,
    proj_goals: 18,
    proj_assists: 20,
    proj_sog: 100,
    proj_ppp: 10,
    proj_blocks: 40,
    proj_hits: 30,
    proj_wins: null,
    proj_saves: null,
    proj_shutouts: null,
    toi_total_minutes: null, avg_toi_per_game: null, vopa_score: null,
    gsax_raw: null, gsax_regressed: null, gsax_shots_faced: null, gsax_xga: null, gsax_ga: null,
    as_of: null,
  };
}

function Probe({ label = 'a', enabled = true }: { label?: string; enabled?: boolean }) {
  const { players, loading, error } = usePlayerDashboardIndex({ enabled });
  return (
    <div data-testid={`probe-${label}`}>
      <span data-testid={`count-${label}`}>{players.length}</span>
      <span data-testid={`loading-${label}`}>{String(loading)}</span>
      <span data-testid={`error-${label}`}>{error ?? ''}</span>
    </div>
  );
}

beforeEach(() => {
  getMock.mockReset();
  resetPlayerDashboardIndex();
});

afterEach(() => {
  resetPlayerDashboardIndex();
});

describe('usePlayerDashboardIndex', () => {
  it('fetches once and hands the array to every consumer', async () => {
    getMock.mockResolvedValue({ data: [row(1, 'A'), row(2, 'B')] });

    render(
      <>
        <Probe label="a" />
        <Probe label="b" />
        <Probe label="c" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('count-a')).toHaveTextContent('2'));
    expect(screen.getByTestId('count-b')).toHaveTextContent('2');
    expect(screen.getByTestId('count-c')).toHaveTextContent('2');
    // Three consumers, one request. This is the whole point of the module.
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/api/players/dashboard-index');
  });

  it('does not fetch again on a later mount', async () => {
    getMock.mockResolvedValue({ data: [row(1, 'A')] });
    const first = render(<Probe label="a" />);
    await waitFor(() => expect(screen.getByTestId('count-a')).toHaveTextContent('1'));
    first.unmount();

    render(<Probe label="d" />);
    await waitFor(() => expect(screen.getByTestId('count-d')).toHaveTextContent('1'));
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a bare array as well as the { data } envelope', async () => {
    getMock.mockResolvedValue([row(1, 'A'), row(2, 'B'), row(3, 'C')]);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('count-a')).toHaveTextContent('3'));
  });

  it('degrades silently on a 401 — empty array, no throw, one request', async () => {
    // The guest / demo / expired-token path. The endpoint is behind
    // authMiddleware; every consumer must simply render nothing.
    getMock.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));

    render(
      <>
        <Probe label="a" />
        <Probe label="b" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('loading-a')).toHaveTextContent('false'));
    expect(screen.getByTestId('count-a')).toHaveTextContent('0');
    expect(screen.getByTestId('count-b')).toHaveTextContent('0');
    expect(screen.getByTestId('error-a')).toHaveTextContent('Unauthorized');
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-request on every mount after a failure', async () => {
    // A guest opening forty player cards must cost one 401, not forty.
    getMock.mockRejectedValue(new Error('Unauthorized'));
    const first = render(<Probe label="a" />);
    await waitFor(() => expect(screen.getByTestId('loading-a')).toHaveTextContent('false'));
    first.unmount();

    for (let i = 0; i < 5; i++) {
      const r = render(<Probe label="a" />);
      await waitFor(() => expect(screen.getByTestId('loading-a')).toHaveTextContent('false'));
      r.unmount();
    }
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('retries a failure after the cooldown, so a mid-session sign-in recovers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getMock.mockRejectedValueOnce(new Error('Unauthorized'));
      const first = render(<Probe label="a" />);
      await waitFor(() => expect(screen.getByTestId('loading-a')).toHaveTextContent('false'));
      first.unmount();

      getMock.mockResolvedValue({ data: [row(1, 'A')] });
      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });
      render(<Probe label="b" />);
      await waitFor(() => expect(screen.getByTestId('count-b')).toHaveTextContent('1'));
      expect(getMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never fetches when the consumer is disabled', async () => {
    getMock.mockResolvedValue({ data: [row(1, 'A')] });
    render(<Probe enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('count-a')).toHaveTextContent('0'));
    expect(getMock).not.toHaveBeenCalled();
  });

  it('tolerates a non-array body rather than handing one downstream', async () => {
    getMock.mockResolvedValue({ data: { oops: true } });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('loading-a')).toHaveTextContent('false'));
    expect(screen.getByTestId('count-a')).toHaveTextContent('0');
  });

  it('reload() forces a fresh request and updates every consumer', async () => {
    getMock.mockResolvedValueOnce({ data: [row(1, 'A')] });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('count-a')).toHaveTextContent('1'));

    getMock.mockResolvedValueOnce({ data: [row(1, 'A'), row(2, 'B')] });
    await act(async () => {
      await reloadPlayerDashboardIndex();
    });
    await waitFor(() => expect(screen.getByTestId('count-a')).toHaveTextContent('2'));
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent callers onto one in-flight request', async () => {
    let resolve!: (v: unknown) => void;
    getMock.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(
      <>
        <Probe label="a" />
        <Probe label="b" />
      </>,
    );
    const extra = reloadPlayerDashboardIndex();
    // The client module is imported lazily, so the request itself lands a
    // microtask later; flush before counting.
    await act(async () => {
      await Promise.resolve();
    });
    expect(getMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ data: [row(1, 'A')] });
      await extra;
    });
    await waitFor(() => expect(screen.getByTestId('count-a')).toHaveTextContent('1'));
  });

  it('reports loading before anything has been attempted', () => {
    // Preserves the Players page's first paint: a spinner, not an empty table.
    expect(peekPlayerDashboardIndex()).toMatchObject({ status: 'idle', loading: true });
  });
});
