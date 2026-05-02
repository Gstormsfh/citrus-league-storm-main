# Phase 4.5 Chunk 11g.0 — Dependency Compatibility Audit

**Date:** 2026-04-29
**Branch:** `staging-setup` at `e21f61c`
**Scratch branch:** `chunk-11g-0-compat-evidence` at `22a36e6`
**Authority:** `docs/adr/ADR-001-persistent-node-draft-engine.md`; `docs/PHASE_4_5_PLAN.md` chunk 11g.0

## Summary

**All clean — proceed to chunk 11g.1.** uWebSockets.js v20.51.0 installs into the existing `server/` workspace via the canonical `github:uNetworking/uWebSockets.js#v20.51.0` tag. Native prebuilt binaries cover the Cloud Run runtime (Node 20 on `node:20-slim`). Hono and uWS coexist in one Node process with HTTP on port 3001 and uWS on port 3002. TypeScript builds clean; the existing 484-test server suite passes unchanged. One refactor is **flagged but deferred** to chunk 11g.2: the existing `authMiddleware` and `membershipMiddleware` are tightly coupled to Hono's `Context<Env>` and cannot be invoked directly from a uWS upgrade handler — the helpers need to be extracted runtime-agnostic when 11g.2 wires upgrade-time JWT verification. No refactor work in this chunk.

## Audit results

### 1. uWebSockets.js installation

**Status: clean.**

- **Version pinned:** `uWebSockets.js@github:uNetworking/uWebSockets.js#v20.51.0`. uWS does **not publish to the npm registry**; the canonical install path is the GitHub tag. This is documented in the package's README and is how every reference deployment cites it.
- **Native binaries shipped (verified in `node_modules/uWebSockets.js/`):** Linux x64 for Node 18 (`uws_linux_x64_108.node`), Node 20 (`_115.node`), Node 22 (`_127.node`), Node 23 (`_131.node`); plus equivalents for Linux ARM64 / ARM, Darwin x64 / ARM64, and Win32 x64. The package's runtime dispatcher (`uws.js`) selects the right binary via `process.versions.modules`.
- **Cloud Run runtime fit:** `server/Dockerfile` uses `FROM node:20-slim`. uWS's `uws_linux_x64_115.node` (Node 20 ABI) is in the package — no Dockerfile changes required, no native build step needed at deploy time.
- **No version conflicts.** `npm install uNetworking/uWebSockets.js#v20.51.0` resolved cleanly against existing deps (Hono 4.6, `@hono/node-server` 1.13.7, `@supabase/supabase-js` 2.56.1, Zod 3.23.8, vitest 4.0.18, TypeScript 5.5.3, `@types/node` 22). 1 package added; 0 conflicts; 0 peer-dep warnings related to uWS.
- **TypeScript types:** ship with the package (`node_modules/uWebSockets.js/index.d.ts`). No `@types/uWebSockets.js` package needed.

### 2. Hono HTTP-upgrade handling

**Status: clean** (with a small architectural note).

- **Coexistence model:** Hono runs through `@hono/node-server`'s `serve()` on port 3001 (the existing setup, unchanged). uWS runs as a **separate `uWS.App()`** on port 3002. They live in the same Node process and share the same V8 event loop but listen on different sockets. This matches PLAN chunk 11g.2's deliverable shape and is the simpler-than-multiplexing path. No Hono adapter needed for WebSocket upgrade — uWS owns its own port.
- **Verified by POC** (`server/src/draft/uws-poc.ts` on the scratch branch):
  - `curl http://localhost:3001/health` → `{"ok":true,"transport":"http","port":3001}` (Hono)
  - `curl http://localhost:3002/health` → `{"ok":true,"transport":"http","port":3002,"server":"uws"}` (uWS)
  - `uwsApp.ws('/ws/echo', { upgrade, open, message, close })` registers without error; the upgrade handler reads `sec-websocket-key` / `sec-websocket-protocol` / `sec-websocket-extensions` and calls `res.upgrade(...)` per uWS's documented API.
- **Hono version pin:** Hono 4.6.0 + `@hono/node-server` 1.13.7. No version bump required.
- **Existing API routes unaffected:** all 484 vitest cases pass with uWS in the workspace (suite run against the scratch branch). See § 5 below.

