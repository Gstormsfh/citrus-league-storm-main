# Phase 4.5 — GCE Spike Runbook

Step-by-step execution guide for chunk 11g.2.0 (GCE platform spike). Follow it linearly. Each step has a "Run this" block you can copy-paste, plus an "Expected output," an "If you see this, stop and ask," and (where applicable) a "Record this in the platform-notes doc" pointer.

**Project:** `citrus-fantasy-staging` only. Do **NOT** use `citrus-fantasy-prod`.
**Time budget:** 2 working days (~6–10 productive hours), hard cap.
**Source code:** `spike-prep/citrus-spike/` (committed in this repo). Copy to a scratch directory before starting.
**Output target:** `docs/PHASE_4_5_GCE_PLATFORM_NOTES.md` (skeleton already in repo; fill TBDs as you go).
**Companion docs:** `docs/PHASE_4_5_PLAN.md` chunk 11g.2.0 spec; `docs/PHASE_4_5_ARCHITECTURE.md` Stack Decision section.

> **Reading guide.** The detailed steps below are the recommended path for someone new to GCE. If you're already comfortable, the "Cheat Sheet — All commands in order" at the bottom of this file is the same recipe, condensed.

---

## Step 0 — Prerequisites

What this does: verifies that your local machine has the tools and credentials needed for the spike. None of this writes to GCP.

### Step 0.1 — Verify gcloud auth and project context

Why: confirms you're authenticated to GCP and that `gcloud` is pointed at the right project. The spike must run in `citrus-fantasy-staging`.

Run this:
```
gcloud auth list
gcloud config get-value project
```

Expected output: an active account that's an owner / editor on `citrus-fantasy-staging`, and the project line returns `citrus-fantasy-staging`.

If you see this, stop and ask:
- Active account empty: run `gcloud auth login` first.
- Project line returns anything other than `citrus-fantasy-staging`: run `gcloud config set project citrus-fantasy-staging` and re-verify.

Record: nothing.

### Step 0.2 — Verify Docker installed and running

Why: the spike builds a container locally before pushing. Docker Desktop (or equivalent) must be running.

Run this:
```
docker --version
docker info
```

Expected output: a version line (e.g. `Docker version 27.x.x`) and `docker info` returns server details without errors.

If you see this, stop and ask:
- "command not found": install Docker Desktop and re-run.
- "Cannot connect to the Docker daemon": Docker Desktop isn't running. Start it.

Record: nothing.

### Step 0.3 — Verify npm and Node 22 available

Why: the spike code targets Node 22. You'll run `npm install` once locally to validate, and the container also uses Node 22.

Run this:
```
node --version
npm --version
```

Expected output: Node `v22.x.x` (any 22 minor) and an npm version of 10 or higher.

If you see this, stop and ask:
- Node version is 18 or 20: install Node 22 via nvm/fnm/volta, or skip the local-run validation (Step 2) and rely on the container build (Step 3).

Record: nothing.

### Step 0.4 — Verify Compute Engine + Artifact Registry APIs enabled

Why: GCP APIs are off by default in new projects. The spike needs Compute Engine (for VMs) and Artifact Registry (for the container image).

Run this:
```
gcloud services list --project=citrus-fantasy-staging --enabled --filter="config.name:compute.googleapis.com OR config.name:artifactregistry.googleapis.com"
```

Expected output: two lines, one for `compute.googleapis.com` and one for `artifactregistry.googleapis.com`.

If you see this, stop and ask:
- Either is missing: enable with:
  ```
  gcloud services enable compute.googleapis.com --project=citrus-fantasy-staging
  gcloud services enable artifactregistry.googleapis.com --project=citrus-fantasy-staging
  ```
  Both enables take ~30 seconds to propagate.

Record: nothing.

### Step 0.5 — Inspect quotas (sanity check)

Why: GCE has CPU and IP-address quotas. Defaults are plenty for this spike, but a project that's been used before may have leftover quota holds.

Run this:
```
gcloud compute project-info describe --project=citrus-fantasy-staging --format="value(quotas[].metric,quotas[].limit,quotas[].usage)" | head -40
```

Expected output: a list of quota metrics. For the spike you care that `CPUS` (regional) is at least 8, `IN_USE_ADDRESSES` is at least 8, and `INSTANCES` is at least 5. Defaults are well above these.

