// Phase 4.5 chunk 11g.2 step 1 — dual-port entry point.
//
// Spins up a minimal Hono HTTP server on PORT (default 3001) and the
// uWebSockets.js draft-engine server on DRAFT_WS_PORT (default 3002)
// in the same Node process. SIGTERM/SIGINT closes both within 10s.
//
// This entry point is parallel to the existing server/src/index.ts —
// it does not replace it. Use `npm run dev:draft-engine` from the
// monorepo root (or `npm run dev:draft-engine` inside server/) to run
// this entry; `npm run dev:server` continues to run the existing
// Hono-only entry unchanged.
//
// The Hono app here is intentionally minimal (just /health). Wiring
// the full Citrus Hono app from server/src/app.ts into this entry
// point lands in chunk 11g.2 step 4-5 (production deploy) — keeping
// the scaffold focused on the architectural primitive for now.
//
// See docs/PHASE_4_5_ARCHITECTURE.md (Stack Decision; Day 1 Topology)
// and docs/PHASE_4_5_PLAN.md chunk 11g.2.

// ── Load .env from monorepo root before anything else ──
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../../.env');
try {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file is optional — production injects env vars directly.
}

// ── Proxy support (matches existing server/src/index.ts) ──
const proxyUrl =
  process.env.https_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.GLOBAL_AGENT_HTTP_PROXY;
if (proxyUrl) {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    process.stdout.write('[proxy] Global fetch proxy configured\n');
  } catch (e: unknown) {
    process.stderr.write(
      `[proxy] Failed to configure proxy: ${e instanceof Error ? e.message : e}\n`,
    );
  }
}

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import uWS from 'uWebSockets.js';
import {
  logger,
  createConsoleLogger,
  structuredLogger,
  createConsoleStructuredLogger,
} from '@citrus/shared';
import { startUwsServer, type UwsServerHandle } from './uws-server';
import { LobbyRegistry, type LobbyConfig } from './LobbyRegistry';
import { DraftServiceV2 } from '../services/DraftServiceV2';
import { supabaseAdmin } from '../lib/supabase';
import {
  startEventSubscription,
  type EventSubscriptionHandle,
} from './eventSubscription';
import type {
  CommissionerAuthorizationResult,
  DraftFormat,
  DraftOrderSlot,
  TeamAuthorizationResult,
} from './types';
import {
  DEFAULT_BID_INCREMENT_TIERS,
  validateBidIncrementTiers,
} from './auctionBidIncrement';

// Enable real console logging on the server (default logger is silent).
Object.assign(logger, createConsoleLogger());
// Chunk 11g.7 sub-step 7a: activate the structured engine-side logger.
// Default singleton is no-op; this swap makes it emit single-line JSON
// to stdout (info/debug) and stderr (warn/error). The GCP Cloud
// Logging Agent on GCE auto-parses the JSON.
Object.assign(structuredLogger, createConsoleStructuredLogger());

const honoPort = parseInt(process.env.PORT || '3001', 10);
const wsPort = parseInt(process.env.DRAFT_WS_PORT || '3002', 10);

// Engine-process Hono app. Carries:
//   - GET /health (chunk 11g.2 — scaffold smoke endpoint, kept).
//   - /api/admin/engine/* — engine-ops admin endpoints, mounted
//     post-registry-construction (chunk 11g.10 sub-step 10b).
//
// The Hono app is intentionally separate from the main API server
// (server/src/app.ts) which runs on Cloud Run. Engine-process routes
// manipulate engine-local in-memory state (LobbyRegistry, snapshot
// pipeline) and have no equivalent on the API side.
import type { Env as AppEnv } from '../app';
import { createDraftAdminRoutes } from '../routes/draftAdmin';

const app = new Hono<AppEnv>();
app.get('/health', (c) => c.json({ ok: true, server: 'hono' }));

