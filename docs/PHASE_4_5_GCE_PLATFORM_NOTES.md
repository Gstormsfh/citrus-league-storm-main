# Phase 4.5 — GCE Platform Notes

Output of chunk 11g.2.0 (GCE platform spike). This doc captures the platform decisions, observations, and gotchas learned during the spike, and feeds chunk 11g.2 implementation.

**Authority:** Garrett Storms (executor); Zach (reviewer when onboard).
**Status:** **Complete 2026-04-30.** Skeleton authored 2026-04-29. Local validation complete 2026-04-29 (runbook Steps 1–3). GCE-side execution complete 2026-04-30 overnight (runbook Steps 4–9: Artifact Registry, VM provisioning, smoke tests, Edmonton-origin latency benchmark, teardown with zero-orphan verification). All findings recorded below. Approval to proceed to chunk 11g.2 pending Zach's review.
**Source spec:** `docs/PHASE_4_5_PLAN.md` chunk 11g.2.0.
**Companion docs:** `docs/PHASE_4_5_ARCHITECTURE.md` (Stack Decision, Day 1 Topology); `spike-prep/citrus-spike/` (the hello-world code the spike deploys).

---

## §1 Decision Table

Locked or revised here. TBD rows are filled during spike execution and signed off at chunk close.

| Decision | Value | Rationale |
|---|---|---|
| **Machine type (spike)** | `e2-medium` (2 vCPU, 4 GB) | **Revised from chunk spec.** Spec said `e2-standard-4`, which was production-target sizing copied into spike sizing by mistake. The spike validates platform behavior (Hono + uWS coexistence, deploy pipeline, IAM, startup time, network), not load capacity. `e2-medium` answers all platform questions at ~30% the cost (~$1.50/day vs ~$3.20/day). Production sizing decision is a separate chunk 11g.2 acceptance gate against measured load. |
| **Machine type (chunk 11g.2 staging — production-target)** | **`e2-medium` (2 vCPU, 4 GB) confirmed by Zach 2026-04-30.** NOT `e2-standard-4`. | **Architectural rationale (Zach):** Node.js is single-threaded — one Node worker uses one core. Second core handles OS/system tasks. Going to 4+ cores wastes capacity until Stage 2 (multiple workers per VM behind HAProxy). Provisioning more cores than the worker count actively uses is paying for Stage 2 capacity without doing the Stage 2 work — worst of both worlds. **Corroborating evidence:** spike measured 15.5 MiB container memory at idle on `e2-medium` (3.83 GiB available) — 0.40% utilization; even projecting 100× scale-up to ~1.5 GiB upper bound, `e2-medium`'s 4 GiB ceiling has comfortable headroom. Cost implication: ~$50/mo staging+prod pair on `e2-medium` vs ~$200/mo on `e2-standard-4`. Real load testing 6 weeks pre-launch (per `PHASE_4_5_PROJECT_PLAN.md` Phase D) refines the final sizing. |
| **Region** | **LOCKED — `northamerica-northeast1` (Montreal).** | Latency delta vs Iowa is negligible (~5ms from Edmonton); Garrett's call to host on Canadian soil 2026-04-30. Multi-city benchmark deferral cancelled — the small latency delta is dwarfed by other stack-level latency contributors (Postgres queries, ML model inference, network propagation to non-Edmonton users). See also: Vertex AI Gemini gap noted below. |
| **Container runtime** | Container-Optimized OS (`cos-stable`) **confirmed working** during spike via `--container-image` flag — but **the deploy pattern is deprecated by Google**. See §11 Gotchas, GCE-side finding 1. | COS itself is fine; the `gcloud compute instances create-with-container` deploy mechanism is the deprecated piece. Chunk 11g.2 production must use a regular GCE VM + startup script that pulls and runs the container manually. |
| **Base image** | `node:22-bookworm-slim` (locally validated 2026-04-29; GCE-side confirmation pending). | Local validation confirmed `node:22-alpine` does **not** work — uWS v20.51.0 prebuilt binaries are glibc-linked, Alpine is musl-based, container fails on startup with `Error loading shared library ld-linux-x86-64.so.2`. See §11 Gotchas, finding 1 for the full narrative and the two follow-on Dockerfile fixes (apt-get git, tarball URL). |
| **Networking** | Spike used **ephemeral** external IP (sufficient for throwaway). **Chunk 11g.2 production:** static external IP, allocated separately, attached at VM creation, released as part of teardown. Tag-scoped firewall rule (`citrus-spike` tag) for ports 3001 + 3002, ingress from `0.0.0.0/0`, validated during spike. | Static IP is required for chunk 11g.2 staging because the VM's IP is encoded into discovery-endpoint env-driven values; ephemeral IP would shuffle on every reboot. VM ↔ static IP lifecycle requires explicit teardown ordering: detach the IP from the VM (or delete the VM) before deleting the IP, or you'll see `IN_USE_ADDRESSES` errors. |
| **IAM** | Spike used the **default Compute Engine service account** (acceptable for throwaway). **Chunk 11g.2 production:** dedicated service account `citrus-draft-engine@citrus-fantasy-staging.iam.gserviceaccount.com` (and prod equivalent) with minimum-scope grants. | Minimum-permission scopes locked: `roles/secretmanager.secretAccessor` on `SUPABASE_JWT_SECRET` only; `roles/artifactregistry.reader` on the relevant Artifact Registry repo only; `roles/logging.logWriter` for stdout/stderr → Cloud Logging. No project-wide grants. |
| **Startup script** | Custom bash script at `infra/gce/draft-engine-startup.sh` (chunk 11g.2 step 4). Provisions Docker, pulls image from Artifact Registry, runs container with secrets injected from GCP Secret Manager. Replaces the deprecated `--container-image` flag pattern. | Parameterized via GCE instance metadata (project-id, image-tag, secret-name, ports — defaults target staging). Idempotent: safe to re-run on VM re-provision. Logs to `/var/log/citrus-startup.log`. Targets a Debian-based GCE VM with `apt-get install docker.io`, not COS — cleaner than the COS pattern when the deploy is Debian-Docker-based. |
| **Deploy pipeline shape** | **Recommendation for chunk 11g.2:** GitHub Actions → `docker build` → push to Artifact Registry → SSH-deploy script that pulls latest image and restarts the container on the staging VM. | Does NOT use the deprecated `--container-image` agent. Push step expected ~2–3min on GitHub Actions runners (faster than the ~2–5min observed on residential internet during spike — see §10). Future option (post-launch): managed instance template with rolling update for zero-downtime deploys; out of scope for v1. |
| **Health check** | TCP probe on Hono port (validated during smoke test) + TCP probe on uWS port. | TCP is sufficient for "is the process alive" liveness. WS-handshake-as-health-check works but requires a custom probe (not built-in to GCE health checks); not needed for chunk 11g.2. |
| **Logging** | Container stdout/stderr → Cloud Logging via Docker's `gcplogs` log driver, applied at `docker run` time in `infra/gce/draft-engine-startup.sh` (chunk 11g.2 step 5 fix). VM service account needs `roles/logging.logWriter` (already granted in IAM). Query: `gcloud logging read 'labels.app="citrus-draft-engine"' --project=citrus-fantasy-staging`. | **Correction from chunk 11g.2.0 spike claim.** The spike notes claimed `--metadata=google-logging-enabled=true` validated container logs reaching Cloud Logging. That was wrong: the metadata flag works on Container-Optimized OS (where Docker is integrated with OS logging) but not on Debian VMs running Docker as a regular service. The "validated" lines seen in Cloud Logging during the spike were `gce_metadata_script_runner` events from the GCE startup-script wrapper — not Docker container stdout. Chunk 11g.2 step 5 surfaced the gap; this fix uses Docker's built-in `gcplogs` driver, no Ops Agent install needed. |
| **Vertex AI Gemini (forward-looking)** | Pay-as-you-go shared quota **NOT available** in Montreal as of 2026-04-30 — only Provisioned Throughput (~$thousands/mo minimum commitment). | If Stormy or other Citrus features ever move to Vertex Gemini, in-region access requires Provisioned Throughput. Pay-as-you-go workaround: cross-border calls Montreal → Iowa Gemini (~50ms added latency, fine for LLM workloads). No data-residency commitment to Canadian users today, so cross-border is acceptable. Source: <https://discuss.google.dev/t/vertex-ai-gemini-2-5-flash-model-available-on-montreal-northamerica-northeast1-server/193394> (Google response confirming Provisioned Throughput-only). **Stormy currently uses Anthropic Claude API, so this is a flag for future, not a current blocker.** |