If you see this, stop and ask:
- Quota looks restricted (anything below default): file a quota increase ticket and pause the spike. Highly unlikely in a fresh project.

Record: nothing.

---

## Step 1 — Copy spike code to a scratch directory

Why: gets you out of the citrus repo so spike commands don't pollute it. Spike is throwaway; the repo copy is the canonical reference.

Run this (Linux/macOS):
```
cp -r ~/path/to/citrus-league-storm-phase45/spike-prep/citrus-spike /tmp/citrus-spike
cd /tmp/citrus-spike
ls -la
```

Run this (Windows PowerShell):
```
Copy-Item -Recurse "C:\path\to\citrus-league-storm-phase45\spike-prep\citrus-spike" "$env:TEMP\citrus-spike"
cd "$env:TEMP\citrus-spike"
Get-ChildItem
```

Expected output: directory contents `index.js`, `package.json`, `Dockerfile`, `.dockerignore`, `README.md`.

If you see this, stop and ask:
- Files missing: re-clone the repo or fix the path.

Record: nothing.

---

## Step 2 — Local hello-world (sanity check before containerizing)

Why: confirms the spike code compiles and runs on your laptop before you spend time on Docker and GCE. Catches version-pin mismatches early.

### Step 2.1 — Install deps

Run this:
```
npm install
```

Expected output: `hono`, `@hono/node-server`, and `uWebSockets.js` install. uWebSockets.js comes from a GitHub tarball, so the install does a git clone — slower than a normal npm dep. Expect 30–60 seconds.

If you see this, stop and ask:
- `npm install` fails on uWebSockets.js with a Git clone error: confirm `git` is installed and that GitHub is reachable.
- Node version error: re-run on Node 22 (Step 0.3).
- A peer-deps error from any package: pause and surface — peer-dep issues are a chunk 11g.2 risk we want to know about now.

Record: nothing yet.

### Step 2.2 — Run the spike locally

Why: starts both servers in one process, listens on ports 3001 and 3002.

Run this:
```
node index.js
```

Expected output (within ~1s):
```
[hono] listening on port 3001
[uws] listening on port 3002
```

If you see this, stop and ask:
- `EADDRINUSE`: another process is on 3001 or 3002. Free those ports, or set `PORT=4001 DRAFT_WS_PORT=4002 node index.js` and use those for the rest of Step 2.
- uWS fails to load native binary: this is a glibc-vs-musl issue. Note in §11 of the platform-notes; the container build (Step 3) will hit the same issue and is where you'll fix it via base-image swap.
- Anything else: pause and surface.

Record: nothing yet — leave the server running for Step 2.3.

### Step 2.3 — Smoke test the local server

In a separate terminal:

Run this (Linux/macOS):
```
curl http://localhost:3001/health
```

Run this (Windows PowerShell):
```
Invoke-WebRequest -UseBasicParsing -Uri http://localhost:3001/health | Select-Object -ExpandProperty Content
```

Expected output: `{"ok":true,"server":"hono"}`.

Run this (any platform; install wscat first if needed: `npm install -g wscat`):
```
wscat -c ws://localhost:3002/ws/draft/test-lobby
```

Once connected, type a message and press Enter. Expected: server replies `echo: <your message>`.

If you see this, stop and ask:
- 404 on `/health`: spike code may have drifted. Diff against `spike-prep/citrus-spike/index.js`.
- WS connection fails: check the server-terminal logs for uWS errors.

Record: nothing yet.

### Step 2.4 — SIGTERM clean shutdown timing

Why: validates the SIGTERM handler shuts both servers down within 10 seconds.

In the server terminal, press Ctrl-C (sends SIGINT, handled the same as SIGTERM by the spike code).

Or from a separate terminal:
- Linux/macOS: `ps aux | grep "node index.js"` to find the PID, then `kill -TERM <pid>`.
- Windows PowerShell: `Get-Process node | Format-Table Id,ProcessName` to find the PID, then `Stop-Process -Id <pid>`.

Expected output:
```
[shutdown] received SIGTERM (or SIGINT); stopping both servers...
[shutdown] uWS listen socket closed
[shutdown] hono server closed
[shutdown] clean exit
```

