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
import { logger, createConsoleLogger } from '@citrus/shared';
import { startUwsServer, type UwsServerHandle } from './uws-server';
import { LobbyRegistry, type LobbyConfig } from './LobbyRegistry';
import { DraftServiceV2 } from '../services/DraftServiceV2';
import { supabaseAdmin } from '../lib/supabase';
import type { DraftFormat, DraftOrderSlot, TeamAuthorizationResult } from './types';

// Enable real console logging on the server (default logger is silent).
Object.assign(logger, createConsoleLogger());

const honoPort = parseInt(process.env.PORT || '3001', 10);
const wsPort = parseInt(process.env.DRAFT_WS_PORT || '3002', 10);

// Minimal Hono app for the chunk 11g.2 scaffold smoke test. The full
// Citrus Hono app (server/src/app.ts) wires in at chunk 11g.2 step 4-5.
const app = new Hono();
app.get('/health', (c) => c.json({ ok: true, server: 'hono' }));

// ── Start Hono ──
const honoServer = serve(
  {
    fetch: app.fetch,
    port: honoPort,
  },
  (info) => {
    logger.info(`[hono] listening on http://localhost:${info.port}`);
  },
);

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
 * Step-6a `lobbyConfigLookup` (Path B per chunk-6a recon).
 *
 * Two queries:
 *   1. `leagues.settings.draftType` → format
 *   2. `draft_order` rows for the league → flattened slot list
 *
 * Snake reversal is already baked into each row's `team_order`
 * JSONB array per `DraftService.initializeDraftOrder`
 * (`server/src/services/DraftService.ts:336-338`). The same data
 * feeds `submit_pick_v2`'s on-clock check (migration line 783-799),
 * so loading from the DB rather than regenerating in-engine
 * eliminates the divergence risk if a commissioner used
 * `customTeamOrder` at draft setup.
 *
 * Throws on missing/invalid configuration so the uWS upgrade
 * handler can close the WS cleanly with code 1011.
 */
async function lookupLobbyConfig(leagueId: string): Promise<LobbyConfig> {
  const { data: leagueRow, error: leagueErr } = await supabaseAdmin
    .from('leagues')
    .select('settings')
    .eq('id', leagueId)
    .single();
  if (leagueErr) {
    throw new Error(`leagueLookup failed for ${leagueId}: ${leagueErr.message}`);
  }
  if (!leagueRow) {
    throw new Error(`league ${leagueId} not found`);
  }
  const draftType = (leagueRow.settings as { draftType?: string } | null)?.draftType;
  if (draftType !== 'snake' && draftType !== 'linear' && draftType !== 'auction') {
    throw new Error(
      `league ${leagueId} draftType=${draftType ?? 'undefined'} is not a live format ` +
        `(expected snake | linear | auction)`,
    );
  }
  const format: DraftFormat = draftType;

  // Auction lobbies have no slot-based order — chunk 11g.6 / ADR-002
  // owns auction state. Return empty draftOrder so the LobbyManager's
  // `processSubmitPick` short-circuits at the format gate before
  // consulting the (intentionally empty) order.
  if (format === 'auction') {
    return { format, draftOrder: [] };
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

  return { format, draftOrder };
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

const lobbyRegistry = new LobbyRegistry({
  draftService: new DraftServiceV2(supabaseAdmin),
  lobbyConfigLookup: lookupLobbyConfig,
  verifyTeamAuthorization,
  publish: publishToLobbyTopic,
});

// ── Start uWS ──
let uwsHandle: UwsServerHandle | null = null;
startUwsServer({ port: wsPort, app: draftApp, lobbyRegistry })
  .then((handle) => {
    uwsHandle = handle;
  })
  .catch((err) => {
    logger.error('[uws] Startup failed:', err);
    process.exit(1);
  });

// ── Graceful shutdown — closes both servers within 10s ──
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[${signal}] Shutting down both servers...`);

  if (uwsHandle) {
    uwsHandle.close();
    uwsHandle = null;
  }

  honoServer.close(() => {
    logger.info('[hono] server closed. Goodbye.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after 10s timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
