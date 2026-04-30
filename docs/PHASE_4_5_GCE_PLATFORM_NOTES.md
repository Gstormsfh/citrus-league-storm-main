# Phase 4.5 — GCE Platform Notes

Output of chunk 11g.2.0 (GCE platform spike). This doc captures the platform decisions, observations, and gotchas learned during the spike, and feeds chunk 11g.2 implementation.

**Authority:** Garrett Storms (executor); Zach (reviewer when onboard).
**Status:** Skeleton authored 2026-04-29. **Local validation complete 2026-04-29** (Steps 1–3 of the runbook: bare-metal Hono+uWS, container build, container smoke tests). GCE-side execution (Steps 4–9: Artifact Registry, VM provisioning, latency benchmark, teardown) pending. Remaining TBDs filled during that phase per `docs/PHASE_4_5_GCE_SPIKE_RUNBOOK.md`.
**Source spec:** `docs/PHASE_4_5_PLAN.md` chunk 11g.2.0.
**Companion docs:** `docs/PHASE_4_5_ARCHITECTURE.md` (Stack Decision, Day 1 Topology); `spike-prep/citrus-spike/` (the hello-world code the spike deploys).

---

## §1 Decision Table

Locked or revised here. TBD rows are filled during spike execution and signed off at chunk close.

| Decision | Value | Rationale |
|---|---|---|
| **Machine type (spike)** | `e2-medium` (2 vCPU, 4 GB) | **Revised from chunk spec.** Spec said `e2-standard-4`, which was production-target sizing copied into spike sizing by mistake. The spike validates platform behavior (Hono + uWS coexistence, deploy pipeline, IAM, startup time, network), not load capacity. `e2-medium` answers all platform questions at ~30% the cost (~$1.50/day vs ~$3.20/day). Production sizing decision is a separate chunk 11g.2 acceptance gate against measured load. |
| **Machine type (chunk 11g.2 staging — production-target)** | TBD — record spike's recommendation to chunk 11g.2 reviewer. | Default starting point: `e2-standard-4`. Revisit after spike + first staging load test. |
| **Region** | TBD — record chosen region (`northamerica-northeast1` Montreal vs `us-central1` Iowa) and rationale based on the §6 latency benchmark. | Montreal is closer to the founder's location (Edmonton) and to the projected Canadian-leaning user base; benchmark either confirms or overrides. |
| **Container runtime** | TBD — confirm Container-Optimized OS (`cos-stable`) on the VM image. | `cos-stable` is GCP's managed container OS for GCE. Standard pattern; no expected surprises. |
| **Base image** | `node:22-bookworm-slim` (locally validated 2026-04-29; GCE-side confirmation pending). | Local validation confirmed `node:22-alpine` does **not** work — uWS v20.51.0 prebuilt binaries are glibc-linked, Alpine is musl-based, container fails on startup with `Error loading shared library ld-linux-x86-64.so.2`. See §11 Gotchas, finding 1 for the full narrative and the two follow-on Dockerfile fixes (apt-get git, tarball URL). |
| **Networking** | TBD — record static external IP allocation name + region; firewall rule name + scope (tag-targeted to spike VM only, ports 3001 + 3002, ingress from `0.0.0.0/0`). | Tag-scoping the firewall rule prevents accidental exposure of other VMs. Static IP makes smoke tests stable across VM reboots during the spike. |
| **IAM** | TBD — record service account used (dedicated `citrus-spike-sa@…` or default Compute Engine SA) + scopes granted. | Dedicated service account is best practice; default SA acceptable for throwaway. Document choice for chunk 11g.2 reference. |
| **Startup script** | TBD — record whether COS auto-pulled the container via `--container-image` flag, or whether a systemd unit was needed. Document the actual `gcloud compute instances create-with-container ...` invocation that worked. | COS supports `--container-image` natively; should be one-flag if it works as expected. |
| **Deploy pipeline shape** | TBD — recommend either: (a) GitHub Actions → Docker build → push to Artifact Registry → SSH-deploy script; or (b) GitHub Actions → push image → managed instance template rolling update. Note tradeoffs observed during spike. | Spike doesn't fully simulate either pipeline (it pushes once and provisions once). Recommendation reflects observations + Zach's review. |
| **Health check** | TBD — confirm: TCP probe on `${PORT}` (Hono) for liveness; WS handshake against `${DRAFT_WS_PORT}` (uWS) for readiness. | TCP probe is sufficient for liveness. Readiness needs the WS handshake to succeed; document the exact `gcloud compute health-checks create` invocation if used during the spike. |
| **Logging** | TBD — confirm container stdout/stderr flowed to Cloud Logging via the COS default agent. | Standard. Worth a screenshot of the Cloud Logging viewer showing the spike's `[hono] listening` and `[uws] listening` lines for the chunk 11g.2 reviewer. |

