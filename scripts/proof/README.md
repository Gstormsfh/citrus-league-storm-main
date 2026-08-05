# scripts/proof/ — live broadcast proof + 10c-2 perf harness

Two tools live in this directory:

**1. Live broadcast proof (chunk 11g.10 sub-step 10c-1c).** Single-client,
single-pick verification that a pick INSERTed into `draft_events` propagates
through the NOTIFY trigger → engine's LISTEN client → `processExternalEvent`
→ WebSocket broadcast. Under the sequential-verified protocol, this run
produces four verbatim capture items an operator can ratify as proof.
Files: `fixture-min.mjs`, `live-proof.mjs`.

**2. 10c-2 draft perf harness (chunk 11g.10 sub-step 10c-2).** M-client,
multi-pick, single-clock latency measurement across four scenarios
(S1/S2/S3/S4). Emits NDJSON + percentile tables labeled `MANDATE-CANDIDATE`
until Garrett ratifies the methodology against the first results.
Files: `fixture-12.mjs`, `draft-harness.mjs`, `lib/ws-client.mjs`,
`lib/percentiles.mjs`.

**Shared** between the two: `lib/ws-client.mjs` provides a heartbeat-
compliant WS client (client-initiated unsolicited protocol pongs every
10 s per RFC 6455 §5.5.3, so the engine's reaper stays happy without
depending on `sendPingsAutomatically` firing correctly).

**Scope note for the proof.** Minimal fixture (one team, one draft_order
row, one pick). Broadcast rail proof only — not a Mandate measurement,
not a load test.

**Non-negotiables.**

- Hard-whitelisted to `993c9219-ecbf-4e4e-9fb0-e9837e1bded3` (canonical
  Staging League, verified 2026-07-24 via in-database boolean comparison).
  No override flag exists.
- Every DB write is printed **before** it runs (dry-run default) and
  printed again as it runs (execute mode).
- Reset restores modified rows to captured before-values, then deletes the
  ephemeral state file. Whitelist-scoped throughout.
- Secrets (SUPABASE_DB_URL, SUPABASE_JWT_SECRET) come from Secret Manager
  at runtime and never touch disk. This README is the only place their
  fetch commands appear.
- Pooled URL patterns (`pooler.supabase.com`, `pgbouncer`, `:6543`) are
  hard-refused per KI-E010; LISTEN frames don't survive them.

---

## 1. Prerequisites

- Node 20+ (verified via `node --version`).
- The `pg` and `ws` npm packages, resolvable from the repo root's
  `node_modules/` (both are transitive dependencies of the existing
  workspace; no `npm install` should be needed):

  ```powershell
  cd C:\Users\garre\Documents\citrus-league-storm-phase45
  Test-Path node_modules\pg\package.json  # → True
  Test-Path node_modules\ws\package.json  # → True
  ```

  If either returns `False`, run `npm install` at the repo root before
  proceeding.

- `gcloud` authenticated as `garrett.storms@citrusfantasysports.com` with
  access to `citrus-fantasy-staging`. Confirm via `gcloud auth list`.