Process should exit within 1–2 seconds with no in-flight work; within 10 seconds with active connections.

If you see this, stop and ask:
- "10s timeout exceeded; forcing exit": the SIGTERM handler isn't draining cleanly. Note in §11 of the platform-notes.

Record: local shutdown timing in §11 platform-notes ("local SIGTERM clean shutdown: ~Xs").

---

## Step 3 — Containerize

Why: the spike's GCE VM runs the code as a container. Confirm the container builds and runs correctly locally before pushing to Artifact Registry.

### Step 3.1 — Build

Run this from `/tmp/citrus-spike`:
```
docker build -t citrus-spike:test .
```

Expected output: multi-stage build completes in 30–90 seconds. Final image tagged `citrus-spike:test`.

If you see this, stop and ask:
- uWS install fails in the build stage with `dlopen` or musl errors: this is the glibc-vs-musl issue. Edit `Dockerfile` and replace both `FROM node:22-alpine` lines with `FROM node:22-bookworm-slim`. Rebuild. **Note this gotcha in §11 of the platform-notes.**
- Build hangs at `npm install`: GitHub may be slow; allow up to 2 minutes before assuming a hang.

Record: build time and any base-image change in §11 of the platform-notes.

### Step 3.2 — Run the container

Run this:
```
docker run --rm -p 3001:3001 -p 3002:3002 citrus-spike:test
```

Expected output: same `[hono] listening` and `[uws] listening` lines as Step 2.2.

In another terminal, re-run the smoke tests from Step 2.3 (curl + wscat) — both should pass.

If you see this, stop and ask:
- Port mapping fails: another process is on 3001/3002 on the host. Free them.
- Container starts but smoke tests fail: confirm `EXPOSE` directives in the Dockerfile.

Record:
- Container memory at idle in §8 of platform-notes — in another terminal, run `docker stats --no-stream` and capture MEM USAGE.

### Step 3.3 — SIGTERM in container

Run this in a third terminal:
```
docker ps --filter "ancestor=citrus-spike:test" --format "{{.ID}}"
docker kill --signal=SIGTERM <container-id>
```

Expected output: container shows the same `[shutdown]` log lines as Step 2.4 and exits within 10 seconds.

If you see this, stop and ask:
- Container doesn't exit within 10s: Node may not be PID 1 inside the container. The Dockerfile uses `CMD ["node", "index.js"]` (exec form) which DOES make Node PID 1, so this should work. If it doesn't, surface.

Record: container shutdown timing in §11 platform-notes.

---

## Step 4 — Push to Artifact Registry

Why: creates a private container repository in `citrus-fantasy-staging` and uploads the spike image. The GCE VM in Step 5 pulls from there.

### Step 4.1 — Create the Artifact Registry repository

What's a "repository" in Artifact Registry? It's a container of images, scoped to a region. We create one named `citrus-spike` in `northamerica-northeast1` (same region as the spike VM, so the VM can pull without cross-region egress).

Run this:
```
gcloud artifacts repositories create citrus-spike \
  --project=citrus-fantasy-staging \
  --repository-format=docker \
  --location=northamerica-northeast1 \
  --description="Throwaway spike images for Phase 4.5 chunk 11g.2.0"
```

Expected output: `Created repository [citrus-spike].`

If you see this, stop and ask:
- "Permission denied": your gcloud account lacks Artifact Registry Admin. Grant the role and retry.
- "Resource already exists": skip; continue to 4.2.

Record: nothing.

### Step 4.2 — Configure Docker auth for the registry

What this does: tells your local Docker how to authenticate to `northamerica-northeast1-docker.pkg.dev` using your gcloud credentials. This adds a credential helper entry to `~/.docker/config.json`.

Run this:
```
gcloud auth configure-docker northamerica-northeast1-docker.pkg.dev --project=citrus-fantasy-staging
```

Expected output: a confirmation message saying the credential helper is now configured.

If you see this, stop and ask:
- A "credentialsHelper" warning about overwriting an existing entry: type `Y`. Safe to overwrite.

Record: nothing.

### Step 4.3 — Tag and push

Run this:
```
docker tag citrus-spike:test northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest
docker push northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest
```