---

## §6 Latency Benchmark Results

Run from Garrett's laptop in Edmonton against `/health` over HTTP. 10 requests per region, recorded as `time_total` from curl. p50 = median, p95 = 9th-or-10th value (sorted).

| Region | p50 (ms) | p95 (ms) | Notes |
|---|---|---|---|
| `northamerica-northeast1` (Montreal) | TBD | TBD | TBD — record VM external IP + raw curl timings inline below |
| `us-central1` (Iowa) | TBD | TBD | TBD — record VM external IP + raw curl timings inline below; teardown immediately after benchmark |

**Raw timings — northamerica-northeast1:**
```
TBD — paste 10 curl time_total values (one per line)
```

**Raw timings — us-central1:**
```
TBD — paste 10 curl time_total values (one per line)
```

**Decision:** TBD — chosen region for chunk 11g.2 staging deploy + one-line rationale. Default expectation: Montreal wins on Edmonton-origin RTT.

---

## §7 Startup Time

Time from `gcloud compute instances start ...` returning to the first successful `/health` 200 response, measured from your laptop.

- **Procedure:** stop the VM (`gcloud compute instances stop citrus-spike-uws --zone=northamerica-northeast1-a --project=citrus-fantasy-staging`), wait for `STOPPED`, then `start`. Start a stopwatch when `start` returns. Poll `curl http://<vm-ip>:3001/health` every 1s from your laptop until 200. Record the seconds.
- **First-boot start time (cold image cache):** TBD seconds.
- **Subsequent start time (cached image):** TBD seconds.
- **Notes:** TBD — anything surprising about the startup behavior.

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

- **Procedure:** SSH in, run `docker stats --no-stream <container-id>` after at least 30 seconds of idle.
- **MEM USAGE at idle:** TBD MiB.
- **Notes:** TBD — compare against the `e2-medium`'s 4 GB RAM ceiling; document headroom.

---

## §9 Cold-Start Observations

How quickly does a freshly-pulled image come up vs. a re-running container?

- **Time to first `/health` 200 on first VM boot:** TBD seconds.
- **Time to first `/health` 200 after restarting the container in-place** (e.g. via `gcloud compute instances reset` or by restarting the COS container service): TBD seconds.
- **Notes:** TBD — second start should be faster since the image is cached. Document the delta.

---

## §10 Deploy Iteration Loop Notes

What was the iteration loop like? edit code → docker build → push → SSH redeploy → test? Roughly how long per iteration?

- **Inner-loop duration estimate:** TBD seconds/minutes per iteration.
- **Narrative observations:** TBD — what felt slow, what felt fast, what felt fragile, what would speed this up for chunk 11g.2's real implementation.

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

Additional gotchas may surface during GCE-side execution (Steps 4–9 of the runbook); those land here when they do.

**Teardown verification (zero-orphan check):** paste the literal output of all four `gcloud compute X list` commands here, post-teardown. This is the chunk's most important acceptance criterion.

```
gcloud compute instances list --project=citrus-fantasy-staging
TBD

gcloud compute addresses list --project=citrus-fantasy-staging
TBD

gcloud compute disks list --project=citrus-fantasy-staging
TBD

gcloud compute firewall-rules list --project=citrus-fantasy-staging
TBD
```

---

## §12 Cost Actuals

Compare against the eyeball estimate in chunk 11g.2.0 (~$1.50/day for the spike VM).

- **VM hours × machine-type rate:** TBD — record actual VM hours and computed cost.
- **Static IP rate (attached, while VM running):** TBD.
- **Static IP rate (unattached, if applicable):** TBD.
- **Artifact Registry storage:** TBD.
- **Egress (smoke tests + benchmarks):** TBD.
- **us-central1 comparison VM (e2-micro, ~3-hour lifetime):** TBD.
- **Total spike cost:** TBD.

Source: GCP billing console (https://console.cloud.google.com/billing) filtered to `citrus-fantasy-staging` for the spike's date range.

---

## §13 Lessons Learned

For Garrett's own reflection post-spike. What carries forward to chunk 11g.2; what would you do differently if running this spike again; what should Zach know first when he's onboard?

- TBD.

---

## §14 Sign-Off

- **Spike acceptance reviewer (Garrett):** TBD — date.
- **Spike acceptance reviewer (Zach, if onboard):** TBD — date.
- **Chunk 11g.2 unblocked:** TBD — date.
