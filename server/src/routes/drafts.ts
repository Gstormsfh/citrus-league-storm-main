/**
 * Phase 4.5 chunk 11g.1 — Discovery endpoint for the live draft engine.
 *
 * GET /api/drafts/:draftId/server returns `{ host, port, token }` where:
 *   - `host` and `port` address the WebSocket-serving Node process for
 *     this draft. Day 1 returns env-driven constants (single-process,
 *     no sharding); the protocol shape supports future multi-process
 *     transition without client or server changes (KI-011).
 *   - `token` is a 5-minute draft-scoped JWT (see `lib/draftToken.ts`).
 *
 * In Citrus's data model the "draft" is not a separate entity — it's the
 * league's drafting phase, identified by `league_id` and tracked via the
 * `leagues.draft_status` enum. The `:draftId` URL parameter and the JWT's
 * `draftId` claim are therefore the league's UUID; the "draftId" naming
 * is preserved at the API surface because it's more semantic for clients
 * than "leagueId in drafting phase." See `docs/DRAFT_ENGINE_V2_SPEC.md`
 * §0 and `lib/draftToken.ts` for the canonical model.
 *
 * Auth: existing `authMiddleware` + direct `LeagueMembershipService`
 * call (the standard `membershipMiddleware` reads `:leagueId` from the
 * path, but this route uses `:draftId`). Chunk 11g.0 audit § 4 flagged
 * the helper-extraction work for chunk 11g.2; until then this route
 * calls the service directly.
 */

import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { issueDraftToken } from '../lib/draftToken';
import {
  CONNECTABLE_DRAFT_STATUSES,
  CURRENT_SEASON,
  type DraftStatus,
  type TerminalSnapshotPick,
} from '@citrus/shared';
import { logger, structuredLogger } from '@citrus/shared';
import { buildSnapshot } from '../services/snapshotService';
import { readSystemFlag } from '../lib/systemFlags';

const draftsRoutes = new Hono<Env>();

draftsRoutes.use('*', authMiddleware);

/**
 * GET /api/drafts/:draftId/server
 *
 * Validates the caller is a member of the league (= draft) and that
 * the league's `draft_status` is in a connectable state, then returns
 * the WebSocket connection address + a short-lived JWT.
 *
 * Status codes:
 *   - 200: league found, user is member, draft connectable.
 *   - 401: unauthenticated (handled by `authMiddleware`).
 *   - 403: user is not a member of the league.
 *   - 404: no league with this id.
 *   - 409: league exists, user is member, but draft is in a non-
 *     connectable state (`not_started` or `completed`). The 409 carries
 *     the current status so the client can render the right UI.
 *   - 503: server JWT secret unavailable, or unexpected lookup error.
 */
