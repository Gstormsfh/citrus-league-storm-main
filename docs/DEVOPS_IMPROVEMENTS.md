# DevOps Suggestions

A running list of improvements to evaluate and implement. Items are not prioritized — order reflects discovery, not urgency. Items carry a **Status** line once they ship or are decided; items without one are open.

---

## 1. Switch to main=staging, release/XXX=prod branching strategy

**Current state:** `master` auto-deploys to production on every merge. A separate `staging` branch deploys to the staging environment. PR preview channels are deployed to Firebase on every PR (using production secrets).

**Proposed change:**
- `master` → auto-deploys to staging (replaces the `staging` branch)
- `release/YYYY-MM-DD` (or `release/vX.Y`) → triggers production deploy (replaces the `master` trigger)
- Delete `deploy-preview.yml` — PRs validate on CI, staging validates the build before release

**Files to change:**
- `.github/workflows/production-deploy.yml` — change trigger from `master` to `release/**`
- `.github/workflows/staging-deploy.yml` — change trigger from `staging` to `master`
- `.github/workflows/deploy-preview.yml` — delete
- Branch protection rules — protect `master` (require CI) and `release/**` (require CI, no direct push)

**Note:** The `staging` branch does not currently exist on the remote. The staging CI workflow is wired to both `staging` and `staging-setup`, with `staging-setup` serving as a bootstrap branch until `staging` is created (per the comment in the workflow file). The staging environment has been deploying off `staging-setup` this whole time. Implementing this item creates `master` as the de facto staging branch and retires `staging-setup`.

**Why:**
- Prod deploys become intentional acts rather than automatic consequences of merging, which pairs well with the draft freeze guard and live user events
- Eliminates the awkward double-merge (`feature` → `staging` → `master`) currently required to validate before shipping
- Removes PR preview channels, which currently connect to the production Supabase database (real user data exposure on every PR)

---

## 2. Replace manual staging bootstrap with automated pg_dump → pg_restore from prod

**Current state:** Staging is bootstrapped via a manual 7-step runbook (`scripts/staging/README.md`): paste SQL into the Supabase dashboard, run several Node scripts, load reference data from locally-generated dump files. The core mechanism (`01-mark-migrations-applied.sql`) marks migrations as applied without actually running them, which has caused silent schema gaps (missing `handle_new_user` trigger, empty playoff tables). Reference data dumps are untracked and not gitignored.

**Proposed change:** A CI job (triggerable via `workflow_dispatch`, and scheduled periodically) that:
1. `pg_dump` full prod database — schema + all data including `auth.users` via service role
2. `pg_restore` to staging, replacing its current state
3. Apply any migrations present in the repo but not yet in staging's `supabase_migrations.schema_migrations` via `supabase db push`
4. Re-apply known cross-schema DDL (triggers bound to `auth.users`) as a post-restore script — `pg_dump` does not reliably capture cross-schema DDL targeting Supabase's managed `auth` schema

**On PII:** Staging DB access is restricted to the same people who have prod DB access, so copying user data does not expand the exposure surface. No anonymization required. FK graph remains fully intact with a straight copy.

**Why:**
- Eliminates the silent-skip antipattern: migrations actually run against real data instead of being marked as applied
- Catches data-specific migration issues (type mismatches, constraint violations, unexpected NULLs) that synthetic or partial data never surfaces
- Playoff tables, auth triggers, and all other prod state are present on staging automatically — no manual gap tracking
- Replaces `scripts/staging/` runbook, `chunk_*.sql` dump files, and `KNOWN_GAPS.md` ongoing triage with a single automated process
- Migration asymmetry between environments becomes detectable: the `supabase db push` step will fail loudly if staging diverged from prod in a way that makes a migration non-applicable

---

## 3. Apply new migrations to staging as a PR CI gate

**Current state:** CI validates migration file naming and checks for duplicate timestamps but never runs migrations. There is no gate that proves a new migration applies cleanly before it merges. Migrations are applied manually to prod post-merge, untested against real data.

**Proposed change:** Add a step to `ci.yml` that detects whether a PR introduces new migration files and, if so, runs `supabase db push` against staging. With item 2 in place (staging mirrors prod data), this means every new migration is validated against the actual data it will run on in production before the PR merges.

**Files to change:**
- `.github/workflows/ci.yml` — add a `validate-migrations` job that diffs migration files against `supabase_migrations.schema_migrations` on staging and applies any new ones via `supabase db push`, failing the PR if the push fails

**Why:**
- Catches data-specific migration failures (constraint violations, type mismatches, unexpected NULLs in prod data) before they reach prod
- Migrations currently go from "named correctly" to "applied to prod" with no intermediate validation — this closes that gap
- With staging mirroring prod (item 2), the test is meaningful: it's the same data shape, same volume, same FK graph

---

## 4. Make TypeScript type errors a hard CI gate

**Current state:** Both `ci.yml` and the deploy workflows run the web type check as `npx tsc --noEmit || echo "::warning::TypeScript found type errors — tracked for strict mode migration"`. Type errors warn but never fail the build or block a deploy.

**Proposed change:** Remove the `|| echo` fallback so `tsc --noEmit` failures exit non-zero and block the PR. The server type check already does this correctly — the web check should match it.