Expected output: layers pushed, final digest reported.

If you see this, stop and ask:
- "denied: Permission ... artifactregistry.repositories.uploadArtifacts": IAM issue, your account lacks Artifact Registry Writer.
- Push hangs on a single layer: usually transient network; retry.

Record: nothing.

---

## Step 5 — Provision GCE VM

Why: creates a single GCE virtual machine running Container-Optimized OS (COS), pre-configured to pull and run the spike container on boot. Ports 3001 and 3002 are exposed via firewall rule and a static external IP makes the VM reachable across reboots.

### Step 5.1 — Allocate static external IP

What's a "static external IP"? It's a reserved IPv4 address that stays bound to your project even when the VM stops. Without one, every VM reboot would shuffle the IP and break smoke tests mid-spike.

Run this:
```
gcloud compute addresses create citrus-spike-ip \
  --project=citrus-fantasy-staging \
  --region=northamerica-northeast1
```

Expected output: `Created [...].`

Get the IP value:
```
gcloud compute addresses describe citrus-spike-ip \
  --project=citrus-fantasy-staging \
  --region=northamerica-northeast1 \
  --format="value(address)"
```

Expected output: an IPv4 address like `34.95.xx.xx`. Save it; you'll use it in Steps 5.3, 6, and 7.

Record: IP address in §1 platform-notes (Networking row).

### Step 5.2 — Firewall rule

Why: GCP firewall rules are deny-by-default. Without an explicit rule, ports 3001 and 3002 are unreachable from the public internet. We create a rule that allows ingress only on those two ports, and only on VMs tagged `citrus-spike` — tag-scoping prevents accidentally opening these ports on other project VMs.

Run this:
```
gcloud compute firewall-rules create citrus-spike-allow \
  --project=citrus-fantasy-staging \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:3001,tcp:3002 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=citrus-spike \
  --description="Spike chunk 11g.2.0: Hono + uWS ports on tagged VMs only"
```

Expected output: `Created [...].`

If you see this, stop and ask:
- "Firewall rule already exists": skip; continue to 5.3.

Record: rule name + scope in §1 platform-notes.

### Step 5.3 — Create the VM

Why: provisions the actual VM. The `--container-image` flag tells COS to pull the spike image and run it as a container on first boot. The `--container-restart-policy=always` flag tells COS to restart the container if it exits — useful if the SIGTERM testing in Step 6 kills it.

Run this (read it before pasting):
```
gcloud compute instances create-with-container citrus-spike-uws \
  --project=citrus-fantasy-staging \
  --zone=northamerica-northeast1-a \
  --machine-type=e2-medium \
  --container-image=northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest \
  --container-restart-policy=always \
  --tags=citrus-spike \
  --address=citrus-spike-ip \
  --boot-disk-size=10GB \
  --boot-disk-type=pd-standard
```

Expected output: a table line with the VM details. Provisioning + first container pull takes ~30–60 seconds.

Note on IAM: by default this uses the **Compute Engine default service account** (`<project-number>-compute@developer.gserviceaccount.com`). Acceptable for a throwaway spike. Document the choice in §1 platform-notes (IAM row). Chunk 11g.2 staging will likely use a dedicated service account — out of scope here.

If you see this, stop and ask:
- "Quota exceeded for IN_USE_ADDRESSES": leftover addresses from prior work. Run `gcloud compute addresses list --project=citrus-fantasy-staging` and clean up.
- "Image not found": the image push (Step 4.3) didn't land. Re-run 4.3.
- VM created but container never starts: SSH in (Step 5.4) and run `sudo journalctl -u konlet-startup` to see why.

Record: VM name, zone, machine type. Eyeball startup time (more careful measurement happens in §7 of platform-notes via Step 6).

### Step 5.4 — SSH in (sanity check)

Why: confirms you can reach the VM via gcloud's SSH wrapper. Useful for debugging mid-spike.

Run this:
```
gcloud compute ssh citrus-spike-uws \
  --project=citrus-fantasy-staging \
  --zone=northamerica-northeast1-a
```

Expected output: a shell prompt on the VM. Run `docker ps` to verify the spike container is running. Type `exit` to leave.

