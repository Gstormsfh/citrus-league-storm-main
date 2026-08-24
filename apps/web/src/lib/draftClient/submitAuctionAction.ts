// Auction action senders (2026-08-24 launch build).
//
// POSTs to the draft-v2 auction routes (server/src/routes/
// draftV2Auction.ts). Same transport/idempotency pattern as
// `submitPick.ts`: UUID idempotency key per attempt, apiClient's
// transient-retry machinery underneath, typed error mapping for the
// room UI. Confirmation arrives over the engine WebSocket as an
// `auction_nomination_started` / `auction_bid_placed` event — the
// HTTP response resolving OK means the action is durable.

import { logger } from '@/utils/logger';

export interface AuctionActionOk {
  ok: true;
  seq: number;
  wasDuplicate: boolean;
  nominationId?: string;
  clockDeadline?: string;
}

export interface AuctionActionErr {
  ok: false;
  /** Machine-ish reason parsed from the server error message. */
  reason:
    | 'not_on_clock'
    | 'player_taken'
    | 'bid_too_low'
    | 'bid_increment_violation'
    | 'insufficient_budget'
    | 'nomination_already_active'
    | 'nomination_not_active'
    | 'auction_paused'
    | 'unauthorized'
    | 'network_or_timeout'
    | 'unknown';
  /** Human-readable message for toasts (server text when available). */
  message: string;
}

export type AuctionActionResult = AuctionActionOk | AuctionActionErr;

function mapErrorMessage(raw: string): AuctionActionErr['reason'] {
  const msg = raw.toLowerCase();
  if (msg.includes('not_on_clock') || msg.includes('not your turn')) return 'not_on_clock';
  if (msg.includes('player_taken') || msg.includes('already been nominated')) return 'player_taken';
  if (msg.includes('bid_increment_violation') || msg.includes('tier minimum')) return 'bid_increment_violation';
  if (msg.includes('bid_too_low') || msg.includes('greater than current')) return 'bid_too_low';
  if (msg.includes('insufficient_budget') || msg.includes('max affordable')) return 'insufficient_budget';
  if (msg.includes('nomination already active')) return 'nomination_already_active';
  if (msg.includes('expected active') || msg.includes('not found in league')) return 'nomination_not_active';
  if (msg.includes('paused')) return 'auction_paused';
  if (msg.includes('unauthorized') || msg.includes('do not own')) return 'unauthorized';
  if (/timed?\s?out|network|abort|fetch|retry/.test(msg)) return 'network_or_timeout';
  return 'unknown';
}

async function post(
  path: string,
  body: Record<string, unknown>,
): Promise<AuctionActionResult> {
  const { apiClient } = await import('@/api/client');
  const idempotencyKey = crypto.randomUUID();
  try {
    const response = await apiClient.post<{
      seq?: number;
      nomination_id?: string;
      clock_deadline?: string;
      was_duplicate?: boolean;
    }>(path, body, {
      headers: { 'X-Idempotency-Key': idempotencyKey },
      timeoutMs: 8_000,
    });
    const data = (response.data ?? {}) as {
      seq?: number;
      nomination_id?: string;
      clock_deadline?: string;
      was_duplicate?: boolean;
    };
    return {
      ok: true,
      seq: Number(data.seq ?? 0),
      wasDuplicate: Boolean(data.was_duplicate),
      ...(data.nomination_id ? { nominationId: data.nomination_id } : {}),
      ...(data.clock_deadline ? { clockDeadline: data.clock_deadline } : {}),
    };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.error('[submitAuctionAction] request failed:', path, raw);
    return { ok: false, reason: mapErrorMessage(raw), message: raw };
  }
}

/** Nominate a player at an opening bid. */
export function submitNomination(input: {
  leagueId: string;
  teamId: string;
  playerId: string;
  playerName: string;
  openingBid: number;
}): Promise<AuctionActionResult> {
  return post(
    `/api/draft/v2/league/${encodeURIComponent(input.leagueId)}/nominate`,
    {
      team_id: input.teamId,
      player_id: input.playerId,
      player_name: input.playerName,
      opening_bid: input.openingBid,
    },
  );
}

/** Place a bid on the active nomination. */
export function submitBid(input: {
  leagueId: string;
  teamId: string;
  nominationId: string;
  bidAmount: number;
}): Promise<AuctionActionResult> {
  return post(
    `/api/draft/v2/league/${encodeURIComponent(input.leagueId)}/bid`,
    {
      team_id: input.teamId,
      nomination_id: input.nominationId,
      bid_amount: input.bidAmount,
    },
  );
}
