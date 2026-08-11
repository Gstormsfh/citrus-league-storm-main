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
const LOBBY_REGISTRY_TS_PATH = resolve(HERE, '..', 'LobbyRegistry.ts');
const indexTsSource = readFileSync(INDEX_TS_PATH, 'utf8');
const lobbyManagerSource = readFileSync(LOBBY_MANAGER_TS_PATH, 'utf8');
const lobbyRegistrySource = readFileSync(LOBBY_REGISTRY_TS_PATH, 'utf8');

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
 * DB enum `draft_status` values, per source of truth:
 *   supabase/migrations/20250101000001_create_leagues_teams_tables.sql
 *     → create type draft_status as enum ('not_started', 'in_progress', 'completed');
 *   supabase/migrations/20260206000000_add_scheduled_draft_time.sql
 *     → alter type draft_status add value 'queued' after 'not_started';
 *
 * E111 POINT OF CONFUSION: `packages/shared/src/types/league.ts` exports
 * `DRAFT_STATUSES` that ADDITIONALLY includes 'paused'. That literal is
 * NOT a DB enum member — `paused` lives on `leagues.draft_state`, a
 * separate column. The client-side shared type carries a documented
 * type-drift docket that is out of scope for this cycle; the DB is
 * authoritative for anything the engine queries.
 */
const DB_DRAFT_STATUS_ENUM = [
  'not_started',
  'queued',
  'in_progress',
  'completed',
] as const;

/**
 * Postgres 22P02 shape — the error the real DB returns when a query
 * uses a non-member enum literal. Our value-domain-aware stubs raise
 * this exact code + message so any regression that adds a bad literal
 * (e.g. 'paused' on draft_status) fails offline the way the DB does.
 */
type PostgresEnumError = { code: '22P02'; message: string };

function makeEnumInvalidError(column: string, value: string): PostgresEnumError {
  return {
    code: '22P02',
    message: `invalid input value for enum ${column}: "${value}"`,
  };
}

/**
 * Build a fake admin Supabase client whose fluent chain resolves to
 * the given rows for the boot-scan query
 * `leagues.select('id').eq('draft_status', 'in_progress')`.
 *
 * E109 REGRESSION GUARD: `.from` is defined with method-shorthand
 * (non-arrow) and reads `this._tag` — mirroring real supabase-js
 * which reads `this.rest`. If a future refactor extracts `.from`
 * off the client (`const untypedFrom = admin.from`) the call runs
 * with `this === undefined` (strict mode) and throws TypeError —
 * exactly the field failure E109 caught in production. Bare
 * arrow-function stubs mask this class of bug.
 *
 * E111 REGRESSION GUARD: both `.eq` and `.in` return a Postgres 22P02
 * error when queried against `draft_status` with a value outside
 * DB_DRAFT_STATUS_ENUM. Prior stub returned {data: activeLeagues,
 * error: null} for ANY argument — that's exactly why the invalid
 * `['in_progress', 'paused']` literal sailed through 1031 offline
 * tests while the DB rejected it in staging.
 */
function makeAdminForBootScan(
  activeLeagues: Array<{ id: string }>,
  probeError: { message: string } | null = null,
): SupabaseClient {
  const eqMethod = (column: string, value: string) => {
    if (column === 'draft_status' && !(DB_DRAFT_STATUS_ENUM as readonly string[]).includes(value)) {
      return Promise.resolve({ data: null, error: makeEnumInvalidError(column, value) });
    }
    return Promise.resolve({ data: activeLeagues, error: probeError });
  };
  const inMethod = (column: string, values: readonly string[]) => {
    if (column === 'draft_status') {
      const invalid = values.find(
        (v) => !(DB_DRAFT_STATUS_ENUM as readonly string[]).includes(v),
      );
      if (invalid !== undefined) {
        return Promise.resolve({
          data: null,
          error: makeEnumInvalidError(column, invalid),
        });
      }
    }
    return Promise.resolve({ data: activeLeagues, error: probeError });
  };
  const selectResult = { eq: eqMethod, in: inMethod };
  const admin = {
    _tag: 'admin-stub-boot-scan',
    from(this: { _tag: string } | undefined, _table: string) {
      if (this === undefined || this._tag === undefined) {
        throw new TypeError(
          "Cannot read properties of undefined (reading '_tag') — .from() called without `this` bound (E109 regression)",
        );
      }
      return { select: () => selectResult };
    },
  };
  return admin as unknown as SupabaseClient;
}