---

## §6 Latency Benchmark Results

Run from Garrett's laptop in Edmonton against `/health` over HTTP. 10 requests per region via PowerShell `Invoke-WebRequest` wrapped in `Measure-Command`. Reported as Avg / Min / Max in milliseconds.

| Region | Avg | Min | Max |
|---|---|---|---|
| `northamerica-northeast1` (Montreal) | 95.78 ms | 85.43 ms | 166.26 ms |
| `us-central1` (Iowa) | 90.56 ms | 75.36 ms | 149.52 ms |

**Observation:** Iowa won by ~5ms average and ~10ms on min from Edmonton. Plausible explanation: western-Canadian residential internet routes through US backbone (Seattle/Chicago) before reaching either region; the path to Iowa is shorter on the backbone than the path to Montreal (which often hops through Toronto). The 166 ms and 149 ms outliers are first-hit warmup on each VM (TCP handshake + first container response).

**Raw timings — northamerica-northeast1:**
```
Summary stats above; 10-value raw dump not preserved.
```

**Raw timings — us-central1:**
```
Summary stats above; 10-value raw dump not preserved.
```

**Conclusion (2026-04-30):** Iowa beat Montreal from Edmonton by ~5ms (96 ms vs 91 ms average), but Garrett's call is to host on **Canadian soil** regardless. Latency delta is negligible against other stack-level latency contributors (Postgres queries, ML model inference, network propagation to non-Edmonton users). No multi-city benchmark needed; **Montreal is the production region for chunk 11g.2.**