If you see this, stop and ask:
- "Permission denied" on SSH: gcloud generates SSH keys and pushes them automatically. If this fails, your account needs `compute.instances.setMetadata` (covered by Compute Instance Admin role).
- `docker ps` shows no running container: see "VM created but container never starts" above.

Record: nothing.

---

## Step 6 — Smoke test from your laptop

Why: validates the deployed spike from outside the GCP network. Same tests as Step 2.3 but against the static IP.

Replace `<vm-ip>` below with the IP from Step 5.1.

Run this (HTTP):
```
curl http://<vm-ip>:3001/health
```

Expected output: `{"ok":true,"server":"hono"}`.

Run this (WS):
```
wscat -c ws://<vm-ip>:3002/ws/draft/test-lobby
```

Type a message. Expected: `echo: <your message>`.

Record:
- §7 startup time: measure properly. Stop the VM:
  ```
  gcloud compute instances stop citrus-spike-uws --zone=northamerica-northeast1-a --project=citrus-fantasy-staging
  ```
  Wait for `STOPPED` (poll with `gcloud compute instances describe ... --format="value(status)"`). Then `start`:
  ```
  gcloud compute instances start citrus-spike-uws --zone=northamerica-northeast1-a --project=citrus-fantasy-staging
  ```
  Start a stopwatch when `start` returns. Poll `curl http://<vm-ip>:3001/health` every 1s from your laptop until you get a 200. Record the seconds in §7.
- §8 memory baseline:
  ```
  gcloud compute ssh citrus-spike-uws --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --command='docker stats --no-stream'
  ```
  Capture MEM USAGE.
- §9 cold-start vs cached: re-stop and re-start; the second start should be faster since the image is cached on the boot disk.

If you see this, stop and ask:
- HTTP times out from your laptop but works on SSH: firewall rule didn't take effect. Re-check Step 5.2's `--target-tags` matches Step 5.3's `--tags`.
- WS upgrades but no echo: check `gcloud compute ssh ... --command='docker logs <container-id>'`.

---

## Step 7 — Latency benchmark (Edmonton-origin)

Why: measures Edmonton → Montreal HTTP latency vs Edmonton → Iowa, to ground the chunk 11g.2 region decision.

### Step 7.1 — Benchmark Montreal (the spike VM)

Run this from your laptop. 10 sequential requests:

Linux/macOS:
```
for i in {1..10}; do curl -o /dev/null -s -w '%{time_total}\n' http://<vm-ip>:3001/health; done
```

Windows PowerShell:
```
1..10 | ForEach-Object { (Measure-Command { Invoke-WebRequest -UseBasicParsing -Uri http://<vm-ip>:3001/health }).TotalSeconds }
```

Expected output: 10 lines, each a time in seconds. Sort them; p50 = the average of values 5 and 6 (or just value 5 for a quick read); p95 = the 10th value (largest).

Record: paste raw timings + computed p50/p95 in §6 platform-notes (Montreal row).

### Step 7.2 — Provision us-central1 comparison VM

Why: gives us an honest A/B for the Edmonton-origin region decision. This VM is `e2-micro` (cheaper, ~$0.30/day) since we only need it for one benchmark.

Run this:
```
gcloud compute addresses create citrus-spike-ip-uscentral \
  --project=citrus-fantasy-staging \
  --region=us-central1

gcloud compute firewall-rules create citrus-spike-allow-uscentral \
  --project=citrus-fantasy-staging \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:3001,tcp:3002 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=citrus-spike-uscentral \
  --description="Spike chunk 11g.2.0: us-central1 latency comparison VM, throwaway"

gcloud compute instances create-with-container citrus-spike-uscentral \
  --project=citrus-fantasy-staging \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --container-image=northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest \
  --container-restart-policy=always \
  --tags=citrus-spike-uscentral \
  --address=citrus-spike-ip-uscentral \
  --boot-disk-size=10GB \
  --boot-disk-type=pd-standard
```

Note: the VM pulls the image cross-region (Artifact Registry repo lives in northamerica-northeast1). That adds ~10–20s to startup but is fine for a one-shot benchmark VM.

Get the us-central1 IP:
```
gcloud compute addresses describe citrus-spike-ip-uscentral \
  --project=citrus-fantasy-staging \
  --region=us-central1 \
  --format="value(address)"
```

