/**
 * Draft API client — replaces direct Supabase calls for draft operations.
 *
 * WHY EVERY CALL CARRIES A TYPE PARAMETER
 *
 * `apiClient.get`/`post`/`delete` declare `<T = unknown>`. Omit the parameter
 * and `response.data` is `unknown`, so every `response.data?.sessionId` at a
 * call site is a compile error — `Property 'sessionId' does not exist on type
 * 'unknown'`. That single omission produced 17 of the 76 errors in the web
 * typecheck baseline, all of them in DraftService.ts, none of them a real
 * defect: the call sites were reading fields the server does send.
 *
 * The types below are transcribed from the route handlers in
 * `server/src/routes/draft.ts`, not from what the call sites wish they got.
 * That distinction is the whole point — a type that flatters the caller trades
 * a visible compile error for a silent `undefined` at runtime, which is
 * strictly worse than the error it replaced. Each entry names the line it came
 * from so the next person can check the claim rather than trust it.
 *
 * `ok(c, x)` and `created(c, x)` both wrap their payload as `{ data: x }`, so
 * `T` is the argument to those helpers, never the envelope.
 */

import { apiClient } from './client';
// Type-only: erased at compile time, so this does not create a runtime import
// cycle with DraftService (which imports draftApi). Same approach as leagues.ts.
import type { DraftPick, DraftOrder } from '@/services/DraftService';

/** `ok(c, { sessionId })` — draft.ts:68, 261. */
interface SessionResponse {
  sessionId: string;
}

/** `created(c, { pick, isComplete })` — draft.ts:216. */
interface MakePickResponse {
  pick: DraftPick | null;
  isComplete: boolean;
}

/** `ok(c, { league, picks, order })` — draft.ts:135. */
interface DraftStateResponse {
  league: Record<string, unknown> | null;
  picks: DraftPick[];
  order: DraftOrder | null;
}

/**
 * `ok(c, result)` — draft.ts:345, where `result` is
 * DraftService.autopickForTeam's return. Every field is nullable: the
 * RPC-error and no-rows branches return all four as null.
 *
 * `playerId` is a NUMBER here and a string on `DraftPick.player_id`, and both
 * are correct. `autopick_next_player` is declared
 * `RETURNS TABLE(picked_player_id integer, ...)` while `draft_picks.player_id`
 * is a `text` column (both verified against the production catalog
 * 2026-09-03). The RPC layer and the table layer genuinely disagree; do not
 * "harmonise" one to the other from the client.
 */
interface AutopickResponse {
  playerId: number | null;
  playerName: string | null;
  position: string | null;
  pickId: string | null;
}

/** `ok(c, { newSessionId })` — draft.ts:278. */
interface ResetResponse {
  newSessionId: string;
}

/** `ok(c, { undone })` — draft.ts:292. Null when there was nothing to undo. */
interface UndoResponse {
  undone: DraftPick | null;
}

/**
 * `ok(c, { picks })` — draft.ts:359.
 *
 * NOT `DraftPick[]`. The server maps the RPC rows into a different shape
 * entirely (server DraftService.ts:461) and `run_full_autopick_draft` is
 * declared `RETURNS TABLE(round_number integer, pick_number integer,
 * team_id uuid, player_id integer, player_name text)` — verified against the
 * production catalog 2026-09-03. `player_name` is nullable there, so
 * `playerName` is optional here rather than promised.
 */
interface FullAutopickResponse {
  picks: Array<{
    round: number;
    pick: number;
    teamId: string;
    playerId: number;
    playerName?: string;
  }>;
}

/** `created(c, { snapshotId })` — draft.ts:397. Null when the insert returned no row. */
interface SaveSnapshotResponse {
  snapshotId: string | null;
}

/** One row of `ok(c, rankings)` — draft.ts:411, shaped by server DraftService.ts:575. */
interface AutopickRanking {
  playerId: number;
  rank: number;
  positionCode: string;
  tier: number;
}

/** `ok(c, { success: true })` — draft.ts:121, 427. */
interface SuccessResponse {
  success: boolean;
}