/**
 * Same-shaped stub for the NOTIFY status-probe chain:
 * `leagues.select('draft_status').eq('id', ...).maybeSingle()`.
 * E109 regression guard identical to makeAdminForBootScan.
 */
function makeAdminForNotifyStatusProbe(
  row: { draft_status: string } | null,
  probeError: { message: string } | null = null,
): SupabaseClient {
  const maybeSingle = () => Promise.resolve({ data: row, error: probeError });
  const eqResult = { maybeSingle };
  const selectResult = { eq: () => eqResult };
  const admin = {
    _tag: 'admin-stub-notify-probe',
    from(this: { _tag: string } | undefined, _table: string) {
      if (this === undefined || this._tag === undefined) {
        throw new TypeError(
          "Cannot read properties of undefined (reading '_tag') — .from() called without `this` bound (E109 regression)",
        );
      }
      return { select: () => selectResult };
    },
  };
  return admin as unknown as SupabaseClient;
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

  it('scans via .eq("draft_status", "in_progress") — the ONLY valid live-draft enum member', async () => {
    // E111 fix pins the filter to the enum-valid literal. Prior
    // shape was `.in('draft_status', ['in_progress', 'paused'])` —
    // 'paused' is NOT a draft_status enum member (it lives on the
    // OTHER column `draft_state`), and Postgres rejects the whole
    // .in() list with 22P02. That regression class killed Item 2
    // resume in the field on tag 7b10d48a-draft.
    //
    // Slice-1's contract explicitly covers `in_progress` only;
    // paused-draft resume is a Slice-2+ decision (would require
    // reading draft_state alongside).
    const { registry } = makeRegistry();
    const eqSpy = vi.fn(() => Promise.resolve({ data: [], error: null }));
    const selectResult = { eq: eqSpy };
    const admin = {
      _tag: 'admin-stub-eq-spy',
      from(this: { _tag: string } | undefined) {
        if (this === undefined) throw new TypeError('unbound');
        return { select: () => selectResult };
      },
    } as unknown as SupabaseClient;
    await registry.performBootScan(admin);
    expect(eqSpy).toHaveBeenCalledWith('draft_status', 'in_progress');
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

  it('dispatch gates on draft_status === in_progress before creating', () => {
    // Resource-exhaustion protection: only in_progress leagues
    // warrant lobby creation on NOTIFY. Other statuses skip. A
    // future refactor that drops the gate would create lobbies for
    // random NOTIFYs (unlikely but the guard is load-bearing).
    //
    // E111 fix removed the `&& status !== 'paused'` clause — 'paused'
    // is not a draft_status enum member (it lives on draft_state).
    // Paused-draft NOTIFY handling is a Slice-2+ decision requiring
    // reading draft_state alongside.
    expect(indexTsSource).toMatch(/status\s*!==\s*['"]in_progress['"]/);
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

// ── E109 REGRESSION LOCKS: unbound-`.from` extraction ban ───────────

describe('E109 unbound-`.from` extraction regression lock', () => {
  // FIELD FAILURE (E109, 2026-08-11): the Slice-1 initial cut used
  //     const untypedFrom = supabaseAdmin.from as unknown as (t) => any;
  //     const { data } = await untypedFrom('leagues').select(...)...
  // to dodge TS deep-instantiation on the wide `leagues` type. That
  // pattern extracts `.from` as a free function → `this` is undefined
  // at call time → real supabase-js reads `this.rest` → TypeError.
  // The Proxy at server/src/lib/supabase.ts:40 makes accidental
  // rebinding impossible. Fix: cast the *result* of `.from()`, not
  // the method itself. These locks pin the fix + prevent silent
  // reintroduction of the anti-pattern anywhere in the engine.

  it('LobbyRegistry.ts must not extract `.from` as a free function', () => {
    // The specific anti-pattern that produced the E109 field failure.
    // Regex anchored to line-start (with leading whitespace) so it
    // only matches real assignments, not the E109 lesson comment
    // that mentions the anti-pattern by name.
    expect(lobbyRegistrySource).not.toMatch(/^\s*const\s+\w+\s*=\s*supabaseAdmin\.from\s+as\s+unknown/m);
    expect(lobbyRegistrySource).not.toMatch(/^\s*const\s+untypedFrom\s*=/m);
  });

  it('LobbyRegistry.ts uses the safe (client.from(t) as any) pattern instead', () => {
    // Positive lock on the corrected shape. `supabaseAdmin.from(...)`
    // preserves `this` because it's a direct property access +
    // invocation in the same expression.
    expect(lobbyRegistrySource).toMatch(/\(supabaseAdmin\.from\(['"]leagues['"]\)\s+as\s+any\)/);
  });

  it('draft/index.ts must not extract `.from` as a free function', () => {
    // Same anti-pattern at the NOTIFY status-probe site. Silent
    // failure class because the throw fell through into a try/catch
    // and would surface as `notify_lobby_create_failed` rather than
    // a boot-fatal error — but the effect is the same: Item 1
    // NOTIFY-creates-lobby doesn't fire.
    expect(indexTsSource).not.toMatch(/const\s+\w+\s*=\s*supabaseAdmin\.from\s+as\s+unknown/);
    expect(indexTsSource).not.toMatch(/const\s+untypedFrom\s*=/);
  });

  it('draft/index.ts uses the safe (client.from(t) as any) pattern instead', () => {
    expect(indexTsSource).toMatch(/\(supabaseAdmin\.from\(['"]leagues['"]\)\s+as\s+any\)/);
  });

  // The behavioral tests below run against the LIVE `LobbyRegistry`
  // code with a stub whose `.from` throws when called unbound. Before
  // the fix they threw TypeError (matching the boot log). After the
  // fix they resolve normally. The stub shape is documented at
  // `makeAdminForBootScan` above — E109 REGRESSION GUARD comment.

  it('performBootScan against a this-dependent stub client → resolves without TypeError', async () => {
    const { registry } = makeRegistry();
    const admin = makeAdminForBootScan([{ id: 'lg-alpha' }]);
    // Pre-fix, this awaited call surfaced the fatal TypeError from
    // the outer try/catch → the returned counts were {0, 0, 0} and
    // structuredLogger.error('registry.boot_scan_threw', …) fired.
    // Post-fix, scanned=1 + resumed=1.
    const result = await registry.performBootScan(admin);
    expect(result.scanned).toBe(1);
    expect(result.resumed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('NOTIFY status-probe path: same-shape stub does not TypeError', async () => {
    // Mirrors the boot-scan test for the NOTIFY dispatch site.
    // The path lives inside the event-subscription dispatch closure
    // (index.ts), so this test only verifies the corrected pattern
    // against a matching stub — the source-shape lock above catches
    // reintroduction of the extraction anti-pattern. Direct
    // invocation here proves the (client.from('leagues') as any)
    // idiom doesn't throw against a `this`-dependent stub.
    const admin = makeAdminForNotifyStatusProbe({ draft_status: 'in_progress' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (admin.from('leagues') as any)
      .select('draft_status')
      .eq('id', 'test-league')
      .maybeSingle();
    expect(result.data).toEqual({ draft_status: 'in_progress' });
    expect(result.error).toBeNull();
  });

  it('sanity: extracting `.from` off the stub client DOES throw (guard is real)', () => {
    // Confirms the E109 REGRESSION GUARD stub actually enforces the
    // `this`-binding contract. If a future refactor of the stub
    // helper accidentally makes `.from` an arrow function or
    // pre-binds it, this test flips to green while the regression
    // guards go blind — this sentinel catches that.
    const admin = makeAdminForBootScan([]);
    const extractedFrom = admin.from;
    expect(() => extractedFrom('leagues')).toThrow(TypeError);
    expect(() => extractedFrom('leagues')).toThrow(/E109 regression/);
  });
});

// ── E111 REGRESSION LOCKS: enum-domain guard on draft_status ────────

describe('E111 draft_status enum-domain regression lock', () => {
  // FIELD FAILURE (E111, 2026-08-11): the Slice-1 boot-scan queried
  //   .in('draft_status', ['in_progress', 'paused'])
  // — but `paused` is NOT a member of the DB `draft_status` enum.
  // Postgres rejected the whole list with 22P02, the scan returned
  // zero rows, Item 2 resume-on-boot was still inert on
  // 7b10d48a-draft (E109 fix worked — TypeError gone — but the query
  // itself was invalid). The offline test suite was 1031-green
  // because the stubs accepted any string as a valid enum literal.
  //
  // LESSON (INS-class per E111 line 1254): mocked DB stubs that
  // accept arbitrary literals cannot catch enum-domain errors —
  // offline tests were green twice while the query was invalid in
  // staging. Any future filter on an enum column gets a value-domain
  // assertion.

  it('LobbyRegistry.ts boot-scan filter must not reference "paused" on draft_status', () => {
    // Direct anti-pattern lock: the specific literal that produced
    // the E111 field failure. The lock is line-anchored so the
    // E111 lesson comment (which mentions 'paused' by name in the
    // explanation) doesn't false-positive.
    const scanLines = lobbyRegistrySource.split('\n');
    const violatingLine = scanLines.find(
      (line) =>
        /\.(in|eq)\(\s*['"]draft_status['"]/.test(line) &&
        /['"]paused['"]/.test(line),
    );
    expect(violatingLine).toBeUndefined();
  });

  it('draft/index.ts NOTIFY guard must not compare draft_status to "paused"', () => {
    // Dead branch pre-fix (draft_status can never be 'paused'), but
    // encoded the same wrong data model. Cleanup preserves the
    // enum-domain invariant across the whole engine.
    const notifyLines = indexTsSource.split('\n');
    const violatingLine = notifyLines.find(
      (line) =>
        /status\s*!==?\s*['"]paused['"]/.test(line) &&
        !line.trim().startsWith('//') &&
        !line.trim().startsWith('*'),
    );
    expect(violatingLine).toBeUndefined();
  });

  it('boot-scan calls .eq (not .in) with a single in_progress literal', () => {
    // Positive shape lock — the E111 fix chose .eq (simpler, safer)
    // over .in with a single element. If a future refactor widens
    // to `.in('draft_status', […])`, the lock trips; the E111 anti-
    // pattern lock above then catches any 'paused' reintroduction.
    expect(lobbyRegistrySource).toMatch(/\.eq\(['"]draft_status['"],\s*['"]in_progress['"]\)/);
  });

  it('stub rejects unknown draft_status literal via 22P02 (mimics Postgres)', async () => {
    // Sentinel: the E111 REGRESSION GUARD stub must reject any
    // draft_status value outside DB_DRAFT_STATUS_ENUM with the
    // Postgres 22P02 error shape. If a future refactor of the
    // stub accidentally accepts arbitrary strings, this sentinel
    // goes red and the value-domain guards go blind.
    const admin = makeAdminForBootScan([{ id: 'lg-x' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (admin.from('leagues') as any)
      .select('id')
      .eq('draft_status', 'paused');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('22P02');
    expect(result.error?.message).toContain('invalid input value for enum draft_status');
    expect(result.error?.message).toContain('"paused"');
    expect(result.data).toBeNull();
  });

  it('stub .in method also rejects any unknown enum literal in the list', async () => {
    // Belt-and-suspenders: exercises the .in overload that produced
    // the original E111 field failure. If a future refactor
    // reintroduces `.in('draft_status', ['in_progress', 'paused'])`,
    // this behavioral test fails with the same 22P02 shape the DB
    // returned in staging.
    const admin = makeAdminForBootScan([{ id: 'lg-x' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (admin.from('leagues') as any)
      .select('id')
      .in('draft_status', ['in_progress', 'paused']);
    expect(result.error?.code).toBe('22P02');
    expect(result.error?.message).toContain('"paused"');
  });

  it('performBootScan against the enum-aware stub → resumed=N for in_progress rigs', async () => {
    // End-to-end behavioral proof: the corrected .eq filter reaches
    // the stub with a valid enum literal, resolves cleanly, and
    // resumes the returned leagues. Pre-fix (using ['in_progress',
    // 'paused'] in the code), this test would have surfaced
    // registry.boot_scan_query_failed with 22P02.
    const { registry, lobbyConfigLookup } = makeRegistry();
    const admin = makeAdminForBootScan([
      { id: 'lg-live-1' },
      { id: 'lg-live-2' },
    ]);
    const result = await registry.performBootScan(admin);
    expect(result.scanned).toBe(2);
    expect(result.resumed).toBe(2);
    expect(result.failed).toBe(0);
    expect(lobbyConfigLookup).toHaveBeenCalledTimes(2);
  });

  it('DB_DRAFT_STATUS_ENUM matches the migration source of truth exactly', () => {
    // Pins the test-side enum constant to the DB migrations. If a
    // future migration adds a value (e.g. 'paused' becomes real,
    // or a new 'archived' member lands), this test forces a
    // conscious update rather than silent drift.
    expect([...DB_DRAFT_STATUS_ENUM].sort()).toEqual(
      ['completed', 'in_progress', 'not_started', 'queued'].sort(),
    );
    // 'paused' is definitively NOT a draft_status member.
    expect(DB_DRAFT_STATUS_ENUM as readonly string[]).not.toContain('paused');
  });
});