// ── Start Hono ──
const processStartTimeMs = Date.now();
const honoServer = serve(
  {
    fetch: app.fetch,
    port: honoPort,
  },
  (info) => {
    structuredLogger.info('hono.listening', { port: info.port });
    emitDeploymentFingerprint(processStartTimeMs);
  },
);

/**
 * Phase 4.5 chunk 11g.10 sub-step 10b — deployment fingerprint.
 *
 * Emit a single structured log line capturing forensic context for
 * any future incident. Fields:
 *   - imageSha       — Docker image SHA, set by deploy pipeline via env.
 *   - commitSha      — git SHA baked into image at build time.
 *   - envFingerprint — presence/absence map for every required env var.
 *                       VALUES NEVER LOGGED (security boundary).
 *   - startupTimeMs  — wall-clock from process start to this emit.
 *
 * The fingerprint anchors "what was deployed when this broke?" for
 * post-incident reconstruction. Required env keys reflect chunk
 * 11g.7-7e + the Phase 4.5 architecture; update when surface changes.
 */
function emitDeploymentFingerprint(startTimeMs: number): void {
  const requiredEnvKeys = [
    'SUPABASE_URL',
    'SUPABASE_DB_URL',
    'SUPABASE_JWT_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'PORT',
    'DRAFT_WS_PORT',
  ];
  const envFingerprint: Record<string, 'present' | 'missing'> = {};
  for (const key of requiredEnvKeys) {
    envFingerprint[key] = process.env[key] ? 'present' : 'missing';
  }
  structuredLogger.info('deployment.fingerprint', {
    imageSha: process.env.IMAGE_SHA ?? 'unset',
    commitSha: process.env.COMMIT_SHA ?? 'unset',
    nodeEnv: process.env.NODE_ENV ?? 'unset',
    envFingerprint,
    startupTimeMs: Date.now() - startTimeMs,
  });
}

// ── uWS app + publish callback for the LobbyRegistry ──
//
// App is hoisted out of `startUwsServer` so its `publish` method can
// also feed the `LobbyRegistry` — every LobbyManager gets the same
// publish callback, so broadcasts on `draft:${lobbyId}` reach all
// subscribed WebSockets via the uWS pub/sub fast path.
//
// Constructor injection (here) beats a setter-based late-bind on
// the registry — no temporal coupling, no null-deref window.
const draftApp = uWS.App();

const publishToLobbyTopic: (topic: string, message: string) => void = (
  topic,
  message,
) => {
  draftApp.publish(topic, message);
};

// ── LobbyRegistry: process-singleton mapping lobbyId → LobbyManager ──
//
// Construct ONE DraftServiceV2 backed by the admin Supabase client
// and reuse it across all LobbyManagers. The lazy-Proxy pattern in
// `server/src/lib/supabase.ts` defers env-var validation until first
// RPC call, so `new DraftServiceV2(supabaseAdmin)` never throws at
// import time.
//
// **Auth.uid() concern:** see the file-level JSDoc in
// `server/src/draft/LobbyRegistry.ts` and the
// PHASE_4_5_PROJECT_PLAN.md Decision Log entry from 2026-05-05
// (ADR-004). Engine-side `verifyTeamAuthorization` below satisfies
// the trusted-executor contract that ADR-004 §5.3 requires.

/**
 * Step-6a/c `lobbyConfigLookup` (Path B per chunk-6a recon).
 *
 * Two queries:
 *   1. `leagues` row → format (`settings.draftType`), pick clock
 *      (`settings.pickTimeLimit`), live deadline (`pick_deadline`),
 *      draft state (`draft_state`).
 *   2. `draft_order` rows for the league → flattened slot list.
 *
 * Snake reversal is already baked into each row's `team_order`
 * JSONB array per `DraftService.initializeDraftOrder`
 * (`server/src/services/DraftService.ts:336-338`). The same data
 * feeds `submit_pick_v2`'s on-clock check (migration line 783-799),
 * so loading from the DB rather than regenerating in-engine
 * eliminates the divergence risk if a commissioner used
 * `customTeamOrder` at draft setup.
 *
 * Step 6c additions:
 *   - `pickClockSeconds`: `pickTimeLimit + 1` (matches
 *     `submit_pick_v2`'s deadline-computation pad at migration
 *     line 896-898 — the +1s ensures the user-visible client timer
 *     hits zero before server-side autopick fires).
 *   - `initialPickDeadline`: `leagues.pick_deadline` parsed to a
 *     `Date`. The RPC has authoritatively maintained this column
 *     since Phase 2; engine consumes directly rather than
 *     reconstructing from event timestamps.
 *   - `initialDraftState`: raw `leagues.draft_state` value.
 *
 * Throws on missing/invalid configuration so the uWS upgrade
 * handler can close the WS cleanly with code 1011.
 */