- Fixture is applied against staging (this README's §3 is the entry point).

---

## 2. Session env — inject secrets from Secret Manager

**PowerShell.** Copy-paste as a single block; do NOT commit the shell
history that contains the pasted values.

```powershell
cd C:\Users\garre\Documents\citrus-league-storm-phase45

$env:SUPABASE_DB_URL = (gcloud secrets versions access latest `
  --secret=SUPABASE_DB_URL `
  --project=citrus-fantasy-staging)

$env:SUPABASE_JWT_SECRET = (gcloud secrets versions access latest `
  --secret=SUPABASE_JWT_SECRET `
  --project=citrus-fantasy-staging)

# DR-4 (2026-07-30) — F-ledger cookbook update: the harness's WS
# transport defaults to plain ws:// via HOST=35.203.89.236 WS_PORT=3002
# SCHEME=ws (draft-harness.mjs:218-224). To exercise the SAME wss/Caddy
# path a real browser rides, set SCHEME=wss + HOST=draft-staging.
# citrusfantasysports.com + WS_PORT=443 before firing the harness.
# The prior acceptance run (2026-07-30T16-12-24-468Z) ran mixed-transport
# because these were unset — 12 harness clients on plain ws, browser
# on wss. Numbers still cleared Mandate but architect required the
# honest transport label in the report.
$env:SCHEME = 'wss'
$env:HOST = 'draft-staging.citrusfantasysports.com'
$env:WS_PORT = '443'

# Sanity — should print the redacted host, NOT the password:
$env:SUPABASE_DB_URL -replace ':\/\/[^:]+:[^@]+@', '://REDACTED:REDACTED@'
```

The scripts refuse pooled URL patterns; the direct primary URL should
resolve to `db.jjgspcpvqaiitloglxbb.supabase.co:5432` (per §15.4 of
`docs/PHASE_4_5_GCE_PLATFORM_NOTES.md`).

### 2.1 PRODUCTION connection — `SUPABASE_DB_URL_PROD`

**Use case.** Season-Loop repair migrations (SL-1..SL-5) and any other
direct-apply that must run against production. Introduced 2026-08-05
with the SL-1 apply harness (`scripts/proof/apply-sl1-auto-fix.local.sql`).
Prior to that date only staging was documented here; prod applies
required a separate ad-hoc loader that lived nowhere durable — the
first SL-1 apply attempt failed because the env var was unset and
psql defaulted to `localhost`, refusing connection with zero prod
contact. INS-8-adjacent instrument lesson: undocumented connection
strings are landmines. This section closes that gap.

**Prerequisite check (paste first).** Does the prod DB-URL secret
exist in Secret Manager?

```powershell
gcloud secrets list --project=citrus-fantasy-prod --filter="name~SUPABASE_DB_URL$" --format="value(name)"
```

- If it prints `SUPABASE_DB_URL`, proceed to the LOADER block below.
- If it prints nothing, run the CREATE block first (one-time setup),
  then the LOADER.

**LOADER (secret exists).** Paste as a single block.

```powershell
$env:SUPABASE_DB_URL_PROD = (gcloud secrets versions access latest `
  --secret=SUPABASE_DB_URL `
  --project=citrus-fantasy-prod)

# Sanity — should print the redacted prod host (db.iezwazccqqrhrjupxzvf...),
# NOT the password, NOT localhost:
$env:SUPABASE_DB_URL_PROD -replace ':\/\/[^:]+:[^@]+@', '://REDACTED:REDACTED@'

# Assert: the URL is the DIRECT connection, NOT the pooler (KI-E010).
# Direct : db.iezwazccqqrhrjupxzvf.supabase.co:5432
# Pooler : aws-0-*.pooler.supabase.com:6543  ← LISTEN frames don't survive; REFUSE
if ($env:SUPABASE_DB_URL_PROD -match 'pooler\.supabase|pgbouncer|:6543') {
  Write-Error "SUPABASE_DB_URL_PROD is a pooler URL — direct connection required. See KI-E010."
  Remove-Item Env:\SUPABASE_DB_URL_PROD
}
```

**CREATE (secret does not yet exist — one-time setup).** Requires the
prod DB password, which lives in the Supabase dashboard at
[https://supabase.com/dashboard/project/iezwazccqqrhrjupxzvf/settings/database](https://supabase.com/dashboard/project/iezwazccqqrhrjupxzvf/settings/database)
(Settings → Database → Connection string → URI → the direct connection,
with the password revealed via the "Reveal" button). NEVER paste the
password into shell history in plaintext — pipe it into gcloud via
`Read-Host -AsSecureString` to keep it out of the buffer.

```powershell
# ONE-TIME. Reads the password from an interactive prompt (masked),
# constructs the direct-connection URL, writes it to Secret Manager,
# then LOADS into env. Paste in one block; the Read-Host masks input.

$pw = Read-Host -Prompt "Enter prod DB password (masked)" -AsSecureString
$pwPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))

$prodUrl = "postgresql://postgres:$pwPlain@db.iezwazccqqrhrjupxzvf.supabase.co:5432/postgres"

# Create the secret in the prod GCP project.
gcloud secrets create SUPABASE_DB_URL `
  --project=citrus-fantasy-prod `
  --replication-policy=automatic

# Add the first version. Uses --data-file=- to read from stdin so the
# password never appears in the gcloud command line / process listing.
$prodUrl | gcloud secrets versions add SUPABASE_DB_URL `
  --project=citrus-fantasy-prod `
  --data-file=-

# Wipe the plaintext from this session's variables.
$pwPlain = $null; $prodUrl = $null; $pw = $null
[System.GC]::Collect()

# Now run the LOADER block above to hydrate SUPABASE_DB_URL_PROD.
```

**Clear the prod env at the end of the session:**

```powershell
Remove-Item Env:\SUPABASE_DB_URL_PROD
```

**KI-E010 reminder.** SL-1 (and any future direct-apply that uses
`\lo_import` or LISTEN/NOTIFY) MUST connect on the direct URL, NOT the
pooler. Symptoms of a pooler URL landing anyway: `\lo_import` fails
silently or emits `pg_largeobject` permission errors; LISTEN frames
never arrive at the client. The LOADER's regex-refuse block catches
the common pooler patterns pre-flight.

### 2.2 Clear the STAGING env at the end of the session

```powershell
Remove-Item Env:\SUPABASE_DB_URL
Remove-Item Env:\SUPABASE_JWT_SECRET
Remove-Item Env:\SCHEME
Remove-Item Env:\HOST
Remove-Item Env:\WS_PORT
```

---

## 3. Run sequence

### 3.1  Dry-run the fixture — READ THE OUTPUT

```powershell
cd C:\Users\garre\Documents\citrus-league-storm-phase45
node scripts/proof/fixture-min.mjs
```

The script prints:
- current DB session identity (`current_user`, `session_user`) — must be
  `postgres`, `service_role`, or `supabase_admin`; warns otherwise.
- current `leagues` row values (before-values it will restore on reset).
- `draft_events` + `draft_picks_v2` counts (must both be 0 to proceed).
- planned writes (SQL + params + before-values per step). Every write is
  printed. If any write is not what you expect, DO NOT proceed.

Expected planned writes on a clean league (all optional per current state):
- `leagues UPDATE` — bringing `draft_state='active'`, `pick_deadline`
  to now+5min, `league_size` to a positive value if unset,
  `draft_event_counter` to 0.
- `teams INSERT` — deterministic proof team (id `44444444-…`),
  `owner_id NULL`.
- `draft_order INSERT` or `UPDATE` — round 1, `team_order=[proof_team_id]`.

### 3.2  Apply the fixture

Only after §3.1's plan matches expectation:

```powershell
node scripts/proof/fixture-min.mjs --execute
```

Writes execute in a single transaction. On success, the script writes
`scripts/proof/fixture-state.local.json` carrying the before-values;
reset consumes and deletes this file. **Never commit `fixture-state.local.json`.**

### 3.3  Run the proof

```powershell
node scripts/proof/live-proof.mjs
```

The script prints a banner with the exact `ws://HOST:PORT/ws/draft/<league>`
target, opens the connection, and confirms snapshot-on-connect. Then it
prompts:

```
ARMED — press Enter to submit the pick.
```

Press Enter. The script:
1. Prints the exact `submit_pick_v2(...)` SQL + params about to fire.
2. Fires the RPC via direct pg. Records `submitStartMs` at fire time.
3. Waits up to **15 seconds** for a WS `event` frame with matching `seq`.
4. On match: prints the four verbatim capture items (wire message, client
   receive timestamp, engine log-grep command for external_event.applied,
   submit→receive wall-clock delta labeled NON-MANDATE).
5. On timeout: prints DIAGNOSTIC FAILURE with the four inspection steps
   Garrett runs to triage. Exits nonzero.

Store the terminal output. This IS the proof.

### 3.4  Dry-run the reset — READ THE OUTPUT

```powershell
node scripts/proof/fixture-min.mjs --reset
```

Loads `fixture-state.local.json`, prints the planned reset writes with the
before-values it will restore. Confirm each step matches what §3.2 wrote.

### 3.5  Apply the reset

```powershell
node scripts/proof/fixture-min.mjs --reset --execute
```

Executes in a single transaction: DELETE draft_events (CASCADEs to
draft_picks_v2 via `source_event_id` FK), restore leagues columns to
before-values, DELETE the proof team (if created), restore or DELETE the
draft_order round 1 row (depending on whether it pre-existed). State file
is deleted at the end.

### 3.6  Clear env

```powershell
Remove-Item Env:\SUPABASE_DB_URL
Remove-Item Env:\SUPABASE_JWT_SECRET
```

---

## 4. Post-run verification — Garrett runs, independently of the scripts

### 4.1  VM log grep for `external_event.applied`

```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a `
  --project=citrus-fantasy-staging `
  --command="sudo docker logs citrus-draft-engine 2>&1 | grep 'external_event.applied' | tail -5"
```

Expected: **at least one line** with `""event"":""external_event.applied""`
whose `""seq""` matches the `expectedSeq` the proof script reported. Fields:
`lobbyId`, `seq`, `eventType`, `applyMs`, `broadcastMs`, `notifyToBroadcastMs`,
`broadcasted:true`. The `broadcasted:true` field is the engine-side witness
that the fix from chunk 11g.10 sub-step 10c-1a is live.

### 4.2  DB cleanliness after reset

Paste into the Supabase SQL editor (or run via psql with the injected
env):

```sql
SELECT count(*) AS leftover_events
  FROM draft_events
 WHERE league_id = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';

SELECT count(*) AS leftover_picks
  FROM draft_picks_v2
 WHERE league_id = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';

SELECT draft_state, pick_deadline, league_size, draft_event_counter
  FROM leagues
 WHERE id = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';

SELECT count(*) AS proof_team_left
  FROM teams
 WHERE id = '44444444-4444-4444-4444-444444444444';

SELECT round_number, team_order
  FROM draft_order
 WHERE league_id = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';
```

Expected after reset:
- `leftover_events` = 0
- `leftover_picks` = 0
- `leagues` row matches the before-values printed in §3.1's dry-run
  output (and again in §3.4's reset dry-run).
- `proof_team_left` = 0 (unless the team pre-existed before §3.2,
  in which case §3.5 leaves it in place — the fixture script prints
  this decision explicitly).
- `draft_order` — row absent (if fixture created it) or restored to
  its pre-fixture team_order (if fixture only modified it).

---

## 5. 10c-2 draft perf harness

Chunk 11g.10 sub-step 10c-2. Mint the first honest Mandate measurements
under multi-client draft load on staging. Every prior latency figure was
fabricated; these come from machine output only.

### 5.1  Methodology laws (non-negotiable)

Every result the harness prints is labeled `MANDATE-CANDIDATE` in the
header until Garrett ratifies the methodology against the first results.
These five laws are the ratification criteria.

1. **SINGLE-CLOCK.** Every latency = two timestamps from the SAME clock.
   Primary metric: `client receive_ts − submit_call_ts` on the harness
   host. Engine-internal splits (`applyMs` / `broadcastMs` /
   `notifyToBroadcastMs` from `external_event.applied` log lines, joined
   on seq) reported as a **separate** table — cross-clock, informational
   only. NEVER compare cross-clock to single-clock (observed workstation
   ↔ server skew ~0.5–0.6 s is much larger than measured quantities).

2. **Percentiles only.** p50 / p90 / p95 / p99 / max + N. Minimum 200
   samples per scenario before any number is quoted. No means, no
   single-shot quotes. The percentile table surfaces a `⚠<200` warning
   flag on any row that has fewer than 200 samples.

3. **`MANDATE-CANDIDATE` labeling.** Every printed table AND every NDJSON
   file header carries the label. Removing it is Garrett's ratification
   action, not the harness's.

4. **Drop rate + seq ordering violations are first-class.** Reported
   always, target 0. A drop = an `event` frame not received on a client
   within `--receive-timeout-ms` (default 15 s) of the RPC submission.
   A seq ordering violation = a client received seqs out of monotonic
   order.

5. **Cold vs warm tagged separately.** First pick after lobby
   construction = `cold` (bootstrap sample). Every subsequent pick =
   `warm`. Two rows in the primary end-to-end percentile table.

### 5.2  Heartbeat prerequisite (blocks everything)

The shared client lib (`lib/ws-client.mjs`) implements **client-initiated
unsolicited WS protocol pongs every 10 s** (RFC 6455 §5.5.3) and logs
each as a `♥` line. Rationale: the 10c-1d incident closure confirmed
the engine's `sendPingsAutomatically` path was NOT firing pings; the
reaper's 30 s pong timeout was culling any idle client (Garrett's proof
runs got 4002 at ~39 s). Client-initiated unsolicited pongs update the
engine's `lastPongAt` directly via its `pong:` handler and don't depend
on any server-side behavior.

Both `live-proof.mjs` and `draft-harness.mjs` now use `connectDraftClient`
from the shared lib, so heartbeat compliance is inherited automatically.
When you run either script, expect a `♥ … pong+ping sent #N` line every
10 s (silenced by default in the harness for >3 clients to reduce log
noise; single-client scripts always show it).

### 5.3  Run sequence — general shape

**PROHIBITED: hand-rolled sweeps.** Cleanup between and after scenarios MUST go
through `fixture-12.mjs --reset --execute` (or `fixture-min.mjs --reset --execute`
for the single-client rig). Do NOT paste ad-hoc SQL to clear `draft_events` /
`draft_snapshots` / `leagues` columns / `teams` / `draft_order` — the fixture's
state file records the exact before-values (harness team ownership, human user's
prior team, `settings.pickTimeLimit`, `league_size`, `draft_state`) and the
reset path restores them; a hand-rolled sweep will silently leave `league_size=12`,
`slot3_owner` still on the human user, harness teams still present, or the
pre-run `pickTimeLimit` clobbered. Architect ruling (2026-07-29 post-DR-2 sweep):
**fixture reset or nothing.** If the fixture state file is missing or suspected
poisoned, DELETE it and re-run `fixture-12.mjs --execute` from a clean baseline
so the state file captures pristine before-values — do not attempt a targeted
manual restore.

**Between every scenario AND after the FINAL scenario: fixture reset + engine restart. Both are mandatory.**
The engine keeps in-memory lobbies alive at `size=0` after all WS clients
disconnect (chunk 11g.7-7c snapshot + bootstrap architecture) and dedupes
replayed seqs via `lastAppliedSeq`. Without an engine restart, scenario 2's
first pick would either race the dedup gate or bootstrap-replay scenario 1's
events into scenario 2's fresh event log. Restart clears the in-memory
`LobbyRegistry` so scenario N starts from a truly cold engine state.

**Machine-verified reason to restart after the FINAL scenario too.** The S4
run at 2026-07-27T05:01:14Z left one lobby alive at `size=0` overnight;
by morning restart at 13:57:41Z (8h56m later) the lobby's 30 s periodic
snapshot writer had inserted **~999 stale rows** into `draft_snapshots`
for the whitelisted league. Extrapolated to production: ~2,880 rows per
lobby per day of ghost life. Skipping the post-final-scenario restart
leaves this pattern running until you next remember to touch the engine.
Chunk 10c-3 (spec pending architect review — see PROJECT_PLAN.md Decision
Log 2026-07-27 "Snapshot retention + lobby hygiene chunk — spec drafted")
will retire this class of drift structurally. Until it lands, the discipline
is: `docker restart` after every scenario, including the last one.

```powershell
cd C:\Users\garre\Documents\citrus-league-storm-phase45

# Set env from Secret Manager (§2 above).
$env:SUPABASE_DB_URL = (gcloud secrets versions access latest `
  --secret=SUPABASE_DB_URL --project=citrus-fantasy-staging)
$env:SUPABASE_JWT_SECRET = (gcloud secrets versions access latest `
  --secret=SUPABASE_JWT_SECRET --project=citrus-fantasy-staging)

# 1. Dry-run fixture-12 — READ the plan.
node scripts/proof/fixture-12.mjs --rounds=3

# 2. Apply the fixture.
node scripts/proof/fixture-12.mjs --execute --rounds=3

# 3. Run the scenario (see §5.4).
node scripts/proof/draft-harness.mjs --scenario=S1

# 4. RESET before next scenario — MANDATORY (each scenario starts clean).
node scripts/proof/fixture-12.mjs --reset --execute

# 5. RESTART THE ENGINE — MANDATORY (clears in-memory LobbyRegistry
#    + lastAppliedSeq dedup state so the next scenario's picks aren't
#    silently deduped or bootstrap-replayed against the prior run).
#    ~10s wait after restart lets startup complete before the next
#    fixture setup verifies the engine is reachable.
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --project=citrus-fantasy-staging `
  --command="sudo docker restart citrus-draft-engine"
Start-Sleep -Seconds 10

# 6. CLEAR-SNAPSHOTS — MANDATORY (2026-08-05 cookbook amendment, KI-031).
#    Catches the snapshot-race orphan: the engine's 30 s snapshot writer
#    can tick between step 4's DELETE FROM draft_snapshots and step 5's
#    restart landing, re-upserting a snapshot with the pre-reset state
#    (lastAppliedSeq populated). Left in place, that snapshot survives
#    every future restart (snapshots are on disk) and the next run's
#    engine hydrates from it — thinks it is caught up to a stale seq,
#    skips new events as duplicates. The persisted cousin of the seq-
#    dedup bug that has bitten twice from in-memory state alone.
#
#    Post-restart is the right place for this step: no in-memory lobby
#    exists (no clients connected during cleanup), so the snapshot
#    writer has no state to write. Any orphan from the race window is
#    safely deleted; the writer produces nothing new.
node scripts/proof/clear-snapshots.local.mjs --execute

# 7. Confirm the restart landed cleanly AND the snapshot table is empty
#    (snapshots=0 is the tripwire that catches the race whenever it
#    recurs — pristine baseline verification depends on it).
curl -s http://35.203.89.236:3001/health/subscription | ConvertFrom-Json | Format-List

# Repeat 2–7 for each scenario you want to measure.
```

### 5.4  Four scenarios

Reset the fixture AND restart the engine between EACH scenario. See §5.3
for the full 6-step cookbook including the `docker restart` step and the
10 s wait — do not skip either. Methodology law 5 (cold-bootstrap sample
is per-scenario) depends on both a clean DB (fixture reset) AND a clean
engine (restart-cleared `LobbyRegistry`).

**S1 — single-client 36-pick paced.** Continuity with the 10c-1c proof.
One WS client (with heartbeat), paced 2–5 s jitter between picks. Baseline
latency without fan-out load.

```powershell
node scripts/proof/draft-harness.mjs --scenario=S1
```

**S2 — 12-client paced (realistic draft).** Twelve WS clients, all
heartbeating. Paced 2–5 s jitter. This is the shape a real 12-team draft
takes — each pick fans out to 12 sockets.

```powershell
node scripts/proof/draft-harness.mjs --scenario=S2
```

**S3 — 12-client burst (fan-out + ordering stress).** Twelve WS clients,
zero pacing between picks. Stresses the fan-out path and surfaces any
ordering violations under back-to-back submissions.

```powershell
node scripts/proof/draft-harness.mjs --scenario=S3
```

**S4 — 12-client with mid-draft 30-min idle.** Twelve WS clients, paced
2–5 s jitter for the first 6 picks, then idle 30 minutes with clients
heartbeating through, then resume paced picks. Tests: do heartbeats keep
clients alive through 30 min idle? Does the engine's listener still fire
NOTIFYs after 30 min idle? (10c-1d watchdog + `/health/subscription`
should confirm this happens automatically.)

```powershell
node scripts/proof/draft-harness.mjs --scenario=S4
# S4 takes ~35+ minutes; expect progress lines every minute during the
# idle window.
```

### 5.4.1  S5 semantics — post-batch-2 regression proof

Chunk 10c-2 batch 2 (2026-07-27) shipped the migration + engine change
that makes external-event apply re-arm the pick-deadline timer from
the event payload's `pick_deadline` field. Before batch 2, external
picks (all production human picks) advanced `picksMade` without
re-arming; a stale timer would eventually fire against a bootstrap-set
deadline — premature-steal for every human draft. See
`PHASE_4_5_PROJECT_PLAN.md` Decision Log 2026-07-27 "S5 exposed" entry
for the verify report and "10c-2 batch 2 external-apply timer re-arm"
for the fix ratification.

**S5 becomes the regression proof.** With batch 2 landed on both DB
(migration `20260727010000_pick_event_carries_pick_deadline.sql`) and
engine (paired commit), S5's `deltaFromLastSubmitMs` per client should
land in the `(pickClock − 2 .. pickClock + 10)` tolerance window:

- Submit N pre-autopick picks (default 3). Each pick's RPC-returned
  `pick_deadline` re-arms the engine's timer via `applyPickEvent`
  reading `payload.pick_deadline`.
- After the N-th submit, STOP submitting. Engine's timer is now armed
  for `pick_deadline = submit_call_ts + pickClock + 1s`. Autopick
  fires when the timer expires and broadcasts.
- Harness records per-client `receiveTs` and asserts
  `deltaFromLastSubmitMs ∈ [(pickClock−2)·1000, (pickClock+10)·1000]`.
- **Green result = regression proof that external picks re-arm.**
- **Red result = the re-arm regressed; investigate `applyPickEvent`,
  the migration, and the deploy-order pattern all together.**

Pre-batch-2 (broken) behavior: `deltaFromLastSubmitMs` would either
time out at `--autopick-timeout-ms` (stall — bootstrap deadline was in
the future, so timer never fired) OR fire way before `pickClock`
seconds (premature-steal — bootstrap deadline was in the past, so
timer fired immediately). The tolerance window's exact shape is now
load-bearing on the fix; the S5 timeout-default patch (`(pickClock +
30) * 1000` ms) is set to comfortably exceed the upper bound so
neither failure mode masquerades as a green run.

Run twice per batch-2 verification cycle: once with fixture-12
`--pick-clock=30 --expected-pick-clock=30`, once with `--pick-clock=90
--expected-pick-clock=90`. Both should land within tolerance. Also
verify the engine boot log's `pickClockSeconds` equals `N+1`:

```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --project=citrus-fantasy-staging `
  --command="sudo docker logs citrus-draft-engine 2>&1 | grep pickClockSeconds | tail -3"
```

### 5.5  Output

Every scenario produces two files under `scripts/proof/results/`:

- `<scenario>-<runId>.ndjson` — one JSON object per (pick, client)
  sample. Fields: `scenario`, `bootstrapClass`, `clientLabel`,
  `pickNumber`, `seq`, `submitCallTs`, `receiveTs`, `rpcMs`,
  `endToEndMs`, `engineApplyMs`, `engineBroadcastMs`,
  `engineNotifyToBroadcastMs`, `seqOrderingViolation`, `rpcError`.
- `<scenario>-<runId>.summary.txt` — the printed percentile tables,
  identical to what appears on stdout.

Also stdout: the full percentile summary as the run ends. Tables:
PRIMARY (single-clock end-to-end + cold/warm split), PER-CLIENT
(single-clock per client), ENGINE-INTERNAL SPLITS (cross-clock,
informational), RPC (pg round-trip). Every table header carries the
column set `N p50 p90 p95 p99 max`; rows with N < 200 get the `⚠<200`
warning marker.

### 5.6  Abort recovery

Ctrl-C, RPC failure, or any uncaught error prints reset guidance and
exits nonzero. To recover: `node scripts/proof/fixture-12.mjs --reset
--execute`, then either re-run the scenario or move on.

Partial NDJSON is NOT written on abort (fault-atomic: either the run
completes and writes the full set, or it aborts and writes nothing).
If you need partial data, add `--out-dir=results/aborted-<label>` before
the abort and inspect any intermediate stdout.

### 5.7  Engine-internal splits — post-run log join (deferred)

The `engineApplyMs` / `engineBroadcastMs` / `engineNotifyToBroadcastMs`
columns in the NDJSON are currently populated as `null`. The engine
emits these on `external_event.applied` log lines (chunk 11g.10 sub-
step 10c-1b), and joining them onto the NDJSON by seq is a post-run
gcloud-SSH grep + parse. Deferred to a follow-up brief since the primary
single-clock metrics are the ratification target; the engine-internal
splits are informational cross-clock data.

To manually join for a given seq after a run:

```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --project=citrus-fantasy-staging `
  --command="sudo docker logs citrus-draft-engine 2>&1 | grep 'external_event.applied' | tail -100"
```

Each matching line is a single-line JSON with the fields the harness
would join. A follow-up commit can wire this into the harness's
`out-dir/<scenario>-<runId>.ndjson` output automatically.

---

## 6. Fabrication guard — what makes this proof trustworthy

The prior "live proof" attempt on 2026-07-24 was fabricated (see
`docs/PHASE_4_5_PROJECT_PLAN.md` Decision Log 2026-07-24 "Forensic note").
The design of these three files is a direct response:

- **Hard whitelist, no override flag.** The scripts refuse to operate on
  any league except the canonical 4e4e UUID. A fabricated report that
  cites a nonexistent league can't be reproduced against these tools.
- **Every DB write is printed BEFORE execution.** Dry-run mode is the
  default; a smooth report that skips the dry-run step and jumps
  straight to "executed" carries no evidence.
- **Ship banner pins the WS target.** `live-proof.mjs` prints the exact
  `ws://HOST:PORT/ws/draft/<league>` before opening the socket — no
  prior confusion about which endpoint was tested.
- **RPC result carries the seq, and the seq must match a WS frame.**
  Both sides are captured verbatim from real network I/O and real DB
  return values; the 15s timeout treats "no frame" as a hard failure,
  not an ambiguous outcome.
- **Two independent measurements after the run.** The VM log grep in
  §4.1 is the engine-side witness (independent from the client-side WS
  observation); the DB odometer / row checks in §4.2 are Postgres-side
  witnesses that the reset actually restored state. Two independent
  attestations of the same event, cross-checked by Garrett.

If any of these guarantees isn't visible in a run report, the run
isn't a proof — it's a claim.
