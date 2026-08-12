# Deploy sheet — 2026-08-12 (pick latency + E142)

**Read this first:** the database work is **already applied and verified on staging**. What is left is three deploys, and only the first two are new today.

**Production has not been touched.** Every production query today was read-only, and prod still has no v2 schema.

---

## ① What is already live on staging (no action needed)

| | |
|---|---|
| `sync_roster_assignments_for_league` | now **v2-aware** — picks its source table by which one holds picks, v2 first. The v1 branch is byte-for-byte unchanged. |
| `draft_events_sync_roster_trg` | **new** AFTER INSERT trigger on `draft_events`, gated `WHEN (NEW.event_type = 'draft_completed')` |
| backfill | **1,302 of 1,302 teams** with v2 picks now match their pick count exactly. Previously 1,177 had zero. |

Committed to the repo as `supabase/migrations/20260812150000_roster_sync_v2_aware_and_completion_trigger.sql` so prod can replay it. **That file is the only thing that needs to reach production, and not before you decide to.**

### Proof, at THE TWELVE's exact shape

A 12-team × 12-round draft ran end to end through the live engine while nobody touched it:

```
144 picks -> 144 roster rows -> 12 of 12 teams
min 12 / max 12 per team          (every team exactly 12 deep)
144/144 rows match source team AND player
144/144 resolve to a real player name
144 distinct players              (no duplicates)
draft wall time 304s              (2.11s/pick — unchanged cadence)
```

**Cost of the sync: 0 ms.** `draft_completed` shares a timestamp with the final pick — same transaction, no measurable addition.

**To reverse the call site:** `DROP TRIGGER draft_events_sync_roster_trg ON public.draft_events;`

---

## ② Deploy 1 — WEB (Firebase hosting) — *optimistic pick render*

**This is the one that changes how the draft feels.**

Files:

```
apps/web/src/lib/draftClient/overlayPending.ts              (new)
apps/web/src/lib/draftClient/__tests__/overlayPending.test.ts (new, 16 tests)
apps/web/src/lib/draftClient/optimistic.ts                  (+2 optional fields)
apps/web/src/lib/draftClient/deriveDraftState.ts            (+1 optional field)
apps/web/src/pages/DraftRoomV2.tsx                          (3 edits)
```

Suggested message:

```
feat(draft): render the manager's pick optimistically on click (PICK-LATENCY)
```

**What it does:** the drafted player now leaves the pool and lands on the roster, the board and the history **the instant you click** — instead of ~2–6 s later when the server answers. The reconciliation that makes this safe (broadcast / resync / rejection / network-failure) has been built and tested since July; it was simply never wired into the render. `PendingPickIndicator.tsx` was imported by nothing but its own test.

**Deliberately NOT optimistic:** the clock, `onClockTeamId`, and whose turn it is. Those stay server-authoritative. A pick that draws instantly is polish; a UI that lies about whose turn it is, is a bug.

**Verify after deploy:** click Draft on your turn. The player should vanish from the pool immediately and appear on your roster. If the server rejects it, it returns to the pool with a toast.

---

## ③ Deploy 2 — API (`citrus-api`, Cloud Run) — *E145, written last night*

```
server/src/routes/draftV2Pick.ts
server/src/__tests__/draftV2Routes.test.ts
```

```
perf(draft): stop awaiting the unconsumed Realtime broadcast on pick submit (PICK-LATENCY, E145)
```

**~6 s → ~1.9 s on every human pick.** The route awaited a Supabase Realtime broadcast on a channel with zero subscribers; every pick paid the full `BROADCAST_TIMEOUT_MS = 5_000`.

**This is no longer only about speed — it is a correctness margin.** `submitPick` has an 8 s client timeout and the dangle-safety timer is also 8 s. A response landing at 5.7–6.0 s leaves about 2 s of headroom. On a slow network or under load that flips, and the manager sees *"We couldn't confirm your pick — check the board"* **and an optimistic rollback, on a pick that actually succeeded.** Deploying this moves the margin from ~2 s to ~6 s.

---

## ④ Deploy 3 — ENGINE (GCE `citrus-draft-engine-staging`) — *unchanged from last night*

E117/E118. Still yours, still needs the `-f server/Dockerfile.draft-engine` image. **Nothing in today's work depends on it** — the roster fix deliberately lives in the database precisely so it needs no engine change.

---

## ⑤ What I could NOT verify, stated plainly

- **The three `DraftRoomV2` component test suites** (`DraftRoomV2.test.tsx`, `.dr3.`, `.f11.` — 1,215 lines). The device VM kills any process at ~45 s and vitest needs longer over the mounted filesystem, so **these did not run.** Reasoning says they are safe: with no pending action the overlay returns `derived` **by reference**, so those suites see bit-identical values, and I checked that f11 asserts only on team/clock/toast — all untouched, one of which has its own test. **Run them on your machine before the web deploy.**
- What I *did* run, in my own container: **48/48 passing** — `overlayPending` 16, `optimistic` 12 (unchanged, proves the added fields are backwards-compatible), `v1Adapters` 20 (unchanged, proves the adapters still behave). Plus **five mutation tests**, each killed: disable the overlay → 7 failures; remove the duplicate guard → 2; leak rolled-back entries → 2; advance the clock → 1; mutate caller state → 1.
- `tsc --noEmit` under `strict` on the new module: **clean**. `DraftRoomV2.tsx` parses (esbuild) but was **not** fully type-checked — same 45 s limit. Your build will catch anything.

---

## ⑥ One thing I decided that you can reverse

The original proposal put the roster-sync call **in the engine** (`PROPOSED_roster_sync_v2.sql`, STEP 2). I put it in a **database trigger** instead, because it covers every completion path at once — `submit_pick_v2`, the auction's `close_nomination_v2`, and commissioner override all append the same `draft_completed` event — and because it needs no deploy surface at all.

It cannot strand a draft: `sync_roster_assignments_for_league` ends in `EXCEPTION WHEN OTHERS THEN RETURN ... 'success', false`, so it never re-raises and cannot abort the transaction carrying the final pick. The proposal's hard requirement — *"MUST NOT BLOCK THE COMPLETION BROADCAST"* — is met by the callee's own contract rather than by hope.

**If you disagree, one line reverses it** and the engine hook can go back on the list.
