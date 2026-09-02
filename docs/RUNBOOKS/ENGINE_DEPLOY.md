# Engine deploy — the `Deploy Engine` workflow

> Deploys the draft engine to the GCE VM `citrus-draft-engine-prod`
> (`northamerica-northeast1-a`, project `citrus-fantasy-prod`) through
> `.github/workflows/deploy-engine.yml`.
> Audience: whoever presses the button (today: Garrett).
> Authority: supersedes the hand-run Cloud Shell sequence in
> `docs/DEPLOY_PROTOCOL_F26_F27.md` §1–4 and `LAUNCH_BUILD_2026-08-24.md` §4
> for production. Those documents remain the reference for *why* each
> step exists; this one is *how to run it*.

The API and web still ship themselves on every push to `master`
(`production-deploy.yml`). Only the engine goes through this workflow.
Order is unchanged: **engine first, then land the commit on `master`**.

---

## 0. Run it (2 minutes of attention, ~8 minutes wall clock + your approval)

1. GitHub → **Actions** tab → **Deploy Engine** (left sidebar) → **Run workflow**.
2. Fill in:
   - **ref** — what to build. Default `master`. A branch, tag or full SHA.
   - **skip_daylight_rule** — leave **off**. Only for a genuine emergency
     between 00:00 and 06:59 MT (see §1, `preflight`).
   - **reason** — one line, e.g. `F31 auction anti-snipe fix`. Recorded in
     the run summary; this is the deploy log.
3. Press **Run workflow**. `build` (~5 min) and `preflight` (~2 min,
   mostly `npm ci` for the freeze guard) run on their own. Nothing has
   touched the VM yet.
4. When `deploy` reaches the `production-engine` gate the run pauses and
   GitHub shows **Review deployments**. Read the two summaries above the
   button (image digest, preflight results, the rollback pin), then
   **Approve and deploy**. Rejecting ends the run with nothing changed.
5. `deploy` writes the metadata and resets the VM (~30 s). `verify` waits
   for the engine's own `deployment.fingerprint` line with the new digest
   (typically 60–120 s), then checks the public endpoint.
6. Green `verify` = the running engine is the image you built. Continue
   with the smoke sequence in `DEPLOY_PROTOCOL_F26_F27.md` §4c, then land
   the same commit on `master`.

Red anywhere → §4 (rollback) and §5 (what each failure means).

---

## 1. What each job checks

| Job | Runs on | What it does | Fails when |
|---|---|---|---|
| **build** | the `ref` you chose | `gcloud builds submit` with `infra/gce/cloudbuild-draft-engine.yaml` (context = repo root, `server/Dockerfile.draft-engine`), tag `engine-<first 8 of the SHA>`, then `gcloud artifacts docker images describe … --format='value(image_summary.digest)'`. | The build fails, is cancelled, **or the tag has no digest** in Artifact Registry. A build that did not push cannot be deployed (Trap 1, `LAUNCH_BUILD_2026-08-24.md` §4). |
| **preflight** | the branch the workflow was launched from (normally `master`) | (a) **Daylight rule** — `DEPLOY_PROTOCOL_F26_F27.md` §4d, encoded as *blocked while the Mountain Time hour is before 07:00* (`DAYLIGHT_START_HOUR` in the workflow). (b) **No draft in progress** — PostgREST `leagues?draft_status=eq.in_progress&select=id` must return `[]`. (c) **Change freeze guard** — `npx tsx scripts/check_draft_freeze.ts`, exactly as `production-deploy.yml` runs it (24 h before a scheduled draft, or a draft live in the last 6 h). | Any of the three. (a) can be bypassed with `skip_daylight_rule`; (c) with the repository variable `OVERRIDE_DRAFT_FREEZE=1` (same as the API deploy); (b) has **no bypass** — a stale `in_progress` row is a data fix, not a deploy decision. |
| **deploy** | — | Waits for approval (§2). Then, in order: confirm the environment really has a required reviewer; read the VM's current `image-tag` / `image-sha` / `commit-sha` and write them to the job summary as the **rollback pin** (§4b of the protocol); *last look* — re-run the live-draft, freeze and daylight checks because the approval may have waited hours; **one** `gcloud compute instances add-metadata` call carrying all three keys (Trap 2: the fingerprint echoes these keys, so they must change together); `gcloud compute instances reset`. | The last look trips, or a gcloud call fails. If it fails *after* the metadata write, the job prints the rollback commands itself. |
| **verify** | — | Polls `gcloud logging read` for up to 6 minutes for a `deployment.fingerprint` entry from this VM, after the reset, whose `imageSha` equals the new digest (and whose `commitSha` equals the built SHA). Then `curl -s -o /dev/null -w '%{http_code}' https://draft.citrusfantasysports.com/` must return **404** — that is the alive signal (Caddy → uWS answers 404 for `/`). | No matching fingerprint in 6 minutes, a fingerprint with a mismatched commit, or a non-404 endpoint. The failure step prints the three rollback commands with the pinned previous values. |