### Step 7.3 — Benchmark Iowa

Run the same 10-request loop from Step 7.1, replacing `<vm-ip>` with the us-central1 address.

Record: raw timings + p50/p95 in §6 platform-notes (Iowa row).

### Step 7.4 — Tear down us-central1 VM IMMEDIATELY

Why: stop the comparison VM from accumulating cost the moment its measurement is captured.

Run this:
```
gcloud compute instances delete citrus-spike-uscentral \
  --project=citrus-fantasy-staging \
  --zone=us-central1-a \
  --quiet

gcloud compute addresses delete citrus-spike-ip-uscentral \
  --project=citrus-fantasy-staging \
  --region=us-central1 \
  --quiet

gcloud compute firewall-rules delete citrus-spike-allow-uscentral \
  --project=citrus-fantasy-staging \
  --quiet
```

Expected output: three "Deleted" confirmations.

Record: in §6 platform-notes, write the regional decision (Montreal vs Iowa) and one-line rationale.

---

## Step 8 — Fill the platform-notes doc

Why: completes every TBD field in `docs/PHASE_4_5_GCE_PLATFORM_NOTES.md` based on observations during steps 5–7.

Open `docs/PHASE_4_5_GCE_PLATFORM_NOTES.md` in your editor. Walk through every TBD and either fill it or mark it explicitly N/A with a one-line reason. Sections to confirm complete:
- §1 Decision Table (all rows)
- §6 Latency Benchmark (raw timings + decision)
- §7 Startup Time
- §8 Memory Baseline
- §9 Cold-Start Observations
- §10 Deploy Iteration Loop Notes
- §11 Gotchas (and Teardown verification — see Step 9.2)
- §12 Cost Actuals
- §13 Lessons Learned
- §14 Sign-Off (your row, dated)

Do not commit yet — Step 9 (teardown) must be verified zero-orphan first.

---

## Step 9 — Teardown

Why: deletes every billable resource the spike created (except the Artifact Registry image, which stays as chunk 11g.2 reference).

### Step 9.1 — Delete the spike VM, its IP, and its firewall rule

Run this:
```
gcloud compute instances delete citrus-spike-uws \
  --project=citrus-fantasy-staging \
  --zone=northamerica-northeast1-a \
  --quiet

gcloud compute addresses delete citrus-spike-ip \
  --project=citrus-fantasy-staging \
  --region=northamerica-northeast1 \
  --quiet

gcloud compute firewall-rules delete citrus-spike-allow \
  --project=citrus-fantasy-staging \
  --quiet
```

Expected output: three "Deleted" confirmations.

### Step 9.2 — Verify zero orphans

Why: confirms NO spike resources remain. **This is the most important acceptance criterion of the chunk.**

Run all four:
```
gcloud compute instances list --project=citrus-fantasy-staging
gcloud compute addresses list --project=citrus-fantasy-staging
gcloud compute disks list --project=citrus-fantasy-staging
gcloud compute firewall-rules list --project=citrus-fantasy-staging
```

