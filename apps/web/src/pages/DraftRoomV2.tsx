// Phase 4.5 chunk 11g DR-3 (2026-07-29) — the visual room.
//
// The v2 page mounts the proven v1 draft components (DraftBoard,
// PlayerPool, DraftHistory, TeamRosters) on the v2 rail via thin
// adapter functions (lib/draftClient/v1Adapters.ts). Zero-touch to
// v1 component internals per architect ratification 1a.
//
// The pool's Draft button is the DR-2 submit path's trigger (same
// submitPick, same optimistic flow, zero plumbing changes). One
// submit surface, never two — the DR-2 minimal control was removed
// in the DR-3 first commit.
//
// DraftControls ships HIDDEN — v2 HTTP routes for /pause and /resume
// don't exist yet (only /undo does). Per architect ruling: wiring
// commissioner tools to nothing is worse than absence; the panel
// lands properly with the post-Zach policy chunk that ships the
// missing routes.
//
// Layout mirrors v1 (lifted CSS from DraftRoom.tsx:3631, :3972):
//   Sticky header: connection banner + timer + on-clock label
//   Main col (lg:3): Tabs { Players | Board | History }
//   Sidebar (lg:1): TeamRosters + DraftQueue (local-only) + [hidden Controls]
//
// Player index is pre-fetched non-blocking; the room renders
// immediately with `#<id>` fallbacks and hydrates as names resolve.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConnectionBanner } from '@/components/draft/v2/ConnectionBanner';
import {
  DraftTimerV2,
  useClockOffsetEstimator,
} from '@/components/draft/v2/DraftTimerV2';
import { OnClockActionBar } from '@/components/draft/v2/OnClockActionBar';
import { ManagerPresencePanel } from '@/components/draft/v2/ManagerPresencePanel';
import { DraftBoard } from '@/components/draft/DraftBoard';
import { PlayerPool } from '@/components/draft/PlayerPool';
import { DraftHistory } from '@/components/draft/DraftHistory';
import { TeamRosters } from '@/components/draft/TeamRosters';
import { DraftQueue } from '@/components/draft/DraftQueue';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { DraftClientRunner } from '@/lib/draftClient/runner';
import { fetchDraftOrderMatrix } from '@/lib/draftClient/fetchDraftOrderMatrix';
import { submitPick, isSubmitPickFailure } from '@/lib/draftClient/submitPick';
import {
  useDraftClientStore,
  useDraftConnectionState,
  useDraftSnapshot,
  useDerivedDraftState,
  useDraftLastFoldGaps,
  useDraftMatrix,
  useMyTeamId,
  usePendingActions,
} from '@/stores/draftClientStore';
import {
  notifyConnectionFatal,
  notifyPresenceJoined,
  notifyPresenceLeft,
} from '@/lib/draftClient/toasts';
import { usePreloadedPlayers } from '@/hooks/usePreloadedPlayers';
import { useOnClockAlarm } from '@/hooks/useOnClockAlarm';
import {
  toAvailablePlayers,
  toDraftHistory,
  toDraftedPlayerIds,
  toV1Teams,
  participatingTeamIdsFromMatrix,
  type FetchedTeam,
} from '@/lib/draftClient/v1Adapters';
import type { Player } from '@/services/PlayerService';

