# Sunday execution blocks — Groups A / B / C

**Author.** Terminal, 2026-08-09 O2 (Entry 16 overnight orders).
**For:** Garrett, Sunday morning execution.
**Status.** **RECONCILED with architect** per Entry 19 (2026-08-09 09:00Z). Three divergences (A-6 pattern list, A-7 watchdog probe, B-0 capture command) corrected in-body BELOW; the full ARCHITECT RECONCILIATION ADDENDUM is retained at the bottom of this file as audit trail. **Garrett reads the main body top-to-bottom; the addendum is for auditors.**
**Standing rule:** author-only. Terminal does not execute these. Garrett pastes into an interactive PowerShell 5.1 session.

## Harvesting discipline (INS-16)

Every command below is harvested from what worked THIS WEEK, cited at the block header. No composed-from-memory patterns. If a command was proven only in the log-flow of a prior session (not in a doc), the citation reads `SESSION: <date> transcript` and Garrett verifies before pasting.

## Convention

- All PowerShell blocks assume the current directory is the repo root.
- Values in `<ANGLE BRACKETS>` are placeholders — Garrett fills in before pasting the block, OR the block's preface tells Garrett how to compute them from prior output.
- `--quiet` on `gcloud` per MIGRATION_SAFETY_GUIDE Rule 4.
- `--project=citrus-fantasy-staging` explicit on every gcloud (defense against wrong-project defaults).
- `-v ON_ERROR_STOP=1` on every `psql` (defense against silent failures in scripts).

---

## GROUP A — engine deploy (F27b-2 image)

**Source citations:**
- `docs/DEPLOY_PROTOCOL_F26_F27.md` §3 (deploy-time discipline) + §4a (build ordering) + §4b (rollback pin capture) + §4c (deploy → boot → smoke sequence).
- `docs/RUNBOOKS/THE_TWELVE_DRAFT_NIGHT.md` §6b (VM reset), §6c (rollback shape), §6d (draft pause).
- `docs/PHASE_4_5_PROJECT_PLAN.md` 2026-07-27 deploy runbook canonical entry (steps 1-9 proven sequence).

**Assumptions Garrett verifies once before starting:**
- `$env:SUPABASE_DB_URL` set + working (`psql "$env:SUPABASE_DB_URL" -c "SELECT 1"` returns 1).
- Docker daemon up (`docker ps` returns a table, no error).
- `gcloud auth login` current + project set to `citrus-fantasy-staging`.
- Git branch is `phase-4-5-implementation` + working tree clean (`git status` reports nothing to commit).

### A-0. Capture pre-deploy rollback pin (INS-16 §4b — do this FIRST)

```powershell
# Query the currently-running image tag + digest on the target VM.
# Terminal records these values in R32 outbox BEFORE Garrett proceeds.
gcloud compute ssh citrus-draft-engine-staging `
  --project=citrus-fantasy-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command='sudo docker ps --format "{{.Image}}" | head -1'

# Fingerprint imageSha for triangulation (proves running image matches
# what fingerprint claims — if they differ, halt + investigate BEFORE deploy).
gcloud logging read `
  --project=citrus-fantasy-staging --limit=1 `
  --format='value(jsonPayload.imageSha)' `
  'jsonPayload.message="deployment.fingerprint"' --order=desc
```

**Record both values in the deploy log** (§5 of DEPLOY_PROTOCOL_F26_F27.md). If the two disagree, HALT + investigate. Expected today (per DEPLOY_PROTOCOL §4b, 2026-08-08 pin): `0ecbe605-draft @ sha256:152b79912cea9d80cf5c3147beeba48957973f5d201d54bdc9a3d6c429768a32`.

### A-1. Push the branch + capture SHA

```powershell
git push origin phase-4-5-implementation
$FULL_SHA = git rev-parse HEAD
$SHORT_SHA = git rev-parse --short=8 HEAD
Write-Output "FULL_SHA=$FULL_SHA"
Write-Output "SHORT_SHA=$SHORT_SHA"
```

### A-2. Build engine image (Dockerfile.draft-engine — INS §15.11)