Why the fingerprint check is sound even though `imageSha` is metadata,
not a hash of the running code (Trap 2): the startup script pulls the
tag *before* it removes the old container. A failed pull aborts the
script and `--restart=always` brings the old container back — with its
old `IMAGE_SHA` env — so the fingerprint after a ghost-tag reset shows
the **old** digest and `verify` fails. A fingerprint with the new digest
can only come from a container the script started after a successful
pull of the new tag.

---

## 2. The approval step

`deploy` runs in the GitHub environment **`production-engine`**. With a
required reviewer configured (§6.1) the run stops before the first
mutating command until that reviewer approves. Rejecting, or simply not
approving, changes nothing on the VM; the run times out after 30 days.

What to read before approving — all in the run summary:

- **Engine build**: ref, commit, image, **digest** (must be a full
  `sha256:` value — the job cannot reach this point otherwise).
- **Preflight**: daylight passed or BYPASSED, no draft in progress,
  freeze guard passed.
- After approval the **Rollback pin** table appears under the deploy
  job; it is what §4 uses.

The workflow additionally refuses to run if the environment has no
required-reviewer rule (GitHub auto-creates a rule-less environment the
first time a workflow references one — that is the trap §6.1 closes).

---

## 3. Reading the result

The run summary is the deploy record. It contains, per run: who
triggered it and why, ref + commit + image + digest, preflight results,
the rollback pin, the metadata that was written, the reset time, the
fingerprint JSON the engine logged, and the endpoint status. Nothing in
it is secret (the fingerprint's `envFingerprint` map is
present/missing, never values).

Manual spot-check, if you want one (Cloud Shell or laptop):

```bash
gcloud compute instances describe citrus-draft-engine-prod \
  --project citrus-fantasy-prod --zone northamerica-northeast1-a \
  --format json | jq '.metadata.items[] | select(.key | test("image-tag|image-sha|commit-sha"))'

gcloud logging read 'resource.type="gce_instance" AND jsonPayload.message:"deployment.fingerprint"' \
  --project citrus-fantasy-prod --limit 1 --order desc --format 'value(timestamp,jsonPayload.message)'

curl -s -o /dev/null -w '%{http_code}\n' https://draft.citrusfantasysports.com/   # 404 = alive
```

---

## 4. Rollback

Roll back first, diagnose after (§4c halt discipline). The failure step
of `verify` (and of `deploy`, if it died after the pin) prints the exact
commands with the previous values filled in — copy them from the run.
Their shape:

