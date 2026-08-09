# Sunday execution blocks — Groups A / B / C

**Author.** Terminal, 2026-08-09 O2 (Entry 16 overnight orders).
**For:** Garrett, Sunday morning execution.
**Prerequisite:** architect review at ~2:30 MT reconciles this against his own set; divergences = findings.
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

**MUST see (harvested from 2026-08-08 successful deploys, per DEPLOY_PROTOCOL §1 corrected vocabulary):**
- `deployment.fingerprint` — with `imageSha` == `$NEW_DIGEST` AND `commitSha` == `$FULL_SHA`.
- `hono.listening` — port 3001.
- `uws.listening` — port 3002 (**the single MOST load-bearing check per 2026-07-27 strike #2**).
- `event_subscription.started`.
- `event_subscription.self_test_succeeded`.
- `event_subscription.watchdog_started`.
- `LobbyRegistry` init or equivalent.

If ANY missing after 60s AND another 30s refetch → **HALT + rollback per A-R below**. Do not diagnose forward.

### A-7. Health probe (twice, ~70s apart — proves watchdog advances)

```powershell
$engineHost = "<PASTE ENGINE PUBLIC IP OR HOSTNAME>"
curl "https://$engineHost/health/subscription" ; Start-Sleep -Seconds 70 ; curl "https://$engineHost/health/subscription"
```

Both should return `connected: true`. `lastSelfTestOkAt` MUST advance between the two reads.

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

**Rule 1 (capture-before-replace)** — Garrett MUST populate the capture file with LIVE pg_get_functiondef output before the apply, or STEP 0 aborts with an explicit RAISE EXCEPTION. Capture command:

```powershell
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 `
  -c "SELECT pg_get_functiondef('public.submit_pick_v2(uuid,uuid,integer,uuid,text,text,jsonb,text)'::regprocedure);" `
  | Out-File -Encoding utf8 supabase/migrations/captures/2026-08-08_pre_v2_draft_completion_clears_draft_state.sql
```

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