async function lookupLobbyConfig(leagueId: string): Promise<LobbyConfig> {
  const { data: leagueRow, error: leagueErr } = await supabaseAdmin
    .from('leagues')
    .select('settings, pick_deadline, draft_state')
    .eq('id', leagueId)
    .single();
  if (leagueErr) {
    throw new Error(`leagueLookup failed for ${leagueId}: ${leagueErr.message}`);
  }
  if (!leagueRow) {
    throw new Error(`league ${leagueId} not found`);
  }
  const settings = leagueRow.settings as
    | {
        draftType?: string;
        pickTimeLimit?: number;
        auctionBidWindowSeconds?: number;
        auctionNominationWindowSeconds?: number;
        auctionBudget?: number;
        auctionMinBid?: number;
        auctionAntiSnipeThresholdSeconds?: number;
        auctionAntiSnipeExtensionSeconds?: number;
        auctionMinBidIncrementTiers?: unknown;
        rosterSize?: number;
        draftRounds?: number;
      }
    | null;
  const draftType = settings?.draftType;
  if (draftType !== 'snake' && draftType !== 'linear' && draftType !== 'auction') {
    throw new Error(
      `league ${leagueId} draftType=${draftType ?? 'undefined'} is not a live format ` +
        `(expected snake | linear | auction)`,
    );
  }
  const format: DraftFormat = draftType;

  // Snake/linear: pickClockSeconds = pickTimeLimit + 1 (RPC pad).
  // Auction (chunk 11g.6 sub-step 6c3): pickClockSeconds is unused
  // by the auction state machine (which has its own
  // `auctionBidWindowSeconds` + `auctionNominationWindowSeconds`
  // pair per ADR-002 §3.4). For backwards-compat with the
  // LobbyManager constructor signature, auction lobbies still set
  // `pickClockSeconds = auctionBidWindowSeconds + 1` (the legacy
  // shape) but the engine now reads the explicit fields directly.
  const auctionBidWindowSeconds =
    typeof settings?.auctionBidWindowSeconds === 'number'
      ? settings.auctionBidWindowSeconds
      : 30;
  const auctionNominationWindowSeconds =
    typeof settings?.auctionNominationWindowSeconds === 'number'
      ? settings.auctionNominationWindowSeconds
      : 60;
  const pickTimeLimit =
    format === 'auction'
      ? auctionBidWindowSeconds
      : typeof settings?.pickTimeLimit === 'number'
        ? settings.pickTimeLimit
        : 90;
  const pickClockSeconds = pickTimeLimit + 1;

  const initialPickDeadline = leagueRow.pick_deadline
    ? new Date(leagueRow.pick_deadline as string)
    : null;
  const initialDraftState = (leagueRow.draft_state as string | null) ?? null;

  // Auction lobbies have no slot-based order — chunk 11g.6 / ADR-002
  // owns auction state. Return empty draftOrder so the LobbyManager's
  // `processSubmitPick` short-circuits at the format gate before
  // consulting the (intentionally empty) order. Round-1 `team_order`
  // from `draft_order` provides the round-robin nomination rotation
  // (per ADR-002 §3.2 + v1 AuctionService); auction_budgets feeds the
  // initial budget/playersWon maps.
  if (format === 'auction') {
    const auctionConfig = await loadAuctionConfig(leagueId, settings);
    // Anti-snipe configuration (chunk 11g.6 sub-step 6b per ADR-002
    // §3.3 / §4.4). Read from `leagues.settings`; defaults match
    // ADR-002 §4.3 (30s threshold + 30s extension).
    const auctionAntiSnipeThresholdSeconds =
      typeof settings?.auctionAntiSnipeThresholdSeconds === 'number'
        ? settings.auctionAntiSnipeThresholdSeconds
        : 30;
    const auctionAntiSnipeExtensionSeconds =
      typeof settings?.auctionAntiSnipeExtensionSeconds === 'number'
        ? settings.auctionAntiSnipeExtensionSeconds
        : 30;

    // Tiered minimum-bid increments (chunk 11g.6 sub-step 6c2 per
    // ADR-002 §4.3). Default = flat $1. Validate at lookup time so
    // commissioner setup errors surface at lobby construction
    // rather than at first bid.
    const rawTiers =
      settings?.auctionMinBidIncrementTiers !== undefined
        ? settings.auctionMinBidIncrementTiers
        : DEFAULT_BID_INCREMENT_TIERS;
    const auctionMinBidIncrementTiers = validateBidIncrementTiers(rawTiers);

    return {
      format,
      draftOrder: [],
      pickClockSeconds,
      initialPickDeadline,
      initialDraftState,
      ...auctionConfig,
      auctionAntiSnipeThresholdSeconds,
      auctionAntiSnipeExtensionSeconds,
      auctionMinBidIncrementTiers,
      auctionBidWindowSeconds,
      auctionNominationWindowSeconds,
    };
  }

  // Load `public.draft_order` rows for the league. Each row has a
  // round_number and a `team_order` JSONB array (already in pick
  // order for that round, with snake reversal baked in).
  const { data: orderRows, error: orderErr } = await supabaseAdmin
    .from('draft_order')
    .select('round_number, team_order')
    .eq('league_id', leagueId)
    .order('round_number', { ascending: true });
  if (orderErr) {
    throw new Error(
      `draftOrderLookup failed for ${leagueId}: ${orderErr.message}`,
    );
  }
  if (!orderRows || orderRows.length === 0) {
    throw new Error(
      `league ${leagueId} has no draft_order rows; ` +
        `DraftService.initializeDraftOrder must run before the lobby opens`,
    );
  }

  // Flatten the per-round rows into a monotonically-numbered slot
  // list. pickNumber is 1-indexed and global across the entire draft.
  const draftOrder: DraftOrderSlot[] = [];
  let pickNumber = 1;
  for (const row of orderRows) {
    const roundNumber = row.round_number as number;
    const teamOrder = row.team_order as unknown;
    if (!Array.isArray(teamOrder)) {
      throw new Error(
        `league ${leagueId} round ${roundNumber} team_order is not an array`,
      );
    }
    for (const teamId of teamOrder) {
      if (typeof teamId !== 'string') {
        throw new Error(
          `league ${leagueId} round ${roundNumber} team_order contains non-string entry`,
        );
      }
      draftOrder.push({ round: roundNumber, pickNumber, teamId });
      pickNumber++;
    }
  }

  return {
    format,
    draftOrder,
    pickClockSeconds,
    initialPickDeadline,
    initialDraftState,
    // Snake/linear lobbies do not use auction state. Empty/zero
    // values keep `LobbyConfig` discriminator-free at the type level
    // while letting `LobbyManager` short-circuit on `format`.
    nominationOrder: [],
    auctionBudget: 0,
    auctionMinBid: 0,
    draftRounds: 0,
    initialTeamBudgets: new Map(),
    initialPlayersWon: new Map(),
    initialActiveNomination: null,
    auctionAntiSnipeThresholdSeconds: 0,
    auctionAntiSnipeExtensionSeconds: 0,
    // Snake/linear lobbies don't call place_bid_v2; tier table is
    // unused but `LobbyConfig` requires the field. Default flat-$1
    // is the safe placeholder.
    auctionMinBidIncrementTiers: DEFAULT_BID_INCREMENT_TIERS,
    // Snake/linear lobbies don't have auction timers; zero-init.
    auctionBidWindowSeconds: 0,
    auctionNominationWindowSeconds: 0,
  };
}

