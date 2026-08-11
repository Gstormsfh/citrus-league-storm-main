// ENGINE-EAR v3 Slice 1 (E106, 2026-08-11) — items 1 + 2 + 6.
//
// Behavioral tests for the LobbyRegistry.performBootScan method
// (item 2) plus source-shape locks for the NOTIFY-creates-lobby
// dispatch (item 1, lives in server/src/draft/index.ts) and the
// INSTANT-AUTOPICK arm-time helper (item 6, private method in
// LobbyManager.ts — locked at source level because it's called
// only from arm sites deep inside the async event loop).
//
// The full-integration acceptance mode lives in
// scripts/proof/lifecycle-acceptance-engine-ear.local.mjs and is
// architect/Garrett-executed against staging per the hand-off
// pattern. These offline tests pin the CORRECTNESS surface at the
// unit level; the acceptance script proves BEHAVIOR against live
// staging.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LobbyRegistry, type LobbyConfig } from '../LobbyRegistry';
import { LobbyManager } from '../LobbyManager';
import type { DraftServiceV2 } from '../../services/DraftServiceV2';
import type {
  CommissionerAuthorizationResult,
  TeamAuthorizationResult,
} from '../types';
import { generateDraftOrder } from '../draftOrderGenerator';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const INDEX_TS_PATH = resolve(HERE, '..', 'index.ts');
const LOBBY_MANAGER_TS_PATH = resolve(HERE, '..', 'LobbyManager.ts');
const indexTsSource = readFileSync(INDEX_TS_PATH, 'utf8');
const lobbyManagerSource = readFileSync(LOBBY_MANAGER_TS_PATH, 'utf8');

// ── Shared LobbyRegistry test scaffolding (matches LobbyRegistry.test.ts) ─

const DEFAULT_DRAFT_ORDER = generateDraftOrder(
  ['team-1', 'team-2', 'team-3'],
  3,
  'snake',
);

const ALLOW_ALL_AUTH: (
  userId: string,
  teamId: string,
) => Promise<TeamAuthorizationResult> = async () => ({ authorized: true });

const ALLOW_ALL_COMMISH_AUTH: (
  userId: string,
  leagueId: string,
) => Promise<CommissionerAuthorizationResult> = async () => ({ authorized: true });

const AUCTION_FIELDS_EMPTY = {
  nominationOrder: [] as ReadonlyArray<string>,
  auctionBudget: 0,
  auctionMinBid: 0,
  draftRounds: 0,
  initialTeamBudgets: new Map<string, number>(),
  initialPlayersWon: new Map<string, number>(),
  initialActiveNomination: null,
  auctionAntiSnipeThresholdSeconds: 0,
  auctionAntiSnipeExtensionSeconds: 0,
  auctionMinBidIncrementTiers: [
    { below: Number.MAX_SAFE_INTEGER, increment: 1 },
  ] as ReadonlyArray<{ below: number; increment: number }>,
  auctionBidWindowSeconds: 0,
  auctionNominationWindowSeconds: 0,
};

const DEFAULT_LOBBY_CONFIG: LobbyConfig = {
  format: 'snake',
  draftOrder: DEFAULT_DRAFT_ORDER,
  pickClockSeconds: 91,
  initialPickDeadline: null,
  initialDraftState: null,
  ...AUCTION_FIELDS_EMPTY,
};

