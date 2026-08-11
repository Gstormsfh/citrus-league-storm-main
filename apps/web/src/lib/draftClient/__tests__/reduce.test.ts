// Phase 4.5 chunk 11g.5a — pure state-machine transition tests.
//
// ~25 tests covering every state × event combination that produces
// a meaningful transition, plus regression tests for the
// noTransition path on irrelevant combinations.

import { describe, it, expect } from 'vitest';
import type {
  BufferedDraftEvent,
  DraftServerMessage,
  DraftSnapshot,
} from '@citrus/shared';
import { reduce } from '../reduce';
import type { DraftClientEvent, DraftClientState, SideEffect } from '../types';

// ── Test helpers ─────────────────────────────────────────────────────

/** Deterministic random — use no-jitter (0.5) by default in tests. */
const noJitter = () => 0.5;

const idleState: DraftClientState = { kind: 'idle' };

const fetchingTokenState = (attempt = 0): DraftClientState => ({
  kind: 'fetching_token',
  attempt,
});

const connectingState = (attempt = 0): DraftClientState => ({
  kind: 'connecting',
  wsUrl: 'ws://localhost:3002/ws/draft/draft-1',
  attempt,
});

const connectedState = (lastSeenSeq = 0): DraftClientState => ({
  kind: 'connected',
  wsUrl: 'ws://localhost:3002/ws/draft/draft-1',
  lastSeenSeq,
  sessionId: 'sess-1',
});

const resyncingState = (sinceSeq = 5): DraftClientState => ({
  kind: 'resyncing',
  wsUrl: 'ws://localhost:3002/ws/draft/draft-1',
  sinceSeq,
  sessionId: 'sess-1',
});

const reconnectingState = (attempt = 1): DraftClientState => ({
  kind: 'reconnecting',
  attempt,
  nextAttemptAt: Date.now() + 1000,
  lastError: null,
});

const snapshotRequiredState = (): DraftClientState => ({
  kind: 'snapshot_required',
  wsUrl: 'ws://localhost:3002/ws/draft/draft-1',
  sessionId: 'sess-1',
});

const fatalState = (): DraftClientState => ({
  kind: 'fatal',
  reason: 'auth_failure',
  errorMessage: 'session expired',
});

function makeServerEvent(seq: number, teamId = 'team-1'): DraftServerMessage {
  return {
    v: 1,
    type: 'event',
    seq,
    timestamp: '2026-05-05T12:00:00.000Z',
    correlationId: `idem-${seq}`,
    payload: {
      kind: 'pick_submitted',
      seq,
      timestamp: '2026-05-05T12:00:00.000Z',
      teamId,
      playerId: 8478000 + seq,
      roundNumber: 1,
      pickNumber: seq,
      correlationId: `idem-${seq}`,
    },
  };
}

function makeServerSnapshot(events: BufferedDraftEvent[] = []): DraftServerMessage {
  return {
    v: 1,
    type: 'snapshot',
    timestamp: '2026-05-05T12:00:00.000Z',
    payload: {
      lobbyId: 'lobby-1',
      format: 'snake',
      recentEvents: events,
      stateSnapshot: {
        currentPickNumber: events.length > 0 ? events.length + 1 : 1,
        currentRoundNumber: 1,
        onClockTeamId: 'team-1',
        totalPicks: 9,
        picksMade: events.length,
        draftStatus: 'in_progress',
        currentPickDeadline: '2026-05-05T12:01:31.000Z',
      },
    },
  };
}