/**
 * Auction-only `lobbyConfigLookup` extension (chunk 11g.6 sub-step
 * 6a). Returns the auction subset of `LobbyConfig`:
 *
 *   - `nominationOrder`: round-1 `team_order` from `draft_order`.
 *     This is the round-robin rotation per ADR-002 §3.2; it matches
 *     v1 `AuctionService`'s `nomination_order` semantics so a
 *     mid-draft handover from v1 to the engine is order-preserving.
 *   - `auctionBudget` / `auctionMinBid` / `draftRounds`: from
 *     `leagues.settings` (with ADR-002 §4.3 defaults).
 *   - `initialTeamBudgets` / `initialPlayersWon`: hydrated from the
 *     existing `auction_budgets` table (canonical per recon — this
 *     replaces the brief's proposal to add a `teams.budget_remaining`
 *     column).
 *   - `initialActiveNomination`: most-recent open row from
 *     `auction_nominations`, used for diagnostic logging during
 *     bootstrap. The authoritative replay path rebuilds
 *     `currentNomination` from `draft_events`, so this field is
 *     informational; init log emits a warning if it disagrees with
 *     the replayed state.
 */
async function loadAuctionConfig(
  leagueId: string,
  settings:
    | {
        auctionBudget?: number;
        auctionMinBid?: number;
        rosterSize?: number;
        draftRounds?: number;
      }
    | null,
): Promise<{
  nominationOrder: string[];
  auctionBudget: number;
  auctionMinBid: number;
  draftRounds: number;
  initialTeamBudgets: Map<string, number>;
  initialPlayersWon: Map<string, number>;
  initialActiveNomination: LobbyConfig['initialActiveNomination'];
}> {
  const auctionBudget =
    typeof settings?.auctionBudget === 'number' ? settings.auctionBudget : 200;
  const auctionMinBid =
    typeof settings?.auctionMinBid === 'number' ? settings.auctionMinBid : 1;
  const draftRounds =
    typeof settings?.draftRounds === 'number'
      ? settings.draftRounds
      : typeof settings?.rosterSize === 'number'
        ? settings.rosterSize
        : 0;

  const { data: round1, error: round1Err } = await supabaseAdmin
    .from('draft_order')
    .select('team_order')
    .eq('league_id', leagueId)
    .eq('round_number', 1)
    .single();
  if (round1Err) {
    throw new Error(
      `auction draftOrderLookup failed for ${leagueId}: ${round1Err.message}`,
    );
  }
  if (!round1 || !Array.isArray(round1.team_order)) {
    throw new Error(
      `league ${leagueId} round-1 team_order missing or not an array`,
    );
  }
  const nominationOrder: string[] = [];
  for (const teamId of round1.team_order as unknown[]) {
    if (typeof teamId !== 'string') {
      throw new Error(
        `league ${leagueId} round-1 team_order contains non-string entry`,
      );
    }
    nominationOrder.push(teamId);
  }

  const { data: budgetRows, error: budgetErr } = await supabaseAdmin
    .from('auction_budgets')
    .select('team_id, remaining_budget, players_won')
    .eq('league_id', leagueId);
  if (budgetErr) {
    throw new Error(
      `auction_budgets lookup failed for ${leagueId}: ${budgetErr.message}`,
    );
  }
  const initialTeamBudgets = new Map<string, number>();
  const initialPlayersWon = new Map<string, number>();
  for (const row of budgetRows ?? []) {
    initialTeamBudgets.set(row.team_id as string, Number(row.remaining_budget));
    initialPlayersWon.set(row.team_id as string, Number(row.players_won));
  }

  // Active nomination (informational; replay is authoritative).
  const { data: activeNom } = await supabaseAdmin
    .from('auction_nominations')
    .select('id, player_id, nominator_team_id, leading_bidder_id, leading_bid, expires_at')
    .eq('league_id', leagueId)
    .eq('status', 'active')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  const initialActiveNomination = activeNom
    ? {
        nominationId: String(activeNom.id),
        playerId: String(activeNom.player_id),
        nominatorTeamId: String(activeNom.nominator_team_id),
        leadingBidderId: String(activeNom.leading_bidder_id),
        leadingBid: Number(activeNom.leading_bid),
        expiresAt: new Date(activeNom.expires_at as string),
      }
    : null;

  return {
    nominationOrder,
    auctionBudget,
    auctionMinBid,
    draftRounds,
    initialTeamBudgets,
    initialPlayersWon,
    initialActiveNomination,
  };
}