export const draftApi = {
  /** Get active draft session for a league */
  getActiveSession(leagueId: string) {
    return apiClient.get<SessionResponse>(`/api/draft/league/${leagueId}/session`);
  },

  /** Get draft picks for a league */
  getDraftPicks(leagueId: string, sessionId?: string) {
    const qs = sessionId ? `?sessionId=${sessionId}` : '';
    return apiClient.get<DraftPick[]>(`/api/draft/league/${leagueId}/picks${qs}`);
  },

  /** Get draft order for a specific round */
  getDraftOrder(leagueId: string, roundNumber: number, sessionId?: string) {
    const qs = sessionId ? `?sessionId=${sessionId}` : '';
    // maybeSingle() on the server, so a round with no order row yields null.
    return apiClient.get<DraftOrder | null>(`/api/draft/league/${leagueId}/order/${roundNumber}${qs}`);
  },

  /** Hard delete all draft data for a league (commissioner only) */
  hardDeleteDraft(leagueId: string) {
    return apiClient.delete<SuccessResponse>(`/api/draft/league/${leagueId}`);
  },

  /** Get full draft state (league, picks, order) */
  getDraftState(leagueId: string) {
    return apiClient.get<DraftStateResponse>(`/api/draft/league/${leagueId}`);
  },

  /** Make a draft pick */
  makePick(leagueId: string, params: {
    playerId: string;
    teamId: string | number;
    pickNumber?: number;
    roundNumber?: number;
    draftSessionId?: string;
    teamsCount?: number;
  }) {
    return apiClient.post<MakePickResponse>(`/api/draft/league/${leagueId}/pick`, params);
  },

  /** Start the draft (commissioner only) */
  startDraft(leagueId: string) {
    return apiClient.post<Record<string, unknown>>(`/api/draft/league/${leagueId}/start`);
  },

  /** Initialize draft order (commissioner only) */
  initializeOrder(leagueId: string, params: {
    teams: unknown[];
    totalRounds: number;
    customTeamOrder?: unknown;
    draftType?: string;
  }) {
    return apiClient.post<SessionResponse>(`/api/draft/league/${leagueId}/initialize-order`, params);
  },

  /** Reset draft (commissioner only) */
  resetDraft(leagueId: string) {
    return apiClient.post<ResetResponse>(`/api/draft/league/${leagueId}/reset`);
  },

  /** Undo last pick (commissioner only) */
  undoLastPick(leagueId: string) {
    return apiClient.post<UndoResponse>(`/api/draft/league/${leagueId}/undo`);
  },

  /** Autopick for a team */
  autopick(leagueId: string, params: {
    teamId: string | number;
    sessionId?: string;
    roundNumber?: number;
    pickNumber?: number;
  }) {
    return apiClient.post<AutopickResponse>(`/api/draft/league/${leagueId}/autopick`, params);
  },

  /** Run full autopick draft (commissioner only) */
  fullAutopick(leagueId: string) {
    return apiClient.post<FullAutopickResponse>(`/api/draft/league/${leagueId}/full-autopick`);
  },

  /** Get draft snapshot */
  getSnapshot(leagueId: string) {
    // maybeSingle() on the server; the payload is the caller's own
    // DraftSnapshotData round-tripped through jsonb, so it is not narrowed here.
    return apiClient.get<Record<string, unknown> | null>(`/api/draft/league/${leagueId}/snapshot`);
  },

  /** Save draft snapshot */
  saveSnapshot(leagueId: string, params: {
    draftSessionId: string;
    snapshotData: unknown;
  }) {
    return apiClient.post<SaveSnapshotResponse>(`/api/draft/league/${leagueId}/snapshot`, params);
  },

  /** Get autopick rankings */
  getRankings(leagueId: string, teamId?: string) {
    const qs = teamId ? `?teamId=${teamId}` : '';
    return apiClient.get<AutopickRanking[]>(`/api/draft/league/${leagueId}/rankings${qs}`);
  },

  /** Save autopick rankings */
  saveRankings(leagueId: string, params: {
    teamId: string | number;
    rankings: unknown;
  }) {
    return apiClient.post<SuccessResponse>(`/api/draft/league/${leagueId}/rankings`, params);
  },

  /** Delete ALL draft data across all leagues (admin only) */
  deleteAllDraftData() {
    return apiClient.delete<{ deletedCounts: { picks: number; orders: number; leagues: number } }>(
      '/api/draft/all',
    );
  },
};