**CRITICAL** per PHASE_4_5_PROJECT_PLAN 2026-07-27 strike #2: MUST use `-f server/Dockerfile.draft-engine`, NOT `server/Dockerfile` (the latter builds the API server, breaks the engine port). Convention: engine image tags carry the `-draft` suffix.

```powershell
$imageTag = "northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:$SHORT_SHA-draft"
docker build -f server/Dockerfile.draft-engine -t $imageTag .
```

Expected time: 60-180s (npm ci + shared build + server build inside the Dockerfile).

### A-3. Push + capture digest

```powershell
docker push $imageTag
$NEW_DIGEST = docker inspect --format='{{index .RepoDigests 0}}' $imageTag
Write-Output "NEW_DIGEST=$NEW_DIGEST"
```

Record `NEW_DIGEST` in the deploy log — this is what post-deploy `deployment.fingerprint.imageSha` MUST equal.

### A-4. Metadata update (QUOTED per §15.12)

```powershell
gcloud compute instances add-metadata citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a `
  --metadata="image-tag=$SHORT_SHA-draft,commit-sha=$FULL_SHA,image-sha=$NEW_DIGEST" `
  --quiet
```

### A-5. Kick startup script (which pulls new image + restarts container)

```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet `
  --command='sudo google_metadata_script_runner startup'
```

Expected: ~10-30s of startup output.

### A-6. Boot verification — 9-item harvest (per DEPLOY_PROTOCOL §1)

```powershell
Start-Sleep -Seconds 30
gcloud compute ssh citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet `
  --command='sudo docker logs citrus-draft-engine --tail=200 2>&1'
```

**MUST see (fully-harvested nine, per Entry 19 Divergence 1 ratification — no "or equivalent" under pressure):**
- `deployment.fingerprint` — with `imageSha` == `$NEW_DIGEST` AND `commitSha` == `$FULL_SHA`.
- `"nodeEnv":"production"`.
- `envFingerprint` present AND zero occurrences of `"absent"`.
- `hono.listening` — port 3001.
- `uws.listening` — port 3002 (**the single MOST load-bearing check per 2026-07-27 strike #2**).
- `event_subscription.started`.
- `event_subscription.self_test_succeeded`.
- `registry.idle_eviction_timer_started`.
- `registry.clock_liveness_scanner_started`.

**Welcome tenth** (appears at boot too, per architect Entry 19 addendum): `event_subscription.watchdog_started`.

If ANY of the nine missing after 60s AND another 30s refetch → **HALT + rollback per A-R below**. Do not diagnose forward.

### A-7. Watchdog probe (twice, ~70s apart — proves watchdog is ticking)

**Per Entry 19 Divergence 2 ratification** — use the proven docker-logs instrument, NOT an unverified `/health/subscription` curl (public reachability through Caddy is unverified, and `<PASTE ENGINE IP>` placeholder violates the no-typing-under-pressure rule). Restore curl-based variant only when a Caddy-config citation proves `/health/subscription` is publicly proxied AND the hostname can be hardcoded — never a placeholder.

```powershell
gcloud compute ssh citrus-draft-engine-staging --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet --command="sudo docker logs citrus-draft-engine --since 3m 2>&1 | grep -c watchdog_ok; echo END-1"
Start-Sleep -Seconds 70
gcloud compute ssh citrus-draft-engine-staging --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet --command="sudo docker logs citrus-draft-engine --since 3m 2>&1 | grep -c watchdog_ok; echo END-2"
```

**PASS:** both counts ≥ 1 AND the count moves upward between the two reads (watchdog is plainly ticking; the sliding 3-min window catches new ticks). If count is 0 at either read → **HALT + rollback per A-R below**.

### A-R. Rollback (only if A-6 or A-7 fails)

Per DEPLOY_PROTOCOL_F26_F27.md §4b — three commands: retag → metadata revert → reset.

```powershell
# Pin per 2026-08-08 DEPLOY_PROTOCOL §4b current pin.
$PRIOR_TAG = "0ecbe605-draft"
$PRIOR_COMMIT = "0ecbe605"

# (1) Retag PRIOR_TAG → :latest so startup script re-pulls the old image
gcloud artifacts docker tags add `
  northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:$PRIOR_TAG `
  northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:latest `
  --quiet

# (2) Metadata revert BEFORE reset
gcloud compute instances add-metadata citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a `
  --metadata="image-tag=$PRIOR_TAG,commit-sha=$PRIOR_COMMIT" `
  --quiet
gcloud compute instances remove-metadata citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a `
  --keys=image-sha --quiet

# (3) Reset the VM — startup script re-pulls :latest (now old image)
gcloud compute instances reset citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet
```

**⚠ ROLLBACK PIN IS `0ecbe605-draft`.** DO NOT roll back to `8b7b43f6-draft` (predates F26/F27/F27b-1). If `0ecbe605-draft` is itself the problem, DEPLOY A NEW BUILD from HEAD — do not descend further.

---

## GROUP B — N-2 staging migration (submit_pick_v2 clears draft_state)

**Source citations:**
- `scripts/proof/apply-n2-draft-state.local.sql` (the apply script — authored + tested-authored-only 2026-08-08).
- `scripts/proof/preapply-n2-history-read.local.sql` (PROD_CHANGE_LEDGER Rule 2 preapply — must run BEFORE apply).
- MIGRATION_SAFETY_GUIDE Rules 1-3 (capture-before-replace, real-SQL-in-history-via-\lo_import, client_encoding=UTF8).

### B-0. Capture population + preapply history read

**Rule 1 (capture-before-replace)** — Garrett MUST populate the capture file with LIVE pg_get_functiondef output before the apply, or STEP 0 aborts with an explicit RAISE EXCEPTION.

**Per Entry 19 Divergence 3 ratification (REAL DEFECT corrected)** — the capture command MUST use `-At` (tuples-only, unaligned) to produce a re-executable SQL file. Default psql output writes aligned table borders (`+----+`, header row, `(1 row)` footer) that would DIE ON THE DECORATIONS if B-R's `psql -f` rollback ran the file. A capture that cannot be re-applied is not a capture (Rule 1's whole point).

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 -At `
  -c "SELECT pg_get_functiondef('public.submit_pick_v2(uuid,uuid,integer,uuid,text,text,jsonb,text)'::regprocedure);" `
  | Out-File -Encoding utf8 supabase/migrations/captures/2026-08-08_pre_v2_draft_completion_clears_draft_state.sql