```bash
# 1) Point the VM back at the previous image (ONE call, all keys together)
gcloud compute instances add-metadata citrus-draft-engine-prod \
  --project citrus-fantasy-prod --zone northamerica-northeast1-a \
  --metadata "image-tag=<PREV_TAG>,image-sha=<PREV_SHA>,commit-sha=<PREV_COMMIT>"

# 2) Reset so the startup script re-pulls that tag
gcloud compute instances reset citrus-draft-engine-prod \
  --project citrus-fantasy-prod --zone northamerica-northeast1-a --quiet

# 3) Confirm the previous fingerprint is back, then the endpoint answers 404
gcloud logging read 'resource.type="gce_instance" AND jsonPayload.message:"deployment.fingerprint" AND jsonPayload.message:"<PREV_SHA>"' \
  --project citrus-fantasy-prod --limit 1 --order desc --freshness 15m --format 'value(jsonPayload.message)'
curl -s -o /dev/null -w '%{http_code}\n' https://draft.citrusfantasysports.com/
```

Notes:

- The pin lives in the **deploy job summary** of the run that deployed
  the bad image, under *Rollback pin (recorded before any mutation)*.
- There is no `:latest` retag step (unlike `DEPLOY_PROTOCOL_F26_F27.md`
  §4b): the startup script builds `IMAGE_URI` from the `image-tag`
  metadata key (`infra/gce/draft-engine-startup.sh`, "IMAGE_TAG"), so
  the metadata write *is* the retarget. Never delete engine tags from
  Artifact Registry — the previous tag is the rollback target.
- If the previous VM had one of the keys unset, the printed block
  includes a `remove-metadata --keys` line for it so the VM returns to
  exactly its prior state.
- Rolling back the engine does not roll back the database. If the
  deploy shipped with a migration, see
  `draft-engine-v2-rollback-playbook.md` Scenario 1 for sequencing.

---

## 5. When a job fails

| Failed job / step | What it means | Do |
|---|---|---|
| `build` — Cloud Build | The image did not build. Nothing was pushed, nothing touched the VM. | Read the Cloud Build log link in the step output, fix, re-run. |
| `build` — *Capture image digest* | The build "succeeded" but the tag has no digest (push failed, wrong repo, cancelled mid-push). Nothing touched the VM. | Check Artifact Registry `citrus-draft-engine`; re-run. This is the tonight-2026-09-01 failure caught where it belongs. |
| `preflight` — daylight | It is between 00:00 and 06:59 MT. | Re-run after 07:00 MT. Emergency only: re-run with `skip_daylight_rule` and say why in `reason`. |
| `preflight` — no draft in progress | A league has `draft_status=in_progress`. A reset would disconnect its room. | Wait for the draft to finish. If the row is stale, fix the league's status in the database first. |
| `preflight` — change freeze | A draft is scheduled inside 24 h, or one was live inside 6 h. | Wait, or (emergency, to *unblock* a broken draft only) set repository variable `OVERRIDE_DRAFT_FREEZE=1`, re-run, unset it after. |
| `deploy` — *Confirm production-engine has a required reviewer* | The environment exists but has no reviewer rule; the job would have deployed unapproved. Nothing touched the VM. | §6.1, then re-run. |
| `deploy` — last look | A draft went live / a freeze started / midnight passed while the run waited for approval. Nothing touched the VM. | Re-run later. |
| `deploy` — after *Point the VM at the new image* | Metadata is written but the reset did not happen (the reset step only runs once the write succeeded, so the reverse cannot occur). The VM will pick up the new tag on its next boot. | Either re-issue the reset by hand (the `gcloud compute instances reset …` command from §4 step 2) and then run the §3 spot-check, or run the printed rollback. |
| `verify` — fingerprint | The engine did not report the new digest within 6 min. Most likely: the pull failed and the previous container was resurrected (`verify` prints the latest fingerprints of any digest so you can see which), or the VM is still installing packages. | Run the §3 spot-check once more. If the fingerprint still shows the previous digest, roll back (§4) — the metadata points at an image the VM cannot run. |
| `verify` — endpoint | Fingerprint is right but `https://draft.citrusfantasysports.com/` is not answering 404. | `502`/`000` usually means Caddy is up before the engine finished binding — wait 30 s and curl again. Anything persistent: roll back, then read the container log (`gcloud logging read 'labels.app="citrus-draft-engine"' --project citrus-fantasy-prod --limit 50 --order desc`). |