---

## §7 Startup Time

Time from `gcloud compute instances start ...` returning to the first successful `/health` 200 response, measured from your laptop.

- **Procedure:** stop the VM (`gcloud compute instances stop citrus-spike-uws --zone=northamerica-northeast1-a --project=citrus-fantasy-staging`), wait for `STOPPED`, then `start`. Start a stopwatch when `start` returns. Poll `curl http://<vm-ip>:3001/health` every 1s from your laptop until 200. Record the seconds.
- **First boot — Montreal VM** (VM creation → container responding to curl, same-region image pull): ~30–60 seconds.
- **First boot — Iowa VM** (cross-region image pull from Montreal Artifact Registry): ~60–90 seconds. The cross-region pull added ~30s.
- **Notes:** **Implication for chunk 11g.2** — store production images in the same region as the production VMs to avoid cross-region pull latency on autoscaling events. Cross-region image storage only makes sense for explicit DR/failover topologies; for v1 single-region staging+prod, keep the image in the VM's region.

**Build performance (local validation, resolved 2026-04-29)**

Docker build timings on Garrett's Windows + Docker Desktop dev machine, with all fixes applied (final stack: `node:22-bookworm-slim` + apt-get `git` in build stage + uWS via direct tarball URL — see §11 Gotchas for the fix narrative).

- **Cold build** (no cache, includes base image pull): ~41 seconds.
- **Subsequent rebuild** (no cache, base image already pulled): ~21.5 seconds.
- **`npm install --omit=dev` step:** ~9 seconds.
- **`apt-get install git` step:** ~7 seconds.

Implication for chunk 11g.2: build is fast enough that GitHub Actions inner-loop duration will be dominated by image-push (cross-region) + GCE-deploy steps, not the build itself. Cache the apt-get layer aggressively to keep rebuilds in the ~14s range (subtract the ~7s git install).

---

## §8 Memory Baseline

Resident memory of the Node process at idle (no traffic), measured via SSH into the VM.

- **Procedure:** SSH in, run `docker stats --no-stream <container-id>` after at least 30 seconds of idle. Spike measured 10 minutes idle, no traffic post-smoke-test, on the Montreal `e2-medium` VM.
- **Container MEM USAGE at idle:** **15.5 MiB.**
- **Container CPU at idle:** 0.01%.
- **VM memory available** (`e2-medium`): 3.83 GiB.
- **% of VM memory used by container:** 0.40%.
- **Process count in container:** 7.
- **Notes:** **Headroom is enormous.** This finding is what drove the §1 production-target machine-type recommendation (`e2-medium` minimum, NOT `e2-standard-4`). Even projecting 100× scale-up for real `LobbyManager` instances + ~1,000 connections + ~100 active drafts (rough chunk 11g.10 load-test target), ~1.5 GiB upper-bound estimate fits comfortably in `e2-medium`'s 4 GiB ceiling.

---

## §9 Cold-Start Observations