```

**Eyeball the first line** of the capture file: it MUST begin with `CREATE OR REPLACE FUNCTION` — no borders, no headers, no `(1 row)` footer. If it doesn't, the `-At` flag didn't apply — re-run before proceeding.

**PROD_CHANGE_LEDGER Rule 2 preapply history read** — check no other-workstream mutation on `submit_pick_v2` since the F24 rebase applied 2026-08-05:

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 `
  -f scripts/proof/preapply-n2-history-read.local.sql
```

**Q1 must clear** (no other-workstream mutation). If not clear, HALT — cross-workstream reconciliation before apply.

### B-1. INS-6 GUC bridge rehearsal (always before an apply that uses \lo_import + convert_from)

```powershell
psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/proof/rehearse-lo-bridge.local.sql
```

**Expect:** `NOTICE: bridge ok, <N> bytes` → `ROLLBACK`. If missing → HALT + do NOT run the apply.

### B-2. Apply migration

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 `
  -f scripts/proof/apply-n2-draft-state.local.sql
```

Watch for:
- `SHOW client_encoding` → `UTF8` (Rule 3 echo).
- `STEP 0 CAPTURE HASH PIN` → passes (Rule 1).
- `STEP 3` marker verification → passes.

Any RAISE EXCEPTION → HALT + inspect + do NOT retry blind.

### B-3. Post-apply census verify (one query)

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 -c @'
SELECT COUNT(*) FILTER (WHERE draft_status = 'completed' AND draft_state IS DISTINCT FROM 'completed') AS still_incoherent,
       COUNT(*) FILTER (WHERE draft_status = 'completed' AND draft_state = 'completed') AS coherent_completed
  FROM public.leagues;
'@
```