/**
 * Engine-side team-authorization callback per ADR-004 §5.3.
 *
 * Today's implementation: query `teams.owner_id` for the team and
 * compare to the user's id. Returns the richer
 * `TeamAuthorizationResult` discriminated union so ADR-003 Phase 2's
 * `team_authorized()` SQL helper integration is a clean drop-in
 * (just swap the implementation; callsites unchanged).
 *
 * Co-manager support is explicitly out of scope here per ADR-003's
 * deferred timing — head manager (`teams.owner_id`) is the only
 * authorized actor pre-ADR-003 Phase 2.
 */
async function verifyTeamAuthorization(
  userId: string,
  teamId: string,
): Promise<TeamAuthorizationResult> {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select('owner_id')
    .eq('id', teamId)
    .single();
  if (error || !data) {
    return { authorized: false, reason: 'team_not_found' };
  }
  if (data.owner_id !== userId) {
    return { authorized: false, reason: 'not_owner' };
  }
  return { authorized: true };
}

/**
 * Engine-side commissioner-authorization callback (chunk 11g.6
 * sub-step 6c4 per ADR-002 §4.4 + ADR-004 §5). Parallel structure
 * to `verifyTeamAuthorization`. Queries `leagues.commissioner_id`
 * directly; returns granular reasons for observability while the
 * engine returns coarse-grained `'unauthorized'` to the client.
 */
