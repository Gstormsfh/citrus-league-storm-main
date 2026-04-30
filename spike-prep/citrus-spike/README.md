# citrus-spike — Phase 4.5 chunk 11g.2.0 throwaway spike

## What this is

A two-port hello-world Node service. Hono on `${PORT}` (default 3001) with a `/health` endpoint that returns `{ ok: true, server: 'hono' }`. uWebSockets.js on `${DRAFT_WS_PORT}` (default 3002) with a `/ws/draft/:lobbyId` route that echoes incoming messages prefixed `echo: `. Both servers run in the same Node process. A single SIGTERM handler closes both within 10 seconds.

## Why it exists

Chunk 11g.2.0 is a GCE platform spike. It validates that GCE supports the two-ports-one-process pattern locked in `docs/PHASE_4_5_ARCHITECTURE.md` Stack Decision section, exercises the deploy primitives Citrus has not used before (Artifact Registry, Container-Optimized OS, static IPs, firewall tags, IAM service accounts), and produces a written platform-decisions doc that feeds chunk 11g.2 implementation.

This directory is the spike's hello-world server. Garrett executes the spike on his own laptop following `docs/PHASE_4_5_GCE_SPIKE_RUNBOOK.md`. The deliverable is `docs/PHASE_4_5_GCE_PLATFORM_NOTES.md`. Throwaway VMs and most spike resources get deleted at chunk close per the runbook's teardown step.

## Why it's checked in (and not just `/tmp`)

The runbook lives in `docs/`, but the runbook deploys this code. Keeping the code in-repo as the canonical reference is cheaper than maintaining a separate gist or scratch directory and easier to keep in sync with `server/package.json` versions. After chunk 11g.2.0 closes, this directory may stay in-repo as historical reference for chunk 11g.2 implementation, or it may be deleted in chunk 11g.3 cleanup. Either is fine.

## Versions

- `hono@4.6.0` — pins the same version as `server/package.json` (`^4.6.0`) so the spike validates the production version. The caret is dropped to true-pin the spike.
- `@hono/node-server@1.13.7` — same pin pattern, matches `server/package.json`.
- `uWebSockets.js@v20.51.0` — installed from the GitHub tarball (uWS does not reliably publish to npm). This is the version chunk 11g.2 will adopt unless Zach overrides during review. Note: uWS native binaries are platform-specific; v20.51.0 ships musl prebuilts so the `node:22-alpine` base image works. If uWS install fails on Alpine for any reason, the runbook's Step 3.1 fallback is to switch the Dockerfile base to `node:22-bookworm-slim` (glibc).

## Running locally

See `docs/PHASE_4_5_GCE_SPIKE_RUNBOOK.md` Step 2 for the full local-validation flow. Quick summary:

```
npm install
node index.js
# in another terminal:
curl http://localhost:3001/health
npx wscat -c ws://localhost:3002/ws/draft/test-lobby
```

Type a message in `wscat`. Server should reply `echo: <your message>`.

## Cross-references

- `docs/PHASE_4_5_PLAN.md` chunk 11g.2.0 — the spec this directory satisfies.
- `docs/PHASE_4_5_ARCHITECTURE.md` — Stack Decision section explaining two-ports-one-process.
- `docs/PHASE_4_5_GCE_SPIKE_RUNBOOK.md` — execution runbook (step-by-step gcloud commands).
- `docs/PHASE_4_5_GCE_PLATFORM_NOTES.md` — the platform-decisions doc this spike produces.
