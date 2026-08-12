# Deploy sheet — 2026-08-12 FINAL

Supersedes `DEPLOY_2026-08-12_PICK_LATENCY.md`. Everything from today, in the order to ship it.

**Production has not been written to. Every production query today was read-only.**

---

## The pick path, before and after

| stage | before | after | how |
|---|---|---|---|
| auth — "who is this?" | **1 cross-region round trip, every request** | **0 — local HMAC** | ③ API deploy |
| membership | 2 queries, 30 s cache | unchanged | — |
| `submit_pick_v2` DB work | **3.5 ms** | 3.5 ms | already fine |
| awaited broadcast to nobody | **~4,000 ms** | **0 — not awaited** | ③ API deploy |
| what the manager *sees* | **nothing for ~6 s** | **instant** | ② web deploy |
| completed draft → rosters | **never** | **automatic** | ✅ already live |

Measured, not estimated: **5,710 ms and 5,966 ms** on two real human picks. The DB was never the problem — **3.5 ms** for the entire read path on the 252-pick soak league, every hot-path index correct.

---

## ① Already live on staging — no action

`sync_roster_assignments_for_league` is v2-aware; `draft_events_sync_roster_trg` fires on `draft_completed`. Backfill took **1,302 of 1,302 teams** to matching counts (1,177 previously had zero).

**Certified at THE TWELVE's exact shape** — 12×12, run by the live engine, untouched:

```
144 picks -> 144 roster rows -> 12 of 12 teams
min 12 / max 12 per team · 144 distinct players
144/144 match source team AND player · 144/144 resolve to a name
sync cost 0 ms · cadence unchanged at 2.11 s/pick
```

Replay for prod: `supabase/migrations/20260812150000_roster_sync_v2_aware_and_completion_trigger.sql`
Reverse the call site: `DROP TRIGGER draft_events_sync_roster_trg ON public.draft_events;`

---

## ② Deploy 1 — WEB (Firebase hosting)

```
apps/web/src/lib/draftClient/overlayPending.ts               (new)
apps/web/src/lib/draftClient/__tests__/overlayPending.test.ts (new, 16 tests)
apps/web/src/lib/draftClient/optimistic.ts                   (+2 optional fields)
apps/web/src/lib/draftClient/deriveDraftState.ts             (+1 optional field)
apps/web/src/lib/draftClient/__tests__/submitPick.test.ts    (comment only)
apps/web/src/pages/DraftRoomV2.tsx                           (3 edits)
```

```
feat(draft): render the manager's pick optimistically on click (PICK-LATENCY)
```

The drafted player leaves the pool and lands on the roster, board and history **on click**. The reconciliation that makes this safe has existed since July — `PendingPickIndicator.tsx` was imported by nothing but its own test.

**Clock, `onClockTeamId` and whose-turn-it-is stay server-authoritative.** A pick that draws instantly is polish; a UI that lies about whose turn it is, is a bug.

**Verify:** click Draft on your turn — the player should vanish from the pool immediately. A rejection returns them, with a toast.

---

## ③ Deploy 2 — API (`citrus-api`, Cloud Run)

```
server/src/lib/verifyAccessToken.ts                  (new)
server/src/__tests__/verifyAccessToken.test.ts       (new, 17 tests)
server/src/middleware/auth.ts                        (3 edits)
server/src/routes/draftV2Pick.ts                     (E145, written last night)
server/src/__tests__/draftV2Routes.test.ts
```

```
perf(api): verify Supabase JWTs locally + stop awaiting the dead broadcast (PICK-LATENCY, E145)
```

**Two wins in one deploy:**

1. **E145** — the route awaited a Realtime broadcast on a channel with **zero subscribers**, paying the full `BROADCAST_TIMEOUT_MS = 5_000` on every pick. ~4 s gone.
2. **Local JWT verification** — `authMiddleware` called `supabase.auth.getUser()` on **every request**: an HTTPS round trip to Montreal to answer a question the signed token already answers. Now a local HMAC check. This one is systemic — it speeds up *every* API call in the app, not just picks.

**REQUIRED ENV:** `SUPABASE_JWT_SECRET` must be set on `citrus-api`. The draft engine already requires it (`server/src/draft/index.ts:182`), so the value exists — it just needs to be on this service too. **If it is missing nothing breaks**: the code falls back to `getUser()` exactly as today. You lose the speedup, not the service.

**E145 is also a correctness margin now.** `submitPick` has an 8 s client timeout and the dangle timer is 8 s. A 5.9 s response leaves ~2 s of headroom; lose that race and the manager sees *"We couldn't confirm your pick"* **and an optimistic rollback — on a pick that succeeded.** This moves the margin to ~6 s.

---

## ④ Deploy 3 — ENGINE (GCE) — unchanged, still yours

E117/E118, `-f server/Dockerfile.draft-engine`. **Nothing from today depends on it** — the roster fix lives in the database precisely so it needs no engine change.

---

## ⑤ 🔴 The infrastructure finding — your call, not a code change

**Cloud Run `citrus-api` runs in `us-central1` (Iowa). Both Supabase projects — staging AND production — are in `ca-central-1` (Montreal).** Every database round trip crosses ~1,500 km.

Google Cloud has **`northamerica-northeast1` — Montreal**, the same metro as `ca-central-1`. Redeploying `citrus-api` there would put the API next to its database and cut each remaining round trip from tens of milliseconds to low single digits.

Cloud Run is stateless, so this is a redeploy with a region flag plus a Firebase Hosting rewrite update — not a migration. **I have not touched it**, because changing serving regions five days before a freeze is a decision, not a fix. But it is the single largest remaining latency item and it applies to production, not just draft night.

---

## ⑥ Verification — everything ran

The device VM kills any process at ~45 s, so I tarred both workspaces into my own container, installed them, and ran the suites properly.

| | |
|---|---|
| **web** | **110 files, 1,814 tests — all passing** |
| **server** | **56 files, 1,074 passing, 6 skipped** |
| new tests | `overlayPending` 16, `verifyAccessToken` 17 |
| untouched suites | `optimistic` 12, `v1Adapters` 20, all 3 `DraftRoomV2` suites 14 — still green, proving the additions are backwards-compatible |
| **mutation batteries** | **9 mutants, all killed** — 5 on the overlay, 4 on token verification |
| typecheck | zero new errors in any file I touched |

**One thing worth telling you about the mutation testing:** deleting the anon-key guard initially killed **no test**. My anon-key fixture had no `sub`, so the sub-check was silently doing all the work and the role guard was never exercised. I added three tests that isolate it. **A test suite that cannot fail is not a test suite** — that is exactly the class of gap that let E142 survive three days of certification.

---

## ⑦ Still open, honestly

- 🔴 **`player_directory` newest `updated_at` = 2026-08-06 — 5 d 21 h stale**, against your own *"stale > 24 h → POSTPONE"*. Complete (2,035 players, all 32 clubs), so low risk for an August draft — but it is your rule to refresh or waive.
- **156 pre-existing TypeScript errors** app-wide, and `vite build` does not typecheck. None are mine. Worth a CI gate on *new* errors after the freeze.
- **Initial JS payload: 339.6 kB gzipped** (charts are correctly lazy; the draft room is its own chunk). Respectable, not the bottleneck, and I did not touch chunking before a freeze.
- **`membershipMiddleware` on the pick route is arguably redundant** — `submit_pick_v2` already enforces team ownership via `auth.uid()`, which is strictly stronger than league membership. **I deliberately left it.** Its 30 s cache makes the steady-state saving ~0 ms, and removing an auth check for zero gain days before a freeze is a bad trade.