export default function DraftRoomV2() {
  const params = useParams<{ leagueId: string; draftId?: string }>();
  const leagueId = params.leagueId ?? '';
  const draftId = params.draftId ?? leagueId;

  const runnerRef = useRef<DraftClientRunner | null>(null);
  const store = useDraftClientStore();
  const { offsetMs: clockOffsetMs, updateOffset } = useClockOffsetEstimator();

  // DR-2 (2026-07-29) — fetch the caller's teamId. Non-fatal on
  // failure (spectator flow).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { apiClient } = await import('@/api/client');
        const path = `/api/leagues/${encodeURIComponent(leagueId)}/my-team`;
        const response = await apiClient.get<{ id?: string }>(path);
        if (cancelled) return;
        const payload = response.data ?? (response as unknown as { id?: string });
        const teamId =
          payload && typeof payload === 'object' && typeof payload.id === 'string'
            ? payload.id
            : null;
        useDraftClientStore.getState().setMyTeamId(teamId);
      } catch (err) {
        // Non-fatal; spectator flow. Reachable in dev via network tab.
        void err;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // DR-3 (2026-07-29) — fetch the league's teams once on mount.
  // Non-blocking: the room shell renders immediately; adapters
  // produce empty teams[] until this resolves and re-renders happen
  // via setTeams triggering re-derivation upstream.
  const [teams, setTeams] = useState<FetchedTeam[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { apiClient } = await import('@/api/client');
        const path = `/api/leagues/${encodeURIComponent(leagueId)}/teams`;
        const response = await apiClient.get<FetchedTeam[]>(path);
        if (cancelled) return;
        const payload = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response as unknown as FetchedTeam[])
          ? (response as unknown as FetchedTeam[])
          : [];
        setTeams(payload);
      } catch {
        // Non-fatal; adapters fall through to empty teams and each
        // roster entry renders with teamId prefix as the name.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // DR-3 (2026-07-29) — pre-fetch all players non-blocking.
  const { playersById, isLoading: playersLoading } = usePreloadedPlayers();

  // Mount / unmount: runner lifecycle (unchanged from DR-1b/DR-2).
  useEffect(() => {
    const runner = new DraftClientRunner();
    runnerRef.current = runner;

    const unsubscribe = runner.subscribe((state) => {
      store.setConnectionState(state);
      if (state.kind === 'fatal') {
        notifyConnectionFatal(state.reason, state.errorMessage);
      }
    });

    runner.connect(
      { leagueId, draftId },
      {
        onSnapshot: (snapshot) => {
          store.setSnapshot(snapshot);
          void fetchDraftOrderMatrix(
            leagueId,
            snapshot.stateSnapshot.totalPicks,
          ).then((matrix) => {
            store.setMatrix(matrix);
          });
        },
        onEvent: (event) => {
          const clientReceiveMs = Date.now();
          const serverMs = new Date(event.timestamp).getTime();
          if (Number.isFinite(serverMs)) updateOffset(clientReceiveMs, serverMs);
          store.applyEvent(event);
        },
        onEvents: (events) => {
          if (events.length > 0) {
            const last = events[events.length - 1];
            const serverMs = new Date(last.timestamp).getTime();
            if (Number.isFinite(serverMs)) updateOffset(Date.now(), serverMs);
          }
          store.applyEvents(events);
        },
        onPresence: (payload) => {
          // DR-4 (2026-07-30) — toast ONLY on a genuine ADD (for
          // 'joined') or genuine REMOVE (for 'left'). Two failure
          // modes this guards against:
          //   1. Self-join post-snapshot-seed: server broadcasts
          //      `joined` for the connecting user AFTER the snapshot
          //      already seeded self into presentUserIds → the set
          //      doesn't change → no "you joined" toast fires at
          //      the user for their own connect (was the DR-1
          //      anomaly's cosmetic tail).
          //   2. Duplicate co-manager attaches: the server's presence
          //      broadcast fires with the SAME set on every socket
          //      the user opens (multi-device / reconnect); we don't
          //      toast on every duplicate.
          const before = useDraftClientStore.getState().presentUserIds;
          store.applyPresence(payload);
          const after = useDraftClientStore.getState().presentUserIds;
          if (
            payload.kind === 'joined' &&
            !before.has(payload.userId) &&
            after.has(payload.userId)
          ) {
            notifyPresenceJoined(payload.userId);
          } else if (
            payload.kind === 'left' &&
            before.has(payload.userId) &&
            !after.has(payload.userId)
          ) {
            notifyPresenceLeft(payload.userId);
          }
        },
        onError: (error) => store.setError(error),
      },
    );

    return () => {
      unsubscribe();
      runner.disconnect();
      runnerRef.current = null;
      store.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, draftId]);

  // DR-1b F1 — matrix refetch on not_started → in_progress.
  const derivedForRefetch = useDerivedDraftState();
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const cur = derivedForRefetch?.draftStatus ?? null;
    const prev = prevStatusRef.current;
    prevStatusRef.current = cur;
    if (prev === 'not_started' && cur === 'in_progress') {
      const totalPicks = derivedForRefetch?.totalPicks ?? 0;
      void fetchDraftOrderMatrix(leagueId, totalPicks).then((matrix) => {
        useDraftClientStore.getState().setMatrix(matrix);
      });
    }
  }, [derivedForRefetch, leagueId]);

  // DR-1b F3 — gap-triggered resync.
  const lastFoldGaps = useDraftLastFoldGaps();
  const derivedForGap = useDerivedDraftState();
  useEffect(() => {
    if (lastFoldGaps.length === 0) return;
    if (derivedForGap === null) return;
    const runner = runnerRef.current;
    if (runner === null) return;
    runner.requestResyncForGap(derivedForGap.foldedThroughSeq);
  }, [lastFoldGaps, derivedForGap]);

  const handleRetryNow = useMemo(
    () => () => {
      const runner = runnerRef.current;
      if (runner === null) return;
      runner.disconnect();
      runner.connect({ leagueId, draftId });
    },
    [leagueId, draftId],
  );

  return (
    <div className="container mx-auto p-4" data-testid="draft-room-v2">
      <StickyHeader
        onRetryNow={handleRetryNow}
        clockOffsetMs={clockOffsetMs}
      />
      <DraftRoomBody
        leagueId={leagueId}
        teams={teams}
        playersById={playersById}
        playersLoading={playersLoading}
      />
    </div>
  );
}