function effectKinds(effects: ReadonlyArray<SideEffect>): string[] {
  return effects.map((e) => e.kind);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('reduce — connect_requested', () => {
  it('idle + connect_requested → fetching_token + fetch_token side effect', () => {
    const result = reduce(idleState, { type: 'connect_requested' }, noJitter);
    expect(result.state.kind).toBe('fetching_token');
    expect(effectKinds(result.sideEffects)).toEqual(['fetch_token']);
  });

  it('fatal + connect_requested → fetching_token (caller is retrying after fatal)', () => {
    const result = reduce(fatalState(), { type: 'connect_requested' }, noJitter);
    expect(result.state.kind).toBe('fetching_token');
    expect(effectKinds(result.sideEffects)).toEqual(['fetch_token']);
  });

  it('connected + connect_requested → no transition (already connected)', () => {
    const result = reduce(connectedState(), { type: 'connect_requested' }, noJitter);
    expect(result.state.kind).toBe('connected');
    expect(result.sideEffects).toEqual([]);
  });
});

describe('reduce — disconnect_requested', () => {
  it('connected + disconnect_requested → idle + close_websocket', () => {
    const result = reduce(connectedState(), { type: 'disconnect_requested' }, noJitter);
    expect(result.state.kind).toBe('idle');
    expect(effectKinds(result.sideEffects)).toEqual(['close_websocket']);
  });

  it('reconnecting + disconnect_requested → idle + cancel_backoff_timer', () => {
    const result = reduce(reconnectingState(), { type: 'disconnect_requested' }, noJitter);
    expect(result.state.kind).toBe('idle');
    expect(effectKinds(result.sideEffects)).toEqual(['cancel_backoff_timer']);
  });

  it('idle + disconnect_requested → idle (no effects, already disconnected)', () => {
    const result = reduce(idleState, { type: 'disconnect_requested' }, noJitter);
    expect(result.state.kind).toBe('idle');
    expect(result.sideEffects).toEqual([]);
  });
});

describe('reduce — token_fetched', () => {
  it('fetching_token + token_fetched → connecting + open_websocket', () => {
    const result = reduce(
      fetchingTokenState(),
      { type: 'token_fetched', token: 'jwt-abc', wsUrl: 'ws://localhost:3002/ws/draft/draft-1' },
      noJitter,
    );
    expect(result.state.kind).toBe('connecting');
    expect(effectKinds(result.sideEffects)).toEqual(['open_websocket']);
    if (result.sideEffects[0].kind === 'open_websocket') {
      expect(result.sideEffects[0].subprotocol).toBe('jwt-abc');
    }
  });

  it('idle + token_fetched → no transition (stale event)', () => {
    const result = reduce(
      idleState,
      { type: 'token_fetched', token: 'jwt-abc', wsUrl: 'ws://x' },
      noJitter,
    );
    expect(result.state.kind).toBe('idle');
    expect(result.sideEffects).toEqual([]);
  });
});

describe('reduce — token_fetch_failed', () => {
  it('fetching_token + 401 → fatal (auth_failure)', () => {
    const result = reduce(
      fetchingTokenState(),
      { type: 'token_fetch_failed', error: 'unauthorized', statusCode: 401 },
      noJitter,
    );
    expect(result.state.kind).toBe('fatal');
    if (result.state.kind === 'fatal') {
      expect(result.state.reason).toBe('auth_failure');
    }
    expect(result.sideEffects).toEqual([]);
  });

  it('fetching_token + 403 → fatal (auth_failure)', () => {
    const result = reduce(
      fetchingTokenState(),
      { type: 'token_fetch_failed', error: 'forbidden', statusCode: 403 },
      noJitter,
    );
    expect(result.state.kind).toBe('fatal');
  });

  it('fetching_token + 500 → reconnecting (transient, schedules backoff)', () => {
    const result = reduce(
      fetchingTokenState(),
      { type: 'token_fetch_failed', error: 'server error', statusCode: 500 },
      noJitter,
    );
    expect(result.state.kind).toBe('reconnecting');
    expect(effectKinds(result.sideEffects)).toEqual(['schedule_backoff_timer']);
  });
});

describe('reduce — ws_opened', () => {
  it('connecting + ws_opened → connected with sessionId, lastSeenSeq=0', () => {
    const result = reduce(
      connectingState(),
      { type: 'ws_opened', sessionId: 'sess-new' },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    if (result.state.kind === 'connected') {
      expect(result.state.sessionId).toBe('sess-new');
      expect(result.state.lastSeenSeq).toBe(0);
    }
    expect(result.sideEffects).toEqual([]);
  });
});

describe('reduce — ws_message (event)', () => {
  it('connected + event message → connected with advanced lastSeenSeq + deliver_event', () => {
    const result = reduce(
      connectedState(0),
      { type: 'ws_message', message: makeServerEvent(5) },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    if (result.state.kind === 'connected') {
      expect(result.state.lastSeenSeq).toBe(5);
    }
    expect(effectKinds(result.sideEffects)).toEqual(['deliver_event']);
  });

  it('connected + lower-seq event → lastSeenSeq stays at max (replay safety)', () => {
    const result = reduce(
      connectedState(10),
      { type: 'ws_message', message: makeServerEvent(5) },
      noJitter,
    );
    if (result.state.kind === 'connected') {
      expect(result.state.lastSeenSeq).toBe(10);
    }
  });

  it('resyncing + event message → state stays resyncing + deliver_event', () => {
    const result = reduce(
      resyncingState(),
      { type: 'ws_message', message: makeServerEvent(7) },
      noJitter,
    );
    expect(result.state.kind).toBe('resyncing');
    expect(effectKinds(result.sideEffects)).toEqual(['deliver_event']);
  });
});

describe('reduce — ws_message (snapshot)', () => {
  it('connected + snapshot → deliver_snapshot + lastSeenSeq from snapshot events', () => {
    const events: BufferedDraftEvent[] = [
      {
        kind: 'pick_submitted',
        seq: 1,
        timestamp: 'x',
        teamId: 'team-1',
        playerId: 8000,
        roundNumber: 1,
        pickNumber: 1,
        correlationId: 'idem-1',
      },
      {
        kind: 'pick_submitted',
        seq: 7,
        timestamp: 'x',
        teamId: 'team-2',
        playerId: 8001,
        roundNumber: 1,
        pickNumber: 7,
        correlationId: 'idem-7',
      },
    ];
    const result = reduce(
      connectedState(0),
      { type: 'ws_message', message: makeServerSnapshot(events) },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    if (result.state.kind === 'connected') {
      expect(result.state.lastSeenSeq).toBe(7);
    }
    expect(effectKinds(result.sideEffects)).toEqual(['deliver_snapshot']);
  });
});

describe('reduce — ws_message (presence)', () => {
  it('connected + presence message → deliver_presence', () => {
    const presenceMsg: DraftServerMessage = {
      v: 1,
      type: 'presence',
      timestamp: 'x',
      payload: { kind: 'joined', userId: 'user-1', presentUserIds: ['user-1'] },
    };
    const result = reduce(
      connectedState(),
      { type: 'ws_message', message: presenceMsg },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    expect(effectKinds(result.sideEffects)).toEqual(['deliver_presence']);
  });
});

describe('reduce — ws_message (resync_response)', () => {
  it('resyncing + resync_response (ok) → connected + deliver_events', () => {
    const events: BufferedDraftEvent[] = [
      {
        kind: 'pick_submitted',
        seq: 6,
        timestamp: 'x',
        teamId: 'team-1',
        playerId: 8000,
        roundNumber: 1,
        pickNumber: 6,
        correlationId: 'idem-6',
      },
    ];
    const resyncMsg: DraftServerMessage = {
      v: 1,
      type: 'resync_response',
      timestamp: 'x',
      payload: { ok: true, events },
    };
    const result = reduce(
      resyncingState(5),
      { type: 'ws_message', message: resyncMsg },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    if (result.state.kind === 'connected') {
      expect(result.state.lastSeenSeq).toBe(6);
    }
    expect(effectKinds(result.sideEffects)).toEqual(['deliver_events']);
  });

  it('resyncing + resync_response (too_old) → snapshot_required + fetch_snapshot', () => {
    const tooOldMsg: DraftServerMessage = {
      v: 1,
      type: 'resync_response',
      timestamp: 'x',
      payload: { ok: false, reason: 'too_old', oldestAvailableSeq: 100 },
    };
    const result = reduce(
      resyncingState(5),
      { type: 'ws_message', message: tooOldMsg },
      noJitter,
    );
    expect(result.state.kind).toBe('snapshot_required');
    expect(effectKinds(result.sideEffects)).toEqual(['fetch_snapshot']);
  });
});

describe('reduce — ws_message (error)', () => {
  it('connected + error message → deliver_error, state unchanged', () => {
    const errorMsg: DraftServerMessage = {
      v: 1,
      type: 'error',
      timestamp: 'x',
      payload: { code: 'lobby_not_ready', message: 'Lobby not registered' },
    };
    const result = reduce(
      connectedState(),
      { type: 'ws_message', message: errorMsg },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    expect(effectKinds(result.sideEffects)).toEqual(['deliver_error']);
  });
});

describe('reduce — ws_closed', () => {
  it('connected + 1006 (network drop) → reconnecting + schedule_backoff_timer', () => {
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 1006, reason: 'abnormal' },
      noJitter,
    );
    expect(result.state.kind).toBe('reconnecting');
    expect(effectKinds(result.sideEffects)).toEqual(['schedule_backoff_timer']);
  });

  it('connected + 4001 (auth) → fatal (auth_failure)', () => {
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 4001, reason: 'token_expired' },
      noJitter,
    );
    expect(result.state.kind).toBe('fatal');
    if (result.state.kind === 'fatal') {
      expect(result.state.reason).toBe('auth_failure');
    }
  });

  it('connected + 4010 (client-watchdog stale) → reconnecting with staleTriggered=true (chunk 11g.10)', () => {
    // The client-side liveness watchdog self-closes with 4010 when it
    // detects N consecutive missed application-level pongs. Reduce
    // MUST route through the transient reconnecting path AND flag
    // `staleTriggered` so the banner renders distinct copy. Regression
    // lock on the flag propagation.
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 4010, reason: 'client_watchdog_stale' },
      noJitter,
    );
    expect(result.state.kind).toBe('reconnecting');
    if (result.state.kind === 'reconnecting') {
      expect(result.state.staleTriggered).toBe(true);
    }
    expect(effectKinds(result.sideEffects)).toEqual(['schedule_backoff_timer']);
  });

  it('connected + 1006 does NOT set staleTriggered — only 4010 does', () => {
    // Negative case: ordinary network drop must not flag the state as
    // stale-triggered. Only the client-watchdog code triggers the
    // distinct-banner branch.
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 1006, reason: 'abnormal' },
      noJitter,
    );
    expect(result.state.kind).toBe('reconnecting');
    if (result.state.kind === 'reconnecting') {
      expect(result.state.staleTriggered).toBeUndefined();
    }
  });

  it('connected + 4100 (lobby gone) → fatal (invalid_lobby)', () => {
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 4100, reason: 'lobby_not_found' },
      noJitter,
    );
    if (result.state.kind === 'fatal') {
      expect(result.state.reason).toBe('invalid_lobby');
    }
  });

  it('connected + 4200 (server) → fatal (permanent_server_error)', () => {
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 4200, reason: 'server_rejection' },
      noJitter,
    );
    if (result.state.kind === 'fatal') {
      expect(result.state.reason).toBe('permanent_server_error');
    }
  });

  it('connected + 4300 (gate (a) bad shape) → fatal (auth_failure)', () => {
    // Chunk 11g.10 sub-step 10c-2 gate (a). Non-UUIDv4 sub can only
    // be fixed by re-authenticating (fresh token from discovery), so
    // 4300 shares the auth_failure disposition despite living in
    // the 4200-4999 range numerically. Regression lock on the
    // closeCodes.ts carve-out ordering.
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 4300, reason: 'unauthorized_bad_shape' },
      noJitter,
    );
    expect(result.state.kind).toBe('fatal');
    if (result.state.kind === 'fatal') {
      expect(result.state.reason).toBe('auth_failure');
    }
    expect(effectKinds(result.sideEffects)).toEqual([]);
  });

  it('connected + 4400 (gate (b) not initialized) → fatal (draft_not_initialized)', () => {
    // Chunk 11g.10 sub-step 10c-2 gate (b). Distinct disposition
    // and reason — the banner reads "This draft hasn't been set up
    // yet" and NO auto-reconnect fires (empty sideEffects). Manual
    // RETRY NOW affordance is the client-side re-entry path.
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 4400, reason: 'draft_not_initialized' },
      noJitter,
    );
    expect(result.state.kind).toBe('fatal');
    if (result.state.kind === 'fatal') {
      expect(result.state.reason).toBe('draft_not_initialized');
    }
    // Critical: no schedule_backoff_timer effect. A not-configured
    // league must never get the retry hammer per the architect's
    // requirement (i).
    expect(effectKinds(result.sideEffects)).toEqual([]);
  });

  it('connected + 1000 (normal closure) → idle (no retry)', () => {
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 1000, reason: 'normal' },
      noJitter,
    );
    expect(result.state.kind).toBe('idle');
  });
});

