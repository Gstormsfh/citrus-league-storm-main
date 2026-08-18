# THE TWELVE — draft night runbook (v2)

**Version.** v2 merged 2026-08-09 (Entry 17 O5 reconciliation). v1 superseded.
**Purpose.** Garrett runs THE TWELVE (12-human live draft on staging) from this one document under pressure. Human timeline is the spine; technical trees are the organs.
**Reconciliation source.** Two blind-authored plans (terminal + architect) diverged in 11 adjudicated findings. Architect's T-3d→T+1h arc wins the structural spine (real humans need days, not an hour); terminal's SQL verifies + 13 trees + escalation ladder + appendices win the technical organs. Both merged.
**Standing rule reminder.** All commands are Garrett-executable. Terminal does not execute these.

---

## Pre-requisites (all must be green ≥ 48 hrs before draft night)

- [ ] F26 + F27 + F27b-1 deployed on staging (certified image `0ecbe605-draft @ sha256:152b79912cea9d80cf5c3147beeba48957973f5d201d54bdc9a3d6c429768a32` — see `docs/PROD_CHANGE_LEDGER.md`)
- [ ] F28 client landed on staging web (deriveDraftState handles draft_started + draft_completed idempotent + monotonic)
- [ ] F27b-2 fix deployed (task #55) — pre-freeze Aug 17 target; verify by `git log` before draft night. **NOTE:** if the Sunday Group A deploy has landed the F27b-2 image, this note in §6i is stale — see §6i's post-Group-A footnote below.
- [ ] N-1 harness fix deployed (task #53) — clean `ordering-violations: 0` on the last STEP 5' rerun
- [ ] Rollback pin `0ecbe605-draft` armed in `docs/DEPLOY_PROTOCOL_F26_F27.md` §4b
- [ ] Pre-twelve dry-run passed (`docs/RUNBOOKS/PRE_TWELVE_DRY_RUN.md` — real commissioner-branch auth press, all asserts green)
- [ ] Sunday deploy blocks executed cleanly (`docs/RUNBOOKS/SUNDAY_EXECUTION_BLOCKS.md` — Group A engine + Group B N-2 + Group C web all green)

---

## Human timeline (spine) — T-3d → T+1h

### T-3d — league creation + participant onboarding starts

**Objective.** Real humans need days, not an hour. Two of your twelve are non-technical; two are on mobile; expect DMs during dry-run week.

- **Commissioner creates the league in staging web UI** (`https://<staging-web-host>/leagues/new`).
  - Name: `THE TWELVE` (or dated variant).
  - Format: **snake**.
  - League size: **12**.
  - Rounds: **12** (one round per team — smallest possible real draft for the FIRST live-human exercise).
  - Pick clock: **30 seconds** (matches STEP 5' rig cadence).
  - Commissioner: Garrett's own user.
- **Generate the invite link + broadcast** via Discord/text/email.
- **Post-share message template:** "Draft is [DATE] at [TIME]. Please claim your team NOW (link above) — no rush. If you have issues, message me by [T-2d date]. Test your device + browser + WiFi tonight if you can."
- **Verify columns land** (technical organ, see §T3v below).

### T-2d — join drift + team-count check

- **Human check** ("who's in?"): DM every participant who hasn't joined. Two rounds of DMs, one at T-2d morning and one at T-2d evening.
- **Technical organ:** verify team count.

  ```powershell
  psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
    -c "SELECT count(*) FROM public.teams WHERE league_id = '<LEAGUE_ID>' AND owner_id IS NOT NULL;"
  ```

  Expected: 12. If < 12 by T-1d evening → **GO/NO-GO trigger** (see §Rain triggers below).

### T-1d — dry-run + go/no-go decision

- **Pre-twelve dry-run** (`docs/RUNBOOKS/PRE_TWELVE_DRY_RUN.md`) with 2 test-user browsers + commissioner. Real commissioner-branch auth press against staging. All assertions green.
- **Rain triggers evaluated (GO/NO-GO):**
  - **NO-GO if any of:** team count < 12; dry-run reveals a red-line technical issue; ≥ 2 participants have unresolved device/browser blockers; any pre-req checkbox above is unchecked.
  - **AUTHORITY:** Garrett makes the call. This document is HIS document.
  - **Postponement message template:** "Draft postponed to [NEW DATE] due to [reason]. New link stays the same; no re-onboarding needed. See you [DATE]."

### T-60m — sync + reminder

- **Broadcast reminder to all 12** in the chat channel.
- **Verify data-pipeline pool is fresh** (§T60v).
- **Open engine-log tail on second terminal** (§4a).
- **Have SUPABASE_DB_URL loaded in ready shell** for the SQL organs.

### T-0 — commissioner press Start

- **Garrett clicks "Start Draft"** in the commissioner UI (F27 wire-up — the button that exists end-to-end as of 2026-08-08).
- Behind the scenes: `useStartDraftFull` runs the two-step (existence-check re-run guard → initializeDraftOrder → `start_draft_v2` RPC).
- **Verify ignition landed** (§3v).

### T+0 → T+2h — steady state

- **Human-layer** — nothing to say in the chat unless something is wrong. Silence = health.
- **Watch the wire** (optional, §4a).
- **20-minute ceiling doctrine** — if a problem takes longer than 20 minutes to resolve, PAUSE the draft (§6d) and resume when fixed. **Resume, not restart.** The event log preserves state; a pause+resume is faster than any "reset the room" scenario. Do NOT ask 12 humans to start over.

### T+~2h — completion

- **Verify completion in DB** (§5a).
- **Confirm all clients saw the completion banner** (F28 UI, T13 CompletionMomentBanner).
- **Announce completion** in the chat channel: "Draft complete — refresh your browser to see the completion banner + follow the link to your roster."

### T+1h post-completion

- **Post-draft evidence capture** (§5c).
- **Post-mortem thread** in the chat channel: what worked, what didn't, ideas for the next one.
- **Ledger updates** — engine image pin table, REGISTRY, INSTRUMENT_LEDGER.

---

## Rain triggers (all cause postponement, none cause rollback)

**GO/NO-GO evaluated at T-1d (in dry-run debrief) and T-1h (final gate):**

1. **Team count < 12.** No autopicked stranger teams; postpone.
2. **Dry-run technical red-line** (any of: engine boot verify fails, N-2 apply un-cleaned, web deploy shows dead links).
3. **≥ 2 participants blocked** (device / browser / WiFi issues unresolved).
4. **Any pre-req checkbox unchecked** — treated as automatic postpone.
5. **Data pipeline stale > 24h** (§T60v shows count = 0 OR season mismatch).
6. **Weather / power / life** — Garrett's judgment. This is a game, not a launch.

**No rollback triggers here** — those live in `docs/DEPLOY_PROTOCOL_F26_F27.md §7`, and they fire mid-deploy, not mid-draft.

---

## Technical organs — SQL verifies + boot-time gates

### §T3v — post-creation column verify (runs at T-3d after league is created)

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT id, name, league_size, draft_rounds, draft_state, draft_status, settings->>'draftType' AS draft_type, pick_deadline FROM public.leagues WHERE name LIKE 'THE TWELVE%' ORDER BY created_at DESC LIMIT 5;"
```

**Expected row:** `draft_state = 'not_started'`, `draft_status = 'not_started'`, `draft_type = 'snake'`, `league_size = 12`, `draft_rounds = 21`, `pick_deadline = NULL`. **RECORD** the `id` (UUID) as `$LEAGUE_ID` for all subsequent commands.

> ⚠️ **CORRECTED 2026-08-12 (E166).** This query previously selected `draft_type` as a column. **There is no `leagues.draft_type`** — it errors (`column l.draft_type does not exist`). Draft type lives in `settings->>'draftType'`. `draft_rounds` added because §5a's completion math depends on it.

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT round_number, jsonb_array_length(team_order) as team_count FROM public.draft_order WHERE league_id = '<LEAGUE_ID>' AND deleted_at IS NULL ORDER BY round_number;"
```

**Expected:** one row per round — **21 rows for a 12×21 league**, each with `team_count = 12`. Snake reversal is encoded in the team_order array per round. *(Corrected E166: previously said 12 rows, which is only right for a 12-round draft.)*

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT draft_event_counter, (SELECT count(*) FROM public.draft_events WHERE league_id = '<LEAGUE_ID>') as event_count, (SELECT count(*) FROM public.draft_picks_v2 WHERE league_id = '<LEAGUE_ID>') as pick_count FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

**Expected:** `draft_event_counter = 0`, `event_count = 0`, `pick_count = 0`.

### §T60v — T-60m player-pool freshness

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT count(*), MIN(updated_at) as oldest, MAX(updated_at) as newest FROM public.player_directory WHERE season = 2025;"
```

**Expected:** count > 500 (staging held **2,035** on 2026-08-12). If ZERO, data pipeline hasn't loaded — HALT + escalate.

> ⚠️ **CORRECTED 2026-08-12 (E166).** `player_directory.season` is an **integer** (`2025`), not the string `'2025-26'`. The old form errored with `invalid input syntax for type integer` — **at T-60m, on the go/no-go check.**
>
> 🔴 **And read this before Aug 20:** as of 2026-08-12 the newest `updated_at` in `player_directory` is **2026-08-06 — six days old.** Under the original "stale > 24h → POSTPONE" rule this check would fail on the night. Either the pipeline needs a run before Aug 20, or this threshold needs to reflect how often it actually refreshes. **Player data is the other session's lane — flagging, not touching.**

### §3v — ignition verify (T-0, within 2s of button press)

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT draft_state, draft_status, pick_deadline FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

**Expected:** `draft_state = 'active'`, `draft_status = 'in_progress'`, `pick_deadline = <30s from now>`.

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT seq, event_type, payload FROM public.draft_events WHERE league_id = '<LEAGUE_ID>' ORDER BY seq LIMIT 3;"
```

**Expected:** exactly 1 row, `seq = 1`, `event_type = 'draft_started'`, `payload` has `started_at`, `first_pick_deadline`, `total_rounds`, `total_teams`, `pick_time_limit_seconds`, `draft_format`.

### §4a — wire-tail during steady state

```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --follow --since 5m 2>&1" `
  | Select-String -Pattern 'external_event.applied|pick.processed|handleClockExpired|autopick_failed|F20|WARNING'
```

Green picks = `pick.processed` lines with `wasAutopick=false` (human) or `wasAutopick=true` (autopick fired).

### §4b — presence + pace dashboard

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT count(*) as picks_in_v2, (SELECT count(*) FROM public.draft_events WHERE league_id = '<LEAGUE_ID>') as total_events, (SELECT pick_deadline FROM public.leagues WHERE id = '<LEAGUE_ID>') as current_deadline FROM public.draft_picks_v2 WHERE league_id = '<LEAGUE_ID>';"
```

### §5a — completion verify

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT draft_state, draft_status, pick_deadline, draft_event_counter FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

**Expected:**
- `draft_status = 'completed'`
- `draft_state = 'completed'` (post-N-2 deploy; pre-N-2 it stays 'active' — cosmetic but log it)
- `pick_deadline = NULL`
- `draft_event_counter` = **1 + (league_size × draft_rounds) + 1**. **Read `draft_rounds` off the league — do not trust a number written here.** For the **12 rounds** this runbook's T-3d section tells you to create, that is **146**. For 21 rounds it is 254.

  > ⚠️ **E166 changed this to 254 and E171 changed it back to a formula. My error, worth stating:** §T-3d instructs creating THE TWELVE with **Rounds: 12** — *"one round per team, smallest possible real draft for the FIRST live-human exercise"* — a deliberate choice, and 146 was correct for it. I assumed 21 because that is the product default and what every architect soak rig used. **The round count is Garrett's decision at creation time; the formula is right either way.** A 12-round draft is ~2 hours at a 30s clock; 21 rounds is closer to 3.5. That is the real trade-off, and it is his.

### §5c — post-draft evidence capture

> ⚠️ **CORRECTED 2026-08-12 (E166).** The picks export referenced `p.round_number` and `pd.player_name`; the real columns are **`p.round`** and **`pd.full_name`**. It also joined on `player_id::text` without a season predicate. Both errored as written.

```powershell
$evidenceDir = "docs\RUNBOOKS\evidence\THE_TWELVE_$(Get-Date -Format 'yyyy-MM-dd')"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT seq, event_type, created_at, payload FROM public.draft_events WHERE league_id = '<LEAGUE_ID>' ORDER BY seq;" `
  > "$evidenceDir\draft_events.txt"

psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT p.pick_number, p.round, t.team_name, p.player_id, pd.full_name FROM public.draft_picks_v2 p LEFT JOIN public.teams t ON t.id = p.team_id LEFT JOIN public.player_directory pd ON pd.player_id = p.player_id AND pd.season = 2025 WHERE p.league_id = '<LEAGUE_ID>' ORDER BY p.pick_number;" `
  > "$evidenceDir\draft_picks.txt"

gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --since 3h 2>&1" `
  > "$evidenceDir\engine_log.txt"
```

---

## Failure decision trees (13 trees, pause-first doctrine)

**Escalation ladder** (inside the 20-min ceiling): 6a → 6b → 6c → 6d → 6R. If any step in the ladder crosses 5 min AND draft is time-sensitive, jump to §6d (draft pause) FIRST, then work the rest. If total wall-clock exceeds 20 min: §6d + declare a NEW resume time in the chat channel. **RESUME, not restart.**

### 6a. Clock stalled (nobody's on the clock, no autopick fires)

**Symptom.** All 12 clients see the clock at 0:00 with "Awaiting server…" for > 30 seconds.

**Step 1 — DB verify:**
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT draft_status, pick_deadline, pick_deadline < now() as expired FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

If `expired = true` AND `draft_status = 'in_progress'` AND no new pick in DB for > 60s → engine autopick did not fire.

**Step 2 — engine log check:**
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-draft-engine --since 2m 2>&1 | grep -E 'handleClockExpired|autopick|F20|WARNING|ERROR'"
```

Look for:
- **`autopick_failed`** → autopick strategy exception. Escalate: root cause needed before restart. **PAUSE the draft (6d) first** so time isn't lost.
- **`clock fired but draftStatus=completed`** → F20 guard absorbed a stray timer. Should be self-healing.
- **NO recent `handleClockExpired`** → engine's timer never fired. Almost certainly the F27b-2 class OR a container crash. Go to Step 3.

**Step 3 — container liveness:**
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker ps --filter name=citrus-draft-engine --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}'"
```

If STATUS is "Restarting" or "Exited", or RunningFor differs from expected uptime → container crashed. **6d pause FIRST, then restart:**

```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo systemctl restart docker"
```

Wait 30s. Verify boot log (§A-6 boot vocabulary from SUNDAY_EXECUTION_BLOCKS.md). If green: tell participants to hard-refresh; clients reconnect via WS resume; autopick should fire within one pick clock. Resume via §6d.

**If NO** — escalate to 6b (VM restart).

### 6b. VM restart (nuclear option — do only if 6a Step 3 restart didn't fix)

```powershell
gcloud compute instances reset citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet
```

Wait 60s. Boot verification per §A-6 in SUNDAY_EXECUTION_BLOCKS.md. If ANY item missing after 60s AND another 30s refetch → **ROLLBACK per 6c**.

### 6c. Rollback (nuclear+ option)

Full rollback command block lives in `docs/RUNBOOKS/SUNDAY_EXECUTION_BLOCKS.md §A-R` — three commands (retag → metadata revert → reset). Rollback pin: `0ecbe605-draft`. Do NOT roll to `8b7b43f6-draft` (predates F26/F27).

### 6d. Draft pause (buys diagnostic time — USE EARLY, not late)

**Pause-first doctrine.** If Section 6a-6c is going to take > 5 min, PAUSE FIRST. The draft is a live human event; wall-clock latency during diagnosis costs more than a pause does.

> ⚠️ **CORRECTED 2026-08-12 (inbox E165).** The commands previously printed here were wrong on both counts and would have errored at the moment you needed them: the second argument is **`jsonb`**, not text, and it **must** carry `"kind":"commissioner"` or the function raises `unauthorized`. `draft_resume` takes the same second argument — the one-argument form does not exist. Verified signatures below. Full detail: **§E13**.

```sql
SELECT public.draft_pause(
  '<LEAGUE_ID>'::uuid,
  '{"kind":"commissioner","id":"<YOUR_USER_UUID>","reason":"diagnostic"}'::jsonb
);
```

**Post-pause: nobody gets auto-drafted, and a manager who tries to pick is told why.** But **the room does NOT show a paused state** — clocks run down to 0:00 and sit there with no explanation (verified E159). So the announcement is not optional:

> *"I'm pausing the draft. Your clock will look stuck at zero — that's expected, nobody gets auto-picked. I'll say when we're back."*

When ready to resume:
```sql
SELECT public.draft_resume(
  '<LEAGUE_ID>'::uuid,
  '{"kind":"commissioner","id":"<YOUR_USER_UUID>"}'::jsonb
);
```

Resume gives everyone a **fresh full clock**, not the seconds that were left. Announce: "Resuming now — you have a full clock." 

### 6e. Client-side glitch (one user stuck, others fine)

**Symptom.** One user says "my room is broken/blank/frozen." Other 11 are fine.

1. Hard-refresh (Ctrl+Shift+R). Most transient client bugs clear.
2. Browser console (F12) → red errors → screenshot + share.
3. If still broken AND you can proceed with 11: proceed. Their team autopicks. Debug post-draft.
4. If broken AND their pick is imminent AND they can't recover: commissioner override via UI or `commissioner_override` RPC.

### 6f. Everyone's browser gets disconnected simultaneously

**Symptom.** All 12 users report "reconnecting…" or blank screen at the same time.

**Diagnosis.** WS layer or the Caddy/TLS layer failed. Check §6l first (cert), then Caddy container logs. If Caddy is up: check engine's uWS port (`curl` from the VM to `localhost:3002`).

**Action.** §6d pause; §6l for cert; if Caddy is fine, §6a for engine.

### 6g. Autopick fires while user is actively typing

**Symptom.** User complains: "I was about to draft [player]! Why did autopick take him?"

**Diagnosis.** Their submit was too close to the clock expiry — autopick RPC fired first (or their submit hit `pick_out_of_order` — F11 semantic).

**Action.** No commissioner action mid-draft. Post-draft: check engine logs for their `handleClockExpired` timing; if genuinely a race, apologize + note for autopick-cascade tuning docket.

### 6h. Pick number desync (one client shows the wrong pick number)

**Symptom.** One user's room shows "Pick 8 of 144" while others show "Pick 9 of 144."

**Action.** Have them hard-refresh (Ctrl+Shift+R). WS resume protocol re-syncs from the current snapshot. Should recover within 5s.

### 6i. Bootstrap replay stale-state warning (F27b-2 territory)

**Post-Sunday-Group-A footnote (2026-08-09 Entry 17 O5 update):** if the Sunday Group A deploy has landed the F27b-2 fix (task #55, commit `c2f2ac91` or later), this class SHOULD NOT trigger. The engine's `bootstrapFullEventReplay` advances cursor to prevent re-fetch of already-applied events. Presence of this warning post-Group-A is a REGRESSION and warrants immediate investigation.

**Pre-Sunday-Group-A behavior (LEGACY, retained for historical context):** engine log emitted `draft_started_apply.skipped_stale_status` — F27b-2 belt-and-suspenders WARN. Cosmetic; no operational impact.

**Action if triggered post-Group-A:** capture the log line + full context. §6d pause. Investigate whether the deploy actually installed the fix (compare running image sha to expected).

### 6j. Autopick storm (multiple picks in rapid succession)

**Symptom.** Multiple team clocks expire in quick succession; engine autopicks land back-to-back at ~1s intervals.

**Expected engine behavior.** F20 identity+wallclock guards on `handleClockExpired` prevent double-firing. Each autopick fires cleanly. Wire fanout ≤200ms broadcast to all clients per Performance Mandate.

**Action.** No commissioner action. Log check for any `F20 WARNING clock fired but draftStatus=X` lines. Expect zero.

### 6k. Player pool empty / stale mid-draft

**Symptom.** Autopick fires but engine logs `autopick_failed: no candidates`.

**Root cause.** `player_directory` for current season is empty OR every remaining player was already picked (data-corruption OR pool miscalibration).

**Action.**
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT count(*) FROM public.player_directory WHERE season = '2025-26' AND player_id NOT IN (SELECT player_id::text::int FROM public.draft_picks_v2 WHERE league_id = '<LEAGUE_ID>');"
```

If < number of remaining picks: pool is exhausted. **§6d PAUSE immediately.** Escalate to data-pipeline owner. Do NOT resume until pool is verified populated.

### 6l. TLS / cert failure (Caddy)

**Symptom.** All clients show "connection refused" or SSL/TLS errors on browser page load. HTTP works, HTTPS doesn't.

**Diagnosis:**
```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker logs citrus-caddy --tail=100 2>&1 | grep -iE 'error|fail|renew'"
```

Look for Let's Encrypt renewal failures (rate limit exceeded → cert can't renew → connections fail).

**Action.**
- Rate-limit failure: prior cert usually still valid (90-day window). Confirm via `curl -Iv https://<draft-domain>` → check `expire date`.
- Other renewal failure: `sudo docker restart citrus-caddy` on the VM (SSH). Caddy retries on start.

**Cert genuinely expired mid-draft.** §6d PAUSE. Issue temporary cert via `certbot` from another VM, swap into Caddy's volume, restart Caddy. Beyond THE TWELVE runbook — needs Caddy operator familiarity. If Garrett is not familiar: postpone.

### 6m. Phone dies mid-pick (single user)

**Symptom.** User's phone / laptop dies while they're on the clock.

**Expected engine behavior.** Their clock expires → engine autopicks their slot with best-available player.

**Action.** None mid-flight. Post-draft, apologize + consider commissioner-override reallocation.

---

## Post-draft

### 7a. Announce completion in the chat channel

> "Draft complete — refresh your browser to see the completion banner + follow the link to your roster. Post-mortem in 30 min."

### 7b. Save evidence (§5c above).

### 7c. File the ledger entry

Update `docs/PROD_CHANGE_LEDGER.md` "Engine image pin table" — note image used + any observations for future certifications.

Update `docs/REGISTRY.md` with any NEW KIs surfaced during the draft.

Update `docs/INSTRUMENT_LEDGER.md` with any instrument-level findings.

### 7d. Fixture cleanup (optional)

`scripts/proof/fixture-12-f27-native-state.local.json` can accumulate stale references.

```powershell
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

**Pause draft** *(corrected E165 — the old one-arg / text forms here would have errored):*
```sql
SELECT public.draft_pause('<LEAGUE_ID>'::uuid,
  '{"kind":"commissioner","id":"<YOUR_USER_UUID>","reason":"diagnostic"}'::jsonb);
```

**Resume draft:**
```sql
SELECT public.draft_resume('<LEAGUE_ID>'::uuid,
  '{"kind":"commissioner","id":"<YOUR_USER_UUID>"}'::jsonb);
```

**Add time to the current pick clock** *(§E12 — the other lever you have):*
```sql
SELECT public.draft_extend('<LEAGUE_ID>'::uuid, 60,
  '{"kind":"commissioner","id":"<YOUR_USER_UUID>"}'::jsonb);
```

> `"kind":"commissioner"` is mandatory on all three — there is no bypass, not even for the SQL editor's role. **Run all three once on a throwaway league before Aug 20** (§E12/§E13); they have been read end-to-end but their first execution should not be during the draft.

---

## Appendix B — what NOT to do under pressure

- **Do NOT run `gcloud compute instances delete`** — nukes the VM + all state. Recovery = full redeploy.
- **Do NOT drop tables** — obvious but under pressure people do dumb things.
- **Do NOT push a new engine image DURING the draft** — deploy cycle is ~5min minimum; window without service is catastrophic mid-draft. If a fix is needed, §6d PAUSE first, then deploy under normal procedure, then §6d resume.
- **Do NOT skip the DEPLOY_PROTOCOL boot verification if you deploy anything** — false-green risk (INS-16) is real.
- **Do NOT restart, RESUME.** The event log preserves state. Restarting is asking 12 humans to re-do a game.
- **Do NOT let a diagnosis run > 20 minutes without §6d pause.** Even if you think "just one more thing to check."
- **Do NOT bypass RLS with service-role key from the client** — CLAUDE.md standing rule.

---

## Appendix C — who to page

- Garrett is on-call for THE TWELVE. This document is HIS document.
- Terminal (Claude) is reachable for real-time diagnostic assist BUT does NOT execute prod commands (standing rule `feedback_hand_off_infra_commands.md`).
- Architect is reachable for structural decisions (rollback vs pause, etc.).
- Nothing to page a 3rd party for. If Supabase itself is down, monitor status.supabase.com.

---

## Appendix D — v1 → v2 change summary (for auditors)

This document was reconciled 2026-08-09 per Entry 17 O5. v1 was terminal-authored; the architect had a parallel plan; the two were adjudicated:

- **Structural spine changed:** T-3d → T+1h human timeline replaces T-60m all-technical-checklist. Real humans need days.
- **Rain triggers section added:** GO/NO-GO authority named (Garrett), 6 triggers enumerated, no-rollback framing.
- **20-minute ceiling doctrine added:** any diagnosis > 20min → §6d pause + resume, not restart.
- **§6d moved earlier in ladder:** pause-first, not pause-late. Time is the scarcest resource in a live human event.
- **§6i F27b-2 note updated to be deploy-state-aware:** post-Sunday-Group-A behavior differs; footnote captures both.
- **Kept from v1:** all 13 trees (6a-6m), SQL verify organs (T3v, T60v, 3v, 4b, 5a, 5c), Appendices A/B/C, rollback shape (§6c) via SUNDAY_EXECUTION_BLOCKS.md §A-R.
- **Kept from architect:** entire human-timeline spine, go/no-go framing, 20-min ceiling.

v2 fully replaces v1. Garrett reads only v2.

---

# v3 DELTA — everything that changed between 2026-08-09 and the twelve
**Appended 2026-08-12 by the architect. Read this section BEFORE the body above: where they disagree, this section wins.** The body's spine (human timeline, decision trees, escalation ladder) is unchanged and still correct.

## D1. The engine is a different animal now — three behaviours the body predates

| Behaviour | Before (body assumes) | Now |
|---|---|---|
| Ignition with nobody connected | draft sat dead until a client connected (8 min of nothing, field-observed) | **NOTIFY creates the lobby**: press START and the draft runs even if all twelve are still loading. Field-proven: first pick 2.77s after ignition with ZERO clients. |
| Engine restart mid-draft | 4.7 dead minutes, resume only on next client connect | **Boot scan resumes every `in_progress` league at startup** (`registry.boot_scan_started` → `boot_scan_complete`). |
| Empty seat's clock | full pick clock, every time (46s of dead air per absent manager) | **~2s instant autopick for seats with no owner**; owned seats still get every second of their clock. Field-proven 2.11s vs 240s side by side. |

**What this means on the night:** a late-joining manager no longer stalls the room, and a bot-heavy league finishes fast instead of grinding. Do NOT "help" the draft by having someone open the room — it is no longer required.

## D2. Pre-requisite list — replacements

- ~~engine image `0ecbe605-draft`~~ → **the engine must be running the ENGINE-EAR v3 image** (E117/E118 autopick + Slice-1 behaviours). Verify by boot log, not by tag memory: `deployment.fingerprint` + `registry.boot_scan_complete` must both appear.
- **NEW — v1 fence live on web.** Old `/draft-room?league=…` URLs must redirect to `/draft-v2/…`. This is the single most dangerous legacy path: an un-fenced v1 room ran an entire draft client-side once already (Run 1, 2026-08-11). Spot-check one drafted league before the night.
- **NEW — service worker updates itself.** After any web deploy, a returning tab must pick up the new build without a hard refresh. If a manager reports stale UI, have them navigate (not refresh) once.
- **NEW — completed rooms render permanently.** After the draft, the room must show the final board on reload — not a reconnect loop.

## D3. Pre-draft checklist — the 10-minute version (T-60m)

1. **Engine:** restart it deliberately, then read the boot log. Required lines: `deployment.fingerprint` (imageSha matches what you pushed) · `hono.listening` · `uws.listening` · `event_subscription.started` · `event_subscription.self_test_succeeded` · `event_subscription.watchdog_started` · **`registry.boot_scan_started` + `registry.boot_scan_complete`**. A `boot_scan_threw` or `boot_scan_query_failed` line is a STOP.
2. **Smoke draft:** run a throwaway rig league end-to-end (fixture → START → let it autopick out). Ledger must show `draft_started` → N picks → `draft_completed`, contiguous seqs, and `draft_picks` (v1) still ZERO.
3. **Fence:** open an old `/draft-room?league=<a drafted league>` URL → must land on `/draft-v2/…`.
4. **Clock:** on the smoke draft's FIRST pick, the countdown must equal the configured clock (30s shows 0:30, not 0:35). This is the one moment the clock used to be wrong — verify it on the device you'll watch from.
5. **Board sanity:** the autopick board's top names must look like a real draft board (skaters, starting goalies deep). If a backup goalie is in the top ten, the engine is running a pre-E117 image.

## D4. Four deploy surfaces — nothing is "deployed" until you name which one

| Surface | What it carries | How |
|---|---|---|
| **Web** (Firebase hosting) | room UI, fence, clock, service worker | `cd apps/web && npm run build && npx firebase-tools deploy --only hosting --project citrus-fantasy-staging` |
| **API** (Cloud Run `citrus-api`) | snapshot/discovery/era routes | docker build (root Dockerfile) → AR push → `gcloud run deploy citrus-api --region=us-central1` |
| **Engine** (GCE `citrus-draft-engine-staging`) | ignition, timers, autopick | build with **`-f server/Dockerfile.draft-engine`** (never the root Dockerfile — that mistake cost a 13-minute outage), tag `<sha>-draft`, push, `add-metadata`, run the startup script |
| **DB** (migrations) | RPCs, schema | applied deliberately; never as a side effect of a code deploy |

A change to autopick is an **engine** deploy. A change to the clock is a **web** deploy. They are not interchangeable, and a green CI run touches neither of the staging surfaces.

## D5. Rollback pins (current as of 2026-08-12)

- **Engine previous-good:** `0ecbe605-draft` @ `sha256:152b7991…` — this is the last image with NO Slice-1 behaviours; rolling back to it reintroduces lazy-arm and 46s bot picks, but it is stable.
- **Engine KNOWN-BAD — never roll back to these:** `fd67eb4d-draft` (boot scan throws), `7b10d48a-draft` (boot scan enum error), `a9204e31-draft` (instant-autopick fires on pick 1 only).
- **citrus-api previous-good:** `71148e07-crm2`; superseded by `038e8e40-fen2` (fence era endpoint + terminal snapshot).
- **Web:** roll back via `firebase hosting:clone` from the release list — the SW's `skipWaiting` means clients pick the rollback up on next navigation.

## D6. During the draft — the three things worth watching

1. **The ledger** (one query, repeatable): event count, max seq, and pick spacing for the league. Contiguous seqs and steady spacing = healthy. A gap is the only true alarm.
2. **`external_event.applied`** in the engine log — `notifyToBroadcastMs` should sit under ~100ms. Tonight's field numbers were 74-75ms.
3. **Nothing else.** Resist restarting the engine because a manager's tab looks odd; the room reconnects itself, and a restart mid-draft — while now survivable — is still a self-inflicted risk.

## D7. Open gate — WHICH ENVIRONMENT (Garrett's decision, still open as of this writing)

This runbook's body says "12-human live draft on **staging**," and the architect's independent analysis agrees that is the right call: **production has no v2 draft system at all** — zero v2 tables, zero v2 RPCs, no engine VM (see `PROD_READINESS_GAP_ANALYSIS.md`). If the twelve are pointed at citrusfantasysports.com they get the legacy v1 room and none of this section applies. **Confirm the environment before sending the invite links.** If Garrett wants the production domain, that is a 2-3 day infrastructure project that must start immediately, not a deploy.


---

# v4 DELTA — appended 2026-08-12 by the architect, after a night of browser-driven live runs

## ⚡ IF SOMETHING GOES WRONG — start here

**One screen. Find your row, go to that section. Everything else in this delta is background.**

| what's happening | do this | where |
|---|---|---|
| **Someone needs more time** — bad connection, phone call, disputed name | `draft_extend`, add 60–300s. Extend FIRST, diagnose second | **§E12** |
| **You need a real break**, or something looks wrong and you want the clock stopped | `draft_pause` → fix → `draft_resume`. **Say it out loud — the room does NOT show a paused state** | **§E13** |
| **Clock at 0:00, nobody picking, no autopick** | DB verify → engine log → container liveness. Pause first if it'll take >5 min | **§6a** |
| **Engine bounced / VM restarted mid-draft** | It resumes itself (boot-scan). **But it autopicks anyone whose deadline passed during the outage** — extend during the outage to protect them | **§E12**, §6b |
| **Someone mis-picked** | Nothing to do. **There is no undo.** Let it stand, move on | **§E10** |
| **A manager has gone dark / won't respond** | Nothing to do. The clock expires and autopick makes a sensible pick. That is the designed answer | *(E160)* |
| **You want to restart the whole draft** | **Do NOT press "Reset Draft" on Profile** — it reports success and makes the league unstartable. Make a new league | **§E11** |
| **Someone hasn't joined yet and you're about to start** | **START permanently locks them out.** Read "Teams joined: N/12" aloud first | **§E9** |
| **A pick seems slow to acknowledge** | Expected pre-API-deploy: ~6s per human pick. Not a fault | **§E6** |
| **Full rollback needed** | `SUNDAY_EXECUTION_BLOCKS.md` §A-R. Pin `0ecbe605-draft`; do NOT descend past it | §6c |

**The three RPCs in §E12/§E13 have no button and no route** — they are run from the Supabase SQL editor. **Dry-run all three before the night** (they're in the deploy sheet's PRE-FLIGHT section too). `"kind":"commissioner"` is mandatory on every one.

**Before the first pick, say this to the room:** *"Picks are final — there's no undo. Check the name before you hit Draft."* (§E10)


**Same rule as the v3 delta: where this section and the body disagree, this wins.** Everything below was observed on staging on Aug 11/12, not reasoned about. Entries 123–128 of `docs/ARCHITECT_INBOX.md` carry the receipts.

## E1 — The single pre-flight check that outranks the rest: **read the first ten picks of the smoke draft**

The v3 delta already says to spot a backup goalie in the top ten as the tell of a pre-E117 engine. **On the night of Aug 11 the deployed engine produced five goalies in fourteen picks, including a four-game callup at #10.** That is not a hypothetical any more; it is the current behaviour of whatever is running until the E117/E118 engine image is deployed.

**Gate: if the smoke draft's first ten picks contain more than two goalies, the engine image is wrong. Stop and deploy the right one before inviting anybody.** The correct board leads with high-games skaters (MacKinnon / McDavid / Kucherov / Draisaitl were correct even on the bad engine — the failure starts around pick 5).

## E2 — Expected numbers, so a deviation is visible

Measured across three independent live drafts on Aug 11/12:

| quantity | expected | note |
|---|---|---|
| inter-pick gap, ownerless seat | **2.10–2.12s** mean, p95 ≤ 2.14s | 2.000s instant-autopick arm + ~110ms engine cycle |
| ignition → first pick | **~2.4s** | ~300ms more than steady state; the lobby is being built by NOTIFY |
| successful discovery → first live paint | **~1.0s** | WS upgrade + snapshot + render |
| ignition → a waiting client enters | **1–3s** (1–4s after the E124 deploy) | bounded by the discovery poll interval |
| `notifyToBroadcastMs` | **74–75ms** | from the boot/steady logs |

**Two independent drafts agreed on the mean gap to within 6ms.** If the number drifts on the night, something is wrong that the logs will explain.

## E3 — What a manager sees BEFORE the commissioner presses START

**Before the E124 web deploy:** a red **"Connection lost — Reconnecting in 1s — Draft is not active. Current status: not_started"** banner over "Waiting for draft state…", and a ~2s retry loop. Nothing is broken; the client is mislabelling a correct server answer. **If the twelve are on a build without E124, tell them in advance that this banner is expected and the room will open by itself.**

**After the E124 deploy:** a calm, non-red **"Waiting for the draft to start — you're in the room. It will open the moment your commissioner starts the draft."** No countdown, ~3s poll, enters on its own.

**Either way, nobody needs to refresh.** That instruction should be in whatever message goes out to the twelve.

## E4 — Phones

Until the E123 web deploy, a **64px opaque bottom bar** (Playoffs / Create / News / Profile) sits over the bottom of the draft room on every screen under 1024px — confirmed live during an in-progress draft. After the deploy it is gone on all three draft routes. **Check one phone after deploying; the player list must run to the bottom edge.**

## E5 — Ten-minute pre-flight, updated

Replaces nothing in D3; adds to it.

1. Restart the engine and read the boot log for the eight required lines **plus `registry.boot_scan_complete` with `resumed: N>0`** — the resident rig league `ada00015-0000-4000-8000-000000000001` is armed `in_progress` with a 24h clock precisely so this proves itself for free. **Do not join or start that league.**
2. Smoke draft → **E1's goalie gate**.
3. First pick's countdown must read the true window (E121).
4. Open the room on a not-yet-started league → **E3's banner must be the calm one.**
5. Open one phone → **E4: no bar at the bottom.**
6. Join by code from a second account → the league must appear **immediately** (E126; before that fix, up to a 30-second lie).
7. v1 fence: `/draft?league=<id>` must land on `/draft-v2/<id>`. **Verified working Aug 12.**

## E6 — Things that are FINE and will look alarming

- **A completed league shows `draft_status='completed'` with `draft_state='active'`.** Every completed league in both databases does. It is a real defect (`submit_pick_v2` never closes the second column) but it is inert on draft night — see `docs/DESIGN_DRAFT_STATUS_SPLIT.md` §5. **Do not "fix" it during the freeze.**
- **The player list may lead with retired players** (Jagr, Cullen, Chara, zeros across). Cause is ~1,100 of 2,035 directory rows having no projection, so they tie and fall into database order. Owned by the player-data lane. **If it is still true on the night, tell the twelve to sort by a stat column or use search.**
- **The clock formatter has no hours field** — the resident rig's 24h clock renders as `1439:50`. Irrelevant at 30–300s.

## E7 — Do not touch, during and around the draft

- The resident rig league `ada00015-…-01`. It is the boot-scan proof.
- `player_ros_projections` / `project_ros` / scoring functions — a separate session owns that lane.
- The engine, once the draft starts. The v3 delta's instruction stands: **resist restarting it.** If it must be bounced, boot-scan resume is the path that carries the draft across, and E5.1 is how you know it works.

---

## E8 — **How long the draft actually takes, and the clock decision that sets it** *(added 2026-08-12 after instrumenting the commissioner path)*

Every cadence number in this runbook and in the ledger — 2.10s per pick, ±16ms, zero drift — was measured on **ownerless** seats, where instant-autopick arms at 2 seconds. **THE TWELVE will have twelve OWNED seats, and that path is completely different.**

**An owned seat that does not pick waits out the ENTIRE pick clock before autopick.** Measured on staging: a 60-second clock produced `ignition → first pick = 60.9s`, against ~2.4s for the same league shape with the seat ownerless. This is correct and must not be changed — you do not autopick a human two seconds into their turn. But it means **the engine does not set the pace of draft night. The clock and twelve humans do.**

**Pick the clock deliberately, before invites go out.** The lobby's estimate (`DraftLobby.tsx:1075`) is `teams × rounds × pickTimeLimit`, i.e. **the worst case where every pick times out**:

> ⚠️ **RECALIBRATED 2026-08-12 (inbox E172).** This table was originally computed for **12 × 21 = 252 picks**, which is the size of the architect's *soak rig* — **not** the draft §T-3d tells you to create. **THE TWELVE as planned is 12 × 12 = 144 picks.** Every duration below was ~75% too long. Both columns now shown; **use the row for the round count you actually create.**

| clock | worst case @ **12 rounds / 144 picks** *(the plan)* | worst case @ 21 rounds / 252 picks | plausible real pace (~20s/pick) |
|---|---|---|---|
| 30s | **1 h 12 m** | 2 h 06 m | ~45 m / ~1 h 20 m |
| **60s** | **2 h 24 m — the lobby will read "Estimated time: 144 minutes"** | 4 h 12 m *(reads 252)* | ~50 m / ~1 h 30 m |
| 90s | **3 h 36 m** | 6 h 18 m | ~55 m / ~1 h 40 m |

The worst case scales linearly with the clock; the realistic case barely moves, because people do not use their full clock. **A shorter clock costs almost nothing in real pace and removes hours from the worst case.** If anyone goes quiet — steps away, loses signal, falls asleep — the difference between a 30s and a 90s clock is the difference between the room absorbing it and the room stalling on it.

**Two operational notes that follow:**

1. **Do not be alarmed by the lobby's estimate.** Whatever number it shows — 144 minutes at a 60s clock for the planned 12 rounds — is arithmetic, not a forecast. Say so to the twelve if anyone asks.
2. **Fewer rounds is the other lever, and you have already pulled it.** Every round removed is 12 picks and, at a 60s clock, up to 12 minutes of worst case. §T-3d already specifies **12 rounds** rather than the product default of 21 — that decision alone takes ~1 h 48 m off the 60s worst case. **The remaining trade-off is that teams finish 12 deep against a 21-slot roster**; if you would rather they start full, 21 rounds is the cost of it (E171).

**Pre-flight addition (goes with E5):** confirm `pickTimeLimit` in the lobby before inviting anyone, and say the number out loud to the room at the start. It is the single setting that determines what kind of evening it is.

---

## E9 — **START seals the league. Say the count out loud first.** *(added 2026-08-12 — inbox E140)*

The moment the draft starts, `join_league_with_code` refuses everyone who has not already joined, with **"Cannot join — the draft is currently in progress."** Permanently. Right code, right person, doesn't matter.

**The lobby does not warn you.** The Start-Draft buttons are gated only on *fewer than 4 teams*. Between 4 and 12 the button looks and behaves identically — **at 11 of 12 it is an ordinary enabled button.**

**What happens if you press it a person short:** that person is locked out of the league permanently, and their seat is **ownerless**, so instant-autopick arms at 2 seconds and drafts them a complete roster at ~2.1s a pick while everyone watches. **There is no undo.** Recovery means abandoning the draft and rebuilding the league.

### The rule

> **Before pressing START, read `Teams joined: N/12` aloud.**
> **Do not press it below 12 unless the missing person has told you they're not coming.**

If someone is missing: wait, or call them. **Waiting five minutes is free. Starting five minutes early is not reversible.**

If you genuinely must start short-handed, know that the empty seat will be auto-drafted from the first pick — it is not a placeholder that sits idle.

*(A confirmation dialog for the below-capacity case is proposed as L7 in `docs/DESIGN_LOBBY_CAMPAIGN.md`. Until it ships, this sentence is the whole safety mechanism.)*

---

## E10 — **There is no undo. Say so before the first pick.** *(added 2026-08-12 — inbox E150)*

**A pick, once made, is permanent.** Not "hard to reverse" — there is **no mechanism at all** on the v2 rail:

- the commissioner control panel is not rendered in the v2 room;
- the `/undo` HTTP route runs the **v1** service, which reads the old `draft_picks` table and finds nothing for a v2 draft;
- no database function can emit a `pick_undone` event, and **not one has ever existed** across 115 drafts on staging;
- the engine knows how to *replay* an undo, but nothing can create one for it to replay.

> ✅ **DEMONSTRATED 2026-08-12 (inbox E177), by accident, on a disposable rig.** The architect ran `UPDATE leagues SET draft_status='completed', pick_deadline=NULL` to retire a rig with a live lobby. **Five minutes later the engine autopicked it anyway** — seq 5 and 6, then `draft_completed` — because the running lobby's state is in memory and driven by the **event log**, not by that column. A write that emits no event does not reach the engine at all. **This is the whole reason for the rule below, now observed rather than reasoned.**

**Do not attempt a manual SQL fix during the draft.** Deleting from `draft_picks_v2` mid-draft would desynchronise the running engine — it holds lobby state in memory and only replays the log at boot. You would turn one bad pick into a broken room.

### What to do on the night

**Before the first pick, say this out loud to the room:**

> *"Picks are final — there's no undo. Check the name before you hit Draft."*

That is the entire mitigation, and it works. **Say it at the start, not after someone's mistake** — a known rule of the game is fine; an unfixable surprise at pick 180 is not.

**Two reasons this matters more than it sounds:**

1. **Every row in the player pool has its own Draft button**, and the table is dense. The architect mis-drafted **Jaromir Jagr** (retired 2018) during testing by clicking the first row. At pick 180, tired, on a phone, someone will do the same.
2. **Every other fantasy product people have used has an undo somewhere.** The twelve will assume one exists. That assumption has to be corrected explicitly, because nothing on screen corrects it.

**If a bad pick happens anyway:** let it stand and move on. It is one roster spot. Stopping the draft to attempt a repair risks the whole evening, and there is no repair to attempt.

*(The real fix — an `undo_last_pick_v2` RPC that appends the event and removes the projection row atomically, then a route, then a button — is scoped in E150 and belongs after Aug 20. The engine half is already built and tested.)*

---

## E11 — **Don't press "Reset Draft" on Profile. It doesn't reset a v2 draft — it makes the league unstartable.** *(added 2026-08-12 — inbox E151, corrected E152)*

There is **no reset control inside the v2 draft room.** There *is* one on the **Profile / settings page** — one button per league you commission — and that is exactly where you'd go looking if the first attempt at THE TWELVE went sideways.

**It does not work on a v2 league.** Its dialog promises to *"permanently delete all draft data and reset the league to 'not started'."* What actually happens:

| it deletes | result |
|---|---|
| `draft_picks` (v1) | **0 rows** — v2 picks live in `draft_picks_v2` |
| `draft_order` | **deleted** |
| `team_lineups`, `roster_assignments` | deleted |
| `draft_status` | **flipped to `not_started`** |
| `draft_state` | **not touched — stays `active`** |
| `draft_picks_v2` | **untouched — every pick survives** |
| `draft_events` (the log) | **untouched — the whole draft survives** |

Then it tells you: *"Draft reset successful — you can now start a fresh draft."*

**You cannot.** The league is now in a state `start_draft_v2` explicitly refuses, by name:

> `draft_state_not_startable: league … draft_status=not_started but draft_state=active (illegal combo)`

**The good news is that this is a designed refusal, not an accident.** Two independent guards catch it: the illegal-combo check above, and — because the reset deleted `draft_order` — `draft_not_configured: league … has no round-1 draft_order`. **The event log is never polluted and no second `draft_started` is ever appended.** The failure is loud, named, and contained.

### What to do on the night

**If a draft needs restarting, make a new league. Don't press that button.**

Creating a fresh league and re-sending the join code costs about five minutes with twelve people on a call. Pressing reset costs you that league permanently — it will report success, then refuse to start, and there is no in-product way back.

**Same rule for `POST /api/draft/league/:id/reset` by hand.** It is the same function.

**If you press it by accident:** nothing is lost and nothing is corrupt — the draft is still whole in `draft_events` and `draft_picks_v2`. Move the twelve to a new league and keep going. Recovery of the old one is a database job for afterwards, not for the night.

**Related, same cause:** don't run the ops integrity tools (`check_data_integrity`, `auto_fix_integrity_issues`) against a v2 league. They read the v1 table, will report a healthy league as corrupt, and `auto_fix` would "repair" it from an empty source.

*(Real fix, post-Aug-20 and one line: have `nuclear_reset_draft` also delete the league's `draft_events` — `draft_picks_v2.source_event_id` cascades — and reset `draft_state` alongside `draft_status`. Full detail: `docs/V1_TABLE_CONSUMERS.md`.)*

---

## E12 — **You CAN add time to a pick clock. It's the only lever you have, and it isn't in the UI.** *(added 2026-08-12 — inbox E158)*

`draft_extend` is a finished, fully-guarded commissioner tool sitting in the database with **no button and no route**. It is the correct response to the two most likely incidents on the night: the engine hiccupping, and somebody needing thirty more seconds.

### The command

Run it in the Supabase SQL editor on **staging** (`jjgspcpvqaiitloglxbb`):

```sql
SELECT public.draft_extend(
  '<league-id>'::uuid,
  60,                                        -- seconds to ADD
  '{"kind":"commissioner","id":"<your-user-uuid>"}'::jsonb
);
```

Returns `{"new_pick_deadline": ..., "seq": ...}`. The engine picks it up **live** — it re-arms the running clock — and also on bootstrap, so an extension issued while the engine is restarting still applies when it comes back.

**`"kind":"commissioner"` is mandatory.** That check has no bypass, not even for the SQL editor's role.

### ✅ Verified — optional rehearsal only

**Executed against a live engine on 2026-08-12 (inbox E176 + E177).** `draft_extend` moved the deadline exactly +60s; `draft_pause` held a draft 52 seconds past its clock with **zero** autopicks; `draft_resume` re-armed and the engine fired on the new deadline. Both documented guard failures reproduced. **Running it once on a throwaway league is still worth two minutes — to see it, not to check it.**

### Two things to know about how it behaves

1. **Time is added to the existing deadline, not to now.** If a clock is already 90 seconds expired, adding 60 still leaves it in the past and the pick fires anyway. **During an outage, extend generously** — 300, not 60.
2. **It refuses on a completed draft**, with `illegal_state: active draft has no pick_deadline (data corruption?)`. That message sounds alarming and is not — completion deliberately clears the deadline. Nothing is wrong.

### When to reach for it

- **The engine bounces mid-draft.** The room shows a reconnecting banner while the clock keeps running. When the engine returns, **it will immediately autopick anyone whose deadline passed during the outage** — the timer re-arms from the stored deadline and fires at once if that deadline is past. Extending during the outage is what protects the person on the clock.
- **Somebody needs a minute** — a phone call, a dropped connection, a disputed name.
- **You want the room to breathe** after any incident, before the next pick starts.

### What it does NOT do

It cannot rewind an autopick that has already fired. **There is no undo (§E10).** Extending is only useful *before* the clock runs out — which means the moment you notice trouble, extend first and diagnose second.

### Why this is safe when a manual undo is not

§E10 tells you never to hand-fix a mis-pick with SQL, and that stands. The difference is architectural: a manual undo would delete rows from `draft_picks_v2` behind the engine's back while it holds lobby state in memory, leaving the engine and the database disagreeing. **`draft_extend` appends an event the engine already knows how to consume**, both live and on replay. It works with the design instead of around it. **This is the one RPC it is appropriate to run by hand on draft night.**

---

## E13 — **You CAN pause the draft. It works — but the room won't say so.** *(added 2026-08-12 — inbox E159)*

Like `draft_extend` (§E12), pause and resume are finished, fully-guarded tools sitting in the database with **no button and no route**. On a three-hour night with twelve people, this is the one you're most likely to want.

### The commands

Supabase SQL editor, staging (`jjgspcpvqaiitloglxbb`):

```sql
-- pause
SELECT public.draft_pause(
  '<league-id>'::uuid,
  '{"kind":"commissioner","id":"<your-user-uuid>","reason":"break"}'::jsonb
);

-- resume
SELECT public.draft_resume(
  '<league-id>'::uuid,
  '{"kind":"commissioner","id":"<your-user-uuid>"}'::jsonb
);
```

`"kind":"commissioner"` is mandatory — no bypass. Pause requires the draft to be **active**; resume requires it to be **paused**. Double-pausing or resuming a running draft raises `illegal_state_transition` and changes nothing.

### ⚠️ Dry-run this before Aug 20, with §E12

On a throwaway league: pause, confirm nobody gets auto-drafted, resume, confirm the clock restarts. Read but never executed — don't let the first run be during the draft.

### What actually happens

**Nobody gets auto-drafted while paused.** The engine suppresses autopick, and the pick RPC refuses picks with a message the app already renders properly: *"The draft is paused or completed. Picks aren't allowed right now."* **The two things that matter both work.**

**Resume gives a fresh full clock** — not the few seconds that were left when you paused. Pause someone at 0:04 and they come back with the whole 90. That's deliberate.

### 🔴 SAY IT OUT LOUD — the room does not show a paused state

**The clocks will run down to 0:00 and sit there.** No autopick will fire, which is correct — but nothing on screen explains why. The paused UI exists in the code and nothing feeds it for a snake draft.

**So pause is a verbal feature. Announce it:**

> *"I'm pausing the draft. Your clock will look stuck at zero — that's expected, nobody gets auto-picked. I'll say when we're back."*

Then say when you resume, because their clocks will jump back to full and they won't know why either.

### One log line that looks alarming and isn't

If you're watching the engine log you'll see:

```
[lobby] clock fired while paused — ignored (pauseDraft should have cancelled)
```

**That is the safety net doing its job.** The pause path sets the flag but doesn't cancel the pending timer, so the timer fires and the handler refuses it. The pick is not made. Expect one of these per paused clock.

### When to reach for it

- Anyone needs a real break in a three-hour event.
- Something looks wrong and you need thirty seconds to think **without the clock running** — pause first, diagnose second.
- An engine hiccup (§E12): pause stops the bleeding, extend buys time for whoever was on the clock.

**Safe across an engine restart (verified E161).** If the engine bounces while the draft is paused, the lobby comes back **still paused, with no clock** — boot-scan picks the league up, the replayed `draft_paused` event restores the pause, and two independent guards stop a timer being armed. You do not have to un-pause before restarting anything.

**Pause does not undo anything (§E10).** It stops the clock; it cannot give back a pick already made.

---