// ── Sticky header ─────────────────────────────────────────────────
//
// Connection banner + timer + one-line pick/round/on-clock label.
// Kept small so per-event fold re-renders don't ripple past this
// section. Selector granularity per architect ratification 5.

interface StickyHeaderProps {
  onRetryNow: () => void;
  clockOffsetMs: number;
}

// DR-4 (2026-07-30) — honest status label. Pre-DR-4 the header showed
// "Status: not_started" while the DB draft_status was in_progress —
// confusing because the client-derived draftStatus only flips on the
// first pick fold. This helper maps derived status → plain-language
// copy that matches the user's expectation.
function describeStatus(
  derivedStatus: string,
  picksMade: number,
): string {
  if (derivedStatus === 'not_started' && picksMade === 0) {
    return 'active — waiting for pick 1';
  }
  if (derivedStatus === 'in_progress') return 'in progress';
  if (derivedStatus === 'completed') return 'completed';
  if (derivedStatus === 'paused') return 'paused';
  if (derivedStatus === 'cancelled') return 'cancelled';
  return derivedStatus;
}

function StickyHeader({ onRetryNow, clockOffsetMs }: StickyHeaderProps) {
  const connectionState = useDraftConnectionState();
  const snapshot = useDraftSnapshot();
  const derived = useDerivedDraftState();
  const wsOpen = connectionState.kind === 'connected';

  return (
    <div className="sticky top-0 z-30 bg-background border-b border-border pb-3 mb-4">
      <h1 className="text-xl font-bold mb-2">Draft Room</h1>
      <ConnectionBanner onRetryNow={onRetryNow} />
      {snapshot !== null && derived !== null && (
        <>
          <div className="mt-2">
            <DraftTimerV2
              currentPickDeadline={snapshot.stateSnapshot.currentPickDeadline}
              draftStatus={derived.draftStatus}
              wsOpen={wsOpen}
              clockOffsetMs={clockOffsetMs}
            />
          </div>
          <div
            className="mt-2 text-sm text-muted-foreground"
            data-testid="draft-header-label"
          >
            {derived.currentPickNumber !== null &&
            derived.currentRoundNumber !== null ? (
              <>
                Round {derived.currentRoundNumber} · Pick{' '}
                {derived.currentPickNumber} / {derived.totalPicks} ·{' '}
                Status: {describeStatus(derived.draftStatus, derived.picksMade)}
              </>
            ) : (
              <>
                {derived.picksMade} / {derived.totalPicks} picks made ·{' '}
                Status: {describeStatus(derived.draftStatus, derived.picksMade)}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main body ─────────────────────────────────────────────────────

interface DraftRoomBodyProps {
  leagueId: string;
  teams: FetchedTeam[];
  playersById: ReadonlyMap<string, Player>;
  playersLoading: boolean;
}

function DraftRoomBody({
  leagueId,
  teams,
  playersById,
  playersLoading,
}: DraftRoomBodyProps) {
  const snapshot = useDraftSnapshot();
  const derived = useDerivedDraftState();
  const myTeamId = useMyTeamId();

  if (snapshot === null || derived === null) {
    return (
      <div className="text-muted-foreground" data-testid="draft-loading">
        Waiting for draft state…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="lg:col-span-3 space-y-4">
        <MainTabs
          leagueId={leagueId}
          teams={teams}
          playersById={playersById}
          playersLoading={playersLoading}
          myTeamId={myTeamId}
        />
      </div>
      <div className="hidden lg:block space-y-4">
        <SidebarPanel
          leagueId={leagueId}
          teams={teams}
          playersById={playersById}
          myTeamId={myTeamId}
        />
      </div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────

interface MainTabsProps {
  leagueId: string;
  teams: FetchedTeam[];
  playersById: ReadonlyMap<string, Player>;
  playersLoading: boolean;
  myTeamId: string | null;
}

function MainTabs({
  leagueId,
  teams,
  playersById,
  playersLoading,
  myTeamId,
}: MainTabsProps) {
  const derived = useDerivedDraftState();
  const snapshot = useDraftSnapshot();
  const pendingActions = usePendingActions();
  const [tab, setTab] = useState<'players' | 'board' | 'history'>('players');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  // Is it my turn? (computed early — feeds alarm + on-clock action bar.)
  const amIOnClock =
    derived !== null &&
    myTeamId !== null &&
    derived.onClockTeamId !== null &&
    derived.onClockTeamId === myTeamId;

  // DR-4 (2026-07-30) — F11 fix (layer 1 GUARD): am I currently
  // submitting a pick? Threaded to PlayerPool + OnClockActionBar so
  // every Draft button disables + shows "Submitting…" while
  // in-flight. Prevents the double-submit that surfaces the
  // pick_out_of_order → clock-expired copy mismatch.
  const isSubmitPending = useMemo(() => {
    if (myTeamId === null) return false;
    for (const p of pendingActions.values()) {
      if (p.teamId === myTeamId && p.optimisticState === 'pending') {
        return true;
      }
    }
    return false;
  }, [pendingActions, myTeamId]);

  // DR-4 (2026-07-30) — alarm system: title flash + notification +
  // sound when on-clock AND tab is hidden. Mute toggle persists to
  // localStorage. See useOnClockAlarm for the honesty contract
  // (only when tab hidden; stops instantly on any exit).
  const alarm = useOnClockAlarm({ amIOnClock });

  // Adapt derived state → v1 prop shapes. Memoized against the exact
  // inputs so per-event folds only re-derive when derived changes.
  // DR-3.1 F9 fix: filter teams to only those in the draft-order
  // matrix; v1's TeamRosters + DraftBoard derive pick-in-round + grid
  // columns from teams.length, so a league holding non-participating
  // members (like a spectator team) would corrupt every pick label
  // from round 2 onward without this filter.
  const matrix = useDraftMatrix();
  const participatingTeamIds = useMemo(
    () => participatingTeamIdsFromMatrix(matrix ?? null),
    [matrix],
  );
  const v1Teams = useMemo(
    () => (derived ? toV1Teams(teams, derived, playersById, participatingTeamIds) : []),
    [teams, derived, playersById, participatingTeamIds],
  );
  const draftHistory = useMemo(
    () => (derived ? toDraftHistory(teams, derived, playersById) : []),
    [teams, derived, playersById],
  );
  const draftedIds = useMemo(
    () => (derived ? toDraftedPlayerIds(derived) : []),
    [derived],
  );
  const availablePlayers = useMemo(
    () => (derived ? toAvailablePlayers(playersById, derived) : []),
    [playersById, derived],
  );

  // amIOnClock is computed once at the top of MainTabs (feeds alarm +
  // action bar + pool + handleDraftFromPool).

  // Pool's Draft button → DR-2 submit path. Same submitPick, same
  // optimistic flow. Fires only when it's the user's turn AND we know
  // the current pick number / round from derived.
  const handleDraftFromPool = useCallback(
    async (player: Player) => {
      if (
        !amIOnClock ||
        myTeamId === null ||
        derived === null ||
        derived.currentPickNumber === null ||
        derived.currentRoundNumber === null
      ) {
        toast.error("It's not your turn");
        return;
      }
      // DR-4 (2026-07-30) — F11 fix (layer 1 GUARD, defense-in-depth):
      // if we already have a pending pick in-flight for this team,
      // silently no-op. The button should already be disabled at the
      // render level (isSubmitPending prop), but this catches any
      // race — very-fast double-click before React re-renders the
      // disabled state, or a stale click event queued behind a
      // slow re-render.
      const currentPending = [...pendingActions.values()].find(
        (p) => p.teamId === myTeamId && p.optimisticState === 'pending',
      );
      if (currentPending) {
        return;
      }
      const playerIdNum = parseInt(player.id, 10);
      if (!Number.isFinite(playerIdNum) || playerIdNum <= 0) {
        toast.error('Invalid player');
        return;
      }
      const attemptId = crypto.randomUUID();
      const submittedAt = Date.now();
      // Capture the currentPickNumber we're submitting for; feeds the
      // F11 layer 2 disambiguate check on the pick_out_of_order path.
      const submittingForPickNumber = derived.currentPickNumber;
      useDraftClientStore.getState().recordPending({
        correlationId: attemptId,
        teamId: myTeamId,
        playerId: playerIdNum,
        submittedAt,
      });
      // Dangle-safety timer (DR-2 architect amendment) — see
      // submitPick.ts and the removed SubmitPickControl.
      const dangleTimer = setTimeout(() => {
        const current = useDraftClientStore
          .getState()
          .pendingActions.get(attemptId);
        if (current !== undefined && current.optimisticState === 'pending') {
          useDraftClientStore
            .getState()
            .rollBackPending(
              attemptId,
              "We couldn't confirm your pick — check the board",
            );
          toast.error("We couldn't confirm your pick — check the board");
        }
      }, 8000);
      try {
        const result = await submitPick({
          leagueId,
          teamId: myTeamId,
          playerId: playerIdNum,
          roundNumber: derived.currentRoundNumber,
          pickNumber: derived.currentPickNumber,
          attemptId,
        });
        if (isSubmitPickFailure(result)) {
          useDraftClientStore
            .getState()
            .rollBackPending(attemptId, result.message);
          // DR-4 (2026-07-30) — F11 fix (layer 2 DISAMBIGUATE):
          // pick_out_of_order translates to reason='clock_expired'
          // per submitPick.ts:129-133 (architect DR-2 mapping). BUT:
          // it also fires on a DOUBLE-SUBMIT — the second submit
          // hits the server AFTER the first one landed, and the
          // server correctly rejects the stale pick_number. Copy
          // must not lie: check whether the SAME pickNumber we
          // just tried to submit for is now present in our own
          // team's roster. If YES → it was a double-submit
          // (the first click succeeded); silent no-op — the user
          // sees their pick on the board. If NO → real clock
          // expiry; keep the DR-2 copy.
          if (result.reason === 'clock_expired') {
            const myRoster =
              useDraftClientStore.getState().derivedState?.teamRosters.get(myTeamId) ?? [];
            const alreadyPicked = myRoster.some(
              (r) => r.pickNumber === submittingForPickNumber,
            );
            if (alreadyPicked) {
              // Double-submit — the first one already landed.
              // Silent no-op is honest: the user sees their pick.
              // A toast would be noise for a non-error state.
            } else {
              // Real clock expiry — autopick took the slot.
              toast.error(result.message);
            }
          } else {
            toast.error(result.message);
          }
        }
        // Success: dangle timer stays armed per DR-2 amendment.
      } catch (err) {
        useDraftClientStore
          .getState()
          .rollBackPending(attemptId, 'Unexpected error');
        toast.error('Unexpected error');
        void err;
      } finally {
        void dangleTimer; // keep the ref; timer runs regardless
        setSelectedPlayer(null);
      }
    },
    [amIOnClock, myTeamId, derived, leagueId, pendingActions],
  );

  const isDraftActive = derived?.draftStatus === 'in_progress';
  const isDraftComplete = derived?.draftStatus === 'completed';

  return (
    <div className="space-y-3">
      {/* DR-4 (2026-07-30) — completed-draft empty state. Deliberate
          copy + link to /roster (route verified at App.tsx:184). */}
      {isDraftComplete && (
        <div
          className="rounded border-2 border-green-600 bg-green-50 p-4 text-sm text-green-900"
          data-testid="completed-draft-banner"
        >
          <div className="font-semibold text-base">Draft complete</div>
          <div className="mt-1">
            All {derived?.totalPicks ?? 0} picks are in. Head to your{' '}
            <a href="/roster" className="underline font-medium">
              roster
            </a>{' '}
            to see the team you built.
          </div>
        </div>
      )}

      {/* DR-3.1 (2026-07-29) — F8 fix: sticky on-clock action bar
          renders above the tabs so it's visible in every tab of the
          room. Returns null when off-clock. */}
      <div className="sticky top-24 z-20">
        <OnClockActionBar
          amIOnClock={amIOnClock}
          currentPickDeadline={snapshot?.stateSnapshot.currentPickDeadline ?? null}
          selectedPlayer={selectedPlayer}
          onDraft={handleDraftFromPool}
          pickNumber={derived?.currentPickNumber ?? null}
          roundNumber={derived?.currentRoundNumber ?? null}
          isSubmitPending={isSubmitPending}
        />
        {/* DR-4 (2026-07-30) — alarm mute toggle. Persistent, small,
            always visible when on-clock. Beeping at a user who's
            already looking is obnoxious; muting is one click. */}
        {amIOnClock && (
          <button
            type="button"
            onClick={() => alarm.setMuted(!alarm.muted)}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground underline"
            data-testid="alarm-mute-toggle"
            aria-pressed={alarm.muted}
          >
            {alarm.muted ? '🔇 Alarm muted — click to unmute' : '🔊 Alarm on — click to mute'}
          </button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="players">Players</TabsTrigger>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="players" className="mt-4">
          {playersLoading ? (
            <Card className="p-4 text-muted-foreground" data-testid="pool-loading">
              Loading players…
            </Card>
          ) : (
            <PlayerPool
              onPlayerSelect={setSelectedPlayer}
              onPlayerDraft={handleDraftFromPool}
              selectedPlayer={selectedPlayer}
              draftedPlayers={draftedIds}
              isDraftActive={isDraftActive}
              availablePlayers={availablePlayers}
              isYourTurn={amIOnClock}
              isSubmitPending={isSubmitPending}
            />
          )}
        </TabsContent>

        <TabsContent value="board" className="mt-4">
          {/* DR-4 (2026-07-30) — pre-draft board copy. */}
          {derived?.draftStatus === 'not_started' && (
            <div
              className="mb-3 rounded border border-dashed border-muted-foreground/40 bg-muted/30 p-4 text-sm text-muted-foreground"
              data-testid="board-pre-draft-copy"
            >
              Draft hasn’t started yet — the board will fill in live as
              picks land.
            </div>
          )}
          <DraftBoard
            teams={v1Teams}
            draftHistory={draftHistory}
            currentPick={derived?.currentPickNumber ?? 0}
            currentRound={derived?.currentRoundNumber ?? 0}
            draftType="snake"
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <DraftHistory draftHistory={draftHistory} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────

interface SidebarPanelProps {
  leagueId: string;
  teams: FetchedTeam[];
  playersById: ReadonlyMap<string, Player>;
  myTeamId: string | null;
}

function SidebarPanel({
  leagueId,
  teams,
  playersById,
  myTeamId,
}: SidebarPanelProps) {
  const derived = useDerivedDraftState();
  const matrix = useDraftMatrix();
  const [queue, setQueue] = useState<string[]>([]);

  // DR-3.1 F9 fix: same filter as MainTabs — TeamRosters' pick label
  // formula reads teams.length as round size.
  const participatingTeamIds = useMemo(
    () => participatingTeamIdsFromMatrix(matrix ?? null),
    [matrix],
  );
  const v1Teams = useMemo(
    () => (derived ? toV1Teams(teams, derived, playersById, participatingTeamIds) : []),
    [teams, derived, playersById, participatingTeamIds],
  );
  const draftHistory = useMemo(
    () => (derived ? toDraftHistory(teams, derived, playersById) : []),
    [teams, derived, playersById],
  );
  const draftedIds = useMemo(
    () => (derived ? toDraftedPlayerIds(derived) : []),
    [derived],
  );
  const allPlayers = useMemo(() => Array.from(playersById.values()), [playersById]);

  const amIOnClock =
    derived !== null &&
    myTeamId !== null &&
    derived.onClockTeamId !== null &&
    derived.onClockTeamId === myTeamId;

  // DR-4 (2026-07-30) — empty rosters copy: shown when no team has
  // any picks yet. Once the first pick lands the copy hides and
  // TeamRosters renders normally.
  const anyPicksMade = derived !== null && derived.picksMade > 0;

  // DR-4 (2026-07-30) — participating-teams filter (in draft_order)
  // for the ManagerPresencePanel. Same filter as v1Teams: a spectator
  // team is not part of THIS draft's manager set.
  const participatingTeams = useMemo(
    () => teams.filter((t) => participatingTeamIds.has(t.id)),
    [teams, participatingTeamIds],
  );

  return (
    <>
      <ManagerPresencePanel teams={participatingTeams} />
      {!anyPicksMade && derived !== null && (
        <div
          className="rounded border border-dashed border-muted-foreground/30 bg-muted/20 p-3 text-xs text-muted-foreground"
          data-testid="rosters-empty-copy"
        >
          No picks yet — rosters will fill in as the draft progresses.
        </div>
      )}
      <TeamRosters
        teams={v1Teams}
        draftHistory={draftHistory}
        userTeamId={myTeamId}
      />
      <div>
        <DraftQueue
          queue={queue}
          players={allPlayers}
          draftedPlayers={draftedIds}
          onQueueChange={setQueue}
          onDraftFromQueue={() => {
            // Queue-drive submit is post-DR-3. For now, users draft
            // via the pool's Draft button. Queue is display-only per
            // architect ruling 1c.
            toast.info('Draft from the Players tab');
          }}
          isDraftActive={derived?.draftStatus === 'in_progress'}
          isYourTurn={amIOnClock}
          leagueId={leagueId}
          currentPick={derived?.currentPickNumber ?? undefined}
          totalPicks={derived?.totalPicks ?? undefined}
        />
        <div
          className="text-xs text-muted-foreground mt-1"
          data-testid="queue-persistence-note"
        >
          Saved on this device
        </div>
      </div>
      {/* DR-3 (2026-07-29) — DraftControls HIDDEN per architect ruling:
          v2 HTTP routes for /pause and /resume don't exist yet (only
          /undo is exposed at server/src/routes/draft.ts:273). Wiring
          commissioner tools to nothing is worse than absence. The
          panel lands properly with the post-Zach policy chunk that
          ships the missing routes.

          KI-012 (see docs/REGISTRY.md): when the post-Zach chunk lands
          the missing HTTP routes, undo MUST flow through the v2 event
          path (pick_undone via v2 RPC + LISTEN/NOTIFY + WS broadcast).
          Do NOT wire the v1 /undo route at server/src/routes/draft.ts:273
          into this room — it bypasses the persistent engine's in-memory
          fold and desyncs state. */}
      {false && null}
    </>
  );
}
