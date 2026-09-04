// Tests for the orphaned-draft scanner (chunk 11g.9).
//
// This module replaced the pgmq `safety_net` path, so its job is
// narrow and worth pinning precisely: reinstate a LOBBY for an
// in_progress league the registry has lost, never pick a player, and
// never let one bad league or a failed query stop the scan.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrphanedDraftScanner } from '../orphanedDraftScanner';

vi.mock('@citrus/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@citrus/shared')>()),
  structuredLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Minimal supabase double for the scan query, which since 2026-09-03
 * reads through `readAllPaged`:
 *
 *   .from('leagues').select('id').eq('draft_status', 'in_progress')
 *     .order('id', { ascending: true }).range(from, to)
 *
 * Only `.range` resolves, and it slices like PostgREST's window does.
 * Two consequences worth stating: a regression back to an unbounded
 * `.select()` fails here instead of passing quietly, and a result set
 * larger than one page is genuinely paged rather than faked.
 */
function makeSupabase(result: { data?: Array<{ id: string }>; error?: unknown }) {
  const rows = result.data ?? [];
  const range = vi.fn((from: number, to: number) =>
    Promise.resolve(
      result.error !== undefined && result.error !== null
        ? { data: null, error: result.error }
        : { data: rows.slice(from, to + 1), error: null },
    ),
  );
  const order = vi.fn(() => ({ order, range }));
  const eq = vi.fn(() => ({ eq, order, range }));
  const select = vi.fn().mockReturnValue({ eq, order, range });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select, eq, order, range };
}

function makeRegistry(loadedLobbyIds: string[] = []) {
  const loaded = new Set(loadedLobbyIds);
  return {
    registry: {
      get: vi.fn((id: string) => (loaded.has(id) ? ({} as never) : undefined)),
      getOrCreate: vi.fn(async (id: string) => {
        loaded.add(id);
        return {} as never;
      }),
    } as never,
    loaded,
  };
}

const GRACE = 90_000;