async function verifyCommissionerAuthorization(
  userId: string,
  leagueId: string,
): Promise<CommissionerAuthorizationResult> {
  const { data, error } = await supabaseAdmin
    .from('leagues')
    .select('commissioner_id')
    .eq('id', leagueId)
    .single();
  if (error || !data) {
    return { authorized: false, reason: 'league_not_found' };
  }
  if (data.commissioner_id !== userId) {
    return { authorized: false, reason: 'not_commissioner' };
  }
  return { authorized: true };
}

const lobbyRegistry = new LobbyRegistry({
  draftService: new DraftServiceV2(supabaseAdmin),
  lobbyConfigLookup: lookupLobbyConfig,
  verifyTeamAuthorization,
  verifyCommissionerAuthorization,
  publish: publishToLobbyTopic,
  // Step 6c: same admin client backs autopick read queries
  // (player projections, already-drafted lookup). Forwarded
  // through the registry to every constructed LobbyManager.
  supabase: supabaseAdmin,
});

// Phase 4.5 chunk 11g.10 sub-step 10b — mount engine-ops admin routes
// at /api/admin/engine/* on the engine's Hono server.
//
// Auth: existing authMiddleware (JWT validation via Supabase auth API).
// Requires SUPABASE_URL + SUPABASE_ANON_KEY in the engine's env — the
// GCE startup script injects both alongside the chunk-11g.10-10b
// secret additions (SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY).
//
// Per-route is_engine_admin gate is implemented inside the factory.
// Audit-log events fire on every successful admin action
// (admin.endpoint.snapshot_forced, admin.endpoint.lobby_evicted,
// admin.endpoint.registry_read) for durable operational trail.
app.route(
  '/api/admin',
  createDraftAdminRoutes({
    registry: lobbyRegistry,
    supabaseAdmin,
  }),
);