draftsRoutes.get('/:draftId/server', async (c) => {
  const draftId = c.req.param('draftId');
  const userId = c.get('userId');
  const userToken = c.get('userToken');

  if (!draftId || !/^[0-9a-f-]{36}$/i.test(draftId)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid draftId' } }, 400);
  }

  const supabase = createUserClient(userToken);

  // The "draft" is the league's drafting phase. Look up the league,
  // confirm it exists, and read its `draft_status` to gate connection.
  const { data: league, error: leagueErr } = await supabase
    .from('leagues')
    .select('id, draft_status')
    .eq('id', draftId)
    .maybeSingle();

  if (leagueErr) {
    logger.error('[drafts/server] league lookup failed', { draftId, error: leagueErr });
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Draft lookup failed' } }, 500);
  }
  if (!league) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Draft not found' } }, 404);
  }

  const leagueId = league.id as string;
  const draftStatus = league.draft_status as DraftStatus;

  // Membership before status — leak as little league existence as possible
  // to non-members. (A non-member gets 403 regardless of whether the
  // draft happens to be in a connectable state.)
  const membership = new LeagueMembershipService(supabase);
  const memberCheck = await membership.checkMembership(leagueId, userId);
  if (!memberCheck.isMember) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this league' } }, 403);
  }

  // Phase 4.5 chunk 11g.10 sub-step 10b — discovery-flag check.
  //
  // Tier-1 incident bridging action (operations runbook §2.4 + rollback
  // playbook §3): refuse NEW drafts when `system_flags.no_new_drafts`
  // is true. In-progress drafts are unaffected — existing players keep
  // playing. Toggle takes effect within the systemFlags cache TTL (~5s).
  //
  // The 5s cache absorbs the discovery endpoint's request rate; an
  // on-call SQL UPDATE on system_flags propagates within 5 seconds to
  // every API process reading this flag. Defense-in-depth: the engine
  // also checks (LobbyRegistry.getOrCreate) — same table, two
  // enforcement points.
  const noNewDrafts = await readSystemFlag(supabase, 'no_new_drafts');
  if (noNewDrafts && draftStatus === 'not_started') {
    structuredLogger.info('discovery.refused_no_new_drafts', {
      leagueId,
      userId,
      draftStatus,
    });
    return c.json(
      {
        error: {
          code: 'NEW_DRAFTS_DISABLED',
          message:
            'New drafts are temporarily disabled by an operational flag. ' +
            'In-progress drafts continue normally. Contact the league commissioner ' +
            'or admin for status.',
          status: draftStatus,
        },
      },
      503,
    );
  }

  if (!CONNECTABLE_DRAFT_STATUSES.includes(draftStatus)) {
    return c.json(
      {
        error: {
          code: 'DRAFT_NOT_CONNECTABLE',
          message: `Draft is not active. Current status: ${draftStatus}`,
          status: draftStatus,
        },
      },
      409,
    );
  }

  // Day 1: single-process, env-driven address. Future sharding (KI-011)
  // turns these into per-shard lookups without changing the response shape.
  const host = process.env.DRAFT_WS_HOST || 'localhost';
  const port = parseInt(process.env.DRAFT_WS_PORT || '3002', 10);

  let token: string;
  try {
    token = await issueDraftToken({ userId, draftId, leagueId });
  } catch (err: unknown) {
    logger.error('[drafts/server] token issuance failed', { error: err instanceof Error ? err.message : err });
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Token issuance unavailable' } }, 503);
  }

  return c.json({ host, port, token });
});

/**
 * GET /api/drafts/:draftId/snapshot
 *
 * Phase 4.5 chunk 11g.7 sub-step 7b — HTTP snapshot endpoint for
 * client resync when WS resync returns `too_old`. Reads durable
 * state from Postgres and reconstructs a `DraftSnapshot` matching
 * the wire shape from `packages/shared/src/types/draftWire.ts`.
 *
 * **Path A architecture (Decision Log 2026-05-07)**: snapshot
 * lives in main API server, NOT engine process. Engine's in-memory
 * `LobbyRegistry` is in a separate Node process; reconstructing
 * from durable state is the cross-process bridge. Staleness <1 sec
 * is acceptable per the existing resync architecture — client
 * issues `resync(sinceSeq=snapshot.lastSeenSeq)` after reconnect
 * and recovers any events that landed during the gap.
 *
 * **Auth**: Supabase JWT via `authMiddleware` (route-group
 * convention) + LeagueMembershipService check. Same as the
 * discovery endpoint above. Decision Log 2026-05-07: auth scheme
 * matches the route group's existing convention, not the
 * underlying resource's other access patterns.
 *
 * Status codes:
 *   - 200: snapshot reconstructed; body matches `DraftSnapshot`
 *   - 400: malformed `:draftId` (not a UUID)
 *   - 401: unauthenticated (handled by `authMiddleware`)
 *   - 403: user not a member of the league
 *   - 404: league/draft not found OR no draft format configured
 *   - 409: league exists, member, but draft not connectable
 *     (`not_started` / `completed` / `cancelled`)
 *   - 500: DB lookup failure (logged with full context)
 */
