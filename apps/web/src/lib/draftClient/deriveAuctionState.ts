// Auction client state derivation (2026-08-24 launch build).
//
// Mirrors the engine's auction state machine (LobbyManager auction
// appliers) the same way `deriveDraftState.ts` mirrors the pick state
// machine. Seeded from `DraftSnapshot.auctionState` (the engine's
// authoritative state at snapshot time — budgets survive ring-buffer
// eviction this way), then folded forward with live auction events.
//
// The seed watermark is the max seq across the snapshot's
// `recentEvents`: every auction event kind appends to the engine ring
// buffer, so the ring tail equals the engine's lastAppliedSeq for
// auction lobbies. Events at or below the watermark are already
// reflected in the seeded budgets/nomination and are skipped —
// re-folding them would double-deduct budgets.

import type { BufferedDraftEvent, DraftSnapshot } from '@citrus/shared';

export interface AuctionNominationView {
  nominationId: string;
  playerId: string;
  /** Empty string when the seed snapshot didn't carry a name (engine
   * snapshot omits it); the UI resolves names from its player pool. */
  playerName: string;
  nominatorTeamId: string;
  leadingBid: number;
  leadingBidderId: string;
  /** ISO wall-clock deadline of the bid window (anti-snipe moves it). */
  deadline: string;
  isAutoNominated: boolean;
}

export interface AuctionHistoryEntry {
  seq: number;
  kind: 'won' | 'no_sale' | 'skipped';
  nominationId: string | null;
  playerId: string | null;
  playerName: string | null;
  teamId: string | null;
  amount: number | null;
  reason?: string;
}

export interface TeamAuctionBudget {
  remaining: number;
  slotsRemaining: number;
}

export interface DerivedAuctionState {
  currentNomination: AuctionNominationView | null;
  /** teamId → budget + open roster slots. */
  budgets: Map<string, TeamAuctionBudget>;
  nominationsCompleted: number;
  paused: boolean;
  /** Newest first, capped at 50 entries for the feed. */
  history: AuctionHistoryEntry[];
  foldedThroughSeq: number;
  /** playerName lookup accumulated from nomination events (playerId → name). */
  playerNames: Map<string, string>;
  /**
   * playerIds sold at auction, observed via close events this session
   * (uncapped, unlike `history`). The nominate search filters on it;
   * the server's player_taken check remains the authority for players
   * won before this client connected.
   */
  wonPlayerIds: Set<string>;
}

const HISTORY_CAP = 50;

/**
 * Seed from a snapshot. Returns null when the lobby is not an auction
 * (no `auctionState`) — callers keep auction UI hidden.
 */
export function seedAuctionState(snapshot: DraftSnapshot): DerivedAuctionState | null {
  const aux = snapshot.auctionState;
  if (snapshot.format !== 'auction' || aux === undefined) {
    return null;
  }
  const budgets = new Map<string, TeamAuctionBudget>();
  for (const [teamId, remaining] of Object.entries(aux.teamBudgets ?? {})) {
    budgets.set(teamId, {
      remaining: Number(remaining),
      slotsRemaining: Number(aux.teamRosterSlotsRemaining?.[teamId] ?? 0),
    });
  }
  const seedSeq = snapshot.recentEvents.length
    ? snapshot.recentEvents[snapshot.recentEvents.length - 1].seq
    : 0;
  return {
    currentNomination: aux.currentNomination
      ? {
          nominationId: aux.currentNomination.nominationId,
          playerId: aux.currentNomination.playerId,
          playerName: '',
          nominatorTeamId: aux.currentNomination.nominatorTeamId,
          leadingBid: Number(aux.currentNomination.leadingBid),
          leadingBidderId: aux.currentNomination.leadingBidderId,
          deadline: aux.currentNomination.clockDeadline,
          isAutoNominated: false,
        }
      : null,
    budgets,
    nominationsCompleted: Number(aux.nominationsCompleted ?? 0),
    paused: false,
    history: [],
    foldedThroughSeq: seedSeq,
    playerNames: new Map(),
    wonPlayerIds: new Set(),
  };
}

/**
 * Fold auction events onto the derived state. Non-auction event kinds
 * are ignored (they advance nothing here — the pick fold owns them).
 * Events at or below `foldedThroughSeq` are skipped (idempotent).
 *
 * Unlike the pick fold, gaps do NOT halt the auction fold — the pick
 * fold + resync machinery already owns gap handling for the shared
 * stream; the auction fold is tolerant and self-corrects on the next
 * snapshot.
 */