Post-N-2, `still_incoherent` should be 0 for any league that COMPLETES via v2 submit_pick_v2 going forward. Historical `draft_state='active'` on completed leagues is Q4 backfill's territory (separate migration, docketed post-twelve).

### B-R. Rollback (only if the apply's STEP 3 fails after commit)

N-2 is a `CREATE OR REPLACE FUNCTION` — no rollback migration is authored today per capture-file discipline. The rollback path is: re-apply the CAPTURED live body (`supabase/migrations/captures/2026-08-08_pre_v2_draft_completion_clears_draft_state.sql`) via `psql -f`. Garrett confirms this is intended before running (capture is the pre-N-2 body).

---

## GROUP C — web build + deploy (Firebase Hosting)

**Source citations:**
- `apps/web/package.json` scripts (`build` per repo root's `build:web` chain).
- `docs/DEPLOY_RUNBOOK.md` for Firebase deploy commands.

### C-0. Preflight — clean build

```powershell
cd apps/web
npm ci
npx tsc -p tsconfig.app.json --noEmit
```

`--noEmit` for typecheck; if any T7 / T11 / T12 / T13 additions introduced new tsc errors specific to today's touches, HALT + fix. (Pre-existing errors from `services/*` are OK per HANDOFF_2026-08-09_v3 known-issues.)

### C-1. Run the offline tests one more time (five specific ones today matter)

```powershell
npx vitest run `
  src/hooks/__tests__/useStartDraftFull.test.ts `
  src/components/draft/__tests__/DraftLobby.doublePress.test.tsx `
  src/__tests__/linkGraphIntegrity.test.ts `
  src/components/draft/v2/__tests__/CompletionMomentBanner.test.tsx `
  src/pages/__tests__/DraftRoomV2.test.tsx
```

Expected: 6 + 5 + 4 + 12 + 10 = **37/37 pass**. Any red → HALT + investigate before deploy.

### C-2. Build the web app

```powershell
cd ../..
npm run build:web
```

Expected artifacts in `apps/web/dist/`. Non-zero exit → HALT.

### C-3. Deploy to Firebase Hosting

```powershell
cd apps/web
npx firebase-tools deploy --only hosting --project citrus-fantasy-staging
```

Watch the URL Firebase emits — Garrett opens it in a browser + confirms:
- Home renders.
- `/league/<any-current-league-id>` renders with the new **LeagueTimelineCard** (T12).
- Header nav clicks land on the routes named in the T11a fixes (particularly the ConnectionBanner path in a draft room and the Matchup "View Bracket" button on a completed-season league).

### C-R. Rollback (Firebase Hosting version pin)

Firebase Hosting keeps prior versions. Rollback via console: Hosting → Release history → click the prior release → "Rollback" (or CLI: `firebase hosting:clone <source-site>:<version> <target-site>:live --project citrus-fantasy-staging`).

Terminal has NOT authored a scripted CLI rollback because Firebase Hosting is not a Docker image; the console rollback is the proven-this-week path.

---

## Post-all-groups verification

After A + B + C complete:

1. **Deploy log** (`docs/DEPLOY_PROTOCOL_F26_F27.md §5`) fully filled in with A-2 tag, A-3 digest, A-0 rollback pin.
2. **REGISTRY updates** — task #55 (F27b-2) marked completed; task #48 (F27) already completed 2026-08-08; task #40 (F26) verify status.
3. **HANDOFF v3** (`docs/HANDOFF_2026-08-09_v3.md`) updated with the deploy log entries under "For Garrett tonight (deployment-relevant)".
4. **Outbox R-post-deploy** — new R-entry (R32+ TBD by then) records: image digest, boot-verify pass, health-probe pass, migration apply, web deploy version, any HALT+rollback triggered.

## Blast-radius argument

Author-only these are — Garrett executes. Each Group is independent enough that a HALT in one doesn't require rolling the others back:

- Group A rollback (§A-R) restores the prior engine tag. Group B (N-2) is a CREATE OR REPLACE and safe to run against either the new or the old engine (both call submit_pick_v2 through the same RPC surface; the RPC body change is invisible to the engine caller). Group C is web-only, safe to run against either engine.
- Group B rollback (§B-R) restores the pre-N-2 function body from the capture file. Group A is unaffected.
- Group C rollback (§C-R) is Firebase version pin — instantly reversible.

Any HALT in ANY group: don't proceed to the next group. Investigate + fix the current one first.

---

## What this doc is NOT

- NOT a substitute for THE_TWELVE_DRAFT_NIGHT.md (that's the DRAFT NIGHT runbook — recovery scenarios during a live draft).
- NOT a substitute for PRE_TWELVE_DRY_RUN.md (that's the ONE-DAY-PRIOR dry-run).
- Every command here is Garrett-executable-only. Terminal does not run these.

---

# ARCHITECT RECONCILIATION ADDENDUM (2026-08-09 08:55Z, night block N5 — corrected blocks below WIN over the versions above; three divergences found, everything else VERIFIED against the Aug 8 proven transcript)

**VERIFIED WITHOUT CHANGE:** A-0 pin-capture-first with expected values; A-2/A-3 build+push (AR path, tag pattern); A-4 quoted metadata; A-5 reset; A-R rollback (tag-based + metadata revert + image-sha removal + the do-not-descend-past-0ecbe605 ruling — that ruling is exactly right and is hereby ratified as doctrine); B-1 rehearsal gate; B-2 apply flags + halt discipline; B-R honesty; all of Group C including the console-rollback honesty note.

## DIVERGENCE 1 — A-6 pattern list: tighten to the fully-harvested nine

"LobbyRegistry init or equivalent" invites judgment under pressure; two env-health lines are missing. REPLACE A-6's MUST-see list with (all harvested verbatim from the 2026-08-08 certified boots):
- `deployment.fingerprint` with `imageSha` == $NEW_DIGEST AND `commitSha` == $FULL_SHA
- `"nodeEnv":"production"`
- `envFingerprint` present AND zero occurrences of `"absent"`
- `hono.listening`
- `uws.listening`
- `event_subscription.started`
- `event_subscription.self_test_succeeded`
- `registry.idle_eviction_timer_started`
- `registry.clock_liveness_scanner_started`
(`event_subscription.watchdog_started` welcome as a tenth; it appears at boot too.)

## DIVERGENCE 2 — A-7 health probe: use the proven instrument, not an unverified endpoint

The curl probe assumes `/health/subscription` is publicly reachable through Caddy — unverified, and the `<PASTE ENGINE IP>` placeholder is exactly the under-pressure typing the runbooks ban. REPLACE A-7 with the docker-logs form proven all week:

```powershell
gcloud compute ssh citrus-draft-engine-staging --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet --command="sudo docker logs citrus-draft-engine --since 3m 2>&1 | grep -c watchdog_ok; echo END-1"
Start-Sleep -Seconds 70
gcloud compute ssh citrus-draft-engine-staging --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet --command="sudo docker logs citrus-draft-engine --since 3m 2>&1 | grep -c watchdog_ok; echo END-2"
```

PASS: both counts ≥1 and the watchdog is plainly ticking (counts move with the window). If the terminal can CITE Caddy config proving /health is proxied, the curl variant may be restored later — with the hostname hardcoded, never a placeholder.

## DIVERGENCE 3 — B-0 capture command produces a NON-EXECUTABLE capture (real defect — the rollback path depends on this file)

`psql -c "SELECT pg_get_functiondef(...)" | Out-File` writes an ALIGNED RESULT TABLE — header row, +----+ borders, "(1 row)" footer. B-R's rollback is `psql -f` of this very file, which would DIE ON THE DECORATIONS at the worst possible moment. REPLACE the capture command with tuples-only unaligned output:

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 -At `
  -c "SELECT pg_get_functiondef('public.submit_pick_v2(uuid,uuid,integer,uuid,text,text,jsonb,text)'::regprocedure);" `
  | Out-File -Encoding utf8 supabase/migrations/captures/2026-08-08_pre_v2_draft_completion_clears_draft_state.sql
```

Then eyeball the file's FIRST line: it must begin `CREATE OR REPLACE FUNCTION` — no borders, no headers. A capture that cannot be re-applied is not a capture (Rule 1's whole point).

**With these three corrections applied above, this file is GARRETT-READY.** — Architect