draftsRoutes.get('/:draftId/snapshot', async (c) => {
  const draftId = c.req.param('draftId');
  const userId = c.get('userId');
  const userToken = c.get('userToken');

  if (!draftId || !/^[0-9a-f-]{36}$/i.test(draftId)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid draftId' } },
      400,
    );
  }

  const supabase = createUserClient(userToken);

  // Read draft_status for connectability gating; the full snapshot
  // reconstruction reads this row again, but the explicit gate
  // here keeps the response semantics close to the discovery
  // endpoint's contract (404/403/409 before any reconstruction work).
  const { data: league, error: leagueErr } = await supabase
    .from('leagues')
    .select('id, draft_status')
    .eq('id', draftId)
    .maybeSingle();

  if (leagueErr) {
    structuredLogger.error(
      'snapshot.endpoint.league_lookup_failed',
      { draftId, userId },
      leagueErr,
    );
    return c.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Snapshot lookup failed' } },
      500,
    );
  }
  if (!league) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Draft not found' } },
      404,
    );
  }

  const leagueId = league.id as string;
  const draftStatus = league.draft_status as DraftStatus;

  // Membership check — same belt-and-suspenders pattern as the
  // discovery endpoint. Non-members get 403 regardless of draft
  // state to minimize information disclosure.
  const membership = new LeagueMembershipService(supabase);
  const memberCheck = await membership.checkMembership(leagueId, userId);
  if (!memberCheck.isMember) {
    structuredLogger.warn(
      'snapshot.endpoint.not_member',
      { draftId, userId },
    );
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Not a member of this league' } },
      403,
    );
  }

  // Entry 87 Fix A (COMPLETED-ROOM-1, 2026-08-10) — the snapshot
  // route serves terminal-state drafts (`completed` today) as
  // permanent league history. Rejecting completed drafts here forced
  // the client into a discovery → 409 → backoff loop for every
  // reconnect after the engine's lobby-eviction TTL kicked in
  // post-completion (Garrett witnessed this on Run 3's finished
  // league). The discovery route KEEPS its 409 for terminal states —
  // there's no live connection to hand out — but the snapshot is
  // always safe to reconstruct from the durable draft_events +
  // draft_picks_v2 tables (Entry 90 DB evidence: draft_snapshots
  // rows persist post-eviction, and buildSnapshot reads durable
  // projection tables regardless of lobby state).
  //
  // Only `not_started` still 409s here — there's genuinely no
  // snapshot to render until the first pick fires. The architect
  // truth table names `cancelled` alongside `completed`, but the
  // current DraftStatus union does not include `cancelled`
  // (packages/shared/types/league.ts:552); when it's added, extend
  // TERMINAL_STATUSES here to match. The client already accepts
  // 'cancelled' in its terminal_completed state.
  const TERMINAL_STATUSES: readonly DraftStatus[] = ['completed'];
  const isConnectable = CONNECTABLE_DRAFT_STATUSES.includes(draftStatus);
  const isTerminal = TERMINAL_STATUSES.includes(draftStatus);
  if (!isConnectable && !isTerminal) {
    return c.json(
      {
        error: {
          code: 'DRAFT_NOT_CONNECTABLE',
          message: `Draft is not active. Current status: ${draftStatus}`,
          status: draftStatus,
        },
      },
      409,
    );
  }

  let snapshot;
  try {
    snapshot = await buildSnapshot(leagueId, supabase);
    // Entry 99 COMPLETED-ROOM-2 (2026-08-11) — dual-source-of-truth
    // fix (b). LOAD-1-NIGHT witness draft found the engine serializer
    // returns `stateSnapshot.draftStatus='in_progress'` for a
    // completed league (lastAppliedSeq=14 including draft_completed,
    // engine persistence log labels it completed, but the serializer's
    // status field lies). Client's completion render waits for a
    // terminal status the payload never asserts → hangs forever on
    // "Loading final board…".
    //
    // Route-level decoration: when serving a terminal league, override
    // `stateSnapshot.draftStatus` with the authoritative
    // `leagues.draft_status` value. The engine serializer fix (a per
    // Entry 99) rides the separate ENGINE-EAR deploy batch; this
    // route override is the client-visible corrective in the morning
    // hosting/API cycle. Belt to reduce.ts's own client-side override
    // (E99 fix c) — either alone is sufficient; both together is
    // defense-in-depth against future engine regressions.
    if (snapshot && isTerminal && snapshot.stateSnapshot.draftStatus !== draftStatus) {
      snapshot = {
        ...snapshot,
        stateSnapshot: {
          ...snapshot.stateSnapshot,
          draftStatus,
        },
      };
    }

    // Entry 103 F2b (2026-08-11) — enrich terminal snapshot with the
    // authoritative picks projection. Morning field verification (E103)
    // found that after E99's decoration landed, terminal rooms STILL
    // rendered "0/12 picks made" — the engine had evicted the lobby
    // post-completion so `snapshot.recentEvents` was empty; the
    // client's derive-from-events fold produced picksMade=0 and
    // teamRosters=Map(). Fix: query draft_picks_v2 (the trigger-
    // maintained projection — spec §3.2, principle P6) directly and
    // attach as `picks`. Client uses this as the authoritative source
    // instead of unpacking event kinds — the projection IS the source
    // of truth per architect ratification.
    //
    // Left-joins to teams (for team_name) and player_directory
    // (current-season for full_name / position / team_abbrev). Missing
    // joins render as `null` on the wire → `#<id>` fallbacks in the
    // client v1Adapters pattern.
    if (snapshot && isTerminal) {
      try {
        const { data: picksRows, error: picksErr } = await supabase
          .from('draft_picks_v2')
          .select('pick_number, round, team_id, player_id, picked_at, picked_by_actor')
          .eq('league_id', leagueId)
          .order('pick_number', { ascending: true });
        if (picksErr) {
          structuredLogger.warn(
            'snapshot.terminal.picks_query_failed',
            { draftId, userId, error: picksErr.message },
          );
        } else if (Array.isArray(picksRows) && picksRows.length > 0) {
          const teamIds = Array.from(new Set(picksRows.map((r) => r.team_id as string)));
          const playerIds = Array.from(new Set(picksRows.map((r) => r.player_id as number)));

          const [{ data: teamRows }, { data: playerRows }] = await Promise.all([
            supabase
              .from('teams')
              .select('id, team_name')
              .in('id', teamIds),
            supabase
              .from('player_directory')
              .select('player_id, full_name, position_code, team_abbrev')
              .in('player_id', playerIds)
              .eq('season', CURRENT_SEASON),
          ]);

          const teamNameById = new Map<string, string | null>();
          for (const t of (teamRows ?? []) as Array<{ id: string; team_name: string | null }>) {
            teamNameById.set(t.id, t.team_name ?? null);
          }
          const playerById = new Map<
            number,
            { full_name: string | null; position_code: string | null; team_abbrev: string | null }
          >();
          for (const p of (playerRows ?? []) as Array<{
            player_id: number;
            full_name: string | null;
            position_code: string | null;
            team_abbrev: string | null;
          }>) {
            playerById.set(p.player_id, {
              full_name: p.full_name ?? null,
              position_code: p.position_code ?? null,
              team_abbrev: p.team_abbrev ?? null,
            });
          }

          const picks: TerminalSnapshotPick[] = picksRows.map((r) => {
            const rawRow = r as {
              pick_number: number;
              round: number;
              team_id: string;
              player_id: number;
              picked_at: string;
              picked_by_actor: { kind?: string } | null;
            };
            const p = playerById.get(rawRow.player_id);
            const actorKind = rawRow.picked_by_actor?.kind;
            return {
              pickNumber: rawRow.pick_number,
              roundNumber: rawRow.round,
              teamId: rawRow.team_id,
              teamName: teamNameById.get(rawRow.team_id) ?? null,
              playerId: rawRow.player_id,
              playerName: p?.full_name ?? null,
              playerPosition: p?.position_code ?? null,
              playerTeam: p?.team_abbrev ?? null,
              pickedAt: rawRow.picked_at,
              isAutopick: actorKind === 'autopick',
            };
          });

          snapshot = { ...snapshot, picks };
        }
      } catch (enrichErr) {
        // Enrichment failure is non-fatal — the terminal room still
        // renders the E99-decorated header + CompletionMomentBanner
        // via the existing derive path. Log for observability.
        structuredLogger.warn(
          'snapshot.terminal.picks_enrichment_threw',
          {
            draftId,
            userId,
            error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
          },
        );
      }
    }
  } catch (err) {
    structuredLogger.error(
      'snapshot.endpoint.build_failed',
      { draftId, userId },
      err,
    );
    return c.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Snapshot build failed' } },
      500,
    );
  }
  if (!snapshot) {
    // League exists + connectable but `buildSnapshot` returned null
    // (e.g., draft_type missing). Treat as 404 — there is no draft
    // to snapshot.
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Draft not configured' } },
      404,
    );
  }

  structuredLogger.debug(
    'snapshot.endpoint.success',
    {
      draftId,
      userId,
      format: snapshot.format,
      eventsReturned: snapshot.recentEvents.length,
    },
  );

  return c.json(snapshot);
});

export { draftsRoutes };
