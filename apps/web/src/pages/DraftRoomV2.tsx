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
  useMyTeamId,
} from '@/stores/draftClientStore';
import {
  notifyConnectionFatal,
  notifyPresenceJoined,
  notifyPresenceLeft,
} from '@/lib/draftClient/toasts';
import { usePreloadedPlayers } from '@/hooks/usePreloadedPlayers';
import {
  toAvailablePlayers,
  toDraftHistory,
  toDraftedPlayerIds,
  toV1Teams,
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
          store.applyPresence(payload);
          if (payload.kind === 'joined') notifyPresenceJoined(payload.userId);
          else notifyPresenceLeft(payload.userId);
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
                Status: {derived.draftStatus}
              </>
            ) : (
              <>
                {derived.picksMade} / {derived.totalPicks} picks made ·{' '}
                Status: {derived.draftStatus}
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
  const [tab, setTab] = useState<'players' | 'board' | 'history'>('players');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  // Adapt derived state → v1 prop shapes. Memoized against the exact
  // inputs so per-event folds only re-derive when derived changes.
  const v1Teams = useMemo(
    () => (derived ? toV1Teams(teams, derived, playersById) : []),
    [teams, derived, playersById],
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

  // Is it my turn? Same predicate as the DR-2 SubmitPickControl gate.
  const amIOnClock =
    derived !== null &&
    myTeamId !== null &&
    derived.onClockTeamId !== null &&
    derived.onClockTeamId === myTeamId;

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
      const playerIdNum = parseInt(player.id, 10);
      if (!Number.isFinite(playerIdNum) || playerIdNum <= 0) {
        toast.error('Invalid player');
        return;
      }
      const attemptId = crypto.randomUUID();
      const submittedAt = Date.now();
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
          toast.error(result.message);
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
    [amIOnClock, myTeamId, derived, leagueId],
  );

  const isDraftActive = derived?.draftStatus === 'in_progress';

  return (
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
          />
        )}
      </TabsContent>

      <TabsContent value="board" className="mt-4">
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
  const [queue, setQueue] = useState<string[]>([]);

  const v1Teams = useMemo(
    () => (derived ? toV1Teams(teams, derived, playersById) : []),
    [teams, derived, playersById],
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

  return (
    <>
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