---

## 6. One-time setup (Garrett, ~30 min) — names only, never values

Nothing below passes a credential through chat or the repo. Steps 6.1
and 6.3 are required. 6.2 is the preferred auth path; skipping it is
allowed (the workflow falls back to the existing `GCP_SA_KEY` secret).

### 6.1 The `production-engine` environment with you as reviewer

GitHub → repo **Settings → Environments → New environment** →
name `production-engine` → **Configure**:

- **Required reviewers** → add yourself → Save protection rules.
- Leave **Prevent self-review** *unchecked* (you trigger and approve).
- **Deployment branches and tags** → *Selected branches* → `master`.
  The rule applies to the branch the workflow file is run from, not to
  the `ref` input, so workflow-file changes have to be merged before
  they can deploy — which is the point.
- No environment secrets or variables are needed; the workflow reads
  repository-level ones so `build` and `verify` (outside the
  environment) see the same names.

Do this **before the first run**. A workflow that references a
non-existent environment makes GitHub create it with no rules; the
workflow's own guard refuses to deploy through such an environment, but
the guard is a backstop, not the plan.

### 6.2 Auth path A (preferred): Workload Identity Federation

Adapted from `GCP_ORG_SETUP.md` §7.3, which was written for this moment
and never executed. Cloud Shell, as the org/project owner:

```bash
PROJECT_ID=citrus-fantasy-prod
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
DEPLOY_SA=citrus-deploy@$PROJECT_ID.iam.gserviceaccount.com
REPO=gstormsfh/citrus-league-storm-main

# WIF needs the token-exchange + impersonation APIs.
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project=$PROJECT_ID

gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions" \
  --project=$PROJECT_ID

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --workload-identity-pool=github --location=global \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'" \
  --project=$PROJECT_ID

gcloud iam service-accounts add-iam-policy-binding $DEPLOY_SA \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" \
  --project=$PROJECT_ID

# The two repository VARIABLE values (not secrets — neither is sensitive):
echo "GCP_WORKLOAD_IDENTITY_PROVIDER = projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-provider"
echo "GCP_DEPLOY_SERVICE_ACCOUNT     = $DEPLOY_SA"
```

Then GitHub → **Settings → Secrets and variables → Actions → Variables**
→ new repository variables `GCP_WORKLOAD_IDENTITY_PROVIDER` and
`GCP_DEPLOY_SERVICE_ACCOUNT` with the two values printed above. The
workflow switches to WIF as soon as both exist; `production-deploy.yml`
can be moved to the same pair afterwards (its `credentials_json` →
`workload_identity_provider` + `service_account`).

### 6.2b Auth path B (fallback): keep `GCP_SA_KEY`

Nothing to do for auth. The workflow uses the `GCP_SA_KEY` secret that
`production-deploy.yml` already uses whenever the two WIF variables are
absent. Grant the roles in 6.3 to the same service account the key
belongs to.

### 6.3 Roles for the deploy service account (both paths)

`citrus-deploy@citrus-fantasy-prod.iam.gserviceaccount.com` already holds,
per `GCP_ORG_SETUP.md` §7.1: `roles/run.admin`,
`roles/iam.serviceAccountUser`, `roles/artifactregistry.writer`
(project-wide, which covers pushing to `citrus-draft-engine` and reading
the digest), `roles/cloudbuild.builds.editor`, `roles/storage.admin`
(Cloud Build staging bucket + log streaming), `roles/firebasehosting.admin`.
Confirm with:

```bash
gcloud projects get-iam-policy citrus-fantasy-prod \
  --flatten="bindings[].members" \
  --filter="bindings.members:citrus-deploy@" \
  --format="table(bindings.role)"
```

Add what the engine deploy needs on top — the VM operations and log
reading:

```bash
PROJECT_ID=citrus-fantasy-prod
DEPLOY_SA=citrus-deploy@$PROJECT_ID.iam.gserviceaccount.com

# Exactly the four permissions deploy-engine.yml uses against the VM:
# read the current metadata (pin), write it, reset, and poll the
# resulting operation (gcloud waits on every mutating call).
gcloud iam roles create citrusEngineDeployer --project=$PROJECT_ID \
  --title="Citrus Engine Deployer" \
  --description="deploy-engine.yml: get/setMetadata/reset one VM + poll the operation" \
  --permissions=compute.instances.get,compute.instances.setMetadata,compute.instances.reset,compute.zoneOperations.get \
  --stage=GA

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$DEPLOY_SA" \
  --role="projects/$PROJECT_ID/roles/citrusEngineDeployer" \
  --condition=None

# verify job: gcloud logging read
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$DEPLOY_SA" \
  --role="roles/logging.viewer" \
  --condition=None
```

Alternatives, if you prefer predefined roles: `roles/compute.instanceAdmin.v1`
is the broad predefined equivalent (it also allows create/delete of any
instance in the project). Scoping either role to the one VM with an IAM
condition (`resource.name == "projects/citrus-fantasy-prod/zones/northamerica-northeast1-a/instances/citrus-draft-engine-prod"`)
works for the three `compute.instances.*` permissions but **not** for
`compute.zoneOperations.get` — the operation is a different resource and
gcloud would fail while polling *after* the reset was already issued.
If you want the condition, keep `compute.zoneOperations.get` in a second,
unconditional binding. With a single VM in the project the unconditional
custom role above is the pragmatic choice.

The Cloud Build *runtime* identity (the project's default Cloud Build
SA, see §7.3a) is unchanged — it already pushed tonight's image.

### 6.4 Secrets and variables the workflow reads (names)

| Name | Kind | Already exists? | Used by |
|---|---|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | repository variable | new (6.2) | build, deploy, verify — selects WIF when set together with the next one |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | repository variable | new (6.2) | same |
| `GCP_SA_KEY` | repository secret | yes (`production-deploy.yml`) | fallback auth when the two variables are unset |
| `VITE_SUPABASE_URL` | repository secret | yes | preflight + last look (PostgREST, freeze RPC) |
| `SUPABASE_SERVICE_ROLE_KEY` | repository secret | yes | same |
| `OVERRIDE_DRAFT_FREEZE` | repository variable | yes (normally unset) | emergency freeze bypass, same semantics as the API deploy |
| `GITHUB_TOKEN` | automatic | yes | reading the environment's protection rules |

### 6.5 First run

The first run is a real deploy. Pick daylight, no drafts scheduled, and
deploy the commit that is already running (so a surprise is limited to
the pipeline, not the code): `ref` = the `commit-sha` currently in the
VM metadata (§3 spot-check shows it). A green `verify` on that run
proves auth, roles, the environment gate and the log filter end to end.

---

## 7. References

- `.github/workflows/deploy-engine.yml` — the workflow (comments at the
  top summarise the gating model and the roles).
- `infra/gce/cloudbuild-draft-engine.yaml` — the Cloud Build config it
  submits; the same file works from Cloud Shell for a manual build.
- `infra/gce/draft-engine-startup.sh` — what the VM does on reset: reads
  `image-tag` / `image-sha` / `commit-sha`, pulls, replaces the container.
- `docs/DEPLOY_PROTOCOL_F26_F27.md` — §4b rollback pin, §4c halt
  discipline and smoke sequence, §4d daylight rule.
- `LAUNCH_BUILD_2026-08-24.md` §4 — the two traps this workflow encodes.
- `docs/RUNBOOKS/GCP_ORG_SETUP.md` §7.1 / §7.3 — the deploy SA and the WIF
  outline the one-time setup adapts.
- `scripts/check_draft_freeze.ts` — the freeze guard preflight runs.
- `docs/RUNBOOKS/draft-engine-v2-rollback-playbook.md` — when the
  regression is not "wrong image" but "wrong code": snapshot-version and
  migration sequencing.