// ── Start uWS ──
let uwsHandle: UwsServerHandle | null = null;
startUwsServer({ port: wsPort, app: draftApp, lobbyRegistry })
  .then((handle) => {
    uwsHandle = handle;
  })
  .catch((err) => {
    structuredLogger.error('uws.startup_failed', {}, err);
    process.exit(1);
  });

// ── Start cross-process event subscription (chunk 11g.7 sub-step 7e) ──
//
// LISTEN/NOTIFY subscription on a dedicated raw `pg.Client` connection.
// Receives notifications written by ANY process (commissioner UI →
// main API → RPC, or this engine's own emissions) and dispatches them
// to in-memory lobbies via the single-writer queue. See
// `eventSubscription.ts` for full architecture.
//
// `SUPABASE_DB_URL` MUST be a direct connection (not pooled —
// pgbouncer drops LISTEN frames). The startup self-test in
// `startEventSubscription` is the operational diagnostic that catches
// pooled-URL misconfiguration within 5s.
//
// `EVENT_SUBSCRIPTION_DISABLED=1` short-circuits startup — used in
// tests (vitest setup sets it by default) and in environments without
// a direct DB URL configured.
let subscriptionHandle: EventSubscriptionHandle | null = null;
const subscriptionDisabled = process.env.EVENT_SUBSCRIPTION_DISABLED === '1';
const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
if (subscriptionDisabled) {
  structuredLogger.info('event_subscription.disabled', {
    reason: 'EVENT_SUBSCRIPTION_DISABLED=1',
  });
} else if (!dbUrl) {
  structuredLogger.warn('event_subscription.skipped_no_db_url', {
    remediation:
      'Set SUPABASE_DB_URL (or DATABASE_URL) to a direct Postgres connection ' +
      'to enable cross-process event delivery. Bootstrap still catches up on ' +
      'WS reconnect; the engine will not observe runtime cross-process events ' +
      'without this.',
  });
} else {
  subscriptionHandle = startEventSubscription({
    connectionString: dbUrl,
    dispatch: async (notification) => {
      // Lobby-load forbidden on NOTIFY (resource-exhaustion protection).
      // Unknown leagueId is silently ignored to prevent the attack
      // vector of every external event firing a lobby load. Lobbies
      // load lazily on WS connect; bootstrap catches up via
      // snapshot+delta from chunk 11g.7 sub-step 7c.
      const lobby = lobbyRegistry.get(notification.leagueId);
      if (!lobby) {
        structuredLogger.debug(
          'event_subscription.event_skipped_unknown_lobby',
          { leagueId: notification.leagueId, seq: notification.seq },
        );
        return;
      }
      await lobby.enqueueExternalEvent(notification.seq);
    },
  });
}

// ── Graceful shutdown — closes both servers within 10s ──
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  structuredLogger.info('shutdown.initiated', { signal });

  // Chunk 11g.7 sub-step 7e: stop the LISTEN/NOTIFY subscription
  // FIRST so no new external events fire mid-teardown. The .stop()
  // promise is awaited inside the IIFE so honoServer.close() doesn't
  // race against the pg client's graceful end.
  if (subscriptionHandle) {
    void subscriptionHandle.stop();
    subscriptionHandle = null;
  }

  if (uwsHandle) {
    // Chunk 11g.7 sub-step 7d: cancel the heartbeat soft-check timer
    // BEFORE closing the listen socket. Mirrors the
    // `LobbyManager.stopSnapshotTimer()` pattern from sub-step 7c —
    // late-firing timers post-shutdown add noise to the SIGTERM
    // window and can race against teardown.
    uwsHandle.stopHeartbeat();
    uwsHandle.close();
    uwsHandle = null;
  }

  honoServer.close(() => {
    structuredLogger.info('hono.closed');
    process.exit(0);
  });

  setTimeout(() => {
    structuredLogger.error('shutdown.forced_after_timeout', {
      timeoutMs: 10_000,
    });
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