How quickly does a freshly-pulled image come up vs. a re-running container?

- **Time to first `/health` 200 on first VM boot** (image not cached on host): ~30–60 seconds end-to-end (VM provisioning + image pull + container start + Node startup).
- **Image pull from same-region Artifact Registry** (Montreal Artifact Registry → Montreal-region VM): fast, no measurable extra delay.
- **Image pull from cross-region Artifact Registry** (Montreal Artifact Registry → Iowa-region VM): ~30s extra.
- **Notes:** the cross-region penalty is the dominant cold-start factor when image and VM regions differ. Same-region storage erases it. Captured in §1 (Region row deferral) and §7 implication.

---

## §10 Deploy Iteration Loop Notes

What was the iteration loop like? edit code → docker build → push → SSH redeploy → test? Roughly how long per iteration?

- **Inner-loop duration estimate (residential internet):** build (~21s no-cache, a few seconds with cache per §7) → tag (instant) → push (~2–5min on residential internet for a ~200 MB image) → VM reads from Artifact Registry on next boot (cold ~30–60s same-region; ~60–90s cross-region per §7/§9).
- **Narrative observations:** push step on residential internet is the slowest single phase. Build is fast, tag is free, image pull on the VM side is fast same-region. **Implication for chunk 11g.2 CI:** GitHub Actions runners have faster network than residential, so the push step will be much faster in CI. Expect total CI build-and-push ~2–3 minutes for production deploys. Inner-loop iteration time on a developer laptop (without CI in the path) will continue to be dominated by residential push.

---

## §11 Gotchas

Anything that surprised you during the spike. Examples that might surface: uWS native binary glibc/musl issue on Alpine; firewall rule needing both ingress AND a target tag to actually take effect; static IP costs while VM is stopped vs. running; Cloud Logging lag; permissions surprises on the default service account; container restart-policy quirks; etc.

**Local validation findings (resolved 2026-04-29)**

Local-half findings from running the spike against bare-metal Hono+uWS on Garrett's Windows dev machine and inside a local Docker container.

- **SIGTERM-equivalent shutdown timing:** 1.1 seconds clean shutdown via PowerShell `Stop-Process` (the Windows equivalent of POSIX SIGTERM). Both Hono and uWS shut down cleanly in response to a single signal. Well under the 10-second acceptance criterion.
- **Final working stack confirmed:**
  - Base image: `node:22-bookworm-slim` (NOT `node:22-alpine` — see Gotchas below).
  - Build deps: `git` installed via apt-get in the build stage.
  - uWS install: tarball URL `https://github.com/uNetworking/uWebSockets.js/archive/refs/tags/v20.51.0.tar.gz`.
  - Ports: 3001 (Hono) and 3002 (uWS), both `EXPOSE`'d in the Dockerfile.
- **Smoke test results inside the local container:**
  - `GET /health` → `200`, body `{"ok":true,"server":"hono"}`.
  - WS upgrade `/ws/draft/test-lobby` → `101 Switching Protocols`, echo round-trip succeeds.
  - Single Node process inside the container; container clean-exits on SIGTERM.

**Gotchas surfaced during local validation (resolved 2026-04-29)**

Three Dockerfile gotchas the local validation phase surfaced. All resolved; the fixes are reflected in the working stack above and need to be applied to `server/Dockerfile` and `server/package.json` during chunk 11g.2.

1. **`node:22-alpine` is incompatible with uWS v20.51.0 at runtime.** `npm install` succeeds (the prebuilt binary downloads cleanly), but the container fails on startup with `Error loading shared library ld-linux-x86-64.so.2: No such file or directory (needed by .../uws_linux_x64_127.node)`. Root cause: uWS prebuilt binaries target glibc; Alpine uses musl. **Fix:** use `node:22-bookworm-slim`. **Implication for chunk 11g.2:** the production server's `Dockerfile` must use `bookworm-slim` (or another glibc-based image), not Alpine.
2. **`node:22-bookworm-slim` does not include `git`** in the base image, but the uWS install path needs git to clone the source archive. **Fix:** add `RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*` to the build stage before `npm install`. **Implication for chunk 11g.2:** the production Dockerfile build stage must include the apt-get git install (and the apt-list cleanup). Caching this layer aggressively saves ~7s per rebuild.
3. **npm GitHub URL resolution silently rewrites to SSH** in some npm versions. Both the GitHub shorthand (`github:org/repo#tag`) and the explicit `git+https://...` forms get rewritten to `ssh://git@github.com/...` during resolution. Build images without an SSH client (which `bookworm-slim` does not include) then fail with `ssh: not found`. **Fix:** in `package.json`, use a direct tarball URL: `https://github.com/uNetworking/uWebSockets.js/archive/refs/tags/v20.51.0.tar.gz`. Cleaner than the github-shorthand, no git/ssh client requirement at npm-resolve time, faster, more reliable in CI. **Implication for chunk 11g.2:** the production `server/package.json` must use the tarball URL form, not the GitHub shorthand.

