# Deploy protocol — F26 + F27 combined engine deploy

**Status:** Design ratified. Awaiting deploy slot per daylight rule (§4d).
**Target:** citrus-draft-engine-staging (GCE, per ADR-001 + PHASE_4_5_ARCHITECTURE).
**Previous engine deploy:** `527ceb38` (2026-08-04, KI-026 close).
**Scope:** LobbyManager `applyEventDuringBootstrap` switch — F26 `case 'draft_completed'` (append + broadcast + timer-cancel + teardown-by-idle-reap) + F27 `case 'draft_started'` (append + broadcast + timer-arm). Shared-types union widened with two new `BufferedDraftEvent` variants.

Author: architect (protocol shape, 2026-08-06) + terminal (§1-3 verbatim citation of 527ceb38 pipeline + §4 architect additions).

---

## §0 Automated path (added 2026-09-02)

For **production** the manual sequence in §1–§4 is superseded by the
gated `Deploy Engine` workflow — `.github/workflows/deploy-engine.yml`,
runbook `docs/RUNBOOKS/ENGINE_DEPLOY.md`: `build` (Cloud Build via
`infra/gce/cloudbuild-draft-engine.yaml`, fails unless the pushed tag
resolves to a digest) → `preflight` (no `in_progress` draft, the §4d
daylight rule as a hard check, `scripts/check_draft_freeze.ts`) →
`deploy` (required-reviewer approval in the `production-engine`
environment; the §4b rollback pin is recorded in the job summary before
the one `add-metadata` call and the `reset`) → `verify` (the engine's
`deployment.fingerprint` must carry the new digest, then the endpoint
must answer 404). Use §1–§4 by hand only when GitHub Actions or the GCP
auth path is unavailable. The 2026-09-01 ghost-tag reset — metadata +
reset chained after a cancelled build — is the failure the job graph
makes impossible.

Two corrections to the text below that the workflow already encodes:

- The VM builds `IMAGE_URI` from the `image-tag` metadata key
  (`infra/gce/draft-engine-startup.sh`), so the §4b `:latest` retag is
  not required for the metadata-driven VM. Rollback is the previous
  `image-tag` / `image-sha` / `commit-sha` in **one** `add-metadata` call
  followed by `reset`.
- Docker's gcplogs driver ships the engine's JSON line as the *string*
  `jsonPayload.message`, so Cloud Logging queries must use
  `jsonPayload.message:"deployment.fingerprint"` (substring), not
  `jsonPayload.message="deployment.fingerprint"` as written in §4b.

## §1 Base pipeline (verbatim from 527ceb38 documented deploy, 2026-08-04)

The 527ceb38 deploy (KI-026 close entry in `docs/REGISTRY.md:271`) established the documented shape. F26+F27 rides this pipeline unchanged for §1's steps; §4 adds four new items.

Reference deploy record:
- Image tag: `527ceb38-draft`
- Image digest: `sha256:d693189d6b2966e27164e9288bec314ef9a34c8907aa4b5165a9c8a39d6cb614`
- Commit sha: `527ceb384d280ed3853de6e36000b442a54fdc76`
- 9-item boot verification passed at `2026-08-04T15:51:55Z`
- `deployment.fingerprint` observability payload confirmed `imageSha == push digest` AND `commitSha == HEAD`

### 9-item boot verification (CORRECTED 2026-08-07 per INS-16)

**Prior emissions of this list were FICTION** — patterns like `hono.server.bound`, `uws.server.bound`, `secrets.loaded`, `NODE_ENV`, `gce.metadata.resolved`, `db_url.direct_connection_ok`, `LobbyRegistry init`, and `startup.shared_types_version` do **not** exist in the engine's log vocabulary and could never match a healthy boot. F27b-1 deploy 2026-08-07 booted clean in 18ms but the checklist "failed" against every single item, correctly not triggering rollback but revealing the checklist as compose-from-memory rather than harvest-from-real-output. See INS-16.

**Canonical vocabulary — harvested from live source** (`grep -rn` in `server/src/draft/`):