function makeStubSupabase(): SupabaseClient {
  const stub: Record<string, unknown> = {};
  const chain = () => stub;
  stub.from = chain;
  stub.select = chain;
  stub.eq = chain;
  stub.order = chain;
  stub.then = (resolve: (val: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return stub as unknown as SupabaseClient;
}

function makeRegistry() {
  const draftService = {
    submitPick: vi.fn(),
    listDraftEvents: vi.fn(async () => []),
  } as unknown as DraftServiceV2;
  const lobbyConfigLookup = vi.fn(async (_leagueId: string) => DEFAULT_LOBBY_CONFIG);
  const publish = vi.fn();
  const registry = new LobbyRegistry({
    draftService,
    lobbyConfigLookup,
    publish,
    verifyTeamAuthorization: ALLOW_ALL_AUTH,
    verifyCommissionerAuthorization: ALLOW_ALL_COMMISH_AUTH,
    supabase: makeStubSupabase(),
    // Disable timers to keep tests deterministic (no idle-eviction /
    // clock-liveness scans firing under our feet).
    idleEvictionMs: 0,
    idleEvictionScanMs: 0,
    clockLivenessScanMs: 0,
  });
  return { registry, lobbyConfigLookup };
}

/**
 * Build a fake admin Supabase client whose fluent chain resolves to
 * the given rows for `leagues.select('id').in('draft_status', ...)`.
 * The boot-scan probe uses this exact chain.
 */
function makeAdminForBootScan(
  activeLeagues: Array<{ id: string }>,
  probeError: { message: string } | null = null,
): SupabaseClient {
  const stub: Record<string, unknown> = {};
  const inMethod = () =>
    Promise.resolve({ data: activeLeagues, error: probeError });
  const selectResult = { in: inMethod };
  const selectMethod = () => selectResult;
  const fromResult = { select: selectMethod };
  stub.from = () => fromResult;
  return stub as unknown as SupabaseClient;
}

// ── Item 2: performBootScan behavioral tests ────────────────────────

describe('ENGINE-EAR v3 Slice 1 item 2 — LobbyRegistry.performBootScan', () => {
  it('empty active-leagues query → returns zero counts, does not construct any lobby', async () => {
    const { registry, lobbyConfigLookup } = makeRegistry();
    const admin = makeAdminForBootScan([]);
    const result = await registry.performBootScan(admin);
    expect(result).toEqual({ scanned: 0, resumed: 0, failed: 0 });
    expect(lobbyConfigLookup).not.toHaveBeenCalled();
  });

  it('scans in_progress + paused leagues via .in("draft_status", ["in_progress", "paused"])', async () => {
    // The probe filter is load-bearing: querying by a different
    // predicate (e.g. `.eq('draft_status', 'in_progress')` alone)
    // would leave paused leagues without a timer post-restart —
    // regression class if a future refactor narrows the filter.
    const { registry } = makeRegistry();
    const inSpy = vi.fn(() => Promise.resolve({ data: [], error: null }));
    const selectResult = { in: inSpy };
    const admin = {
      from: () => ({ select: () => selectResult }),
    } as unknown as SupabaseClient;
    await registry.performBootScan(admin);
    expect(inSpy).toHaveBeenCalledWith(
      'draft_status',
      ['in_progress', 'paused'],
    );
  });

  it('scan of 3 active leagues → getOrCreate fires per league, resumed=3', async () => {
    const { registry, lobbyConfigLookup } = makeRegistry();
    const admin = makeAdminForBootScan([
      { id: 'lg-alpha' },
      { id: 'lg-bravo' },
      { id: 'lg-charlie' },
    ]);
    const result = await registry.performBootScan(admin);
    expect(result.scanned).toBe(3);
    expect(result.resumed).toBe(3);
    expect(result.failed).toBe(0);
    // Each league constructed a lobby via getOrCreate → each triggered
    // lobbyConfigLookup exactly once.
    expect(lobbyConfigLookup).toHaveBeenCalledTimes(3);
    // Registry now has three lobbies present.
    expect(registry.get('lg-alpha')).toBeInstanceOf(LobbyManager);
    expect(registry.get('lg-bravo')).toBeInstanceOf(LobbyManager);
    expect(registry.get('lg-charlie')).toBeInstanceOf(LobbyManager);
  });

  it('per-league construction failure is non-fatal — other leagues still resume', async () => {
    const { registry } = makeRegistry();
    // Override lobbyConfigLookup so 'lg-broken' throws but the
    // others succeed. `registry.performBootScan` iterates sequentially
    // and catches per-iteration; failed count increments while
    // resumed still advances for the healthy leagues.
    (registry as unknown as {
      lobbyConfigLookup: (leagueId: string) => Promise<LobbyConfig>;
    }).lobbyConfigLookup = async (leagueId: string) => {
      if (leagueId === 'lg-broken') {
        throw new Error('synthetic construction failure');
      }
      return DEFAULT_LOBBY_CONFIG;
    };
    const admin = makeAdminForBootScan([
      { id: 'lg-ok-1' },
      { id: 'lg-broken' },
      { id: 'lg-ok-2' },
    ]);
    const result = await registry.performBootScan(admin);
    expect(result.scanned).toBe(3);
    expect(result.resumed).toBe(2);
    expect(result.failed).toBe(1);
    // Registry has the healthy lobbies but NOT the broken one.
    expect(registry.get('lg-ok-1')).toBeInstanceOf(LobbyManager);
    expect(registry.get('lg-ok-2')).toBeInstanceOf(LobbyManager);
    expect(registry.get('lg-broken')).toBeUndefined();
  });

  it('query error → returns zero counts, does not throw (engine boot must not fail)', async () => {
    const { registry, lobbyConfigLookup } = makeRegistry();
    const admin = makeAdminForBootScan([], { message: 'synthetic DB failure' });
    const result = await registry.performBootScan(admin);
    expect(result).toEqual({ scanned: 0, resumed: 0, failed: 0 });
    expect(lobbyConfigLookup).not.toHaveBeenCalled();
  });
});

// ── Item 1: NOTIFY-creates-lobby source-shape lock ──────────────────

describe('ENGINE-EAR v3 Slice 1 item 1 — NOTIFY-creates-lobby (source-shape)', () => {
  it('dispatch calls getOrCreate for unknown lobby (was: silently skipped)', () => {
    // Pre-Slice-1 pattern was `registry.get` + silent-skip. Post
    // fix: `registry.getOrCreate` fires when the lobby is missing
    // and the league is in_progress/paused. This source-shape lock
    // prevents a silent regression to the pre-fix pattern.
    expect(indexTsSource).toMatch(/lobbyRegistry\.getOrCreate\(\s*notification\.leagueId,\s*notification\.leagueId,\s*\)/);
  });

  it('dispatch gates on draft_status IN (in_progress, paused) before creating', () => {
    // Resource-exhaustion protection: only in_progress/paused leagues
    // warrant lobby creation on NOTIFY. Other statuses skip. A
    // future refactor that drops the gate would create lobbies for
    // random NOTIFYs (unlikely but the guard is load-bearing).
    expect(indexTsSource).toMatch(/status\s*!==\s*['"]in_progress['"]\s*&&\s*status\s*!==\s*['"]paused['"]/);
  });

  it('dispatch logs notify_creates_lobby when creating (observability)', () => {
    // ENGINE-EAR always-log doctrine: every path is visible. A
    // silent NOTIFY-triggered create would cost a verification
    // cycle if it started misfiring. Structured log tag anchors
    // operator grep.
    expect(indexTsSource).toMatch(/event_subscription\.notify_creates_lobby/);
  });

  it('dispatch logs notify_skipped_non_live_league when skipping (observability)', () => {
    // Skips also log — pre-fix silent-skip was the exact defect
    // class Entry 82/83/88 spent cycles diagnosing.
    expect(indexTsSource).toMatch(/event_subscription\.notify_skipped_non_live_league/);
  });

  it('dispatch logs notify_status_probe_failed on DB error (fail-open, still visible)', () => {
    // DB errors during the status probe fall through to no-create
    // (fail-open) but MUST log — silent DB errors are a chronic
    // instrument gap (INS-class docket applies).
    expect(indexTsSource).toMatch(/event_subscription\.notify_status_probe_failed/);
  });
});

// ── Item 6: INSTANT-AUTOPICK arm-time helper source-shape lock ──────

describe('ENGINE-EAR v3 Slice 1 item 6 — INSTANT-AUTOPICK arm (source-shape)', () => {
  it('INSTANT_AUTOPICK_ARM_MS constant is 2000 (~2s per E106 amendment)', () => {
    // E106 amendment ratified 2s window (small but not zero — gives
    // pick_submitted broadcast + client re-arm time to land before
    // the autopick fires; matches LOAD-1-NIGHT 74-75ms notify→
    // broadcast p99 with margin).
    expect(lobbyManagerSource).toMatch(/const INSTANT_AUTOPICK_ARM_MS = 2[_,]?000/);
  });

  it('computeArmDeadlineForOnClockTeam helper exists on LobbyManager', () => {
    expect(lobbyManagerSource).toMatch(/private computeArmDeadlineForOnClockTeam\(rpcDeadline: Date\): Date/);
  });

  it('helper fail-opens on missing team-owner cache entry (unknown ≠ unowned)', () => {
    // Discriminator per R98 spec: "unknown" (cache empty / not
    // populated) MUST NOT trigger instant-autopick. Only truly-null
    // owners fire fast. A future refactor that treats missing-key
    // as null-owner would silently instant-pick every seat in a
    // populated draft during any cache-timing race — this test
    // pins the .has() check pre-.get().
    expect(lobbyManagerSource).toMatch(/if \(!this\.teamOwners\.has\(onClockTeamId\)\)/);
  });

  it('helper fail-opens when owner exists (any non-null value)', () => {
    // Owner exists → respect full pick clock. Logged-out but
    // existing owners are NOT unowned — they can still reconnect.
    expect(lobbyManagerSource).toMatch(/if \(owner !== null\)/);
  });

  it('helper respects earlier rpcDeadline (never DELAYS a due autopick)', () => {
    // Edge case: RPC deadline already in the past → the timer fires
    // immediately on next tick. The helper must not override to
    // a LATER instant-window deadline — that would delay a legit
    // due autopick by ~2s. Pin the .getTime() comparison.
    expect(lobbyManagerSource).toMatch(/rpcDeadline\.getTime\(\)\s*<\s*instantDeadline\.getTime\(\)/);
  });

  it('helper only applies to snake/linear (auction has its own budget/nomination logic)', () => {
    // Format-gate at top of helper — auction bid-window / nomination-
    // window arms bypass the instant-autopick path entirely.
    expect(lobbyManagerSource).toMatch(/this\.format !== 'snake' && this\.format !== 'linear'/);
  });

  it('init() populates teamOwners cache from teams table (query shape)', () => {
    // The .select('id, owner_id') + .eq('league_id', ...) call at
    // bootstrap is the ONLY place the cache is populated. If a
    // future refactor drops the .select fields or narrows the .eq
    // filter, INSTANT-AUTOPICK stops working — silently.
    expect(lobbyManagerSource).toMatch(/\.from\(['"]teams['"]\)/);
    expect(lobbyManagerSource).toMatch(/\.select\(['"]id, owner_id['"]\)/);
    expect(lobbyManagerSource).toMatch(/\.eq\(['"]league_id['"], this\.leagueId\)/);
  });

  it('init() logs team_owner_cache_populated with counts (observability)', () => {
    expect(lobbyManagerSource).toMatch(/team_owner_cache_populated/);
    expect(lobbyManagerSource).toMatch(/team_owner_cache_query_failed/);
  });

  it('cache-populate failure is non-fatal (silent-degrade to full pick clock)', () => {
    // Query failure logs but init continues. Fail-open to the full
    // pick clock preserves the pre-Slice-1 behavior instead of
    // hard-failing a draft that would otherwise work.
    expect(lobbyManagerSource).toMatch(/team_owner_cache_threw/);
  });
});

// ── Item 2 wiring: boot-scan is called from index.ts on startup ─────

describe('ENGINE-EAR v3 Slice 1 item 2 wiring — boot-scan called at startup', () => {
  it('index.ts calls lobbyRegistry.performBootScan(supabaseAdmin) after registry construction', () => {
    expect(indexTsSource).toMatch(/lobbyRegistry\.performBootScan\(supabaseAdmin\)/);
  });

  it('boot-scan is skipped when EVENT_SUBSCRIPTION_DISABLED=1 (test env)', () => {
    // Vitest sets EVENT_SUBSCRIPTION_DISABLED=1 to keep test runs
    // deterministic. Boot-scan queries the DB — must gate on the
    // same env so unit test runs don't fire real queries.
    expect(indexTsSource).toMatch(/EVENT_SUBSCRIPTION_DISABLED[\s\S]*performBootScan/);
  });

  it('boot-scan uncaught errors log but do NOT crash the engine', () => {
    // Non-fatal — engine keeps serving even if boot-scan throws
    // beyond performBootScan's own try/catch. Instrument pattern
    // per INS-class ledger: unexpected boot events must log.
    expect(indexTsSource).toMatch(/registry\.boot_scan_uncaught/);
  });
});