describe('reduce — backoff_timer_fired', () => {
  it('reconnecting + backoff_timer_fired → fetching_token + fetch_token', () => {
    const result = reduce(
      reconnectingState(2),
      { type: 'backoff_timer_fired' },
      noJitter,
    );
    expect(result.state.kind).toBe('fetching_token');
    if (result.state.kind === 'fetching_token') {
      expect(result.state.attempt).toBe(2);
    }
    expect(effectKinds(result.sideEffects)).toEqual(['fetch_token']);
  });

  it('connected + backoff_timer_fired → no transition (stale timer)', () => {
    const result = reduce(connectedState(), { type: 'backoff_timer_fired' }, noJitter);
    expect(result.state.kind).toBe('connected');
    expect(result.sideEffects).toEqual([]);
  });
});

describe('reduce — snapshot_fetched / snapshot_fetch_failed', () => {
  it('snapshot_required + snapshot_fetched → connected + deliver_snapshot', () => {
    const snapshot: DraftSnapshot = {
      lobbyId: 'lobby-1',
      format: 'snake',
      recentEvents: [
        {
          kind: 'pick_submitted',
          seq: 12,
          timestamp: 'x',
          teamId: 'team-1',
          playerId: 8000,
          roundNumber: 1,
          pickNumber: 12,
          correlationId: 'idem-12',
        },
      ],
      stateSnapshot: {
        currentPickNumber: 13,
        currentRoundNumber: 2,
        onClockTeamId: 'team-2',
        totalPicks: 100,
        picksMade: 12,
        draftStatus: 'in_progress',
        currentPickDeadline: null,
      },
    };
    const result = reduce(
      snapshotRequiredState(),
      { type: 'snapshot_fetched', snapshot },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    if (result.state.kind === 'connected') {
      expect(result.state.lastSeenSeq).toBe(12);
    }
    expect(effectKinds(result.sideEffects)).toEqual(['deliver_snapshot']);
  });

  it('snapshot_required + snapshot_fetch_failed → reconnecting (back off + retry)', () => {
    const result = reduce(
      snapshotRequiredState(),
      { type: 'snapshot_fetch_failed', error: 'not_implemented' },
      noJitter,
    );
    expect(result.state.kind).toBe('reconnecting');
    expect(effectKinds(result.sideEffects)).toEqual(['schedule_backoff_timer']);
  });
});

describe('reduce — network_changed', () => {
  it('reconnecting + network online → fetching_token + fetch_token + cancel_backoff_timer', () => {
    const result = reduce(
      reconnectingState(),
      { type: 'network_changed', isOnline: true },
      noJitter,
    );
    expect(result.state.kind).toBe('fetching_token');
    expect(effectKinds(result.sideEffects)).toEqual(['cancel_backoff_timer', 'fetch_token']);
  });

  it('reconnecting + network offline → reconnecting with extended delay', () => {
    const result = reduce(
      reconnectingState(2),
      { type: 'network_changed', isOnline: false },
      noJitter,
    );
    expect(result.state.kind).toBe('reconnecting');
    if (result.state.kind === 'reconnecting') {
      expect(result.state.lastError).toBe('network_offline');
    }
    expect(effectKinds(result.sideEffects)).toEqual([
      'cancel_backoff_timer',
      'schedule_backoff_timer',
    ]);
  });

  it('connected + network_changed → no transition (let WS detect via close)', () => {
    const result = reduce(
      connectedState(),
      { type: 'network_changed', isOnline: false },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    expect(result.sideEffects).toEqual([]);
  });
});

describe('reduce — visibility_changed', () => {
  it('connected + visibility hidden → no transition (5a no-op)', () => {
    const result = reduce(
      connectedState(),
      { type: 'visibility_changed', isVisible: false },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    expect(result.sideEffects).toEqual([]);
  });

  it('connected + visibility visible → no transition (5a no-op)', () => {
    const result = reduce(
      connectedState(),
      { type: 'visibility_changed', isVisible: true },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    expect(result.sideEffects).toEqual([]);
  });
});

describe('reduce — ws_error', () => {
  it('reconnecting + ws_error → state preserved with lastError updated', () => {
    const result = reduce(
      reconnectingState(),
      { type: 'ws_error', error: 'tcp_reset' },
      noJitter,
    );
    expect(result.state.kind).toBe('reconnecting');
    if (result.state.kind === 'reconnecting') {
      expect(result.state.lastError).toBe('tcp_reset');
    }
    expect(result.sideEffects).toEqual([]);
  });

  it('connected + ws_error → no transition (close handles reconnect)', () => {
    const result = reduce(
      connectedState(),
      { type: 'ws_error', error: 'tcp_reset' },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    expect(result.sideEffects).toEqual([]);
  });
});

describe('reduce — multi-step reconnect cycle', () => {
  it('connected → ws_closed (1006) → reconnecting → backoff_timer_fired → fetching_token → token_fetched → connecting → ws_opened → connected', () => {
    let state: DraftClientState = connectedState();

    let r = reduce(state, { type: 'ws_closed', code: 1006, reason: 'drop' }, noJitter);
    state = r.state;
    expect(state.kind).toBe('reconnecting');

    r = reduce(state, { type: 'backoff_timer_fired' }, noJitter);
    state = r.state;
    expect(state.kind).toBe('fetching_token');

    r = reduce(
      state,
      { type: 'token_fetched', token: 'jwt-fresh', wsUrl: 'ws://localhost:3002/ws/draft/draft-1' },
      noJitter,
    );
    state = r.state;
    expect(state.kind).toBe('connecting');

    r = reduce(state, { type: 'ws_opened', sessionId: 'sess-2' }, noJitter);
    state = r.state;
    expect(state.kind).toBe('connected');
  });
});

// ── Entry 87 Fix A (COMPLETED-ROOM-1, 2026-08-10) ───────────────────
//
// Truth-table verification per architect ratification (Entries 89 + 90):
//   1. discovery-409-terminal → terminal_completed + snapshot effect + NO backoff
//   2. ws_closed + lastKnownTerminalStatus → terminal_completed (regression
//      pin for Garrett's Run 3 sighting: post-completion engine eviction
//      → ws_closed → previously scheduled backoff → discovery-409-loop)
//   3. terminal_completed: backoff_timer_fired / visibility_changed /
//      network_changed → no-ops (draft is done; nothing to reconnect to)
//   4. terminal_completed: connect_requested → single re-discovery
//      (harmless re-entry; discovery will 409 again into this state)
//   5. 401/403 discovery failures unchanged (route through fatal
//      auth_failure, NOT the new terminal_completed state)
//   6. ws_closed in terminal_completed → no-op (no double transition)

describe('reduce — Entry 87 Fix A (COMPLETED-ROOM-1)', () => {
  const terminalCompletedState = (
    draftStatus: 'completed' | 'cancelled' = 'completed',
  ): DraftClientState => ({
    kind: 'terminal_completed',
    draftStatus,
  });

  it('fetching_token + discovery_refused_terminal(completed) → terminal_completed + snapshot fetch, no backoff', () => {
    const result = reduce(
      fetchingTokenState(),
      { type: 'discovery_refused_terminal', draftStatus: 'completed' },
      noJitter,
    );
    expect(result.state.kind).toBe('terminal_completed');
    if (result.state.kind === 'terminal_completed') {
      expect(result.state.draftStatus).toBe('completed');
    }
    // Truth-table item 4: fetch_snapshot is the ONLY effect (no
    // schedule_backoff_timer, no fetch_token, no close_websocket).
    expect(effectKinds(result.sideEffects)).toEqual(['fetch_snapshot']);
  });

  it('fetching_token + discovery_refused_terminal(cancelled) → terminal_completed with cancelled status', () => {
    const result = reduce(
      fetchingTokenState(),
      { type: 'discovery_refused_terminal', draftStatus: 'cancelled' },
      noJitter,
    );
    expect(result.state.kind).toBe('terminal_completed');
    if (result.state.kind === 'terminal_completed') {
      expect(result.state.draftStatus).toBe('cancelled');
    }
    expect(effectKinds(result.sideEffects)).toEqual(['fetch_snapshot']);
  });

  it('connected + ws_closed with lastKnownTerminalStatus → terminal_completed (Garrett Run 3 pin)', () => {
    // The exact bug on Run 3: engine evicts the completed lobby, ws
    // closes with code 1006 (abnormal), and pre-fix reduce
    // classified it as transient → scheduled backoff → discovery
    // returned 409 → repeat forever. The runner now annotates the
    // close with lastKnownTerminalStatus (set when it observed the
    // draft_completed frame), and reduce routes to terminal.
    const result = reduce(
      connectedState(35),
      {
        type: 'ws_closed',
        code: 1006,
        reason: 'lobby_evicted',
        lastKnownTerminalStatus: 'completed',
      },
      noJitter,
    );
    expect(result.state.kind).toBe('terminal_completed');
    if (result.state.kind === 'terminal_completed') {
      expect(result.state.draftStatus).toBe('completed');
    }
    // Same fetch_snapshot pattern — the room needs the frozen board.
    // No backoff.
    expect(effectKinds(result.sideEffects)).toEqual(['fetch_snapshot']);
  });

  it('connected + ws_closed WITHOUT lastKnownTerminalStatus → reconnecting (unchanged path)', () => {
    // Regression guard — a normal transient close on an in-progress
    // draft must still schedule backoff. The terminal routing only
    // activates when the annotation is present.
    const result = reduce(
      connectedState(),
      { type: 'ws_closed', code: 1006, reason: 'network_flap' },
      noJitter,
    );
    expect(result.state.kind).toBe('reconnecting');
    expect(effectKinds(result.sideEffects)).toEqual(['schedule_backoff_timer']);
  });

  it('terminal_completed + backoff_timer_fired → no-op', () => {
    // Truth-table item 3: defensive against a stray timer callback
    // that already fired before cancellation. Never re-enters
    // fetching_token from a terminal draft.
    const result = reduce(
      terminalCompletedState(),
      { type: 'backoff_timer_fired' },
      noJitter,
    );
    expect(result.state.kind).toBe('terminal_completed');
    expect(result.sideEffects).toEqual([]);
  });

  it('terminal_completed + visibility_changed → no-op', () => {
    const result = reduce(
      terminalCompletedState(),
      { type: 'visibility_changed', isVisible: true },
      noJitter,
    );
    expect(result.state.kind).toBe('terminal_completed');
    expect(result.sideEffects).toEqual([]);
  });

  it('terminal_completed + network_changed(online) → no-op', () => {
    const result = reduce(
      terminalCompletedState(),
      { type: 'network_changed', isOnline: true },
      noJitter,
    );
    expect(result.state.kind).toBe('terminal_completed');
    expect(result.sideEffects).toEqual([]);
  });

  it('terminal_completed + network_changed(offline) → no-op', () => {
    const result = reduce(
      terminalCompletedState(),
      { type: 'network_changed', isOnline: false },
      noJitter,
    );
    expect(result.state.kind).toBe('terminal_completed');
    expect(result.sideEffects).toEqual([]);
  });

  it('terminal_completed + ws_closed → no-op (already terminal)', () => {
    const result = reduce(
      terminalCompletedState(),
      { type: 'ws_closed', code: 1006, reason: 'anything' },
      noJitter,
    );
    expect(result.state.kind).toBe('terminal_completed');
    expect(result.sideEffects).toEqual([]);
  });

  it('terminal_completed + connect_requested → single re-discovery permitted', () => {
    // Explicit user retry — allowed. The discovery will 409 again
    // and reduce will route right back to terminal_completed
    // (harmless re-entry). Enables a manual "Try Again" affordance
    // without automated retries.
    const result = reduce(
      terminalCompletedState(),
      { type: 'connect_requested' },
      noJitter,
    );
    expect(result.state.kind).toBe('fetching_token');
    expect(effectKinds(result.sideEffects)).toEqual(['fetch_token']);
  });

  it('fetching_token + token_fetch_failed(401) → fatal auth_failure (UNCHANGED)', () => {
    // Regression guard — 401 must NOT route through the new
    // terminal_completed branch. The state machine's existing
    // auth_failure disposition still handles it.
    const result = reduce(
      fetchingTokenState(),
      { type: 'token_fetch_failed', error: 'unauthorized', statusCode: 401 },
      noJitter,
    );
    expect(result.state.kind).toBe('fatal');
    if (result.state.kind === 'fatal') {
      expect(result.state.reason).toBe('auth_failure');
    }
  });

  it('fetching_token + token_fetch_failed(403) → fatal auth_failure (UNCHANGED)', () => {
    const result = reduce(
      fetchingTokenState(),
      { type: 'token_fetch_failed', error: 'forbidden', statusCode: 403 },
      noJitter,
    );
    expect(result.state.kind).toBe('fatal');
    if (result.state.kind === 'fatal') {
      expect(result.state.reason).toBe('auth_failure');
    }
  });

  it('fetching_token + token_fetch_failed(500) → reconnecting (transient, UNCHANGED)', () => {
    const result = reduce(
      fetchingTokenState(),
      { type: 'token_fetch_failed', error: 'server error', statusCode: 500 },
      noJitter,
    );
    expect(result.state.kind).toBe('reconnecting');
    expect(effectKinds(result.sideEffects)).toEqual(['schedule_backoff_timer']);
  });
});

// ── Entry 99 COMPLETED-ROOM-2 (2026-08-11) ──────────────────────────
//
// Client-side companion to the server-route draftStatus decoration.
// LOAD-1-NIGHT witness draft: for a completed league, the engine
// serializer returned `stateSnapshot.draftStatus='in_progress'` even
// though the applied event stream includes draft_completed. Fix A's
// terminal-completed path fetches the snapshot on entry, but the
// pre-E99 reducer no-op'd on the arrival from anywhere except
// `snapshot_required` — so the delivered snapshot never reached the
// store and DraftRoomV2 sat on "Loading final board…" indefinitely.
//
// E99 (c): terminal_completed accepts snapshot_fetched. State stays
// terminal (no transition to connected — no live socket). Snapshot
// is delivered with stateSnapshot.draftStatus overridden to the
// runner's known terminal value, so the store's derived state
// trusts the routed terminality even when the payload's own status
// still lies. Belt to the server-side decoration in drafts.ts.

describe('reduce — Entry 99 COMPLETED-ROOM-2 (terminal_completed accepts snapshot_fetched)', () => {
  function mkSnapshotWithStatus(
    draftStatus: import('@citrus/shared').LobbyStatus,
  ): import('@citrus/shared').DraftSnapshot {
    return {
      lobbyId: 'lobby-terminal',
      format: 'snake',
      recentEvents: [],
      stateSnapshot: {
        currentPickNumber: null,
        currentRoundNumber: null,
        onClockTeamId: null,
        totalPicks: 12,
        picksMade: 12,
        draftStatus,
        currentPickDeadline: null,
      },
    };
  }

  it('terminal_completed + snapshot_fetched(in_progress payload) → stays terminal_completed + delivers snapshot with draftStatus overridden to "completed"', () => {
    // The exact E99 scenario: engine serializer lies (says in_progress),
    // client's runner already knows the draft is completed (routed
    // via discovery_refused_terminal). Client-side override forces
    // the delivered payload to match reality.
    const lyingPayload = mkSnapshotWithStatus('in_progress');
    const result = reduce(
      { kind: 'terminal_completed', draftStatus: 'completed' },
      { type: 'snapshot_fetched', snapshot: lyingPayload },
      noJitter,
    );
    // State unchanged — still terminal_completed. No transition to
    // 'connected' (there is no live socket for a completed draft).
    expect(result.state.kind).toBe('terminal_completed');
    if (result.state.kind === 'terminal_completed') {
      expect(result.state.draftStatus).toBe('completed');
    }
    // Exactly one deliver_snapshot side effect fires.
    expect(effectKinds(result.sideEffects)).toEqual(['deliver_snapshot']);
    // Delivered snapshot has draftStatus overridden to the runner's
    // known terminal value — the render layer trusts this and shows
    // the completion board.
    const delivered = result.sideEffects[0];
    if (delivered.kind === 'deliver_snapshot') {
      expect(delivered.snapshot.stateSnapshot.draftStatus).toBe('completed');
      // Rest of payload preserved (no other fields clobbered).
      expect(delivered.snapshot.stateSnapshot.picksMade).toBe(12);
      expect(delivered.snapshot.stateSnapshot.totalPicks).toBe(12);
      expect(delivered.snapshot.lobbyId).toBe('lobby-terminal');
    }
  });

  it('terminal_completed(cancelled) + snapshot_fetched → override to "cancelled"', () => {
    // Same override applies for the cancelled variant of terminal.
    const payload = mkSnapshotWithStatus('in_progress');
    const result = reduce(
      { kind: 'terminal_completed', draftStatus: 'cancelled' },
      { type: 'snapshot_fetched', snapshot: payload },
      noJitter,
    );
    expect(result.state.kind).toBe('terminal_completed');
    if (result.state.kind === 'terminal_completed') {
      expect(result.state.draftStatus).toBe('cancelled');
    }
    const delivered = result.sideEffects[0];
    if (delivered.kind === 'deliver_snapshot') {
      expect(delivered.snapshot.stateSnapshot.draftStatus).toBe('cancelled');
    }
  });

  it('snapshot_required + snapshot_fetched → connected (UNCHANGED pre-E99 path)', () => {
    // Regression guard: the resync-too-old → snapshot-fetch → connected
    // path (Fix A's original E87 shape) must not have changed. Only
    // terminal_completed gets the new branch; snapshot_required
    // continues to transition to `connected`.
    const payload = mkSnapshotWithStatus('in_progress');
    const result = reduce(
      snapshotRequiredState(),
      { type: 'snapshot_fetched', snapshot: payload },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    expect(effectKinds(result.sideEffects)).toEqual(['deliver_snapshot']);
    // Payload NOT patched here — the snapshot_required path preserves
    // the original stateSnapshot as-is (that path is for live drafts
    // catching up post-eviction; the runner has no terminal
    // knowledge to override with).
    const delivered = result.sideEffects[0];
    if (delivered.kind === 'deliver_snapshot') {
      expect(delivered.snapshot.stateSnapshot.draftStatus).toBe('in_progress');
    }
  });

  it('connected + snapshot_fetched → no-op (unchanged; unexpected arrival ignored)', () => {
    const payload = mkSnapshotWithStatus('in_progress');
    const result = reduce(
      connectedState(),
      { type: 'snapshot_fetched', snapshot: payload },
      noJitter,
    );
    expect(result.state.kind).toBe('connected');
    expect(result.sideEffects).toEqual([]);
  });
});