| # | Pattern | Emitted by (file:line) | Signal |
|---|---------|------------------------|--------|
| 1 | `deployment.fingerprint` | `index.ts:192` | `imageSha` + `commitSha` + `imageTag` + `bootAt` + `envFingerprint` map |
| 2 | (nested in #1) `envFingerprint` fields all `present` | `index.ts:188-190` | Every required env var populated |
| 3 | `hono.listening` | `index.ts:158` | Hono HTTP server bound, port emitted |
| 4 | `uws.listening` | `uws-server.ts:674` | uWS server bound, port emitted |
| 5 | `event_subscription.started` | `eventSubscription.ts:728` | LISTEN client connected (chunk 11g.7 sub-step 7e) |
| 6 | `event_subscription.self_test_succeeded` | `eventSubscription.ts:379` | LISTEN/NOTIFY round-trip verified |
| 7 | `registry.idle_eviction_timer_started` | `LobbyRegistry.ts:725` | Idle-reap scanner scheduled |
| 8 | `registry.clock_liveness_scanner_started` | `LobbyRegistry.ts:866` | Clock-liveness scanner scheduled |
| 9 | `heartbeat.timer_started` | `uws-server.ts:651` | App-level WS ping/pong watchdog scheduled |

Each item logs at INFO with a structured payload. Verification is exact-name grep, not free-text pattern match.

**Removed:** the `startup.shared_types_version` guard (§4a below) was fiction — no such log line exists. Guard is REMOVED until an actual emission is added. Docket task if the boot-time assert is wanted; otherwise the shared-types diff is covered transitively via the `deployment.fingerprint` `imageSha` digest chain (the build ordering §4a still stands; only the log-line assertion is removed).

## §2 Standing rules (all apply to this deploy)

- **KI-E010** — direct-connection SUPABASE_DB_URL only, no pooler patterns.
- **PROD_CHANGE_LEDGER Rule 2** — read recent history before touching shared objects. F27 migration authorship covered this via `scripts/proof/preapply-f27-history-read.local.sql` on 2026-08-06 (Q1 zero rows expected).
- **`feedback_hand_off_infra_commands.md`** — Garrett executes all gcloud / docker / ssh / prod commands. Terminal never invokes via Bash.

## §3 Deploy-time discipline (from 527ceb38 record)

- Image builds locally, pushes to Artifact Registry with commit-sha tag.
- GCE VM startup script (`infra/gce/draft-engine-startup.sh`) pulls the tagged image and runs it with Secret Manager-fetched env.
- Post-deploy `deployment.fingerprint` observability payload is the primary boot-verification signal (paste back to architect).
- Rollback historically: re-tag the prior image as `latest`, `gcloud compute instances reset`, VM re-pulls.

## §4 Architect additions for F26+F27 deploy (2026-08-06)

Four additions to the §1-3 base pipeline:

### §4a Build ordering: shared → server, digest chain covers the widened union

The shared-types diff at `packages/shared/src/types/draftWire.ts` adds two `BufferedDraftEvent` union variants (`kind: 'draft_started'`, `kind: 'draft_completed'`). The server bundle depends on `@citrus/shared`; if the shared build is stale, the server bundle can silently ship the old union shape.

**Enforcement:**
- Local build command: `npm run build:server` (root workspace) — internally runs `npm run build --workspace=packages/shared && npm run build --workspace=server`. Order is enforced by the script chain.
- Deploy image build: the Dockerfile MUST run `npm run build:server` (not just `npm run build --workspace=server`) so the shared package is compiled BEFORE the server bundle.
- The pushed image's digest is the same digest chain that ran `build:server` locally — the deployment.fingerprint `imageSha` covers the shared-types change transitively.
- **Verification step (new, add to §1 item 5):** after `deployment.fingerprint` logs, terminal (or Garrett) runs a one-off log-based assertion: `structuredLogger.debug('startup.shared_types_version', { hasDraftStartedKind: <check>, hasDraftCompletedKind: <check> })` — proves the compiled server bundle knows the new variants exist. (Concrete implementation: assert type existence via a defensive `typeof` check at boot in `server/src/draft/index.ts`; if not present, log FATAL and fail boot.)

### §4b Rollback pin — record current running image digest BEFORE deploy

Zero-diagnosis-time rollback target. If the deploy behaves wrong, revert IMMEDIATELY without needing to reconstruct the prior digest from git history or Artifact Registry timestamps.

**Pre-deploy step (add to §3 before push):**
```powershell
# Query the currently-running image digest on the target VM.
gcloud compute ssh <vm-name> --project=citrus-fantasy-staging --zone=<zone> --quiet -- 'docker ps --format "{{.Image}}" | head -1'
# Also grab the fingerprint-log's imageSha for triangulation.
gcloud logging read --project=citrus-fantasy-staging --limit=1 --format='value(jsonPayload.imageSha)' 'jsonPayload.message="deployment.fingerprint"' --order=desc
```

Terminal records both values in the deploy notice + commits to `docs/DEPLOY_PROTOCOL_F26_F27.md` §5 "Deploy log" (this doc) BEFORE the deploy runs.

**Rollback command (kept ready throughout the deploy window):**

**AR path CORRECTED per INS-16 doc-defect flag** — actual infra uses `northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine` (per `infra/gce/draft-engine-startup.sh:114-119`).

```powershell
# Rollback shape (tag-based, per architect P1 ruling — full 64-hex digest
# in the tag command is redundant when we retag by tag).
# THREE commands: retag → metadata revert → reset.

# (1) Retag PRIOR_TAG → :latest so startup script re-pulls the old image
gcloud artifacts docker tags add `
  northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:<PRIOR_TAG> `
  northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:latest `
  --quiet

# (2) Metadata revert BEFORE reset (otherwise VM boots old image while
#     fingerprint metadata claims new one, poisoning post-rollback verification)
gcloud compute instances add-metadata citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a `
  --metadata="image-tag=<PRIOR_TAG>,commit-sha=<PRIOR_COMMIT>" `
  --quiet
gcloud compute instances remove-metadata citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a `
  --keys=image-sha --quiet

# (3) Reset the VM — startup script re-pulls :latest (now old image)
gcloud compute instances reset citrus-draft-engine-staging `
  --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet
```

### Current rollback pin (advanced 2026-08-08 per F26+F27+F27b-1 certification)

- **Rollback pin (previous-good, tape-to-monitor):** `0ecbe605-draft @ sha256:152b79912cea9d80cf5c3147beeba48957973f5d201d54bdc9a3d6c429768a32`
  - `<PRIOR_TAG>` = `0ecbe605-draft`
  - `<PRIOR_COMMIT>` = `0ecbe605`
- **Retired (was previous-good pre-2026-08-08):** `8b7b43f6-draft @ sha256:881024ba…` (pre-F26/F27 image; do not roll back this far)

`--quiet` per Rule 4. Rollback is instant — no diagnosis of what went wrong required; that happens after the room is safe.

### §4c Sequence — deploy → boot → smoke → THEN full rigs

Never straight from boot to a 600-line acceptance run. Intermediate smoke establishes basic health.

**Sequence:**
1. **Deploy** — push image, reset VM, VM pulls + starts.
2. **9-item boot verification** (§1) — all nine INFO logs land within 60s of boot start. Paste back to architect.
3. **§4a shared-types version assertion** — bundle knows the two new variants.
4. **3-pick smoke on standard rig** — `scripts/proof/fixture-12.mjs --reset --execute` + `--execute` + `scripts/proof/draft-harness.mjs --picks=3`. Just three picks; confirms the pick path still works end-to-end post-deploy. Expected: 3 pick events, 3 broadcasts observed, zero errors. Same rig that ran on 527ceb38.
5. **Full lifecycle acceptance rig (Rider 4)** — `scripts/proof/lifecycle-acceptance-f27.local.mjs --mode=lifecycle`. Six assertions A/B/C/D/E/F.
6. **Full zero-client acceptance rig (Rider 2)** — `scripts/proof/lifecycle-acceptance-f27.local.mjs --mode=zero-client`. Five-step scenario, real-wall-clock wait for `first_pick_deadline` to elapse.

**Halt discipline:** any step fails → HALT + rollback per §4b. Do not continue to the next step trying to diagnose forward. Rollback first, diagnose after.

### §4d Daylight rule — no engine deploy after midnight

Deploy is a mutating shared action; if it goes wrong at 2 AM, the room-affecting diagnostic window is minimal. Rule:

- **No engine deploy after midnight** local time (MT).
- **Rig runs** may run late (they don't mutate deployed state), but the DEPLOY itself waits for daylight.
- **Tonight (2026-08-06 evening, 22:00 MT cron witness pending):** DB apply proceeds tonight; engine deploy waits until tomorrow morning. Whole day for acceptance runs (§4c steps 4-6) + follow-up if any step fails.

**Natural deploy slot:** tomorrow morning (2026-08-07), post-daylight, post-the-22:00-MT-cron-witness sanity check.

## §5 Deploy log (fill in at deploy time)

| Field | Value |
|---|---|
| Pre-deploy running image digest | `<record before push>` |
| Pre-deploy fingerprint.imageSha | `<record before push>` |
| Pre-deploy fingerprint.commitSha | `<record before push>` |
| New image tag | `<commit-sha>-draft` |
| New image digest | `<from Artifact Registry after push>` |
| New commit sha | `<HEAD>` |
| Deploy start (UTC) | |
| VM reset issued | |
| 9-item boot verify pass timestamp | |
| §4a shared-types assertion pass | |
| §4c step 4 3-pick smoke result | |
| §4c step 5 lifecycle rig result | A/B/C/D/E/F |
| §4c step 6 zero-client rig result | 1/2/3/4/5 |
| Any HALT + rollback | |
| Post-deploy `deployment.fingerprint` verify | imageSha == push digest AND commitSha == HEAD |

## §6 Post-deploy checklist

- [ ] Deploy log §5 filled in.
- [ ] `deployment.fingerprint` observability payload matches expected (paste to architect).
- [ ] KI-035 (F26) close-out entry added to REGISTRY.
- [ ] F27 (KI candidate) close-out entry added to REGISTRY.
- [ ] Task #40 (F26) marked completed.
- [ ] Task #48 (F27) marked completed.
- [ ] `docs/DESIGN_F27_start_draft_v2.md` gets a "SHIPPED" annotation with deploy digest + timestamp.
- [ ] Break-glass rename ships in the same PR docs (§9 of design doc; already renamed).
- [ ] `scripts/proof/README.md` updated to reflect break-glass status (retirement note; separate small commit if needed).

## §7 Rollback triggers

Any of the following triggers immediate §4b rollback:
- Any of the 9 boot items fails or times out (>60s to first INFO).
- `§4a` shared-types assertion fails (bundle doesn't know the new variants).
- 3-pick smoke fails (broken pick path — regression from 527ceb38).
- Lifecycle rig any assert fails.
- Zero-client rig any step fails.
- Any structured error log emits in the first 5 minutes post-boot (excluding known-benign warnings like the F21 `systemFlags.ts:96` observability bug per KI-027).

## §8 References

- `docs/DESIGN_F27_start_draft_v2.md` — F27 design doc (commit c8aabe32).
- `docs/PROD_CHANGE_LEDGER.md` — cross-workstream coexistence protocol.
- `docs/REGISTRY.md` KI-035 — F26 (external-apply broadcast).
- `docs/REGISTRY.md` KI-026 — 527ceb38 deploy (previous engine deploy record).
- `server/src/draft/index.ts` — startup log emissions (9-item boot verification source).
- `infra/gce/draft-engine-startup.sh` — GCE VM bootstrap script.
- `feedback_hand_off_infra_commands.md` (memory) — infra-command discipline.