**Gotchas surfaced during GCE-side execution (resolved 2026-04-30)**

Five GCE-side findings the spike's Steps 4–9 surfaced. The first four affect chunk 11g.2 implementation directly; the fifth is project hygiene unrelated to the spike but worth recording.

1. **`--container-image` flag is DEPRECATED.** GCP issued a deprecation warning on every `gcloud compute instances create-with-container` call: *"The option to deploy a container during VM creation using the container startup agent is deprecated. Use alternative services to run containers on your VMs."* Reference: <https://cloud.google.com/compute/docs/containers/migrate-containers>. The spike used the flag because it's the simplest one-shot pattern; it works today but will be discontinued. **Implication for chunk 11g.2:** do NOT use `--container-image`. Instead, provision a regular GCE VM (Container-Optimized OS, or a Debian VM with Docker installed via startup script), then run the container via a startup script that pulls from Artifact Registry. Slightly more boilerplate, future-proof.
2. **PowerShell comma-handling in the `--rules` flag.** Initial firewall rule creation with `--rules=tcp:3001,tcp:3002` (no quotes) failed because PowerShell parsed the comma as an argument separator. **Fix:** quote the value: `--rules="tcp:3001,tcp:3002"`. Affects any gcloud command with comma-separated values when run from PowerShell. **Implication for chunk 11g.2:** document for the CI scripts and for any local PowerShell deploy work. (GitHub Actions runners on Linux don't have this problem; Windows-based runners or local Windows operators would.)
3. **SSH host-key prompt swallow.** First-time `gcloud compute ssh` to a new VM prompts for host-key trust ("Store key in cache?"). The prompt got mixed with the command output (PuTTY/Plink behavior on Windows) and was auto-accepted in this case, but in production deploy automation that's a hang risk. **Fix for chunk 11g.2 deploy automation:** explicitly use `-o StrictHostKeyChecking=no` on the gcloud-ssh invocation, or pre-populate `known_hosts` for non-interactive SSH.
4. **Cross-region image pull latency.** Pulling a Montreal Artifact Registry image to an Iowa VM added ~30 seconds to first boot (captured in §7 and §9). **Mitigation:** store production images in the same region as the production VMs. If multi-region is required (DR, failover), use Artifact Registry's multi-region replication feature.
5. **Cloud Workstations drain (related but separate from spike).** During the audit before the spike, identified $96.95 of April spend on Cloud Workstations from two stopped workstations and a cluster (`citrus-dev-zach`, `citrus-dev-garrett`, `citrus-dev-config`, `citrus-dev-cluster`) that were not actively in use. All deleted 2026-04-29. **Stopped Cloud Workstations are NOT free** — persistent disks bill while stopped. Reclaimed ~$97/mo of credits. **Implication for project hygiene:** quarterly audit of stopped/idle GCP resources is worth the time. Revisit Cloud Workstations if/when Zach wants a shared dev environment.

**Teardown verification (zero-orphan check):** literal output of all four `gcloud compute X list` commands, post-teardown 2026-04-30 ~05:55 UTC. **Zero orphans confirmed** in `citrus-fantasy-staging`.

```
gcloud compute instances list --project=citrus-fantasy-staging
Listed 0 items.

gcloud compute addresses list --project=citrus-fantasy-staging
Listed 0 items.

gcloud compute disks list --project=citrus-fantasy-staging
Listed 0 items.

gcloud compute firewall-rules list --project=citrus-fantasy-staging --filter="name:citrus-spike"
[empty match]
```

**Preserved intentionally** (per runbook Step 9.4): Artifact Registry image `northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest` retained for chunk 11g.2 reference; will be retired in chunk 11g.3 cleanup.

---

## §12 Cost Actuals

Compare against the eyeball estimate in chunk 11g.2.0 (~$1.50/day for the spike VM).

**Estimated total spike cost: ~$0.30** in actual GCP consumption (within free credits, not paid out-of-pocket). Breakdown:

- **Montreal `e2-medium` VM, ~1 hour runtime:** ~$0.05.
- **Iowa `e2-micro` VM, ~30 min runtime:** ~$0.01.
- **Artifact Registry storage** (~200 MB), 1 day prorated: ~$0.001.
- **Network egress** (smoke tests + benchmarks + image pulls, including cross-region pull to Iowa): ~$0.05.
- **Cloud Logging write volume from VMs:** negligible.
- **Static IP rates:** N/A — spike used ephemeral IPs (see §1 Networking row); chunk 11g.2 staging will allocate static IPs and absorb their cost.

**Real win unrelated to spike: ~$97/mo of Cloud Workstations drain killed during the pre-spike audit.** See §11 finding 5.

Source: GCP billing console (<https://console.cloud.google.com/billing>) filtered to `citrus-fantasy-staging` for 2026-04-29 → 2026-04-30.

---

## §13 Lessons Learned

Garrett's own reflections from the 2026-04-29 → 2026-04-30 session.

1. **Local validation surfaces real platform decisions.** Three chunk-11g.2 production-Dockerfile decisions (Debian over Alpine, `git` via apt-get, tarball URLs over GitHub shorthand) came from local Docker iteration, not from spec reading. Test-first paid off.
2. **Memory baseline at 15.5 MiB invalidates the original `e2-standard-4` sizing.** Saved ~$150/mo on the staging+prod pair. Real measurements beat conservative defaults.
3. **Iowa-from-Edmonton beating Montreal-from-Edmonton was unexpected.** Architectural defaults that seem right (Montreal for Canadian users) need real benchmarks to confirm. Multi-city benchmarking is on the chunk 11g.2 list.
4. **Cloud Workstations drain ($97/mo) was hiding in plain sight.** Worth a quarterly project audit going forward — what's billing that we're not actively using?
5. **GCP deprecation of `--container-image`** means chunk 11g.2's deploy pattern is different from what the spike used. Spec said *"Container-Optimized OS via `--container-image`"*; reality says *"Container-Optimized OS via startup script."* Easy adjustment, must be made.
6. **Doing the spike hands-on (not delegating to Claude Code) generated genuine GCE familiarity.** Worth the time investment — chunk 11g.2 implementation will go faster because the operator has real platform experience now.

---

## §14 Sign-Off

- **Spike executed by:** Garrett Storms, 2026-04-29 → 2026-04-30 overnight session.
- **Status:** Complete. All TBDs resolved or explicitly deferred to chunk 11g.2 (regional decision deferred per §6; production-target machine type recommended per §1; deploy pipeline shape recommended per §1).
- **Spike acceptance reviewer (Garrett):** ✅ 2026-04-30.
- **Spike acceptance reviewer (Zach, when onboard):** Reviewed by Zach 2026-04-30 (async). Three pieces of feedback incorporated: Montreal region locked for Canadian-soil rationale, `e2-medium` confirmed with single-threaded-Node rationale, polymorphic events question raised (response in ADR-002 — separate sharpening pass forthcoming). Spike findings ratified.
- **Chunk 11g.2 unblocked:** Granted by Zach 2026-04-30 via async Slack ratification of the five-point summary. Chunk 11g.2 cleared to start post-Web-Summit.

---

## §15 Staging re-provisioning 2026-07-21 (chunk 11g.10 sub-step 10b)

Second time standing up staging on GCE. The first stand-up (chunk 11g.2, 2026-05-04) landed a hello-world echo engine at 34.19.223.135 (Montreal) and was torn down post-validation. This section captures the shape and gotchas of the re-provisioning against the real (post-11g.9) engine.

### §15.1 VM shape

- **Instance name:** `citrus-draft-engine-staging`
- **Zone:** `northamerica-northeast1-a` (Montreal)
- **Machine type:** `e2-medium` (per §1 spike; unchanged)
- **Static external IP:** `35.203.89.236` — reserved as a named address so the value survives VM lifecycle churn. **Retention-on-teardown policy:** keep the reserved IP allocated even when the VM is deleted (opposite of the 2026-05-04 teardown). Retention cost is ~$1.50/mo for an unattached static IP; the tradeoff pays for itself the first time we don't have to update runbook / harness / CI env vars on re-provision.
- **Container image:** `northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:ef52351` — Docker image ID `sha256:a261fb3d6b72edb6624313fe0a05da93cdb7d70f7b62e8418238166472139e70` (short: `af39dff6…` per the deploy manifest handed off from the architect; the container-inspect `sha256:` above is the canonical digest as observed on the VM).
- **Ports opened:** firewall rule `citrus-draft-engine-allow` — `tcp:3001` (Hono) + `tcp:3002` (uWS).
- **Service account:** `citrus-draft-engine@citrus-fantasy-staging.iam.gserviceaccount.com` (unchanged from §14 spike).

### §15.2 Secrets inventory (Secret Manager)

Naming convention: UPPERCASE_UNDERSCORE, matching the env-var name the engine reads. This is a change from the chunk 11g.2 spike's `lowercase-hyphen` convention (`supabase-jwt-secret`, etc.); rename adopted here for parity with the env vars themselves. The startup script's `SECRET_*_NAME` metadata overrides (see `infra/gce/draft-engine-startup.sh` §3) supported the migration without a code change.

- `SUPABASE_JWT_SECRET`
- `SUPABASE_DB_URL` — **direct primary URL** (`db.jjgspcpvqaiitloglxbb.supabase.co:5432`), NOT the pooler. See §15.4 for the IPv4 add-on story.
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `SUPABASE_URL`

**IAM-grant-ordering gotcha (real, observed).** The initial provisioning granted `roles/secretmanager.secretAccessor` on the SA in one batch against the then-existing set of secrets, then added a missing secret afterward. Result: the engine boots and hits `PERMISSION_DENIED` on the new secret because the batch grant was against secret resource names, not project-level. **Rule going forward:** either grant `secretAccessor` at the project level, or re-run the per-secret grant every time a new secret is added. Prefer per-secret so the blast radius stays tight; the compensating discipline is a `gcloud secrets add-iam-policy-binding` step folded into any "add-a-new-secret" playbook. Not a KI because there's no code fix — this is provisioning discipline.

### §15.3 Startup log location — file name correction

The startup script writes its own logs to `/var/log/citrus-startup.log`, **not** `/var/log/citrus-draft-engine-startup.log` (as some pre-10b drafts had suggested). The script's `exec >> /var/log/citrus-startup.log 2>&1` at line 76 of `infra/gce/draft-engine-startup.sh` is the authoritative name. When investigating a boot problem via `gcloud compute ssh …`, tail this file:

```
sudo tail -f /var/log/citrus-startup.log
```

Separately, the *container* stdout goes to Cloud Logging via the `gcplogs` Docker driver — see §15.6 for filtering.

### §15.4 IPv4 add-on decision (Supabase project)

The Supabase project's Postgres hostname (`db.<ref>.supabase.co`) is **IPv6-only by default**. GCE VMs do not automatically egress on IPv6, so the engine's LISTEN/NOTIFY client and the `supabaseAdmin` `.from('leagues')` calls could not reach the DB at boot. Options considered:

1. Enable IPv6 egress on the VM (requires Cloud NAT reconfig + subnet dual-stack, not one click).
2. Enable the Supabase "dedicated IPv4 add-on" ($4/mo per project) — hostname resolves to a stable IPv4 (`15.222.174.205` for this project).
3. Route through Supavisor (pooler on IPv4 but only supports transaction-mode by default, which drops LISTEN frames — KI-E010).

**Chose #2.** Cost is negligible against a single point of ops complexity avoided; #1 has network-config drag; #3 breaks LISTEN.

**10f flag.** Production will need the same IPv4 add-on on its own Supabase project. Not baked into the deploy pipeline — flagged as a 10f pre-cutover checklist item.

### §15.5 Migration-history repair narrative

Supabase migration history had drifted during the local-only chunks 11g.3–11g.9 window. Two classes of repair required:

1. **17 Phase 4.5 migrations marked applied.** `supabase migration repair --status applied <ts>` for each, targeting the staging project's `supabase_migrations.schema_migrations` table. These migrations had been executed via direct psql in local dev but were never registered in staging's history.
2. **Master hotfix renames reconciled.** Two migrations that shipped on `master` (playoff-winner propagation trigger + playoff aggregate assists NHL-column fix) had been repaired as `reverted` in staging when the branch's earlier state was rolled back. Reconciled to `applied` and copied the two `.sql` files into the branch working tree so the local state matches remote (files remain uncommitted at time of this note; see 10b closure package Commit 2 file list).

Net state after repair: staging `schema_migrations` history is a clean superset of what the `phase-4-5-implementation` branch expects, with the master hotfixes reflected.

### §15.6 Cloud Logging findings (input for 10d)

Container stdout **does** reach Cloud Logging via the `gcplogs` Docker driver configured in the startup script. The suggested filter `labels.app="citrus-draft-engine"` (as it appeared in the startup script comment at line 48) **returns zero results** — the driver does not promote Docker container labels to top-level Cloud Logging entry labels. Working filter:

```
logName:"gcplogs-docker-driver"
AND jsonPayload.container.metadata.app="citrus-draft-engine"
```

Additional caveat for downstream 10d work: the engine's own structured JSON (severity, event, time, and per-event fields) lands inside `jsonPayload.message` as a **stringified JSON blob**, not as top-level fields. Any Cloud Logging alert policy or log-based metric on `jsonPayload.event` would need to reparse `message` (e.g., via a log-based metric filter that extracts the event name from the string). **Flag for 10d design:** either (a) accept the string-reparse pattern and codify it in the alert policy DSL, or (b) switch the Docker log driver to one that preserves structured fields at the top level (e.g., write JSON to a file and ship via the Ops Agent, which parses JSON-per-line into structured payload). Decision belongs to 10d.

### §15.7 LOG_LEVEL=DEBUG operator tip (LISTEN/NOTIFY visibility)

`event_subscription.notification_received` (the log line an operator would grep for to confirm a NOTIFY reached the engine after e.g. a `draft_pause` RPC) is emitted at DEBUG level in `server/src/draft/eventSubscription.ts:248`. Default engine log level is INFO. **Operator tip:** to observe cross-session notifications in logs during a preflight run, set `LOG_LEVEL=DEBUG` on the container (`-e LOG_LEVEL=DEBUG` in the `docker run` line, or the same env var on the deploy invocation). Reset to INFO after.

Note: the engine's built-in `event_subscription.self_test_succeeded` at boot IS a full LISTEN/NOTIFY round-trip through Postgres (engine fires a `_test` sentinel on its own LISTEN client and waits to see it come back). This runs at INFO and is a valid end-to-end proof-of-life without a `LOG_LEVEL=DEBUG` toggle — sufficient for §4 preflight pass criteria. The DEBUG-level `notification_received` tip is for the deeper preflight variant where the operator wants to observe an externally-triggered NOTIFY specifically.

### §15.8 Smoke fixture requirements

The chunk 11g.2 step 2 WebSocket smoke harness (`scripts/smoke-uws-step2.js`) requires more from staging DB state than the original scaffold suggested. Fixture requirements observed during 10b:

- **Real league UUID.** The URL path must be a valid UUID that exists in `leagues.id`. String IDs like `lobby-A` fail with `invalid input syntax for type uuid` at `lookupLobbyConfig` (`server/src/draft/index.ts:239`).
- **`settings.draftType` in `snake | linear | auction`.** Values like `none` or `offline` fail lobby construction. `pickTimeLimit` recommended alongside (default 90 works, 60 is a fine explicit value for staging).
- **At least one `draft_order` row.** Zero rows produces `league <id> has no draft_order rows; DraftService.initializeDraftOrder must run before the lobby opens`. Row must have `team_order` as a JSONB array of at least one string team ID; that team ID must reference a row in `teams`.
- **Snapshot semantics on connect.** The real engine (post-11g.4 step 5) sends a `{v, type:'snapshot', payload:{lobbyId, format, …}}` JSON message immediately on WS open. The pre-11g.4 smoke scaffold expected `echo: <text>` reply; that echo path no longer exists. Harness scenario (c) has been updated to assert the snapshot-message shape instead. See `scripts/smoke-uws-step2.js` scenario (c) `wsSnapshotTest` for the reference assertion.

Staging fixture applied during 10b: league `993c9219-ecbf-4e4e-9fb0-e9837e1bded3` ("Staging League") — `settings.draftType` set to `snake`, `settings.pickTimeLimit` set to `60`, one `draft_order` row inserted with the existing team `4c742dae-6770-43f5-b310-cc24741e8148`. `draft_state` left at `not_started` (the smoke doesn't need in-progress).
