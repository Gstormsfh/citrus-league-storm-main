# scripts/proof/ — live broadcast proof

Chunk 11g.10 sub-step 10c-1c verification. Produces trusted first-party
evidence that a pick INSERTed into `draft_events` propagates through the
NOTIFY trigger, the engine's LISTEN client, `processExternalEvent`, and out
to a connected WebSocket client — in Garrett's own terminal, under the
sequential-verified protocol.

**Scope.** Minimal fixture (one team, one draft_order row, one pick).
Broadcast rail proof only — not a Mandate measurement, not a load test,
not a 12-team production shape. Those belong to 10c-2.

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

# Sanity — should print the redacted host, NOT the password:
$env:SUPABASE_DB_URL -replace ':\/\/[^:]+:[^@]+@', '://REDACTED:REDACTED@'
```

The scripts refuse pooled URL patterns; the direct primary URL should
resolve to `db.jjgspcpvqaiitloglxbb.supabase.co:5432` (per §15.4 of
`docs/PHASE_4_5_GCE_PLATFORM_NOTES.md`).

**Clear the env at the end of the session:**

```powershell
Remove-Item Env:\SUPABASE_DB_URL
Remove-Item Env:\SUPABASE_JWT_SECRET
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

## 5. Fabrication guard — what makes this proof trustworthy

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