**Files to change:**
- `.github/workflows/ci.yml` — remove `|| echo "::warning::..."` from the web type check step
- `.github/workflows/staging-deploy.yml` — same
- `.github/workflows/production-deploy.yml` — same

**Why:**
- Type errors in CI that don't block merges accumulate. The `|| echo` pattern was likely added to unblock a specific PR and never revisited.
- The server already enforces this; inconsistency between web and server type gates creates a false sense of safety on the web side.
- Pre-condition: the existing type errors need to be resolved first, otherwise this gate immediately breaks CI on every PR.

---

## 5. Reconcile prod deploy env vars with Secret Manager

**Current state:** `production-deploy.yml` injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` directly as plaintext env vars via the `deploy-cloudrun@v2` action's `env_vars:` field. `ops/cloudrun/service.yaml` references the same secrets from GCP Secret Manager. These are two divergent paths: CI deploys via env vars, manual `gcloud run services replace` deploys via Secret Manager. Rotating a secret in Secret Manager has no effect on a CI-deployed revision.

**Proposed change:** Remove the `env_vars:` block from the deploy action and instead pass `--set-secrets` flags (or rely solely on `service.yaml`'s Secret Manager references) so all revisions, regardless of deploy path, read secrets from Secret Manager at runtime.

**Files to change:**
- `.github/workflows/production-deploy.yml` — replace `env_vars:` secret injection with `secrets:` references (matching the staging deploy workflow, which already does this correctly)

**Why:**
- Secret rotation in Secret Manager currently has no effect until the next CI deploy, which defeats the purpose of centralized secret management
- The staging deploy workflow already uses Secret Manager references correctly — prod should match
- Eliminates a divergence between the CI deploy path and the manual `gcloud run services replace` path

---

## 6. Move data pipeline off personal Windows machine

**Current state:** `ops/windows/` contains PowerShell scripts that install the NHL data scraping service as Windows Scheduled Tasks on what appears to be the developer's local machine. If that machine goes offline, restarts, or loses connectivity, stats stop updating silently — there is no alerting on pipeline staleness (as demonstrated by the playoff sync cron failing undetected for 14 days).

**Proposed change:** Move the data pipeline to a managed scheduled job — Cloud Run Jobs triggered by Cloud Scheduler is the natural fit given the existing GCP footprint. Each pipeline script becomes a Cloud Run Job invocation on a schedule, replacing the Windows Task Scheduler entries.

**Why:**
- A personal machine is not reliable infrastructure — it sleeps, reboots, loses network, and has no uptime SLA
- Cloud Run Jobs are the same runtime as the existing API server (Docker, same GCP project, same credentials model), so there is no new operational surface to learn
- Failures surface via Cloud Run job execution logs and can trigger alerting, unlike a silent Windows task failure
- Eliminates the entire `ops/windows/` directory

---

## 7. Audit all `continue-on-error: true` flags in CI workflows

**Current state:** At least one `continue-on-error: true` flag in `.github/workflows/playoff-sync.yml` masked a 14-day failure of the playoff series sync job during the most active part of the playoff season. The failure produced no alert and was only discovered incidentally. The known gaps ledger explicitly calls for auditing all 7 workflows for this pattern.

**Proposed change:** Grep `continue-on-error: true` across `.github/workflows/` and evaluate each instance. For each one, either:
- Remove the flag so failures surface loudly, or
- Document why the failure is genuinely tolerable and add a compensating monitoring control (e.g., a freshness check that alerts if data goes stale)

**Why:**
- `continue-on-error: true` is a silent failure trap — it makes a workflow green while hiding broken steps
- The playoff sync incident showed that a broken automated pipeline can go undetected for weeks with no user-visible signal other than stale data
- No rollback or recovery is possible if nobody knows the pipeline is broken

---

## 8. Gated, digest-verified draft-engine deploy workflow

**Status (2026-09-02):** Shipped — `.github/workflows/deploy-engine.yml`, `infra/gce/cloudbuild-draft-engine.yaml`, `docs/RUNBOOKS/ENGINE_DEPLOY.md`. Blocked on Garrett's one-time setup before the first run: create the `production-engine` environment with himself as required reviewer, and grant the deploy service account the VM/logging roles (WIF pool + provider preferred, `GCP_SA_KEY` fallback accepted). Setup steps, names only, in the runbook §6.

**Previous state:** `production-deploy.yml` shipped the API and web on every push to `master`, but the draft engine on `citrus-draft-engine-prod` was deployed entirely by hand in Cloud Shell (`gcloud builds submit` → digest → `add-metadata` → `reset` → log grep). On 2026-09-01 an ungated block chained `add-metadata` + `reset` after a cancelled build and pointed the VM at a tag that had never been pushed; the old container survived only because of `--restart=always`.

**Change:** `workflow_dispatch` → `build` (Cloud Build; fails unless the tag resolves to a digest) → `preflight` (no `in_progress` draft, daylight rule, `check_draft_freeze.ts`) → `deploy` (`environment: production-engine`, rollback pin recorded, one `add-metadata` call, `reset`) → `verify` (`deployment.fingerprint` with the new digest, endpoint 404, rollback commands printed on failure). Process audit 2026-09-01 §B-2 / §D-2.

**Follow-ups:** move `production-deploy.yml` to the same WIF variables once runbook §6.2 is done; post run outcomes to the `ops_ci_runs` bridge (audit §D-5) when it exists.
