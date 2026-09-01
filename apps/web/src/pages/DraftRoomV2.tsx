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
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConnectionBanner } from '@/components/draft/v2/ConnectionBanner';
import { CompletionMomentBanner } from '@/components/draft/v2/CompletionMomentBanner';
import {
  DraftTimerV2,
  useClockOffsetEstimator,
} from '@/components/draft/v2/DraftTimerV2';
import { OnClockActionBar } from '@/components/draft/v2/OnClockActionBar';
import { AuctionPanel } from '@/components/draft/v2/AuctionPanel';
import { OfflineDraftRoom } from '@/components/draft/v2/OfflineDraftRoom';
import { ManagerPresencePanel } from '@/components/draft/v2/ManagerPresencePanel';
import { DraftBoard } from '@/components/draft/DraftBoard';
import { PlayerPool } from '@/components/draft/PlayerPool';
import { PlayerCardDialog } from '@/components/draft/PlayerCardDialog';
import { ScoringCalculator, type ScoringSettings } from '@citrus/shared';
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
  useIdentityFailure,
  usePendingActions,
  usePickTimeLimitSec,
} from '@/stores/draftClientStore';
import { useMyTeamIdCrossCheck } from '@/hooks/useMyTeamIdCrossCheck';
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
import { overlayPendingPicks } from '@/lib/draftClient/overlayPending';
import type { Player } from '@/services/PlayerService';
import { Button } from '@/components/ui/button';
import type { Team } from '@/services/LeagueService';

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
      // 2026-08-18 launch audit: this used to swallow every error and
      // leave myTeamId at its null default — which the rest of the room
      // reads as "legitimate spectator" (useMyTeamIdCrossCheck.ts:61
      // returns early on null, so the fail-loud banner never fires).
      // One transient blip at mount therefore made the owner a SILENT
      // spectator for the entire draft: no on-clock highlight, no alarm,
      // server-side autopick queue disabled, and a false "It's not your
      // turn" on every pick attempt — every pick lost to autopick, which
      // is a direct violation of the I1 never-lose-a-pick invariant.
      //
      // Now: retry the transient case, and if it still fails, say so.
      // A SUCCESSFUL response carrying no id is a real spectator and is
      // still handled silently — only genuine fetch failure is loud.
      try {
        const { apiClient } = await import('@/api/client');
        const path = `/api/leagues/${encodeURIComponent(leagueId)}/my-team`;

        for (let attempt = 0; attempt < 3; attempt++) {
          if (cancelled) return;
          try {
            const response = await apiClient.get<{ id?: string }>(path);
            if (cancelled) return;
            const payload = response.data ?? (response as unknown as { id?: string });
            const teamId =
              payload && typeof payload === 'object' && typeof payload.id === 'string'
                ? payload.id
                : null;
            useDraftClientStore.getState().setMyTeamId(teamId);
            // Un-latch a banner raised by an earlier failed attempt.
            if (useDraftClientStore.getState().identityFailure?.reason === 'my_team_unverifiable') {
              useDraftClientStore.getState().setIdentityFailure(null);
            }
            return;
          } catch {
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
            }
          }
        }
      } catch {
        // Fall through to the loud failure below (covers a dynamic
        // import failure as well as an exhausted retry loop).
      }
      if (cancelled) return;
      useDraftClientStore.getState().setIdentityFailure({ reason: 'my_team_unverifiable' });
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
  // 2026-08-18 launch audit: this catch used to be bare. That was the
  // SAME silent-no-button failure the lobby's league fetch was hardened
  // against — and worse, because the lobby derives commissioner status
  // from this list: teams=[] => myUserId=null => isCommissioner=false =>
  // the Start button is never rendered, under the copy "0 of 0 teams
  // joined · waiting for the commissioner to start". The commissioner
  // sits waiting for themselves, with nothing on screen saying why.
  // Now it is loud and retryable, mirroring leagueError/leagueFetchNonce.
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsFetchNonce, setTeamsFetchNonce] = useState(0);
  const retryTeamsFetch = useCallback(() => setTeamsFetchNonce((n) => n + 1), []);
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
          : null;
        if (payload === null) {
          setTeamsError('The team list came back in an unexpected shape.');
          return;
        }
        setTeams(payload);
        setTeamsError(null);
      } catch {
        if (!cancelled) {
          setTeamsError("Couldn't load this league's teams — the Start button needs them.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, teamsFetchNonce]);

  // DR-3 (2026-07-29) — pre-fetch all players non-blocking.
  // 2026-08-18 launch audit: `error` used to be destructured away, so a
  // failed player_directory load rendered an empty pool under the words
  // "No players found. Try adjusting your filters." The user was told to
  // fix their filters when in fact nothing had loaded and they could not
  // draft at all.
  const {
    playersById,
    isLoading: playersLoading,
    error: playersError,
    reload: reloadPlayers,
  } = usePreloadedPlayers();

  // OFFLINE DRAFT BRANCH (2026-08-24 launch build). Offline leagues
  // (settings.draftType === 'offline') never run a live engine lobby —
  // the commissioner types in the in-person results instead. The room
  // ASSUMES live and connects immediately (identical to pre-offline
  // behavior — zero added latency for real drafts); a parallel probe of
  // the league record flips to the offline entry room when it confirms
  // draftType='offline', and the connect effect's cleanup tears the
  // runner down on that flip. The brief discovery attempt an offline
  // league makes before the flip is harmless: the engine refuses
  // not_started/completed leagues at discovery without creating a
  // lobby (the format gate that bricked the autopick league only runs
  // at ignition, which draftV2Start now refuses for offline).
  const [offlineMeta, setOfflineMeta] = useState<
    | { kind: 'live' }
    | {
        kind: 'offline';
        commissionerId: string;
        draftRounds: number;
        draftStatus: string;
      }
  >({ kind: 'live' });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { apiClient } = await import('@/api/client');
        const response = await apiClient.get<{
          commissioner_id?: string;
          draft_rounds?: number;
          draft_status?: string;
          settings?: Record<string, unknown> | null;
        }>(`/api/leagues/${encodeURIComponent(leagueId)}`);
        if (cancelled) return;
        const payload =
          response.data ??
          (response as unknown as {
            commissioner_id?: string;
            draft_rounds?: number;
            draft_status?: string;
            settings?: Record<string, unknown> | null;
          });
        const draftType = (payload?.settings as { draftType?: string } | null)
          ?.draftType;
        if (draftType === 'offline') {
          setOfflineMeta({
            kind: 'offline',
            commissionerId: String(payload?.commissioner_id ?? ''),
            draftRounds: Number(payload?.draft_rounds ?? 0) || 14,
            draftStatus: String(payload?.draft_status ?? 'not_started'),
          });
        }
        // Non-offline (or shape surprise): stay 'live' — no state churn.
      } catch {
        // Probe failure: stay 'live' (fail open — a transient API blip
        // must never lock a real live draft out of its room).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // Mount / unmount: runner lifecycle (unchanged from DR-1b/DR-2).
  useEffect(() => {
    // Offline leagues never keep a WS runner: when the probe flips
    // kind to 'offline', this effect re-runs — the PREVIOUS run's
    // cleanup disconnects the runner, and this early return prevents
    // a reconnect.
    if (offlineMeta.kind !== 'live') return;
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
          // Entry 87 Fix C (CLOCK-DISPLAY-35) — seed the clock-offset
          // estimator from the freshest server timestamp available in
          // the snapshot's recentEvents ring buffer. Pre-fix root
          // cause: useClockOffsetEstimator starts at useState(0) and
          // was only fed by onEvent/onEvents, so the FIRST paint
          // computed remaining = deadline − localNow with zero
          // correction. On Garrett's PC (~5s slow vs server), a 30s
          // deadline rendered as 35s until the first pick event
          // seeded the EMA. Seeding here eliminates that first-paint
          // window entirely.
          // TIMER-1 / E121 — seed from the snapshot RESPONSE's server
          // clock first. E104's event-based seed (below) cannot fire
          // on a freshly-ignited draft: the engine's ring buffer holds
          // pick events only, so `recentEvents` is EMPTY until the
          // first pick lands — leaving the opening pick of every
          // draft uncorrected (0:35 on a 30s clock for a slow device).
          // `serverReceivedAtMs` is stamped by the snapshot fetcher
          // from the HTTP Date header and is always present.
          //
          // TIMER-2 (2026-08-12) — the event-timestamp fallback is GONE.
          //
          // It used to seed the estimator from
          // `recentEvents[last].timestamp` whenever the Date header was
          // unavailable — which is ALWAYS, because getResponseDateMs reads
          // `response.headers` and the snapshot fetcher receives apiClient's
          // parsed envelope, which has none. So this fallback ran on every
          // single load.
          //
          // An event timestamp says WHEN A PICK HAPPENED, not what the
          // server's clock reads now. Seeding from it means "offset = age of
          // the last pick". Open a league 80s after the previous pick and the
          // estimator concludes your clock runs 80s fast; the deadline is
          // pushed 80s into the future; DraftTimerV2's
          // `Math.min(remaining, pickTimeLimitSec)` then pins the display at
          // the configured limit and THE CLOCK APPEARS FROZEN.
          //
          // Field-confirmed 2026-08-12: server had 520s remaining on a 600s
          // clock, the browser showed a motionless 10:00. 520 + 80 = 600.
          //
          // With no seed the offset stays 0 and the countdown renders
          // `deadline - localNow` — accurate to the device's real skew
          // (measured at 1.8s on Garrett's machine, invisible on any clock).
          // That is strictly better than a confidently wrong correction.
          if (typeof snapshot.serverReceivedAtMs === 'number') {
            updateOffset(Date.now(), snapshot.serverReceivedAtMs);
          }
          // 2026-08-18 launch audit: fetchDraftOrderMatrix's own comment
          // says "caller retries with backoff" — no caller ever did.
          // Without a matrix, deriveDraftState cannot compute
          // onClockTeamId or currentPickNumber, so a single failure here
          // left the room showing "Status: in progress" with nobody ever
          // on the clock and no way to pick. Retry properly.
          void (async () => {
            for (let attempt = 0; attempt < 4; attempt++) {
              const matrix = await fetchDraftOrderMatrix(
                leagueId,
                snapshot.stateSnapshot.totalPicks,
              );
              if (matrix !== null) {
                store.setMatrix(matrix);
                return;
              }
              if (attempt < 3) {
                await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
              }
            }
            // Exhausted. setMatrix(null) is a no-op when a good matrix
            // is already installed (see store), so this only reports a
            // genuine cold-start failure.
            store.setMatrix(null);
          })();
        },
        onEvent: (event) => {
          const clientReceiveMs = Date.now();
          const serverMs = new Date(event.timestamp).getTime();
          if (Number.isFinite(serverMs)) updateOffset(clientReceiveMs, serverMs);
          store.applyEvent(event);
        },
        onEvents: (events) => {
          // TIMER-2 (2026-08-12) — deliberately does NOT seed the clock
          // offset. This is the RESYNC path: the batch is history, and its
          // last entry can be minutes old. Same defect as the snapshot
          // fallback above — see the comment there. `onEvent` still seeds,
          // and correctly, because a live frame genuinely just happened.
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
  }, [leagueId, draftId, offlineMeta.kind]);

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

  // Chunk 11g.10 client-liveness watchdog wiring.
  //
  // The runner's application-level ping/pong watchdog only fires while
  // the draft is `in_progress`. Paused / not_started / completed
  // lobbies are legitimately silent for arbitrary durations, so the
  // watchdog must not accumulate missed-pong evidence during those
  // windows (architect ruling: "must never fire while the draft is
  // paused or not started"). Toggling on every derived-state transition
  // is safe — setDraftActive is idempotent on same-value calls.
  useEffect(() => {
    const runner = runnerRef.current;
    if (runner === null) return;
    runner.setDraftActive(derivedForGap?.draftStatus === 'in_progress');
  }, [derivedForGap]);

  // F14(b) (2026-08-03) — client-side cross-check that the resolved
  // myTeamId appears in the fetched draft-order matrix. Fires during
  // active drafts only; re-resolves once on mismatch; sets
  // identityFailure state on confirmed miss so the room fails loud
  // instead of silently letting the user sit there unable to draft
  // (the F14 incident's user-visible surface).
  useMyTeamIdCrossCheck({ leagueId });

  const handleRetryNow = useMemo(
    () => () => {
      const runner = runnerRef.current;
      if (runner === null) return;
      runner.disconnect();
      runner.connect({ leagueId, draftId });
    },
    [leagueId, draftId],
  );

  // OFFLINE DRAFT BRANCH (2026-08-24): offline leagues get the results
  // entry room instead of the live draft room — no WS, no lobby, no
  // start button. Rendered as soon as the format probe resolves.
  if (offlineMeta.kind === 'offline') {
    return (
      <div className="container mx-auto p-4" data-testid="draft-room-v2">
      {/*
        * NATIVE ESCAPE HATCH (2026-08-31) — reported from the iOS simulator
        * as "I'm stuck, the menu has disappeared." The draft routes hide the
        * app's global nav on purpose (MobileBottomNav hideRoutes), and the
        * native shell has no browser chrome, so without this link the room
        * is a dead end you can only leave by killing the app. Every draft
        * surface carries its own way back.
        */}
      <Link
        to={`/league/${leagueId}`}
        data-testid="draft-room-exit"
        /* MOBILE PASS (2026-09-01): was muted grey — on this room's dark
           surface that rendered near-invisible, which is how "I can't
           back out of the draft room" got reported AFTER the exit
           shipped. Brand orange, real touch target. */
        className="mb-2 inline-flex min-h-[44px] items-center gap-1 rounded-md px-1.5 -ml-1.5 text-sm font-semibold text-pastel-orange transition-colors hover:text-pastel-orange/80 active:bg-white/5"
      >
        &larr; League HQ
      </Link>
        <OfflineDraftRoom
          leagueId={leagueId}
          teams={teams}
          teamsError={teamsError}
          onRetryTeams={retryTeamsFetch}
          playersById={playersById}
          playersLoading={playersLoading}
          playersError={playersError}
          onRetryPlayers={reloadPlayers}
          commissionerId={offlineMeta.commissionerId}
          draftRounds={offlineMeta.draftRounds}
          initialDraftStatus={offlineMeta.draftStatus}
        />
      </div>
    );
  }

  return (
    /* pb-28: clearance for the on-clock action bar, which is FIXED to the
       bottom edge on phones (see MainTabs). lg+ restores the normal pad —
       the bar is sticky-in-flow there. */
    <div className="container mx-auto p-4 pb-28 lg:pb-4" data-testid="draft-room-v2">
      {/*
        * NATIVE ESCAPE HATCH (2026-08-31, moved into the sticky header
        * 2026-09-01) — reported from the iOS simulator as "I'm stuck, the
        * menu has disappeared." The draft routes hide the app's global nav
        * on purpose (MobileBottomNav hideRoutes), and the native shell has
        * no browser chrome, so without a visible exit the room is a dead
        * end you can only leave by killing the app. The exit now lives
        * INSIDE StickyHeader so it never scrolls away — the first fix put
        * it above the header in muted grey, and it was reported unfindable
        * a second time.
        */}
      <StickyHeader
        leagueId={leagueId}
        onRetryNow={handleRetryNow}
        clockOffsetMs={clockOffsetMs}
      />
      <IdentityFailureBanner />
      <DraftLobbyV2
        leagueId={leagueId}
        teams={teams}
        teamsError={teamsError}
        onRetryTeams={retryTeamsFetch}
      />
      <DraftRoomBody
        leagueId={leagueId}
        teams={teams}
        playersById={playersById}
        playersLoading={playersLoading}
        playersError={playersError}
        onRetryPlayers={reloadPlayers}
        clockOffsetMs={clockOffsetMs}
      />
    </div>
  );
}

// F14(b) (2026-08-03) — hard-error banner rendered when the
// myTeamId ↔ draft-order-matrix cross-check has failed (see
// useMyTeamIdCrossCheck). Prominent, red, and permanent until
// the state clears — because "silent-degrade-to-can't-draft" was
// the F14 defect and this is the invariant I1 guarantee that
// prevents recurrence. NOT dismissable by the user; the user
// cannot make this go away by clicking, only the underlying
// membership resolution can.
function IdentityFailureBanner() {
  const failure = useIdentityFailure();
  if (failure === null) return null;
  // F14(b) honest-copy (2026-08-03 architect ruling — F11/F15 lineage):
  // distinguish the CONFIRMED mismatch (we saw a fresh answer and it
  // still isn't in the draft) from the UNVERIFIABLE state (re-resolve
  // threw; we don't actually know). Do not assert a fact that wasn't
  // verified. Copy differs; the mask-to-null downstream behavior is
  // the same either way.
  const { title, body } =
    failure.reason === 'my_team_not_in_matrix'
      ? {
          title: "We can't identify your team in this draft.",
          body: (
            <>
              The draft server doesn't recognize you as an owner of any
              team in this draft's order. This usually means a
              commissioner just changed your team assignment and the
              change hasn't reached the draft yet. Refreshing the page
              usually resolves it.
            </>
          ),
        }
      : {
          title: "Couldn't verify your team — check your connection.",
          body: (
            <>
              We couldn't reach the server to confirm which team you
              own in this draft. Draft controls are hidden until we
              can verify. If your connection is back, refreshing the
              page should recover.
            </>
          ),
        };
  return (
    <div
      role="alert"
      className="mb-4 rounded border border-destructive bg-destructive/10 p-4 text-destructive"
      data-testid="identity-failure-banner"
      data-identity-failure-reason={failure.reason}
    >
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-sm">
        {body}{' '}
        <button
          type="button"
          className="underline font-medium"
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

// ── Sticky header ─────────────────────────────────────────────────
//
// Connection banner + timer + one-line pick/round/on-clock label.
// Kept small so per-event fold re-renders don't ripple past this
// section. Selector granularity per architect ratification 5.

interface StickyHeaderProps {
  /** Exit-link target — the header owns the room's way back to League HQ. */
  leagueId: string;
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

// ── COMMISH-START (2026-08-18) — pre-draft lobby, inside the v2 room ──
//
// Why this exists: retiring the v1 room (which used to host the start
// lobby) left the v2 room with no way to START a draft — a not-started
// league opened to "waiting for the commissioner" with no button, ever.
// This restores the start flow where it belongs and makes it a real
// lobby: participants land in the room and JOIN, the commissioner sees
// who is in, and officially kicks the draft off. No instant/auto start.
//
// Purely additive by construction: it renders null the instant the
// draft is live (draftStatus !== 'not_started' OR any pick made), so
// the proven in-draft path is untouched. It reuses the SAME ignition
// the v1 lobby used — useStartDraftFull → (init draft_order) +
// start_draft_v2 — so starting is byte-identical to the proven
// THE-TWELVE path; only the button's location moved into v2. On
// success the live WS receives the draft_started event, `derived`
// flips to in_progress, and this panel unmounts on the next render —
// no navigation, we are already in /draft-v2.
interface DraftLobbyV2Props {
  leagueId: string;
  teams: FetchedTeam[];
  /** Loud, retryable teams-fetch failure. Null when the list loaded. */
  teamsError: string | null;
  onRetryTeams: () => void;
}

/**
 * 2026-08-19 — the LATCH, extracted to a hook (2026-08-20) because the
 * disease had a second site. Deriving pre-start visibility straight
 * from the live connection state flickers, because the state
 * legitimately cycles
 *     reconnecting(waitingForStart) -> connecting -> reconnecting(...)
 * roughly every 3 seconds while the draft has not started.
 *
 * Measured on production (2026-08-19): 4 full lobby teardown/rebuild
 * cycles in 12 seconds — the Start button itself was being destroyed
 * and recreated under the commissioner's cursor. The lobby got the
 * latch that night; the "draft hasn't started yet" fallback line in
 * DraftRoomBody did NOT, kept reading the raw state, and flickered
 * between its two strings on every poll (reported on production
 * 2026-08-20, pre-proving-draft). Same defect: a FIXED surface paired
 * with a FLAPPING signal. One latch, shared by both consumers, so a
 * third site can never re-derive it raw.
 *
 * Once pre-ignition is observed, STAY latched. Only a decisive
 * transition leaves: the draft actually going live (`connected`),
 * finishing (`terminal_completed`), or dying (`fatal`). Transient
 * blips between polls never touch the UI.
 */
function useLatchedWaitingForStart(): boolean {
  const connectionState = useDraftConnectionState();
  const rawWaitingForStart =
    connectionState.kind === 'reconnecting' && connectionState.waitingForStart === true;
  const [lobbyLatched, setLobbyLatched] = useState(false);
  useEffect(() => {
    if (rawWaitingForStart) {
      setLobbyLatched(true);
      return;
    }
    if (
      connectionState.kind === 'connected' ||
      connectionState.kind === 'fatal' ||
      connectionState.kind === 'terminal_completed'
    ) {
      setLobbyLatched(false);
    }
  }, [rawWaitingForStart, connectionState.kind]);
  return rawWaitingForStart || lobbyLatched;
}

function DraftLobbyV2({ leagueId, teams, teamsError, onRetryTeams }: DraftLobbyV2Props) {
  const myTeamId = useMyTeamId();
  const [isStarting, setIsStarting] = useState(false);
  // AI-FILL (2026-08-23) — see the button's comment below.
  const [isFilling, setIsFilling] = useState(false);
  const [league, setLeague] = useState<
    { commissioner_id: string; draft_rounds: number; league_size: number | null; settings: Record<string, unknown> | null } | null
  >(null);
  // League-fetch failure is USER-VISIBLE. The original silent-null
  // catch produced the exact incident this lobby exists to prevent:
  // a commissioner staring at a waiting screen with no button and no
  // explanation. leagueFetchNonce re-arms the effect for Retry.
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [leagueFetchNonce, setLeagueFetchNonce] = useState(0);

  // Additive-only invariant, keyed on the SAME signal ConnectionBanner
  // uses for its "Waiting for the draft to start" copy: the engine's
  // discovery answers 409 with status `not_started` (commissioner hasn't
  // pressed Start), which puts the client in `reconnecting` with
  // `waitingForStart`. That is the ONLY genuinely pre-ignition state.
  // Latching (see useLatchedWaitingForStart) keeps it stable across the
  // poll cycle's transient blips.
  const waitingForStart = useLatchedWaitingForStart();

  // Fetch the league record ONLY while we are actually the pre-draft
  // lobby. Gating on waitingForStart keeps the in-draft render path free
  // of any extra network work — during a live draft this effect is a
  // no-op, so it can never perturb the draft's own fetch/timing.
  useEffect(() => {
    if (!waitingForStart) return;
    let cancelled = false;
    void (async () => {
      try {
        const { apiClient } = await import('@/api/client');
        const path = `/api/leagues/${encodeURIComponent(leagueId)}`;
        const response = await apiClient.get<{
          commissioner_id: string;
          draft_rounds: number;
          league_size: number | null;
          settings: Record<string, unknown> | null;
        }>(path);
        if (cancelled) return;
        const payload =
          response.data ??
          (response as unknown as {
            commissioner_id: string;
            draft_rounds: number;
            league_size: number | null;
            settings: Record<string, unknown> | null;
          });
        if (payload && typeof payload.commissioner_id === 'string') {
          setLeague(payload);
          setLeagueError(null);
        } else {
          setLeagueError('League details came back in an unexpected shape.');
        }
      } catch {
        if (!cancelled) {
          // Loud, recoverable failure — never a silent no-button state.
          setLeagueError("Couldn't load league details — the Start button needs them.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, waitingForStart, leagueFetchNonce]);

  if (!waitingForStart) return null;

  // Our user id = the owner of our team. The teams list carries owner_id
  // and the store already resolved our teamId (the DR-2 my-team fetch), so
  // commissioner status needs no AuthProvider and no supabase import — the
  // v2 room stays testable in isolation.
  const myUserId = teams.find((t) => t.id === myTeamId)?.owner_id ?? null;
  const isCommissioner = !!myUserId && !!league && myUserId === league.commissioner_id;
  const joinedHumans = teams.filter((t) => t.owner_id);

  // start_draft_v2 hard-requires round-1 team_order length ===
  // league_size (draft_not_configured otherwise). Enabling Start with
  // fewer teams hands the commissioner a button that can only fail
  // with a raw RPC error — so the gate lives HERE, with words.
  const leagueSize = league?.league_size ?? null;
  const roomFull = leagueSize == null ? teams.length >= 2 : teams.length >= leagueSize;
  const startBlockedReason = !roomFull
    ? leagueSize != null
      ? `Waiting for teams — ${teams.length} of ${leagueSize} created. The draft needs all ${leagueSize} before it can start.`
      : 'Need at least 2 teams to start.'
    : null;

  // Reuses the EXACT ignition the v1 lobby used, via the same plain
  // building blocks useStartDraftFull calls under the hood —
  // DraftService.initializeDraftOrder (builds draft_order from whoever
  // has joined) then draftV2Api.startDraftV2 (the F27 start_draft_v2 RPC).
  // Called directly (not through the hook) so the lobby stays free of
  // provider-coupled hooks; ignition semantics are identical.
  // AI-FILL (2026-08-23) — fills every open seat via the same
  // commissioner endpoint the v1 lobby used, then re-fetches the team
  // list so the room flips to "everyone's here" without a reload.
  const handleFillWithAI = async () => {
    if (isFilling) return;
    const size = league?.league_size ?? null;
    if (size == null || teams.length >= size) return;
    setIsFilling(true);
    try {
      const missing = size - teams.length;
      const teamNames = Array.from(
        { length: missing },
        (_, i) => `AI Team ${teams.length + i + 1}`,
      );
      const { apiClient } = await import('@/api/client');
      await apiClient.post(`/api/leagues/${leagueId}/simulate-fill`, { teamNames });
      toast.success(
        missing === 1 ? 'AI team added — room is full.' : `${missing} AI teams added — room is full.`,
      );
      onRetryTeams();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error('Could not add AI teams', {
        description: e?.response?.data?.error ?? e?.message ?? 'Please try again.',
      });
    } finally {
      setIsFilling(false);
    }
  };

  const handleStart = async () => {
    if (!myUserId || !league || isStarting) return;
    setIsStarting(true);
    try {
      const [{ DraftService }, { draftV2Api }] = await Promise.all([
        import('@/services/DraftService'),
        import('@/api/draftV2'),
      ]);
      const draftType =
        ((league.settings as { draftType?: string } | null)?.draftType) || 'snake';
      const mappedTeams: Team[] = teams.map((t) => ({
        id: t.id,
        league_id: leagueId,
        owner_id: t.owner_id ?? null,
        team_name: t.team_name,
        created_at: '',
        updated_at: '',
      }));
      // initializeDraftOrder ignores its userId arg server-side and
      // start_draft_v2 authorizes via the JWT; myUserId is passed for
      // signature compatibility only.
      const { error: initError } = await DraftService.initializeDraftOrder(
        leagueId,
        myUserId,
        mappedTeams,
        league.draft_rounds || 14,
        true,
        undefined,
        draftType,
      );
      if (initError) {
        toast.error('Failed to initialize draft', {
          description: (initError as { message?: string })?.message ?? 'Please try again.',
        });
        return;
      }
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${leagueId}-${Date.now()}`;
      await draftV2Api.startDraftV2(leagueId, idempotencyKey);
      // Live WS receives draft_started; this panel unmounts on the next
      // derivation — no navigate, we are already in /draft-v2.
      toast.success('Draft started — good luck!');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error('Cannot start draft', {
        description: e?.response?.data?.error ?? e?.message ?? 'Please try again.',
      });
    } finally {
      setIsStarting(false);
    }
  };

  // Draft settings, shown as a strip so everyone can see the format they
  // are about to be locked into. Falls back gracefully while the league
  // record is still loading.
  const draftTypeLabel = String(
    (league?.settings as { draftType?: string } | null)?.draftType ?? 'snake',
  );
  const pickSeconds = Number(
    (league?.settings as { pickTimeLimit?: number | string } | null)?.pickTimeLimit ?? 0,
  );
  const rounds = league?.draft_rounds ?? null;
  const totalPicks = rounds && teams.length ? rounds * teams.length : null;

  return (
    <Card
      className="mb-4 overflow-hidden border-0 bg-pastel-surface-tile p-0 ring-1 ring-white/10 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)]"
      data-testid="draft-lobby-v2"
    >
      {/* Hero — this is the last screen before a live draft, so it should
          feel like an event rather than a status readout. */}
      <div className="relative px-5 pt-5 pb-4 sm:px-7 sm:pt-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
        />
        <div className="relative flex items-start justify-between gap-5 flex-wrap">
          <div className="min-w-0">
            <div className="font-jbmono text-[10px] font-bold uppercase tracking-[0.32em] text-pastel-orange-soft">
              {isCommissioner ? "You're the commissioner" : 'Draft lobby'}
            </div>
            <h2 className="mt-1.5 font-sans text-[1.75rem] sm:text-[2.25rem] font-black leading-none tracking-[-0.03em] text-pastel-cream">
              {roomFull ? (
                <>Everyone&apos;s here.</>
              ) : (
                <>Waiting on the <span className="text-pastel-orange">room</span>.</>
              )}
            </h2>
            <p className="mt-2 text-sm text-white/55">
              {teamsError ? (
                'Team list unavailable — see below.'
              ) : (
                <>
                  <span className="font-semibold text-pastel-cream">
                    {joinedHumans.length} of {teams.length}
                  </span>{' '}
                  {teams.length === 1 ? 'manager' : 'managers'} in the room
                  {isCommissioner
                    ? ' · start whenever you’re ready'
                    : ' · the commissioner starts when everyone’s in'}
                </>
              )}
            </p>
          </div>

          {isCommissioner && (
            <div className="flex flex-col items-end gap-1.5">
              <Button
                onClick={handleStart}
                disabled={isStarting || !roomFull}
                data-testid="draft-lobby-v2-start"
                size="lg"
                className="bg-pastel-orange text-[#2A0F00] hover:bg-pastel-orange-soft border-0 rounded-full px-8 font-black tracking-tight shadow-[0_8px_24px_-6px_rgba(255,107,26,0.55)] disabled:shadow-none"
              >
                {isStarting ? 'Starting…' : 'Start Draft'}
              </Button>
              {roomFull && !isStarting && (
                <span className="font-jbmono text-[10px] uppercase tracking-[0.18em] text-white/55">
                  This goes live immediately
                </span>
              )}
              {/* AI-FILL (2026-08-23, found live on prod during launch QA):
                  the create-league page promises "Fill any open slots with
                  AI opponents at the press of a button" — but the button
                  only ever existed in the RETIRED v1 lobby. The v2 lobby
                  left a solo commissioner stuck at "waiting for teams" with
                  no way to do the thing the banner sold. Same endpoint the
                  v1 lobby used (POST /simulate-fill). */}
              {!roomFull && leagueSize != null && teams.length < leagueSize && (
                <Button
                  onClick={handleFillWithAI}
                  disabled={isFilling}
                  data-testid="draft-lobby-v2-fill-ai"
                  variant="outline"
                  className="rounded-full border-white/20 bg-white/5 text-pastel-cream hover:bg-white/10"
                >
                  {isFilling
                    ? 'Adding AI teams…'
                    : `Fill ${leagueSize - teams.length} open slot${leagueSize - teams.length === 1 ? '' : 's'} with AI`}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Format strip — snake / rounds / clock, so nobody is surprised. */}
        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          {[
            // FORMAT-LABEL FIX (2026-08-23, found live on prod during launch
            // QA): everything non-auction rendered as "Snake" — a LINEAR
            // league's lobby announced the wrong format on the one screen
            // whose comment says "so nobody is surprised".
            {
              label: 'Format',
              value:
                ({
                  snake: 'Snake',
                  linear: 'Linear',
                  auction: 'Auction',
                  autopick: 'Autopick',
                  offline: 'Offline / Manual',
                } as Record<string, string>)[draftTypeLabel] ?? 'Snake',
            },
            rounds ? { label: 'Rounds', value: String(rounds) } : null,
            pickSeconds ? { label: 'Per pick', value: `${pickSeconds}s` } : null,
            totalPicks ? { label: 'Total picks', value: String(totalPicks) } : null,
          ]
            .filter(Boolean)
            .map((chip) => {
              const c = chip as { label: string; value: string };
              return (
                <div
                  key={c.label}
                  className="rounded-lg bg-white/5 px-3 py-1.5 ring-1 ring-white/10"
                >
                  <span className="font-jbmono text-[9px] uppercase tracking-[0.18em] text-white/55">
                    {c.label}
                  </span>
                  <span className="ml-2 text-sm font-bold text-pastel-cream">{c.value}</span>
                </div>
              );
            })}
        </div>
      </div>
      {leagueError && (
        <div
          className="mx-5 sm:mx-7 mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2"
          data-testid="draft-lobby-v2-error"
        >
          <p className="text-sm text-destructive">{leagueError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLeagueFetchNonce((n) => n + 1)}
            data-testid="draft-lobby-v2-retry"
          >
            Retry
          </Button>
        </div>
      )}
      {teamsError && (
        <div
          className="mx-5 sm:mx-7 mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2"
          data-testid="draft-lobby-v2-teams-error"
        >
          <p className="text-sm text-destructive">{teamsError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetryTeams}
            data-testid="draft-lobby-v2-teams-retry"
          >
            Retry
          </Button>
        </div>
      )}
      {/* Draft order slots. Numbered, because in a snake draft the order
          IS the story — a manager should be able to see where they pick
          before the clock ever starts. */}
      <div className="border-t border-white/5 bg-black/15 px-5 py-4 sm:px-7">
        <div className="mb-3 font-jbmono text-[10px] font-bold uppercase tracking-[0.28em] text-white/55">
          The room
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((t, i) => {
            const isMine = t.id === myTeamId;
            return (
              <div
                key={t.id}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 transition-colors ${
                  isMine
                    ? 'bg-pastel-orange/10 ring-pastel-orange/40'
                    : 'bg-white/5 ring-white/10'
                }`}
              >
                <span
                  className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg font-jbmono text-[11px] font-bold ${
                    isMine
                      ? 'bg-pastel-orange text-[#2A0F00]'
                      : 'bg-white/10 text-white/55'
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-pastel-cream">
                  {t.team_name}
                </span>
                {isMine && (
                  <span className="font-jbmono text-[9px] font-bold uppercase tracking-[0.16em] text-pastel-orange-soft">
                    You
                  </span>
                )}
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${
                    t.owner_id ? 'bg-pastel-sage' : 'bg-white/20'
                  }`}
                  title={t.owner_id ? 'Manager ready' : 'Seat open'}
                />
              </div>
            );
          })}
        </div>
        {isCommissioner && startBlockedReason && (
          <p
            className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/55 ring-1 ring-white/10"
            data-testid="draft-lobby-v2-blocked"
          >
            {startBlockedReason}
          </p>
        )}
      </div>
    </Card>
  );
}

// MOBILE PASS (2026-09-01) — compact single-row header. The previous
// stack (h1 + banner + a full timer Card + a status line) measured
// ~150px of sticky chrome on an iPhone 17 Pro, screenshotted by the
// founder as "dead space" burying the player list; it was also TALLER
// than the on-clock bar's sticky offset, so the bar slid underneath it.
// One row now carries the room's whole frame: exit (always visible —
// the escape hatch that got reported unfindable when it scrolled away),
// round/pick/status, and the countdown as a compact pill. The h1 stays
// for screen readers and the page-heading test; sighted users don't
// need a sign saying "Draft Room" — they need the clock and the way out.
function StickyHeader({ leagueId, onRetryNow, clockOffsetMs }: StickyHeaderProps) {
  const connectionState = useDraftConnectionState();
  const snapshot = useDraftSnapshot();
  const derived = useDerivedDraftState();
  const pickTimeLimitSec = usePickTimeLimitSec();
  const wsOpen = connectionState.kind === 'connected';

  // Status stays in the DOM in every state (the DR-4 honest-status
  // contract and its tests read textContent), but while the draft is
  // simply in_progress the words add nothing a phone can afford —
  // they render from sm: up only. Any OTHER status (waiting, paused,
  // completed) is load-bearing and shows at every width.
  const statusVisibility =
    derived !== null && derived.draftStatus === 'in_progress'
      ? 'hidden sm:inline'
      : '';

  return (
    <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border pb-2 mb-3 pt-safe">
      <h1 className="sr-only">Draft Room</h1>
      <div className="flex min-h-[44px] items-center justify-between gap-2">
        <Link
          to={`/league/${leagueId}`}
          data-testid="draft-room-exit"
          className="-ml-1.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold text-pastel-orange transition-colors hover:text-pastel-orange/80 active:bg-white/5"
        >
          &larr; League HQ
        </Link>
        {snapshot !== null && derived !== null ? (
          <div
            className="min-w-0 flex-1 truncate text-right text-xs sm:text-sm text-muted-foreground tabular-nums"
            data-testid="draft-header-label"
          >
            {derived.currentPickNumber !== null &&
            derived.currentRoundNumber !== null ? (
              <>
                Round {derived.currentRoundNumber} · Pick{' '}
                {derived.currentPickNumber} / {derived.totalPicks}
                <span className={statusVisibility}>
                  {' '}· {describeStatus(derived.draftStatus, derived.picksMade)}
                </span>
              </>
            ) : (
              <>
                {derived.picksMade} / {derived.totalPicks} picks ·{' '}
                {describeStatus(derived.draftStatus, derived.picksMade)}
              </>
            )}
          </div>
        ) : (
          <div className="min-w-0 flex-1 truncate text-right text-sm font-semibold">
            Draft Room
          </div>
        )}
        {snapshot !== null && derived !== null && (
          <DraftTimerV2
            variant="compact"
            currentPickDeadline={snapshot.stateSnapshot.currentPickDeadline}
            draftStatus={derived.draftStatus}
            wsOpen={wsOpen}
            clockOffsetMs={clockOffsetMs}
            pickTimeLimitSec={pickTimeLimitSec}
          />
        )}
      </div>
      <ConnectionBanner onRetryNow={onRetryNow} />
    </div>
  );
}

// ── Main body ─────────────────────────────────────────────────────

interface DraftRoomBodyProps {
  leagueId: string;
  teams: FetchedTeam[];
  playersById: ReadonlyMap<string, Player>;
  playersLoading: boolean;
  playersError: Error | null;
  onRetryPlayers: () => void;
  /**
   * Entry 87 Fix C — threaded from DraftRoomV2's estimator so
   * OnClockActionBar reads the SAME offset instance that DraftTimerV2
   * does. A second useClockOffsetEstimator call here would create a
   * separate EMA that never receives updateOffset frames.
   */
  clockOffsetMs: number;
}

function DraftRoomBody({
  leagueId,
  teams,
  playersById,
  playersLoading,
  playersError,
  onRetryPlayers,
  clockOffsetMs,
}: DraftRoomBodyProps) {
  /*
   * QUEUE-REACH (2026-08-13) — this state was declared inside
   * `SidebarPanel`. That made the queue invisible to `PlayerPool`,
   * which lives in `MainTabs`, a SIBLING. `PlayerPool` already
   * supports the queue completely — it takes `queue` and
   * `onAddToQueue` and renders a per-row star (PlayerPool.tsx:356 for
   * the mobile card, :631 for the desktop table) — but v2 never passed
   * either prop, and the star only renders when `onAddToQueue` is
   * defined. So the v2 room shipped a queue panel whose own empty
   * state reads "Click the star icon on players to add them to your
   * queue" next to a pool with no stars in it.
   *
   * That is not cosmetic. The server-side queue (`set_draft_queue`)
   * and the autopick `queueStrategy` that reads it both landed
   * 2026-08-12, and both are driven ENTIRELY by what a manager puts in
   * this list. With no way to fill it, a manager who misses their
   * clock falls through to projections-only autopick — the exact
   * outcome the queue exists to prevent. The whole chain was wired
   * except its first inch.
   *
   * Lifting to the common parent is the minimum that fixes it: one
   * `DraftQueue` instance still owns hydration and persistence (two
   * instances would race, and the empty-initial-state save would wipe
   * the very queue it restored — see DraftQueue.persistence.test.tsx),
   * while the pool becomes a read/write view of the same array.
   */
  const [queue, setQueue] = useState<string[]>([]);
  const snapshot = useDraftSnapshot();
  const derived = useDerivedDraftState();
  const resolvedMyTeamId = useMyTeamId();
  const identityFailure = useIdentityFailure();
  // Entry 87 Fix A (COMPLETED-ROOM-1) — read the runner state so
  // the "waiting" branch can distinguish terminal_completed (draft
  // is done; snapshot fetch in flight) from a genuine pre-first-
  // snapshot wait.
  const connectionState = useDraftConnectionState();
  // 2026-08-20 — latched pre-ignition signal, shared with DraftLobbyV2.
  // See useLatchedWaitingForStart for why the raw state must never
  // drive render decisions directly.
  const waitingForStart = useLatchedWaitingForStart();
  // F14(b) (2026-08-03): when the client-side identity cross-check
  // has failed, refuse to render draft controls by forcing myTeamId
  // to null downstream. Every downstream gate already checks
  // `myTeamId !== null` (submit button, on-clock label, roster
  // highlight), so a single mask here disables all draft affordances
  // without touching each callsite. The banner rendered above the
  // body tells the user WHY controls are absent — silent-degrade
  // was the F14 defect that this fix prevents.
  const myTeamId = identityFailure !== null ? null : resolvedMyTeamId;

  if (snapshot === null || derived === null) {
    // Entry 87 Fix A (COMPLETED-ROOM-1) — while the terminal-state
    // snapshot fetch is in flight (state.kind === 'terminal_completed'
    // triggers a fetch_snapshot side effect on entry), the room shows
    // a completion-specific loader instead of the generic "Waiting
    // for draft state…" copy. The generic copy on a completed draft
    // reads as broken; being explicit that the draft is done and the
    // board is loading matches the user's mental model.
    if (connectionState.kind === 'terminal_completed') {
      return (
        <div className="text-muted-foreground" data-testid="draft-terminal-loading">
          Draft {connectionState.draftStatus}. Loading final board…
        </div>
      );
    }
    // ARCHITECT 2026-08-12 (LOBBY-WAIT / inbox E124), reworked
    // 2026-08-20: this branch used to render its own "the draft
    // hasn't started yet" line, gated on the RAW connection state.
    // Two defects in one: (a) raw state flaps every poll cycle, so
    // the line flickered between two strings — the exact disease the
    // lobby latch fixed one component up; (b) it narrated the
    // pre-start state UNDERNEATH DraftLobbyV2, which already owns
    // that surface completely (headline, format strip, draft order,
    // Start button). Duplicate narration is how the doubled
    // "RETRY NOW" banner happened.
    //
    // While pre-ignition (latched, so poll blips cannot flap it), the
    // body renders NOTHING and the lobby is the single voice.
    if (waitingForStart) {
      return null;
    }
    return (
      <div className="text-muted-foreground" data-testid="draft-loading">
        Waiting for draft state…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="lg:col-span-3 space-y-4">
        {/* Auction launch build (2026-08-24): the live auction surface —
            nomination block, bid controls, budgets, sales feed. Renders
            only for auction-format lobbies (useAuctionDerived is null
            otherwise, and the component returns null). */}
        {snapshot.format === 'auction' && (
          <AuctionPanel
            leagueId={leagueId}
            teams={teams}
            playersById={playersById}
            myTeamId={myTeamId}
          />
        )}
        <MainTabs
          leagueId={leagueId}
          teams={teams}
          playersById={playersById}
          playersLoading={playersLoading}
          playersError={playersError}
          onRetryPlayers={onRetryPlayers}
          myTeamId={myTeamId}
          clockOffsetMs={clockOffsetMs}
          queue={queue}
          onQueueChange={setQueue}
        />
      </div>
      {/* QUEUE-REACH (2026-08-13) — was `hidden lg:block`.
          Below 1024px that hid the ENTIRE sidebar: manager presence,
          team rosters, and the draft queue. Measured on staging at a
          766px viewport: the sidebar was display:none while the
          player pool was capped to 467px with 2,582px of rows hidden
          inside its own scrollbar — so there was nothing to scroll TO
          and no way to scroll there. Reported as two separate issues
          ("I can't scroll on the page, only the internal table of
          players" and "doesn't have a proper watchlist/queue
          button/list"); they are one layout bug.
          Below lg the grid is already `grid-cols-1`, so this simply
          stacks underneath the pool, which is what v1 has always
          done. At lg and up nothing changes — it is still the right
          hand column. */}
      <div className="space-y-4">
        <SidebarPanel
          leagueId={leagueId}
          teams={teams}
          playersById={playersById}
          myTeamId={myTeamId}
          queue={queue}
          onQueueChange={setQueue}
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
  playersError: Error | null;
  onRetryPlayers: () => void;
  myTeamId: string | null;
  clockOffsetMs: number;
  /** QUEUE-REACH (2026-08-13) — owned by DraftRoomBody, shared with the sidebar. */
  queue: string[];
  onQueueChange: (next: string[]) => void;
}

function MainTabs({
  leagueId,
  teams,
  playersById,
  playersLoading,
  playersError,
  onRetryPlayers,
  myTeamId,
  clockOffsetMs,
  queue,
  onQueueChange,
}: MainTabsProps) {
  const derived = useDerivedDraftState();
  const snapshot = useDraftSnapshot();

  // LEAGUE-SCORING WIRE (2026-08-23 final audit): the pool previously
  // ranked EVERY league with DEFAULT_SCORING — a custom league (e.g.
  // 1 pt G / 1 pt A) drafted off rankings computed for the default
  // categories. One GET at mount; ScoringCalculator accepts the raw
  // leagues.scoring_settings JSON. Fetch failure falls back to default
  // scoring — never block the pool on this request.
  const [leagueScoring, setLeagueScoring] = useState<ScoringSettings | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { apiClient } = await import('@/api/client');
        const response = await apiClient.get<{ scoring_settings?: ScoringSettings | null }>(
          `/api/leagues/${encodeURIComponent(leagueId)}`,
        );
        const payload = (response.data ?? response) as { scoring_settings?: ScoringSettings | null };
        if (!cancelled && payload?.scoring_settings) {
          setLeagueScoring(payload.scoring_settings);
        }
      } catch {
        /* default scoring remains */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);
  // Entry 87 Fix C — clamp source for OnClockActionBar's countdown.
  // Same store selector StickyHeader reads for DraftTimerV2 so the
  // sticky bar and the header timer agree frame-for-frame.
  const pickTimeLimitSec = usePickTimeLimitSec();
  const pendingActions = usePendingActions();
  const [tab, setTab] = useState<'players' | 'board' | 'history'>('players');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  // V2-PARITY (2026-08-17) — tap-for-player-card. Garrett's #1 feedback
  // from Citrus Draft Night: rows only highlighted; no card ever opened.
  const [cardPlayer, setCardPlayer] = useState<Player | null>(null);
  // V2-PARITY (2026-08-17) — autodraft toggle ("autodraft button doesn't
  // exist" — same feedback list). When ON and it's my turn, the client
  // submits automatically after a short beat: top of my queue first,
  // best season-FPTS available otherwise (the pool's own #1 ranking).
  // Persisted per league so a reload mid-draft keeps the setting.
  const [autodraftOn, setAutodraftOn] = useState<boolean>(() => {
    try { return localStorage.getItem(`citrus:autodraft:${leagueId}`) === '1'; } catch { return false; }
  });
  const lastAutoPickForRef = useRef<number | null>(null);

  // CLIENT-AUTODRAFT SHAPE GUARD (2026-08-23, found live on prod during
  // launch QA): this loop picked pure best-season-FPTS with zero roster
  // awareness — a manager who flipped autodraft on drafted NINE centers
  // and NO goalie (Claude Linear League). The engine's expiry autopick
  // has carried a roster-shape guard since E118; the client path that
  // fires FASTER than the engine had none. Mirror the same cap idea:
  // prefer the best player at a position the roster still needs.
  const [rosterCaps, setRosterCaps] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { apiClient } = await import('@/api/client');
        const res = await apiClient.get<{ settings?: { rosterSlots?: Record<string, number> } }>(
          `/api/leagues/${leagueId}`,
        );
        const raw = (res?.data as { settings?: { rosterSlots?: Record<string, number> } } | undefined)
          ?.settings?.rosterSlots;
        if (cancelled) return;
        if (raw && typeof raw === 'object') {
          const caps: Record<string, number> = {};
          for (const pos of ['C', 'LW', 'RW', 'D', 'G']) {
            const n = Number(raw[pos]);
            if (Number.isFinite(n) && n > 0) caps[pos] = n;
          }
          setRosterCaps(Object.keys(caps).length > 0 ? caps : null);
        }
      } catch {
        // Guard is best-effort: with no caps the loop degrades to the
        // old best-available behaviour rather than blocking autodraft.
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId]);

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
  // PICK-LATENCY (2026-08-12) — optimistic render.
  //
  // `renderDerived` is `derived` plus any pick the user has submitted
  // but the server has not yet confirmed. It feeds ONLY the four view
  // adapters below, so the pool, board, rosters and history all update
  // the instant the manager clicks Draft.
  //
  // Everything else on this page — amIOnClock, the countdown, the
  // on-clock action bar, isDraftActive, the submit guards — deliberately
  // keeps reading raw `derived`. The pick draws immediately; whose turn
  // it is stays server-authoritative. See overlayPending.ts for why.
  const renderDerived = useMemo(
    () => overlayPendingPicks(derived, pendingActions),
    [derived, pendingActions],
  );
  const v1Teams = useMemo(
    () =>
      renderDerived
        ? toV1Teams(teams, renderDerived, playersById, participatingTeamIds)
        : [],
    [teams, renderDerived, playersById, participatingTeamIds],
  );
  const draftHistory = useMemo(
    () => (renderDerived ? toDraftHistory(teams, renderDerived, playersById) : []),
    [teams, renderDerived, playersById],
  );
  const draftedIds = useMemo(
    () => (renderDerived ? toDraftedPlayerIds(renderDerived) : []),
    [renderDerived],
  );
  const availablePlayers = useMemo(
    () => (renderDerived ? toAvailablePlayers(playersById, renderDerived) : []),
    [playersById, renderDerived],
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
      // PICK-LATENCY (2026-08-12): capture the pick slot at CLICK time.
      // overlayPendingPicks places the optimistic entry at exactly these
      // coordinates; reading them at render time instead would misplace
      // the pick on any frame where the server has already advanced.
      useDraftClientStore.getState().recordPending({
        correlationId: attemptId,
        teamId: myTeamId,
        playerId: playerIdNum,
        submittedAt,
        pickNumber: submittingForPickNumber,
        roundNumber: derived.currentRoundNumber,
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

  /*
   * QUEUE-REACH (2026-08-13) — star toggles membership, appending to
   * the END so the list stays in the manager's chosen priority order.
   * `queueStrategy` (server/src/draft/autopickStrategy.ts) walks it
   * front-to-back and takes the first player still available, so
   * position IS priority; inserting anywhere but the end would
   * silently reorder someone's board.
   */
  const toggleQueued = useCallback(
    (playerId: string) => {
      onQueueChange(
        queue.includes(playerId)
          ? queue.filter((id) => id !== playerId)
          : [...queue, playerId],
      );
    },
    [queue, onQueueChange],
  );

  const isDraftActive = derived?.draftStatus === 'in_progress';
  const isDraftComplete = derived?.draftStatus === 'completed';

  // V2-PARITY (2026-08-17) — autodraft machinery.
  const toggleAutodraft = useCallback(() => {
    setAutodraftOn(v => {
      const next = !v;
      try { localStorage.setItem(`citrus:autodraft:${leagueId}`, next ? '1' : '0'); } catch { /* storage unavailable */ }
      return next;
    });
  }, [leagueId]);

  useEffect(() => {
    if (!autodraftOn || !amIOnClock || isSubmitPending) return;
    const pickNo = derived?.currentPickNumber ?? null;
    // One attempt per pick slot: if the submit fails (e.g. the engine
    // refuses the player), we deliberately do NOT retry this slot — the
    // engine's own expiry autopick remains the backstop, and the toast
    // tells the manager what happened.
    if (pickNo === null || lastAutoPickForRef.current === pickNo) return;
    if (availablePlayers.length === 0) return;
    const timer = setTimeout(() => {
      const availSet = new Set(availablePlayers.map(p => p.id));
      const queuedId = queue.find(id => availSet.has(id));
      let target = queuedId ? availablePlayers.find(p => p.id === queuedId) : undefined;
      if (!target) {
        // Mirror PlayerPool's rankMap: season FPTS via the LEAGUE's
        // scoring settings (wired 2026-08-23 — both the pool and this
        // fallback previously used default scoring for every league),
        // so autodraft still matches the visible #1 exactly.
        const scorer = new ScoringCalculator(leagueScoring ?? undefined);
        const scored = availablePlayers.map((p) => {
          const isG = p.position === 'G';
          const f = scorer.calculatePoints(
            isG
              ? { wins: p.wins || 0, saves: p.saves || 0, shutouts: p.shutouts || 0, goals_against: p.goals_against || 0 }
              : { goals: p.goals || 0, assists: p.assists || 0, shots: p.shots || 0, blocks: p.blocks || 0, hits: p.hits || 0, pim: p.pim || 0, ppp: p.ppp || 0, shp: p.shp || 0 },
            isG,
          );
          return { p, f };
        }).sort((a, b) => b.f - a.f);

        // CLIENT-AUTODRAFT SHAPE GUARD (2026-08-23): count what my team
        // already holds by position and prefer the best player at a
        // position still under its cap — exactly the engine's E118 idea.
        // Queue picks above are exempt on purpose: an explicit ranking
        // the manager typed outranks the guard (industry standard).
        let underCap: typeof scored[number] | undefined;
        if (rosterCaps && myTeamId) {
          const myEntries =
            useDraftClientStore.getState().derivedState?.teamRosters.get(myTeamId) ?? [];
          const counts: Record<string, number> = {};
          for (const entry of myEntries) {
            const owned = playersById.get(String(entry.playerId));
            const pos = owned?.position;
            if (pos) counts[pos] = (counts[pos] ?? 0) + 1;
          }
          underCap = scored.find(({ p }) => {
            const cap = rosterCaps[p.position];
            // Positions outside the cap map never block a pick.
            if (cap === undefined) return true;
            return (counts[p.position] ?? 0) < cap;
          });
        }
        target = (underCap ?? scored[0])?.p;
      }
      if (target) {
        lastAutoPickForRef.current = pickNo;
        void handleDraftFromPool(target);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [autodraftOn, amIOnClock, isSubmitPending, derived?.currentPickNumber, availablePlayers, queue, handleDraftFromPool, rosterCaps, myTeamId, playersById, leagueScoring]);

  return (
    <div className="space-y-3">
      {/* T13 architect Entry 13 (2026-08-09) — completion-moment
          polish. Replaces the DR-4 minimal green box with an elevated
          citrus2-style banner: scene-cup art slot, one-time fade+rise
          transition (prefers-reduced-motion respected), invite to
          screenshot the final board. data-testid preserved for
          DR-4-era test binding. Route to /roster verified at
          App.tsx:184; T11a link-graph integrity test guards this. */}
      {isDraftComplete && (
        <CompletionMomentBanner
          totalPicks={derived?.totalPicks ?? 0}
          topPickTeamName={null}
          topPickPlayerName={null}
          /*
           * ARCHITECT 2026-08-12 (ROSTER-CTA / inbox E133). The banner's
           * `rosterHref` defaults to a bare "/roster", and `Roster.tsx` has no
           * :leagueId route param — it resolves the league from LeagueContext's
           * `activeLeagueId` (Roster.tsx:218, :502). DraftRoomV2 reads its
           * leagueId from the PATH and never calls setActiveLeagueId, so the
           * context still points wherever it pointed before the user entered
           * the room. Observed live: finishing a draft in league ada00018 and
           * clicking "View your roster" landed on /roster?league=ada00015 —
           * a different league entirely.
           *
           * Scoping the href with ?league=<id> routes through LeagueContext's
           * existing "update active league when the URL param changes (with
           * membership validation)" effect, which is the designed mechanism
           * for exactly this. `CompletionMomentBanner` already declares the
           * prop and its test already covers "parent may pass league-scoped
           * variant" — the parent simply never did.
           *
           * The broader issue (the draft room not owning the active league at
           * all, which also leaves the mobile nav and every league-scoped route
           * pointing elsewhere for the duration of the draft) is a
           * LeagueContext change and is written up as a proposal, not shipped
           * here.
           */
          rosterHref={leagueId ? `/roster?league=${leagueId}` : undefined}
        />
      )}

      {/* DR-3.1 (2026-07-29) — F8 fix: on-clock action bar, visible in
          every tab of the room. Returns null when off-clock.
          MOBILE PASS (2026-09-01): on phones the bar is now FIXED to the
          bottom edge — the thumb zone, the industry placement (Sleeper/
          ESPN pin the pick action low), and the one spot the compact
          sticky header can never overlap. (Its old `sticky top-24` sat
          UNDERNEATH the taller pre-compaction header, z-20 vs z-30.)
          The draft routes already hide MobileBottomNav, so the bottom
          edge belongs to the draft; the room container carries pb-28 so
          the list's last rows scroll clear of it. lg+ keeps it in-flow,
          sticky just below the compact header. */}
      <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-16 lg:z-20">
        <OnClockActionBar
          amIOnClock={amIOnClock}
          currentPickDeadline={snapshot?.stateSnapshot.currentPickDeadline ?? null}
          clockOffsetMs={clockOffsetMs}
          pickTimeLimitSec={pickTimeLimitSec}
          selectedPlayer={selectedPlayer}
          onDraft={handleDraftFromPool}
          pickNumber={derived?.currentPickNumber ?? null}
          roundNumber={derived?.currentRoundNumber ?? null}
          isSubmitPending={isSubmitPending}
        />
      </div>
      {/* Toggles live in normal flow — set-and-forget controls don't earn
          a permanent slice of a phone screen the way the pick action does. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* DR-4 (2026-07-30) — alarm mute toggle. Beeping at a user who's
            already looking is obnoxious; muting is one click. */}
        {amIOnClock && (
          <button
            type="button"
            onClick={() => alarm.setMuted(!alarm.muted)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
            data-testid="alarm-mute-toggle"
            aria-pressed={alarm.muted}
          >
            {alarm.muted ? '🔇 Alarm muted — click to unmute' : '🔊 Alarm on — click to mute'}
          </button>
        )}
        {/* V2-PARITY (2026-08-17) — autodraft toggle, always visible so a
            manager can arm it BEFORE their turn (that's the whole point). */}
        {!isDraftComplete && (
          <button
            type="button"
            onClick={toggleAutodraft}
            className={
              autodraftOn
                ? 'text-xs underline text-fantasy-primary font-semibold'
                : 'text-xs underline text-muted-foreground hover:text-foreground'
            }
            data-testid="autodraft-toggle"
            aria-pressed={autodraftOn}
            title="When on, your picks submit automatically — top of your queue first, best available otherwise. One attempt per pick; the draft clock is still the backstop."
          >
            {autodraftOn ? '🤖 Autodraft ON — click to turn off' : '🤖 Autodraft off — click to turn on'}
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
              loadError={playersError}
              onRetryLoad={onRetryPlayers}
              isYourTurn={amIOnClock}
              isSubmitPending={isSubmitPending}
              /* LEAGUE-SCORING WIRE (2026-08-23) — rankings/FPTS follow
                 this league's categories instead of default scoring. */
              scoringSettings={leagueScoring}
              /* QUEUE-REACH (2026-08-13) — the two props that make the
                 per-row star appear. `onAddToQueue` is optional in
                 PlayerPool and the star is gated on it being defined,
                 so omitting it (as v2 did) removed the only control
                 that can put a player in the queue. */
              queue={queue}
              onAddToQueue={toggleQueued}
              /* V2-PARITY (2026-08-17) — per-row info button opens the
                 player card. */
              onShowCard={setCardPlayer}
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
            /*
             * ARCHITECT 2026-08-12 (BOARD-ROUNDS / inbox E129). This prop was
             * dropped in the v1 -> v2 port. `DraftBoard`'s signature defaults
             * `totalRounds = 16` (DraftBoard.tsx:57) and computes
             * `totalPicks = teams.length * totalRounds`, so without it the v2
             * board showed EVERY league as a 16-round draft. Observed live on
             * a 12x21 league that had finished: the board header read
             * "252 of 192 picks made" — a denominator smaller than the
             * numerator. In a live 21-round draft it would read
             * "192 of 192 picks made" around pick 192 and stay there for the
             * remaining 60 picks, which reads as "the draft is over" three
             * quarters of the way through. v1 has always passed this
             * (DraftRoom.tsx:4574, `league?.draft_rounds || ... || 21`).
             *
             * Deriving it from `derived.totalPicks` rather than from a league
             * settings field is deliberate: `totalPicks` comes straight from
             * `DraftSnapshot.stateSnapshot.totalPicks`, i.e. the ENGINE's own
             * authoritative count, and it is the same value the header two
             * hundred lines up already renders. Computing the board's
             * denominator from it makes the two numbers agree by construction
             * instead of by coincidence. `Math.round` (not ceil/floor) because
             * totalPicks is always teams x rounds exactly; rounding only
             * guards float noise. Falls back to the old 16 only when there are
             * no teams to divide by, which is the pre-snapshot render.
             */
            totalRounds={
              v1Teams.length > 0 && derived && derived.totalPicks > 0
                ? Math.round(derived.totalPicks / v1Teams.length)
                : undefined
            }
            draftType="snake"
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <DraftHistory draftHistory={draftHistory} />
        </TabsContent>
      </Tabs>

      {/* V2-PARITY (2026-08-17) — the player card. Draftable straight
          from the card when it's your turn. */}
      <PlayerCardDialog
        player={cardPlayer}
        onClose={() => setCardPlayer(null)}
        onDraft={handleDraftFromPool}
        canDraft={amIOnClock && isDraftActive && cardPlayer !== null && !draftedIds.includes(cardPlayer.id)}
        isSubmitPending={isSubmitPending}
      />
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────

interface SidebarPanelProps {
  leagueId: string;
  teams: FetchedTeam[];
  playersById: ReadonlyMap<string, Player>;
  myTeamId: string | null;
  /** QUEUE-REACH (2026-08-13) — lifted to DraftRoomBody; see the note there. */
  queue: string[];
  onQueueChange: (next: string[]) => void;
}

function SidebarPanel({
  leagueId,
  teams,
  playersById,
  myTeamId,
  queue,
  onQueueChange,
}: SidebarPanelProps) {
  const derived = useDerivedDraftState();
  const matrix = useDraftMatrix();

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
          onQueueChange={onQueueChange}
          onDraftFromQueue={() => {
            // Queue-drive submit is post-DR-3. For now, users draft
            // via the pool's Draft button. Queue is display-only per
            // architect ruling 1c.
            toast.info('Draft from the Players tab');
          }}
          isDraftActive={derived?.draftStatus === 'in_progress'}
          isYourTurn={amIOnClock}
          leagueId={leagueId}
          // QUEUE (2026-08-12) — enables server persistence. Null for a
          // spectator or an unresolved identity, in which case DraftQueue
          // stays on its previous localStorage-only path.
          teamId={myTeamId}
          currentPick={derived?.currentPickNumber ?? undefined}
          totalPicks={derived?.totalPicks ?? undefined}
        />
        <div
          className="text-xs text-muted-foreground mt-1"
          data-testid="queue-persistence-note"
        >
          Saved to your team — used for autopick if your clock expires
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
      {/* DraftControls slot intentionally rendered as null until KI-012 lands v2 /pause + /resume routes. */}
      {null}
    </>
  );
}