export function foldAuctionEvents(
  state: DerivedAuctionState,
  events: ReadonlyArray<BufferedDraftEvent>,
): DerivedAuctionState {
  let next = state;
  let mutated = false;
  const ensure = (): DerivedAuctionState => {
    if (!mutated) {
      next = {
        ...state,
        budgets: new Map(state.budgets),
        history: [...state.history],
        playerNames: new Map(state.playerNames),
        wonPlayerIds: new Set(state.wonPlayerIds),
      };
      mutated = true;
    }
    return next;
  };

  const deductBudget = (s: DerivedAuctionState, teamId: string, amount: number) => {
    const prev = s.budgets.get(teamId) ?? { remaining: 0, slotsRemaining: 0 };
    s.budgets.set(teamId, {
      remaining: prev.remaining - amount,
      slotsRemaining: Math.max(0, prev.slotsRemaining - 1),
    });
  };

  const pushHistory = (s: DerivedAuctionState, entry: AuctionHistoryEntry) => {
    s.history.unshift(entry);
    if (s.history.length > HISTORY_CAP) s.history.length = HISTORY_CAP;
  };

  for (const event of events) {
    if (event.seq <= next.foldedThroughSeq) continue;

    switch (event.kind) {
      case 'auction_nomination_started':
      case 'auction_auto_nominated': {
        const s = ensure();
        s.playerNames.set(event.playerId, event.playerName);
        s.currentNomination = {
          nominationId: event.nominationId,
          playerId: event.playerId,
          playerName: event.playerName,
          nominatorTeamId: event.nominatorTeamId,
          leadingBid: event.openingBid,
          leadingBidderId: event.nominatorTeamId,
          deadline: event.clockDeadline,
          isAutoNominated: event.kind === 'auction_auto_nominated',
        };
        s.foldedThroughSeq = event.seq;
        break;
      }
      case 'auction_bid_placed': {
        const s = ensure();
        if (s.currentNomination && s.currentNomination.nominationId === event.nominationId) {
          s.currentNomination = {
            ...s.currentNomination,
            leadingBid: event.bidAmount,
            leadingBidderId: event.bidderTeamId,
          };
        }
        s.foldedThroughSeq = event.seq;
        break;
      }
      case 'auction_bid_extends_timer': {
        const s = ensure();
        if (s.currentNomination && s.currentNomination.nominationId === event.nominationId) {
          s.currentNomination = {
            ...s.currentNomination,
            deadline: event.newClockDeadline,
          };
        }
        s.foldedThroughSeq = event.seq;
        break;
      }
      case 'auction_nomination_closed': {
        const s = ensure();
        deductBudget(s, event.winnerTeamId, event.finalAmount);
        s.wonPlayerIds.add(event.playerId);
        pushHistory(s, {
          seq: event.seq,
          kind: 'won',
          nominationId: event.nominationId,
          playerId: event.playerId,
          playerName:
            s.playerNames.get(event.playerId) ??
            (s.currentNomination?.playerId === event.playerId
              ? s.currentNomination.playerName
              : null),
          teamId: event.winnerTeamId,
          amount: event.finalAmount,
        });
        s.currentNomination = null;
        s.nominationsCompleted += 1;
        s.foldedThroughSeq = event.seq;
        break;
      }
      case 'auction_nomination_expired': {
        const s = ensure();
        pushHistory(s, {
          seq: event.seq,
          kind: 'no_sale',
          nominationId: event.nominationId,
          playerId: s.currentNomination?.playerId ?? null,
          playerName: s.currentNomination?.playerName ?? null,
          teamId: s.currentNomination?.nominatorTeamId ?? null,
          amount: null,
          reason: event.reason,
        });
        s.currentNomination = null;
        s.nominationsCompleted += 1;
        s.foldedThroughSeq = event.seq;
        break;
      }
      case 'auction_nomination_skipped': {
        const s = ensure();
        pushHistory(s, {
          seq: event.seq,
          kind: 'skipped',
          nominationId: null,
          playerId: null,
          playerName: null,
          teamId: event.skippedTeamId,
          amount: null,
          reason: event.reason,
        });
        s.nominationsCompleted += 1;
        s.foldedThroughSeq = event.seq;
        break;
      }
      case 'auction_paused': {
        const s = ensure();
        s.paused = true;
        s.foldedThroughSeq = event.seq;
        break;
      }
      case 'auction_resumed': {
        const s = ensure();
        s.paused = false;
        if (
          s.currentNomination &&
          event.restoredNominationId === s.currentNomination.nominationId &&
          typeof event.newClockDeadline === 'string'
        ) {
          s.currentNomination = {
            ...s.currentNomination,
            deadline: event.newClockDeadline,
          };
        }
        s.foldedThroughSeq = event.seq;
        break;
      }
      case 'auction_commissioner_override': {
        // Overrides carry action-specific prior/new state snapshots.
        // The launch client applies the budget-affecting ones coarsely
        // and otherwise clears the nomination when the action ends it;
        // the next WS snapshot (reconnect/resync) fully reconciles.
        const s = ensure();
        if (
          event.overrideAction === 'force_close_nomination' ||
          event.overrideAction === 'award_to_team' ||
          event.overrideAction === 'cancel_nomination'
        ) {
          s.currentNomination = null;
          if (event.overrideAction !== 'cancel_nomination') {
            s.nominationsCompleted += 1;
          }
        }
        if (event.overrideAction === 'adjust_budget') {
          const teamId = String(
            (event.newState as { team_id?: unknown }).team_id ?? '',
          );
          const newRemaining = Number(
            (event.newState as { remaining_budget?: unknown }).remaining_budget,
          );
          if (teamId && Number.isFinite(newRemaining)) {
            const prev = s.budgets.get(teamId) ?? { remaining: 0, slotsRemaining: 0 };
            s.budgets.set(teamId, { ...prev, remaining: newRemaining });
          }
        }
        s.foldedThroughSeq = event.seq;
        break;
      }
      default: {
        // Non-auction kinds: advance the watermark WITHOUT mutating
        // auction state, so a later auction event doesn't re-process
        // anything and seq bookkeeping stays cheap. (No object clone
        // when nothing else changes and the watermark is the only
        // delta — clone anyway for immutability when needed.)
        const s = ensure();
        s.foldedThroughSeq = event.seq;
        break;
      }
    }
  }

  return next;
}