describe('OrphanedDraftScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does nothing when every in_progress league already has a lobby', async () => {
    const sb = makeSupabase({ data: [{ id: 'lg-1' }, { id: 'lg-2' }] });
    const { registry } = makeRegistry(['lg-1', 'lg-2']);
    const scanner = new OrphanedDraftScanner({
      registry,
      supabaseAdmin: sb.client,
      graceMs: GRACE,
    });

    const r = await scanner.scan();

    expect(r).toMatchObject({ scanned: 2, orphaned: 0, adopted: 0, failed: 0 });
    expect((registry as unknown as { getOrCreate: ReturnType<typeof vi.fn> }).getOrCreate)
      .not.toHaveBeenCalled();
  });

  it('holds a newly-missing league inside the grace window', async () => {
    // Guards against racing draft ignition: draftV2Start flips
    // draft_status before the NOTIFY that creates the lobby lands.
    const sb = makeSupabase({ data: [{ id: 'lg-1' }] });
    const { registry } = makeRegistry([]);
    const scanner = new OrphanedDraftScanner({
      registry,
      supabaseAdmin: sb.client,
      graceMs: GRACE,
    });

    const first = await scanner.scan();
    expect(first).toMatchObject({ scanned: 1, orphaned: 0, adopted: 0 });

    vi.advanceTimersByTime(GRACE - 1_000);
    const second = await scanner.scan();
    expect(second).toMatchObject({ orphaned: 0, adopted: 0 });
    expect((registry as unknown as { getOrCreate: ReturnType<typeof vi.fn> }).getOrCreate)
      .not.toHaveBeenCalled();
  });

  it('adopts a league still missing after the grace window', async () => {
    const sb = makeSupabase({ data: [{ id: 'lg-1' }] });
    const { registry } = makeRegistry([]);
    const scanner = new OrphanedDraftScanner({
      registry,
      supabaseAdmin: sb.client,
      graceMs: GRACE,
    });

    await scanner.scan();
    vi.advanceTimersByTime(GRACE + 1_000);
    const r = await scanner.scan();

    expect(r).toMatchObject({ scanned: 1, orphaned: 1, adopted: 1, failed: 0 });
    const getOrCreate = (registry as unknown as { getOrCreate: ReturnType<typeof vi.fn> }).getOrCreate;
    expect(getOrCreate).toHaveBeenCalledTimes(1);
    // Lobby id === league id in the v2 engine.
    expect(getOrCreate).toHaveBeenCalledWith('lg-1', 'lg-1');
  });

  it('does not re-adopt a league on the next pass once it is loaded', async () => {
    const sb = makeSupabase({ data: [{ id: 'lg-1' }] });
    const { registry } = makeRegistry([]);
    const scanner = new OrphanedDraftScanner({
      registry,
      supabaseAdmin: sb.client,
      graceMs: GRACE,
    });

    await scanner.scan();
    vi.advanceTimersByTime(GRACE + 1_000);
    await scanner.scan();
    const third = await scanner.scan();

    expect(third).toMatchObject({ orphaned: 0, adopted: 0 });
    expect((registry as unknown as { getOrCreate: ReturnType<typeof vi.fn> }).getOrCreate)
      .toHaveBeenCalledTimes(1);
  });

  it('one failing league cannot shield the rest', async () => {
    const sb = makeSupabase({ data: [{ id: 'bad' }, { id: 'good' }] });
    const { registry } = makeRegistry([]);
    const reg = registry as unknown as { getOrCreate: ReturnType<typeof vi.fn> };
    reg.getOrCreate.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('boom');
      return {} as never;
    });
    const scanner = new OrphanedDraftScanner({
      registry,
      supabaseAdmin: sb.client,
      graceMs: GRACE,
    });

    await scanner.scan();
    vi.advanceTimersByTime(GRACE + 1_000);
    const r = await scanner.scan();

    expect(r.failed).toBe(1);
    expect(r.adopted).toBe(1);
    expect(reg.getOrCreate).toHaveBeenCalledWith('good', 'good');
  });

  it('returns zeros and does not throw when the query errors', async () => {
    const sb = makeSupabase({ error: { message: 'connection reset' } });
    const { registry } = makeRegistry([]);
    const scanner = new OrphanedDraftScanner({
      registry,
      supabaseAdmin: sb.client,
      graceMs: GRACE,
    });

    await expect(scanner.scan()).resolves.toMatchObject({
      scanned: 0,
      orphaned: 0,
      adopted: 0,
      failed: 0,
    });
  });

  it('prunes grace state for leagues that stop being in_progress', async () => {
    // A draft that completes while inside the grace window must not
    // leave an entry behind in a long-lived engine process.
    // PAGED-READ SHAPE (2026-09-03). scan() reads through `readAllPaged`, so
    // the chain is .select(cols).eq(col, val).order(col, opts).range(from, to)
    // and it is only AWAITED at `.range`. This stub used to resolve at `.eq`,
    // which is why it fell over with "query.order is not a function" the first
    // time it ran after the scanner was paged. It is a hand-rolled stub rather
    // than makeSupabase() because this test needs a DIFFERENT answer on each
    // of its three scans.
    //
    // One `.range` call per scan: each answer is shorter than PAGE_SIZE, so
    // readAllPaged stops after the first window.
    const range = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 'lg-1' }], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'lg-1' }], error: null });
    const order = vi.fn(() => ({ order, range }));
    const eq = vi.fn(() => ({ eq, order, range }));
    const client = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq, order, range }) }),
    };
    const { registry } = makeRegistry([]);
    const scanner = new OrphanedDraftScanner({
      registry,
      supabaseAdmin: client as never,
      graceMs: GRACE,
    });

    await scanner.scan();                     // lg-1 seen missing
    await scanner.scan();                     // lg-1 gone -> grace entry pruned
    vi.advanceTimersByTime(GRACE + 1_000);
    const third = await scanner.scan();        // lg-1 back: must restart grace

    expect(third).toMatchObject({ orphaned: 0, adopted: 0 });
    // Three scans, three windowed reads - and each one asked for a bounded
    // window. An unbounded regression would never reach `.range` at all.
    expect(range).toHaveBeenCalledTimes(3);
    expect(order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('start() is a no-op when the scan interval is disabled', () => {
    const sb = makeSupabase({ data: [] });
    const { registry } = makeRegistry([]);
    const scanner = new OrphanedDraftScanner({
      registry,
      supabaseAdmin: sb.client,
      scanMs: 0,
    });

    scanner.start();
    vi.advanceTimersByTime(600_000);
    expect(sb.from).not.toHaveBeenCalled();
    scanner.stop();
  });

  it('start() is idempotent and stop() halts scanning', () => {
    const sb = makeSupabase({ data: [] });
    const { registry } = makeRegistry([]);
    const scanner = new OrphanedDraftScanner({
      registry,
      supabaseAdmin: sb.client,
      scanMs: 1_000,
    });

    scanner.start();
    scanner.start(); // second call must not add a second interval
    vi.advanceTimersByTime(3_500);
    const callsWhileRunning = sb.from.mock.calls.length;
    expect(callsWhileRunning).toBe(3);

    scanner.stop();
    vi.advanceTimersByTime(10_000);
    expect(sb.from.mock.calls.length).toBe(callsWhileRunning);
  });
});
