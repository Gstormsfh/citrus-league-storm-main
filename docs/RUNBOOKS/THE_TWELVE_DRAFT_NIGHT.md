# THE TWELVE — draft night runbook

**Purpose.** Garrett runs THE TWELVE (12-human live draft on staging) from this one document under pressure. Every step is pre-scripted; every failure mode has a decision tree; every escalation has a ready-to-paste PowerShell block.

**Status.** AUTHORED 2026-08-08. Not yet field-exercised. First live use of this runbook = THE TWELVE itself. Pre-run dry-run walk-through is docketed as `docs/RUNBOOKS/PRE_TWELVE_DRY_RUN.md` (P9 companion).

**Pre-requisites (must ALL be green before starting):**
- [ ] F26 + F27 + F27b-1 deployed on staging (certified image `0ecbe605-draft @ sha256:152b79912cea9d80cf5c3147beeba48957973f5d201d54bdc9a3d6c429768a32` — see `docs/PROD_CHANGE_LEDGER.md` engine image pin table)
- [ ] F28 client landed on staging web build (deriveDraftState handles draft_started + draft_completed idempotent + monotonic)
- [ ] F27b-2 fix deployed (task #55, `c2f2ac91`) — pre-freeze Aug 17 target; check `git log` before draft night
- [ ] N-1 harness fix deployed (task #53, `8edbf002`) — clean `ordering-violations: 0` on the last STEP 5' rerun
- [ ] Rollback pin `0ecbe605-draft` armed in `docs/DEPLOY_PROTOCOL_F26_F27.md` §4b (verified by grep)
- [ ] Pre-twelve dry-run passed (see `docs/RUNBOOKS/PRE_TWELVE_DRY_RUN.md` — real commissioner-branch auth press, all asserts green)

---

## Phase 1 — league creation (T-60 min)

**Objective.** Fresh real league in staging, 12 seats, snake, 30s pick clock, ready for ignition.

### 1a. Create the league via the web UI

```powershell
# Open the staging web UI in a browser (Garrett's laptop):
# https://<staging-web-host>/leagues/new
# (Exact URL varies by staging env; check ../DEPLOY_PROTOCOL_F26_F27.md
# for the current staging domain.)
```

- Name: `THE TWELVE` (or a variant with date)
- Format: **snake**
- League size: 12
- Rounds: **12** (one round per team — smallest possible real draft for the FIRST live-human exercise; expand later)
- Pick clock: **30 seconds** (matches STEP 5' rig cadence)
- Commissioner: Garrett's own user
- **DO NOT invite users yet.** League is set up first; users join by shared link in Phase 2.

### 1b. Verify league columns in DB

Garrett runs from his workstation (SUPABASE_DB_URL in env):

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT id, name, league_size, draft_state, draft_status, draft_type, pick_deadline FROM public.leagues WHERE name LIKE 'THE TWELVE%' ORDER BY created_at DESC LIMIT 5;"
```

**Expected row:** `draft_state = 'not_started'`, `draft_status = 'not_started'`, `draft_type = 'snake'`, `league_size = 12`, `pick_deadline = NULL`.

**RECORD** the `id` (UUID) in a scratch note. It becomes `$LEAGUE_ID` for all subsequent commands.

### 1c. Verify draft_order rows

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT round_number, jsonb_array_length(team_order) as team_count FROM public.draft_order WHERE league_id = '<LEAGUE_ID>' AND deleted_at IS NULL ORDER BY round_number;"
```

**Expected:** 12 rows, each with `team_count = 12`. Snake reversal is encoded in the team_order array per round.

### 1d. Verify draft_events counter clean

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT draft_event_counter, (SELECT count(*) FROM public.draft_events WHERE league_id = '<LEAGUE_ID>') as event_count, (SELECT count(*) FROM public.draft_picks_v2 WHERE league_id = '<LEAGUE_ID>') as pick_count FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

**Expected:** `draft_event_counter = 0`, `event_count = 0`, `pick_count = 0`. Baseline for THE TWELVE.

---

## Phase 2 — user onboarding (T-30 min)

### 2a. Generate join link

- From the commissioner UI, generate the invite link.
- Share to the 12 participants via whatever channel (Discord, text).
- Users must sign up + join before Phase 3 begins.

### 2b. Verify all 12 teams present

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT id, team_name, owner_id FROM public.teams WHERE league_id = '<LEAGUE_ID>' ORDER BY created_at;"
```

**Expected:** 12 rows. Each has a non-null `owner_id` (means a user has joined + claimed the team).

If FEWER than 12: wait for stragglers. Do NOT ignite the draft with unclaimed teams — they'll be assigned to no user, and autopick will fire against them if the human doesn't show up in time.

### 2c. Verify pool of players is fresh

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT count(*) FROM public.player_directory WHERE season = '2025-26';"
```

**Expected:** > 500 (rough sanity — actual count varies by data freshness). If ZERO, data pipeline hasn't loaded — HALT the draft and escalate.

---

## Phase 3 — ignition (T-0)

**Objective.** Commissioner presses "Start Draft" → seq 1 draft_started event → all 12 clients see the draft go live.

### 3a. Commissioner presses Start

- Garrett clicks the "Start Draft" button in the commissioner UI.
- This calls the `start_draft_v2` RPC (F27, migration `20260807000000`).

### 3b. Verify ignition in DB

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT draft_state, draft_status, pick_deadline FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

**Expected within 2s of button press:** `draft_state = 'active'`, `draft_status = 'in_progress'`, `pick_deadline = <30s from now>`.

### 3c. Verify seq 1 draft_started event

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT seq, event_type, payload FROM public.draft_events WHERE league_id = '<LEAGUE_ID>' ORDER BY seq LIMIT 3;"
```

**Expected:** exactly 1 row, `seq = 1`, `event_type = 'draft_started'`, `payload` has `started_at`, `first_pick_deadline`, `total_rounds`, `total_teams`, `pick_time_limit_seconds`, `draft_format`.

### 3d. Verify all 12 client browsers see the room go live

- Ask each participant on the chat channel: "you see the clock counting down?"
- If any user says NO after 10 seconds:
  - Have them hard-refresh their browser tab (Ctrl+Shift+R / Cmd+Shift+R).
  - If STILL no: they hit a client bug OR a real WS reconnect. Escalate to F28 troubleshooting (see Section 6 below).

---

## Phase 4 — the draft (T+0 to T+~5-10 min per round × 12 rounds)

**Steady-state.** Nothing to do — the engine drives, humans pick, autopick fires if a clock expires.

### 4a. Watch the wire (optional situational awareness)

Garrett can tail engine logs on another terminal:

```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --follow --since 5m 2>&1" `
  | Select-String -Pattern 'external_event.applied|pick.processed|handleClockExpired|autopick_failed|F20|WARNING'
```

Green picks = `pick.processed` lines with `wasAutopick=false` (human) or `wasAutopick=true` (autopick fired).

### 4b. Presence + participation dashboard

For a quick "is everyone still connected" check:

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT count(*) as picks_in_v2, (SELECT count(*) FROM public.draft_events WHERE league_id = '<LEAGUE_ID>') as total_events, (SELECT pick_deadline FROM public.leagues WHERE id = '<LEAGUE_ID>') as current_deadline FROM public.draft_picks_v2 WHERE league_id = '<LEAGUE_ID>';"
```

Compare `picks_in_v2` count against elapsed time × expected pace. If way behind — clock stalled (see 6a).

---

## Phase 5 — completion (T+~2 hrs)

### 5a. Verify completion

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT draft_state, draft_status, pick_deadline, draft_event_counter FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

**Expected:**
- `draft_status = 'completed'`
- `draft_state = 'completed'` (post-N-2 deploy; pre-N-2 it stays 'active' — cosmetic but log it)
- `pick_deadline = NULL`
- `draft_event_counter = 145` (1 draft_started + 12 teams × 12 rounds picks + 1 draft_completed = 146; verify math for THE TWELVE's actual config)

### 5b. Verify all clients saw the completion frame (F26/F28)

- Every browser tab shows the "Draft complete" banner (F28 UI at `DraftRoomV2.tsx:707-721`).
- If any browser is stuck showing the clock (not the completion banner), instruct user to hard-refresh — the frame may have landed but a client-side React glitch didn't render.

### 5c. Post-draft evidence capture

Save the following to a dated folder for the post-mortem:

```powershell
$evidenceDir = "docs\RUNBOOKS\evidence\THE_TWELVE_$(Get-Date -Format 'yyyy-MM-dd')"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

# 1. All events for the league (with timestamps)
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT seq, event_type, created_at, payload FROM public.draft_events WHERE league_id = '<LEAGUE_ID>' ORDER BY seq;" `
  > "$evidenceDir\draft_events.txt"

# 2. All picks (join with player_directory for names)
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT p.pick_number, p.round_number, t.team_name, p.player_id, pd.player_name FROM public.draft_picks_v2 p LEFT JOIN public.teams t ON t.id = p.team_id LEFT JOIN public.player_directory pd ON pd.player_id::text = p.player_id::text WHERE p.league_id = '<LEAGUE_ID>' ORDER BY p.pick_number;" `
  > "$evidenceDir\draft_picks.txt"

# 3. Engine log for the draft window (approx duration)
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --since 3h 2>&1" `
  > "$evidenceDir\engine_log.txt"
```

Commit the evidence folder to the repo (or a separate archive per team preference).

---

## Section 6 — failure decision trees (KEEP HANDY DURING DRAFT)

Each subsection: symptom → diagnostic step → escalation.

### 6a. Clock stalled (nobody's on the clock, no autopick fires)

**Symptom.** All 12 clients see the clock at 0:00 with "Awaiting server…" for > 30 seconds.

**Step 1 — verify from DB:**
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT draft_status, pick_deadline, pick_deadline < now() as expired FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

If `expired = true` AND `draft_status = 'in_progress'` AND no new pick in DB for > 60s → engine autopick did not fire.

**Step 2 — check engine logs for the last minute:**
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --since 2m 2>&1 | grep -E 'handleClockExpired|autopick|F20|WARNING|ERROR'"
```

Look for:
- **`autopick_failed`** → autopick strategy exception. Escalate: root cause needed before restart. **PAUSE the draft in DB manually if possible** (see 6d).
- **`clock fired but draftStatus=completed`** → F20 guard absorbed a stray timer. Should be self-healing.
- **NO recent `handleClockExpired`** → engine's timer never fired. Almost certainly the F27b-2 class OR a container crash. Go to Step 3.

**Step 3 — check container is alive:**
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker ps --filter name=citrus-draft-engine --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}'"
```

If STATUS is "Restarting" or "Exited", or RunningFor differs from expected uptime → container crashed. **Container restart procedure:**

```powershell
# Restart the container in-place (startup script re-pulls if metadata says new tag,
# but for a crash-restart we just want the current tag back up)
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo systemctl restart docker"
```

Wait 30s. Verify:
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --tail=50 2>&1 | grep -E 'deployment.fingerprint|hono.listening|uws.listening|event_subscription.started|LobbyRegistry'"
```

Should see the 9 boot items land (per `docs/DEPLOY_PROTOCOL_F26_F27.md` §1 corrected vocabulary). If YES, tell participants to hard-refresh; clients reconnect via WS resume protocol and autopick should fire within one pick clock.

**If NO** — VM might be sick. Escalate to VM restart (6b).

### 6b. VM restart (nuclear option — do only if 6a Step 3 restart didn't fix)

```powershell
gcloud compute instances reset citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet
```

Wait 60s. Boot verification:
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --tail=200 2>&1"
```

Full 9-item boot verification per `docs/DEPLOY_PROTOCOL_F26_F27.md` §1. If ANY item missing after 60s AND another 30s refetch → ROLLBACK per 6c.

### 6c. Rollback (nuclear+ option — do only if 6b VM restart didn't fix)

Retarget to previous-good image:

```powershell
# Retag PRIOR_TAG -> :latest so startup script re-pulls old image
gcloud artifacts docker tags add `
  northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:0ecbe605-draft `
  northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:latest `
  --quiet

# Metadata revert BEFORE reset
gcloud compute instances add-metadata citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a `
  --metadata="image-tag=0ecbe605-draft,commit-sha=0ecbe605" `
  --quiet
gcloud compute instances remove-metadata citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a `
  --keys=image-sha --quiet

# Reset the VM
gcloud compute instances reset citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet
```

**⚠ ROLLBACK PIN IS `0ecbe605-draft`.** DO NOT roll back to `8b7b43f6-draft` — its full digest is unrecorded and the older image PREDATES F26 (draft_completed silent) + F27 (Commissioner Start) + F27b-1 (bootstrap replay dispatch). Rolling that far breaks THE TWELVE entirely.

If the rollback target (`0ecbe605-draft`) is itself the current problem, DEPLOY A NEW BUILD from the current phase-4-5-implementation HEAD — do NOT descend further into the pin chain.

### 6d. Draft pause (buys diagnostic time without ending the run)

If Section 6a-6c is going to take > 5 min AND you don't want to lose the draft:

```powershell
# Pause the draft via RPC (marks state='paused', clears pick clock)
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT public.draft_pause('<LEAGUE_ID>'::uuid, 'diagnostic — engine issue');"
```

Post-pause: clients see the pause state; timer is dead but state is preserved. When ready to resume:

```powershell
# Resume with a fresh pick clock
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT public.draft_resume('<LEAGUE_ID>'::uuid);"
```

### 6e. Client-side glitch (one user stuck, others fine)

**Symptom.** One user says "my room is broken/blank/frozen." Other 11 users are fine.

**Step 1.** Have them hard-refresh (Ctrl+Shift+R). Most transient client bugs clear.

**Step 2.** Check their browser console (F12) for red errors. Have them screenshot + share.

**Step 3.** If still broken AND you can proceed with 11: proceed. Their team autopicks. Debug post-draft.

**Step 4.** If broken AND their pick is imminent AND they can't recover: use commissioner override to make the pick for them (via the commissioner UI or the `commissioner_override` RPC).

### 6f. Everyone's browser gets disconnected simultaneously

**Symptom.** All 12 users report "reconnecting…" or blank screen at the same time.

**Likely cause.** Either:
- Engine crashed → go to 6a Step 3.
- WS termination sidecar (Caddy) crashed → check:
  ```powershell
  gcloud compute ssh citrus-draft-engine-staging `
    --zone=northamerica-northeast1-a --quiet `
    --command="sudo docker ps --filter name=citrus-caddy --format 'table {{.Names}}\t{{.Status}}'"
  ```
- Network partition on the VM → escalate to VM restart (6b).

If engine is fine + Caddy is fine: hardest case, likely LISTEN/NOTIFY disruption (rare). Check:
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --since 2m 2>&1 | grep -E 'event_subscription|LISTEN|reconnect'"
```

Reconnect activity is normal; PERSISTENT reconnect loops mean the DB connection is unhealthy. Escalate to Supabase status page + docs/RUNBOOKS/draft-engine-v2-known-issues.md KI-E010.

### 6g. Commissioner double-press on Start Draft button

**Symptom.** Garrett clicks "Start Draft" twice (finger slip, or first click didn't register visually).

**Expected engine behavior (start_draft_v2 idempotency).** The RPC has an idempotency short-circuit at Step 0 (migration `20260807000000_start_draft_v2.sql`, key-only compare because payload has now()-derived fields). Second press with the same session's idempotency_key returns the first press's result — NO second draft_started event, NO second timer arm.

**If second press uses a DIFFERENT idempotency_key** (browser tab reload between clicks): Step 1 preflight taxonomy fires — `draft_state='active'` already → returns error "illegal combo (already in_progress)" per Rider 1 taxonomy. Commissioner UI displays a toast; no state corruption.

**Action.** Verify seq 1 draft_started event count via `psql "$env:SUPABASE_DB_URL" -c "SELECT count(*) FROM public.draft_events WHERE league_id = '<LEAGUE_ID>' AND event_type = 'draft_started';"` — expected: EXACTLY 1. If > 1, engine idempotency broke and this is a bug worth escalating post-draft.

### 6h. Late joiner (user arrives after Phase 3)

**Symptom.** User connects to the draft room after ignition + several picks have landed.

**Expected client behavior.** New WS connection → snapshot delivered with `recentEvents` (up to 200 most recent events per RingBuffer capacity). Client's deriveDraftState re-derives from snapshot → correct in_progress state + on-clock team.

**Action.** No commissioner action needed. Confirm the user's UI shows the correct current pick number matches the DB via:
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT count(*) FROM public.draft_picks_v2 WHERE league_id = '<LEAGUE_ID>';"
```
Ask user "what pick are you seeing?" — should match count + 1 (the next pick).

**Failure mode: snapshot missing 200+ events back.** If draft has advanced past the ring buffer's oldest event, the late joiner's fold could gap-halt. Runner's `requestResyncForGap` fires, fetches missing events via HTTP, resumes fold. Should self-heal within ~2 seconds. If NOT self-healing, hard-refresh browser.

### 6i. F27b-2 duplicate frame (pre-fix; documented for post-close awareness)

**Symptom (pre-F27b-2 deploy).** UI's Recent-events pane shows duplicate "Draft started" line entries.

**Expected client-derivation behavior.** deriveDraftState's outer seq-idempotency guard at `:181` skips duplicate seq → status correct, no double-flip. Only the Recent-events pane display is affected (F28-L4 cosmetic docketed).

**Action.** Cosmetic only, no operational impact. Verify draft is otherwise proceeding correctly.

**Post-F27b-2 deploy (task #55):** this class shouldn't happen. Engine's `bootstrapFullEventReplay` advances cursor to prevent re-fetch of already-applied events.

### 6j. Autopick storm (multiple picks in rapid succession)

**Symptom.** Multiple team clocks expire in quick succession (e.g., all humans miss their picks for a stretch); engine autopicks land back-to-back at ~1s intervals or faster.

**Expected engine behavior.** F20 identity+wallclock guards on `handleClockExpired` prevent double-firing. Each autopick fires cleanly with `driftFromDeadlineMs` bounded. Wire fanout at ≤200ms broadcast to all clients per Performance Mandate.

**Action.** No commissioner action. Observability check:
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --since 30s 2>&1 | grep -E 'handleClockExpired|F20|autopick' | tail -20"
```

Any `F20 WARNING clock fired but draftStatus=X` lines? Expect zero — if any, log for post-mortem but do NOT interrupt the draft (F20 guard absorbs cleanly by design).

### 6k. Player pool empty / stale mid-draft

**Symptom.** Autopick fires but engine logs `autopick_failed: no candidates`.

**Root cause (rare).** `player_directory` for current season is empty OR every remaining player was already picked (impossible in a normal draft; suggests data-corruption OR the pool was miscalibrated).

**Action.**
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT count(*) FROM public.player_directory WHERE season = '2025-26' AND player_id NOT IN (SELECT player_id::text::int FROM public.draft_picks_v2 WHERE league_id = '<LEAGUE_ID>');"
```

If < number of remaining picks: pool is exhausted. **PAUSE the draft (6d) immediately.** Escalate to data-pipeline owner.

### 6l. TLS / cert failure (Caddy)

**Symptom.** All clients show "connection refused" or SSL/TLS errors on browser page load. HTTP works, HTTPS doesn't.

**Diagnosis.**
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-caddy --tail=100 2>&1 | grep -iE 'error|fail|renew'"
```

Look for Let's Encrypt renewal failures. Rate limit exceeded → cert can't renew → connections fail.

**Action.**
- If renewal failed due to rate limit: the previous cert is still valid (usually 90 days from issue). Confirm cert expiry via `curl -Iv https://<draft-domain>` — check `expire date` in cert output.
- If renewal failed for other reasons: `sudo docker restart citrus-caddy` on the VM (via SSH). Caddy retries on start.

**Escalation if cert genuinely expired mid-draft.** PAUSE the draft (6d), issue temporary cert via `certbot` from another VM, swap it into Caddy's volume, restart Caddy. Beyond the scope of THE TWELVE runbook — needs Caddy operator familiarity.

### 6m. Phone dies mid-pick (single user)

**Symptom.** User's phone / laptop dies while they're on the clock.

**Expected engine behavior.** Their clock expires → engine autopicks their slot with the best-available player per autopickStrategy. Draft continues.

**Action.** None needed. Post-draft, apologize to the user and consider offering a commissioner-override to reallocate. Do NOT interrupt the draft mid-flight.

---

## Section 7 — post-draft (T+~2 hrs)

### 7a. Announce completion in the chat channel

"Draft complete — refresh your browser to see the completion banner + follow the link to your roster. Post-mortem in 30 min."

### 7b. Save evidence (see 5c above)

### 7c. File the ledger entry

Update `docs/PROD_CHANGE_LEDGER.md` "Engine image pin table" with a note that image `0ecbe605-draft` was used for THE TWELVE + any observations that would matter for future certifications.

Update `docs/REGISTRY.md` with any NEW KIs surfaced during the draft.

Update `docs/INSTRUMENT_LEDGER.md` with any instrument-level findings.

### 7d. Retire the fixture-12-f27-native league file (optional cleanup)

The staging fixtures state file (`scripts/proof/fixture-12-f27-native-state.local.json`) can accumulate stale references. If the file exists and its LEAGUE_ID is no longer needed:

```powershell
# Non-destructive: just note the current league UUID before overwriting
Get-Content scripts\proof\fixture-12-f27-native-state.local.json
# If cleanup desired:
# node scripts/proof/fixture-12-f27-native.local.mjs --reset --execute
```

---

## Appendix A — quick-reference commands

Copy-paste from here during draft night. Every command below is safe to run under pressure (no destructive defaults).

**League snapshot (all fields at once):**
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -c "SELECT id, draft_state, draft_status, pick_deadline, draft_event_counter FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

**Recent events (last 10):**
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -c "SELECT seq, event_type, created_at FROM public.draft_events WHERE league_id = '<LEAGUE_ID>' ORDER BY seq DESC LIMIT 10;"
```

**Engine health probe:**
```powershell
gcloud compute ssh citrus-draft-engine-staging --zone=northamerica-northeast1-a --quiet --command="curl -s http://localhost:3001/health"
```

**Container uptime:**
```powershell
gcloud compute ssh citrus-draft-engine-staging --zone=northamerica-northeast1-a --quiet --command="sudo docker ps --filter name=citrus-draft-engine --format '{{.Status}}'"
```

**Tail last 100 log lines:**
```powershell
gcloud compute ssh citrus-draft-engine-staging --zone=northamerica-northeast1-a --quiet --command="sudo docker logs citrus-draft-engine --tail=100 2>&1"
```

---

## Appendix B — what NOT to do under pressure

- **Do NOT run `gcloud compute instances delete`** — nukes the VM + all state. Recovery = full redeploy.
- **Do NOT drop tables** — obvious but under pressure people do dumb things.
- **Do NOT push a new engine image DURING the draft** — deploy cycle takes ~5 min minimum; window without service is catastrophic mid-draft. If a fix is needed, PAUSE the draft (6d) first, then deploy under normal §15.14 procedure, then resume.
- **Do NOT skip the DEPLOY_PROTOCOL boot verification if you deploy anything** — false-green risk (INS-16) is real.
- **Do NOT bypass RLS with service-role key from the client** — CLAUDE.md standing rule.

---

## Appendix C — who to page

- Garrett is on-call for THE TWELVE. This document is HIS document.
- Terminal (Claude) is reachable for real-time diagnostic assist BUT does NOT execute prod commands (standing rule `feedback_hand_off_infra_commands.md`).
- Architect is reachable for structural decisions (rollback vs pause, etc.).

Nothing to page a 3rd party for. If Supabase itself is down, monitor status.supabase.com.

---

**Sign-off.** This runbook was authored 2026-08-08 in author-only mode under the unattended-day directive (`docs/DAY_DIRECTIVE_2026-08-08.md`). Not yet field-tested. First live exercise = THE TWELVE itself. Post-draft, add a "Section D — lessons learned" appendix.