**Architectural note (not a conflict):** the PLAN's chunk 11g.1 token-issuance route lives on the Hono side (port 3001), and chunk 11g.2's WebSocket upgrade lives on the uWS side (port 3002). The discovery-as-function endpoint (`GET /api/drafts/:draftId/server` returning `{host, port, token}`) hands the client both — it's the architectural seam that makes the two-port model invisible to clients. This is exactly the shape the PLAN already specifies; no audit-time issue.

### 3. TypeScript build pipeline

**Status: clean.**

- **`npx tsc --noEmit` (from `server/`)** passes with zero errors against the existing `server/tsconfig.json` (no edits needed): `target: ES2020`, `module: ESNext`, `moduleResolution: bundler`, `esModuleInterop: true`, `isolatedModules: true`. uWS's bundled `index.d.ts` is consumed without complaint.
- **No tsconfig churn required.** I did not modify `server/tsconfig.json` or the root `tsconfig.json`. The `paths` aliases for `@citrus/shared` are unchanged and still resolve.
- **`tsx` (the dev runtime + Cloud Run runtime per `Dockerfile` line 38) handles uWS imports** without configuration changes. The POC starts via `npx tsx src/draft/uws-poc.ts` and both servers boot inside ~1s.
- **Cloud Run build path:** the Dockerfile's `npm ci` step in stage 1 will fetch uWS via the GitHub tag. This requires container build time to have outbound network to GitHub during install (it already does — GitHub is reachable from Cloud Build by default). No Dockerfile edits required for chunk 11g.2's first uWS-using deploy. **Caveat verified locally only:** I did not run a Cloud Build against this configuration; the Cloud Build pass needs to happen as part of chunk 11g.2's first deploy. Flagging here so chunk 11g.2 plans for it.

### 4. Existing middleware compatibility

**Status: clean — with one flagged-for-future-refactor item.**

- **`server/src/middleware/auth.ts` (`authMiddleware`)** is a Hono-style middleware: signature `async (c: Context<Env>, next: Next)`. Internally it calls `c.req.header('Authorization')`, `c.json(...)` for error responses, and `c.set('userId', ...)` / `c.set('userToken', ...)`. The actual JWT verification is `await supabase.auth.getUser(token)` — that part is runtime-agnostic. **The Hono coupling is the problem** for invoking from a uWS upgrade handler: there is no `Context<Env>` available at WebSocket upgrade time.
- **`server/src/middleware/membership.ts` (`membershipMiddleware`)** has the same shape and the same coupling. It also depends on `c.req.param('leagueId')` which is a Hono routing concern.
- **Recommended chunk 11g.2 refactor (NOT done in this chunk):** extract two pure async helpers in `server/src/lib/`:
  ```ts
  // server/src/lib/authVerify.ts
  export async function verifyJwt(token: string): Promise<
    { ok: true; userId: string } | { ok: false; reason: 'missing' | 'expired' | 'invalid' | 'service_unavailable' }
  >
  
  // server/src/lib/membershipCheck.ts
  export async function checkLeagueMembership(args: { userId: string; userToken: string; leagueId: string }):
    Promise<{ ok: true; isCommissioner: boolean } | { ok: false; reason: 'not_member' | 'not_authenticated' | 'bad_request' }>
  ```
  Both functions return tuples that the existing Hono middlewares wrap into `c.json(...)` responses, AND that the chunk 11g.2 uWS upgrade handler consumes directly. The existing tests for `authMiddleware` / `membershipMiddleware` continue to pass without modification (the helpers are called from inside the middlewares).
- **No refactor work lands in 11g.0.** This audit flags the shape and locks in the contract; chunk 11g.2's PR is the place where the helpers and the upgrade handler land together.
- **Chunk 11g.1's discovery endpoint** (the Hono route `GET /api/drafts/:draftId/server`) does NOT need this refactor — it runs in Hono context and uses `authMiddleware` + `membershipMiddleware` exactly as written. So 11g.1 is unblocked by this audit; only 11g.2's upgrade-handler work needs the helpers.

### 5. Async patterns and event loop

**Status: clean.**

- **Existing background work in `server/src/`:**
  - `server/src/middleware/rateLimit.ts:78` runs `setInterval(..., 60_000).unref()` for rate-limit bucket cleanup. The `.unref()` means it does not hold the event loop alive on its own and cannot block uWS message handling. ✓
  - `server/src/lib/circuitBreaker.ts` uses timeout-based reset logic via `setTimeout` for circuit-breaker recovery. Standard pattern, non-blocking. ✓
  - No `setInterval` without `.unref()` in production code; no manual `process.nextTick` event-loop saturation patterns; no synchronous-I/O paths in request handlers.
