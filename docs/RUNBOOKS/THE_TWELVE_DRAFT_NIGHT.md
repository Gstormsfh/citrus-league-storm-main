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
  -c "SELECT id, name, league_size, draft_state, draft_status, draft_type, pick_deadline FROM public.leagues WHERE name LIKE 'THE TWELVE%' ORDER BY created_at DESC LIMIT 5;"
```

**Expected row:** `draft_state = 'not_started'`, `draft_status = 'not_started'`, `draft_type = 'snake'`, `league_size = 12`, `pick_deadline = NULL`. **RECORD** the `id` (UUID) as `$LEAGUE_ID` for all subsequent commands.

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT round_number, jsonb_array_length(team_order) as team_count FROM public.draft_order WHERE league_id = '<LEAGUE_ID>' AND deleted_at IS NULL ORDER BY round_number;"
```

**Expected:** 12 rows, each with `team_count = 12`. Snake reversal is encoded in the team_order array per round.

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT draft_event_counter, (SELECT count(*) FROM public.draft_events WHERE league_id = '<LEAGUE_ID>') as event_count, (SELECT count(*) FROM public.draft_picks_v2 WHERE league_id = '<LEAGUE_ID>') as pick_count FROM public.leagues WHERE id = '<LEAGUE_ID>';"
```

**Expected:** `draft_event_counter = 0`, `event_count = 0`, `pick_count = 0`.

### §T60v — T-60m player-pool freshness

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT count(*), MIN(updated_at) as oldest, MAX(updated_at) as newest FROM public.player_directory WHERE season = '2025-26';"
```

**Expected:** count > 500 (rough sanity — actual count varies). Newest updated within last 24h. If ZERO, data pipeline hasn't loaded — HALT + escalate. If newest is stale > 24h, POSTPONE.

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
- `draft_event_counter = 146` (1 draft_started + 12 teams × 12 rounds picks + 1 draft_completed; verify math for THE TWELVE's actual config)

### §5c — post-draft evidence capture

```powershell
$evidenceDir = "docs\RUNBOOKS\evidence\THE_TWELVE_$(Get-Date -Format 'yyyy-MM-dd')"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT seq, event_type, created_at, payload FROM public.draft_events WHERE league_id = '<LEAGUE_ID>' ORDER BY seq;" `
  > "$evidenceDir\draft_events.txt"

psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT p.pick_number, p.round_number, t.team_name, p.player_id, pd.player_name FROM public.draft_picks_v2 p LEFT JOIN public.teams t ON t.id = p.team_id LEFT JOIN public.player_directory pd ON pd.player_id::text = p.player_id::text WHERE p.league_id = '<LEAGUE_ID>' ORDER BY p.pick_number;" `
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

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT public.draft_pause('<LEAGUE_ID>'::uuid, 'diagnostic — engine issue');"
```

Post-pause: clients see the pause state; timer is dead but state is preserved. Announce in chat: "Draft paused for ~[N] min — I'll message when we resume."

When ready to resume:
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
  -c "SELECT public.draft_resume('<LEAGUE_ID>'::uuid);"
```

Announce: "Resuming in 60s — refresh your browser to reconnect."

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

**Pause draft:**
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -c "SELECT public.draft_pause('<LEAGUE_ID>'::uuid, 'diagnostic');"
```

**Resume draft:**
```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -c "SELECT public.draft_resume('<LEAGUE_ID>'::uuid);"
```

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