Expected output: nothing matching `citrus-spike` or `spike`. (The Artifact Registry repository doesn't appear in these lists — it stays intentionally and is cleaned up in chunk 11g.3.)

If you see this, stop and ask:
- A spike resource still listed: delete it explicitly. The `--quiet` flag in 9.1 may have failed silently if there was a dependency. Re-run with `--verbosity=info` to see what happened.

Record: paste the literal output of all four commands into §11 of the platform-notes (Teardown verification block). This is the artifact that proves zero orphans.

### Step 9.3 — Delete the local scratch directory

Linux/macOS:
```
rm -rf /tmp/citrus-spike
```

Windows PowerShell:
```
Remove-Item -Recurse -Force "$env:TEMP\citrus-spike"
```

### Step 9.4 — Do NOT delete the Artifact Registry image

Per chunk 11g.2.0 spec: the image at `northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest` stays. Chunk 11g.2 may reference its build metadata or layer caching. Cleanup happens in chunk 11g.3.

---

## Step 10 — Commit the platform-notes doc

Why: lands the spike's deliverable in the repo so chunk 11g.2 has a documented input.

Run this from the citrus repo:
```
git status
git diff docs/PHASE_4_5_GCE_PLATFORM_NOTES.md
git add docs/PHASE_4_5_GCE_PLATFORM_NOTES.md
git commit -m "docs(phase-4-5): GCE platform spike notes (chunk 11g.2.0 acceptance)"
```

Push when ready:
```
git push origin phase-4-5-implementation
```

Spike is complete.

---

## Cheat Sheet — All commands in order

For the second time through, when you don't need the prose. Wrap each block with your verification eye and back-fill the platform-notes doc as you go.

```
# Step 0 — preflight
gcloud auth list
gcloud config get-value project
docker --version
node --version
gcloud services list --project=citrus-fantasy-staging --enabled --filter="config.name:compute.googleapis.com OR config.name:artifactregistry.googleapis.com"

# Step 1-3 — local hello-world + container build
# (cd to scratch dir, npm install, node index.js, smoke test, docker build, docker run, docker kill --signal=SIGTERM)

# Step 4 — Artifact Registry
gcloud artifacts repositories create citrus-spike --project=citrus-fantasy-staging --repository-format=docker --location=northamerica-northeast1 --description="Spike chunk 11g.2.0"
gcloud auth configure-docker northamerica-northeast1-docker.pkg.dev --project=citrus-fantasy-staging
docker tag citrus-spike:test northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest
docker push northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest

# Step 5 — VM
gcloud compute addresses create citrus-spike-ip --project=citrus-fantasy-staging --region=northamerica-northeast1
gcloud compute addresses describe citrus-spike-ip --project=citrus-fantasy-staging --region=northamerica-northeast1 --format="value(address)"
gcloud compute firewall-rules create citrus-spike-allow --project=citrus-fantasy-staging --direction=INGRESS --action=ALLOW --rules=tcp:3001,tcp:3002 --source-ranges=0.0.0.0/0 --target-tags=citrus-spike --description="Spike 11g.2.0"
gcloud compute instances create-with-container citrus-spike-uws --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --machine-type=e2-medium --container-image=northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest --container-restart-policy=always --tags=citrus-spike --address=citrus-spike-ip --boot-disk-size=10GB --boot-disk-type=pd-standard

# Step 6 — smoke test (replace <ip>)
curl http://<ip>:3001/health
wscat -c ws://<ip>:3002/ws/draft/test-lobby

# Step 7 — us-central1 comparison
gcloud compute addresses create citrus-spike-ip-uscentral --project=citrus-fantasy-staging --region=us-central1
gcloud compute firewall-rules create citrus-spike-allow-uscentral --project=citrus-fantasy-staging --direction=INGRESS --action=ALLOW --rules=tcp:3001,tcp:3002 --source-ranges=0.0.0.0/0 --target-tags=citrus-spike-uscentral --description="Spike 11g.2.0 us-central1"
gcloud compute instances create-with-container citrus-spike-uscentral --project=citrus-fantasy-staging --zone=us-central1-a --machine-type=e2-micro --container-image=northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-spike/spike:latest --container-restart-policy=always --tags=citrus-spike-uscentral --address=citrus-spike-ip-uscentral --boot-disk-size=10GB --boot-disk-type=pd-standard
# benchmark, then immediately:
gcloud compute instances delete citrus-spike-uscentral --project=citrus-fantasy-staging --zone=us-central1-a --quiet
gcloud compute addresses delete citrus-spike-ip-uscentral --project=citrus-fantasy-staging --region=us-central1 --quiet
gcloud compute firewall-rules delete citrus-spike-allow-uscentral --project=citrus-fantasy-staging --quiet

# Step 9 — teardown spike VM + zero-orphan verify
gcloud compute instances delete citrus-spike-uws --project=citrus-fantasy-staging --zone=northamerica-northeast1-a --quiet
gcloud compute addresses delete citrus-spike-ip --project=citrus-fantasy-staging --region=northamerica-northeast1 --quiet
gcloud compute firewall-rules delete citrus-spike-allow --project=citrus-fantasy-staging --quiet

gcloud compute instances list --project=citrus-fantasy-staging
gcloud compute addresses list --project=citrus-fantasy-staging
gcloud compute disks list --project=citrus-fantasy-staging
gcloud compute firewall-rules list --project=citrus-fantasy-staging
```