- **Existing graceful-shutdown handler** (`server/src/index.ts:60-76`) listens for SIGINT/SIGTERM and calls `server.close()` on the Hono server with a 10s force-exit fallback. **For chunk 11g.2 this hook needs to also stop the uWS app** (`us_listen_socket_close(token)` per the uWS API, captured at listen time). Flagging here; not a 11g.0 fix.
- **No request-lifecycle assumptions that break with persistent connections.** I checked `server/src/routes/` for any patterns that would assume "request comes in → handler runs → response sent → done." Nothing problematic — every Hono handler is the standard request/response shape, so adding a long-lived uWS connection in the same process doesn't disturb them.
- **No global state held across requests** in the existing route handlers (each request creates per-request Supabase clients via `createUserClient(token)` from `server/src/lib/supabase.ts`). uWS's per-socket state (kept on `ws.getUserData()`) is orthogonal to Hono's per-request state — they don't share or interfere.

## Recommendation

**Proceed to chunk 11g.1.**

- **Library locked:** `uWebSockets.js@github:uNetworking/uWebSockets.js#v20.51.0` (no npm-registry alternative; the GitHub tag is the canonical install).
- **Hono pinning:** existing `hono@^4.6.0` + `@hono/node-server@^1.13.7` are sufficient. No adapter or version bump required.
- **Port topology:** Hono on `process.env.PORT || 3001` (existing); uWS on a new `process.env.UWS_PORT || 3002`. Configurable via env so Cloud Run can map both if multi-port hosting is needed (single-port multiplexing is out of scope per ADR-001's two-server model).

## Items deferred to specific later chunks

These are not blockers; they're shape-locking notes so the next chunks don't surprise themselves:

1. **(Chunk 11g.2)** Extract `verifyJwt` and `checkLeagueMembership` helpers from the existing Hono middlewares so the uWS upgrade handler can invoke them. Existing middleware tests continue to pass; new helper unit tests added alongside.
2. **(Chunk 11g.2)** Extend the SIGINT/SIGTERM shutdown handler in `server/src/index.ts` to stop the uWS app's listen socket before the 10s force-exit. The uWS API exposes the listen-socket token in the `listen()` callback — capture it in module scope.
3. **(Chunk 11g.2 first deploy)** Verify Cloud Build successfully resolves the `github:uNetworking/uWebSockets.js#v20.51.0` GitHub tag during `npm ci`. Local-only verification was done in this audit.

## Scratch branch evidence

**Branch:** `chunk-11g-0-compat-evidence`
**Commit SHA:** `22a36e6`
**Demonstrates:**
- `server/package.json` updated with `"uWebSockets.js": "github:uNetworking/uWebSockets.js#v20.51.0"`.
- `package-lock.json` regenerated for the new dependency.
- `server/src/draft/uws-poc.ts` — minimal POC: Hono on port 3001 with a `/health` route; uWS on port 3002 with a `/health` route plus `/ws/echo` WebSocket endpoint with a typed upgrade handler.
- `npx tsc --noEmit` passes from `server/`.
- `npm test` (vitest) passes 26 test files, 484 tests, in 2.92s.
- Manual boot of the POC: `npx tsx src/draft/uws-poc.ts` → `curl /health` on both ports returns the documented JSON.

**Not for merge.** The POC and the dependency-add live on the scratch branch as evidence; chunk 11g.1 (discovery endpoint + JWT issuance) is the next merge to `staging-setup` and lands the real Hono route. Chunk 11g.2 lands the real uWS code (replacing `uws-poc.ts` with `server/src/draft/uwsServer.ts` or similar).

## Cross-references

- `docs/adr/ADR-001-persistent-node-draft-engine.md` § Decision (uWebSockets.js library lock); § "What stays vs. what changes" → "New transport"; § Validation Gates → Chunk 11g.0.
- `docs/PHASE_4_5_PLAN.md` chunk 11g.0 (this audit's spec); chunk 11g.1 (discovery endpoint); chunk 11g.2 (uWS setup with upgrade auth — consumes the helpers flagged in § 4 above).
- `docs/REGISTRY.md` KI-008 (architectural pivot); KI-009 (Edge Function infra removal); KI-011 (multi-process sharding deferred).
