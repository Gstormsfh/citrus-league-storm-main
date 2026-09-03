# Citrus Fantasy Sports — Deploy Runbook (Playoffs Readiness)

> **The API has no separate subdomain.** `api.citrusfantasysports.com` does not
> resolve (measured 2026-09-03: curl exit 000, no connection). The web app is
> built with `VITE_API_URL` deliberately UNSET so `/api/*` stays relative, and
> Firebase Hosting rewrites it to Cloud Run. The origin that answers is
> `https://citrusfantasysports.com` (verified 200 in 0.36s), which is exactly
> what `apps/web/scripts/build-native.mjs` accepts in `PRODUCTION_API_ORIGINS`
> for the iOS build. Setting `VITE_API_URL` to an `api.` host breaks every
> request in the native shell and the build guard refuses it.

**Audience.** The human (you) who will execute the deploy. Assumes you
have the repo cloned, `gcloud` + `firebase` + `git` + `k6` installed,
and console access to GCP, Firebase, Supabase, GitHub, Sentry, and
BetterStack.

**Goal.** Ship the P0 remediation merged in `dbd6a41` to production,
then prove with real load testing that the stack survives a 200-user
playoff beta. Each phase has: purpose, exact commands, expected output,
troubleshooting, and rollback.

**Order matters.** Do NOT skip phases. The cheap-to-verify phases
(0, 1, 4) exist specifically to catch the kind of configuration error
that caused April 10. If smoke fails, nothing after it will mean
anything.

**Total time.** ~2 hours of hands-on work. ~3 hours wall-clock if you
include the full load-test suite. Budget a half-day.

---

## Phase 0 — Pre-flight (5 min)

**Purpose.** Confirm your environment is sane before you change anything.

### Commands

```bash
# 1. Make sure you're on master at the merge commit (everything P0)
cd /path/to/citrus-league-storm-main
git fetch origin
git status                              # → "On branch master, up to date with 'origin/master'"
git log --oneline -1                    # → a5ee37a or later (load-test framework)
git log --oneline -15 | grep -i 'P0\|postmortem\|live.draft'   # confirm dbd6a41 is in history

# 2. Confirm tooling
node --version                          # ≥ 20
npm --version                           # ≥ 10
gcloud --version                        # Google Cloud SDK 450+
firebase --version                      # 13+
k6 version                              # 0.50+ (install: brew install k6)

# 3. Confirm credentials are active
gcloud auth list                        # should show your email as ACTIVE
gcloud config get-value project         # → citrus-fantasy-sports
firebase projects:list                  # → citrus-fantasy-sports

# 4. Local build sanity — if this fails, do NOT deploy
npm ci
npm run test                            # expect ~1200+ web tests passing
npm run test:server                     # expect ~420+ server tests passing
npm run build                           # expect success + dist/ populated
```

### Expected output

- All version checks pass
- `gcloud config get-value project` is `citrus-fantasy-sports`
- `npm run build` exits 0 with `dist/` containing the built bundle
- Total test failures: **zero**

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `gcloud` says "no active account" | Not logged in | `gcloud auth login` |
| `firebase projects:list` fails | Not logged in | `firebase login` |
| `npm run test` shows GOALIE_GSAX failures | Postmortem fix didn't land | `git log --all --grep=GOALIE_GSAX` — should show `d26d232` |
| `npm run build` fails on asset size gate | PNG budget gate firing correctly | Check `dist/**/*.png` total > 512 KB — means minified assets were reverted |

### Rollback

N/A — nothing has changed yet. Stop here if anything above failed.

---

## Phase 1 — GitHub Secrets audit (10 min)

**Purpose.** The production deploy workflow (`.github/workflows/production-deploy.yml`)
needs a specific set of repository secrets. Missing or wrong values
cause silent failures — the deploy "succeeds" but ships a broken
bundle. We audit before any push triggers the workflow.

### Required secrets

Navigate to: **GitHub → `Gstormsfh/citrus-league-storm-main` → Settings → Secrets and variables → Actions**

Confirm each of these exists and is non-empty. You can't read existing
values from the UI; if you're not sure, rotate and re-set.

| Secret | Used by | Source of truth |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | web + server build | Supabase Dashboard → Project Settings → API → URL |
| `VITE_SUPABASE_ANON_KEY` | web + server build | Supabase Dashboard → Project Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | server + RLS audit | Supabase Dashboard → Project Settings → API → service_role key |
| `VITE_FIREBASE_API_KEY` | web build | Firebase Console → Project Settings → General → Web app config |
| `VITE_FIREBASE_APP_ID` | web build | same |
| `VITE_FIREBASE_MEASUREMENT_ID` | web build | same |
| `VITE_SENTRY_DSN` | web build | Sentry → Settings → Projects → citrus-web → Client Keys (DSN) |
| `VITE_API_URL` | web build | **unset on web** (relative `/api/*` + Hosting rewrite). Native/iOS only: `https://citrusfantasysports.com` |
| `FIREBASE_SERVICE_ACCOUNT` | hosting deploy | Firebase Console → Project Settings → Service accounts → Generate new private key (JSON, paste whole file) |
| `GCP_SA_KEY` | Cloud Run deploy | GCP Console → IAM → Service Accounts → `citrus-deploy@...` → Keys → Add key (JSON, paste whole file) |

### Sanity check

After confirming all exist, trigger a dry-run of the workflow without
deploying: go to **Actions → Production Deploy → Run workflow** on a
branch (not master), look at the build logs for missing-env warnings.
Cancel before the deploy step.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Workflow fails with "undefined VITE_…" | Secret missing or has leading/trailing whitespace | Re-set the secret; don't paste from a rich-text source |
| `FIREBASE_SERVICE_ACCOUNT` auth fails | Pasted something other than the raw JSON | Re-download from Firebase and paste the entire file contents |
| `GCP_SA_KEY` auth fails | Service account lacks Cloud Run Admin role | Grant `roles/run.admin` + `roles/iam.serviceAccountUser` |

### Rollback

N/A — auditing secrets does not change deployment state.

---

## Phase 2 — Cloud Run config push (10 min)

**Purpose.** The live Cloud Run revision is still the April 10 disaster
config (512Mi / 1 CPU / maxScale=3). The declarative service config in
`ops/cloudrun/service.yaml` has the fixed values (2Gi / 2 CPU /
minScale=1 / maxScale=10 / cpu-throttling=false). We push it now,
once, so the next CI-driven deploy does not revert to broken defaults.

### Commands

```bash
# Confirm you're pushing the right file
cat ops/cloudrun/service.yaml | grep -E 'minScale|maxScale|memory|cpu'
# Expect:
#   autoscaling.knative.dev/minScale: "1"
#   autoscaling.knative.dev/maxScale: "10"
#   memory: 2Gi
#   cpu: "2"

# Push config
gcloud run services replace ops/cloudrun/service.yaml \
  --region=us-central1

# Verify the live revision now matches
gcloud run services describe citrus-api \
  --region=us-central1 \
  --format='value(spec.template.metadata.annotations)'
# Expect minScale=1, maxScale=10, cpu-throttling=false, startup-cpu-boost=true

gcloud run services describe citrus-api \
  --region=us-central1 \
  --format='value(spec.template.spec.containers[0].resources.limits)'
# Expect: {'cpu': '2', 'memory': '2Gi'}

# Health check through the live URL
curl -sS https://citrusfantasysports.com/api/health | jq .
# Expect: { "status": "ok", ... }
```

### Expected output

- `services replace` exits 0
- `describe` confirms the new annotations
- Health check returns 200 with `status: ok`
- Cloud Run console shows a new revision with `100%` traffic

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `services replace` says "secret not found" | `SUPABASE_*` secrets missing in Secret Manager | Create them: `echo -n "<value>" \| gcloud secrets create SUPABASE_URL --data-file=-` etc. |
| New revision stuck at 0% traffic | Startup probe failing | Tail logs: `gcloud logging tail "resource.type=cloud_run_revision"` — common cause: missing env var |
| Health returns 503 | Container booting, give it 30s | Wait and retry; if persists after 2 min, rollback |
| Health returns 200 but `/api/players` fails | DB connection issue | Check Supabase Dashboard for connection pool saturation |

### Rollback

```bash
# Roll back to the previous revision (one-liner)
gcloud run services update-traffic citrus-api \
  --region=us-central1 \
  --to-revisions=$(gcloud run revisions list \
    --service=citrus-api --region=us-central1 \
    --format='value(name)' --limit=2 | tail -n1)=100
```

Keep this command in a scratch buffer throughout Phases 3+. If anything
looks wrong, run it and you're back on the previous revision in < 30s.

---

## Phase 3 — Firebase Blaze + budget cap (15 min)

**Purpose.** The April 10 bundle shipped 3.4 MB of PNGs. If that pattern
recurs on the Spark (free) tier, Firebase Hosting either hard-stops at
the 10 GB/month egress cap (leaving users on a broken cached build) or
silently disables the site. Blaze is pay-as-you-go with a budget cap —
safer AND auto-recovers.

### Upgrade steps

1. **Firebase Console → `citrus-fantasy-sports`** (top-left project selector)
2. Lower-left: **Upgrade** button → select **Blaze (pay-as-you-go)**
3. Link a billing account (create one if needed, requires credit card)
4. Confirm upgrade. Firebase will NOT change behavior until traffic
   exceeds the free tier; you get the Spark-tier allowance free before
   any charges accrue.

### Budget cap (so you don't get a surprise $500 bill)

1. **GCP Console → Billing** → the billing account linked above
2. **Budgets & alerts** → **Create budget**
3. Fill in:
   - **Name**: `citrus-fantasy-sports playoffs cap`
   - **Scope**: project `citrus-fantasy-sports`, all services
   - **Time range**: Monthly
   - **Budget type**: Specified amount → **$50**
   - **Thresholds**: 50%, 90%, 100%, 120%
   - **Email alerts to**: your email (add on-call emails too)
4. Save.

### Optional — auto-disable at 100%

Pub/Sub + a Cloud Function that calls `billingAccounts.projects.updateBillingInfo`
with empty billing info. Skip for launch; email alerts at 50/90/100% are
sufficient given the traffic levels we expect.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Blaze upgrade unavailable" | Credit card verification pending | Check email for Google billing verification |
| Budget alert email doesn't arrive at threshold | Email filter | Check spam; add `billing-noreply@google.com` to contacts |
| Project shows Spark even after upgrade | Caching in Firebase console | Hard-refresh browser; takes ~2 min to propagate |

### Rollback

Downgrading Blaze → Spark is a UI click in the same place. Note: this
re-applies free-tier egress caps, so only downgrade if you are
definitely under the free allowance.

---

## Phase 4 — Production smoke test (5 min)

**Purpose.** A 60-second k6 smoke test confirms the endpoints that
matter are reachable and fast BEFORE we do any of the expensive load
runs. If this fails, everything after it is moot.

### Commands

```bash
# From repo root
TARGET_URL=https://citrusfantasysports.com \
  k6 run scripts/load-test/scenarios/smoke.js
```

### Expected output

The k6 summary block at the end prints:

```
============================================================
SMOKE TEST — PASS
============================================================
Requests: ~300
Error rate: 0.000%
p50 latency: <200ms
p95 latency: <500ms
p99 latency: <1000ms
============================================================
```

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `SMOKE TEST — FAIL`, error rate > 0% | New Cloud Run revision unhealthy | Phase 2 rollback. Investigate. |
| p95 > 500ms | Cold starts (minScale=0 instead of 1) | Check annotations — minScale should be "1" after Phase 2 |
| p95 > 500ms but minScale correct | DB slow, Supabase connection pool saturated | Supabase dashboard → connection pool → restart if needed |
| All 503s | Cloud Run scaling to 0 | Confirm `minScale: 1` took effect; sometimes takes 2-3 min after `services replace` |

### Rollback

If smoke fails: Phase 2 rollback command. Then diagnose offline before
retrying Phase 4.

---

## Phase 5 — Load test the full stack (45–90 min, depending on which scenarios)

**Purpose.** Prove the stack survives 200 users. This is the single
piece of evidence you didn't have before; everything else has been
math. Run these against STAGING first if you haven't — auth scenarios
write data.

### 5a — Steady state (13 min, unauthenticated, no setup)

```bash
TARGET_URL=https://citrusfantasysports.com \
  k6 run scripts/load-test/scenarios/steady-state.js
```

**Watch in parallel:**

- Tab 1: GCP Console → Cloud Run → citrus-api → Metrics
  - Instance count (should peak 2–4; if 10, we're under-provisioned)
  - Container CPU util (30–60%)
  - Container memory (< 1.2 GiB)
  - Request latency p95
- Tab 2: Supabase Dashboard → Database → Connection pool
  - Active connections (peak should stay < 180 on Pro tier)
- Tab 3: `gcloud logging tail "resource.type=cloud_run_revision" --format=json | jq '.severity'`

**Pass criteria (both k6 AND dashboards):**

- [ ] k6 prints `STEADY-STATE — PASS`
- [ ] k6 error rate < 0.5%
- [ ] Cloud Run never hit 10 instances (headroom exists)
- [ ] No OOM kills in Cloud Logging
- [ ] Supabase active connections peaked < 180

### 5b — Realtime connections (7 min, auth, needs TEST_ACCOUNTS)

Only run after you've provisioned test accounts:

```bash
# One-time: provision 200 test accounts
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_KEY=eyJ... \
  npx tsx scripts/load-test/provision-test-accounts.ts \
    --count 200 --output accounts.json

# Run scenario
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_ANON_KEY=eyJ...
export TEST_ACCOUNTS="$(cat accounts.json)"
k6 run scripts/load-test/scenarios/realtime-connections.js
```

**Watch in parallel:** Supabase Dashboard → Realtime → active connections.
It should climb to exactly 200.

**Pass criteria:**

- [ ] All 200 connects succeed
- [ ] Supabase dashboard shows 200 active realtime connections (exact)
- [ ] Zero `too_many_connections` errors (if any, you're hitting plan cap)

**If Supabase is on the Free tier (200 realtime cap), a single spare
user refreshing the page during a busy period breaks the test.** Upgrade
to Pro ($25/mo, 500 cap) before the beta opens.

### 5c — Reconnection storm (6 min, auth)

```bash
k6 run scripts/load-test/scenarios/reconnection-storm.js
```

**Pass criteria:**

- [ ] 600+ successful reconnects (200 VUs × 3 cycles)
- [ ] Auth endpoint 429s = 0 (CRITICAL; non-zero means real users will
      get signed out during the next realtime blip)
- [ ] p95 reconnect latency < 3000ms

### 5d — Notification storm (5 min, auth + service key)

This is the April 10 §5 behavioral regression test under load. Needs
**two** leagues and **two** account pools.

```bash
# Create league A and league B in Supabase beforehand (can be a
# staging project). Note their UUIDs.

npx tsx scripts/load-test/provision-test-accounts.ts \
  --count 100 --league <A_UUID> --output accounts-a.json
npx tsx scripts/load-test/provision-test-accounts.ts \
  --count 100 --league <B_UUID> --output accounts-b.json

export TEST_ACCOUNTS_LEAGUE_A="$(cat accounts-a.json)"
export TEST_ACCOUNTS_LEAGUE_B="$(cat accounts-b.json)"
export TEST_LEAGUE_A_ID=<A_UUID>
export TEST_LEAGUE_B_ID=<B_UUID>
export SUPABASE_SERVICE_KEY=eyJ...     # service_role, bypasses RLS

k6 run scripts/load-test/scenarios/notification-storm.js
```

**Pass criteria (ABSOLUTE, not a budget):**

- [ ] League-A → B leakage = **0**
- [ ] League-B → A leakage = **0**

Any non-zero value means `NotificationService.subscribeToNotifications`
is leaking, and the April 10 bug is back. **Do not open the beta** until
fixed.

### 5e — Draft simulation (22 min, auth, needs TEST_LEAGUE_ID)

Full authenticated-draft flow. Only run this against a dedicated test
league — it reads heavily and was intentionally designed NOT to make
real picks (200 VUs in real pick order would serialize).

```bash
export TEST_LEAGUE_ID=<UUID_of_staging_league>
k6 run scripts/load-test/scenarios/draft-simulation.js
```

**Pass criteria:**

- [ ] k6 prints `DRAFT SIMULATION — PASS`
- [ ] Error rate < 1%
- [ ] p95 pick latency < 1500ms
- [ ] Zero 5xx from `/api/draft/*`

### Minimum viable load-test suite (if you're short on time)

If you can only do one: **5a (steady state)**. That's the single best
evidence for "will 200 users break the site".

If you can do two: add **5c (reconnection storm)** — it's the single
most common silent failure mode in realtime apps and the one you
haven't stress-tested.

If you can do three: add **5b (realtime connections)** — it's the one
test that definitively confirms your Supabase plan tier.

---

## Phase 6 — Sentry alerts (10 min)

**Purpose.** Error telemetry is already wired in the code via
`VITE_SENTRY_DSN`. But default Sentry has no alert rules — errors land
silently in the Issues tab and nobody looks. We add the two alert rules
that would have paged on April 10.

### Setup

1. **Sentry → Alerts → Create Alert Rule**
2. Rule 1: **"Production spike — new 5xx errors"**
   - When: *Event frequency* exceeds **10** in **1 minute**
   - Filter: `event.type:error level:error environment:production`
   - Action: Email on-call + Slack `#incidents`
3. Rule 2: **"Production regression — new issue"**
   - When: *A new issue is created*
   - Filter: `environment:production level:error`
   - Action: Email on-call

### Verify

From your dev machine:

```bash
# Trigger a synthetic error via a browser devtools console on the live site
throw new Error('sentry-smoke-test-ignore')
```

Wait ~60s, then check Sentry Issues — new issue should appear, and if
Rule 2 is wired correctly you should get an email within a minute.

Resolve the test issue afterward so it doesn't pollute the dashboard.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No issue appears in Sentry after synthetic error | DSN wrong or Sentry not initialized | Check browser devtools → Network → filter `ingest.sentry.io` for 200 responses |
| Alert email doesn't arrive | Rule scope too narrow | Edit rule, remove `environment:production` filter temporarily, re-trigger |

### Rollback

Delete the alert rules. Sentry telemetry continues either way.

---

## Phase 7 — BetterStack external monitors (15 min)

**Purpose.** Sentry catches frontend errors but misses entire-site-down.
If Cloud Run crashes hard, there are no frontend errors — there's just
no frontend. BetterStack (or Pingdom, UptimeRobot — any external HTTP
monitor) pings from outside your infrastructure and pages you if the
site becomes unreachable. This is the April 10 wake-up-at-8am problem:
we didn't know the site was down until users told us.

### Setup

1. **BetterStack → Monitors → Create monitor**
2. Monitor 1: **API health**
   - URL: `https://citrusfantasysports.com/api/health`
   - Check type: HTTP(S)
   - Check interval: **60 seconds**
   - Timeout: 5 seconds
   - Expected status: **200**
   - Expected response contains: `"status":"ok"`
   - Regions: us-east, us-west, eu-west (multi-region so a single
     backbone outage doesn't false-positive)
3. Monitor 2: **Web landing page**
   - URL: `https://citrusfantasysports.com`
   - Interval: 60 s, timeout 10 s
   - Expected status: 200
   - Expected response contains: `<title>` (anything indicating the HTML rendered)
4. Escalation policy:
   - First alert: email on-call (you)
   - After 5 minutes: SMS on-call
   - After 15 minutes: call on-call

### Verify

Temporarily break one monitor (e.g. change URL to `/api/nonexistent`)
and confirm the alert arrives via email. Then revert.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Monitor shows "up" but API is actually down | Cloud Run cold start < check interval | Lower timeout to 3s, interval to 30s |
| False positives from EU region | EU datacenter transient issue unrelated to app | Remove EU region if flaky; add back once stable |
| SMS escalation doesn't fire | Phone number not verified in BetterStack | Verify in profile settings |

### Rollback

Delete monitors. Nothing in the deployed app depends on them.

---

## Phase 8 — Ops dashboard (20 min)

**Purpose.** When the beta is live, you want ONE page that tells you
whether the site is healthy — not five tabs across three vendors. This
is the "single throat to choke" during a live event.

### Dashboard 1 — GCP Cloud Monitoring (the most important)

1. **GCP Console → Monitoring → Dashboards → Create dashboard**
2. Name: `citrus-api playoffs live`
3. Add charts:
   - **Container instance count** (metric: `run.googleapis.com/container/instance_count`, filter `service_name=citrus-api`) — threshold line at 8 (80% of maxScale=10)
   - **Request latency p95** (`run.googleapis.com/request_latencies`, aligner 95th percentile) — threshold line at 1500ms
   - **Request count by status** (stacked by 2xx/4xx/5xx) — 5xx > 0 is a flag
   - **CPU utilization** per instance — threshold line at 80%
   - **Memory utilization** per instance — threshold line at 80%
4. Set time range to "last 30 minutes", auto-refresh: 30 s
5. **Bookmark the URL.** Open it in a dedicated tab during any live
   event (beta night, draft night).

### Dashboard 2 — Supabase

Supabase doesn't let you build a custom dashboard, but you can bookmark
the three tabs you need:

- `https://supabase.com/dashboard/project/<ID>/database/pooler` — connection pool
- `https://supabase.com/dashboard/project/<ID>/realtime/inspector` — active realtime connections
- `https://supabase.com/dashboard/project/<ID>/logs/postgres-logs` — database errors

Put all three in a browser folder `citrus-live`.

### Dashboard 3 — BetterStack status page

BetterStack has a built-in status page per monitor. Create a public
status page (`status.citrusfantasysports.com`) and pin it as your "is
the site up?" source of truth. Share with beta users.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Cloud Monitoring dashboard empty | Metric ingestion lag | Wait 2-3 min after first requests; metrics have ~1 min delay |
| Supabase inspector shows 0 connections but app works | App using HTTP calls, not websockets — correct behavior | No fix needed |

### Rollback

Delete dashboards — no effect on production.

---

## Phase 9 — Final verification (10 min)

**Purpose.** One last walk-through of the golden path as a real user
before you open the site to anyone. The load tests proved the
infrastructure; this proves the UX.

### Checklist (run as a real user, in a real browser, in incognito)

- [ ] `https://citrusfantasysports.com` loads in < 2s
- [ ] Sign-up flow works with a fresh email address
- [ ] Email confirmation arrives (< 60s)
- [ ] Sign-in after confirmation succeeds
- [ ] Home page renders with user's league list
- [ ] Clicking into a league renders the dashboard
- [ ] Player search returns results
- [ ] A goalie's player card renders with a `goalsSavedAboveExpected`
      value (this is the April 10 §2 regression — must be non-null)
- [ ] Open a second browser (different account), post something in
      league A, confirm the first account in league A sees the
      notification **and** the first account does NOT see it if
      they're in a different league (April 10 §5)
- [ ] Sign out works
- [ ] Sign back in — session persists
- [ ] Lighthouse mobile score ≥ 80 (DevTools → Lighthouse → Mobile)

### What failure looks like

- Goalie card shows no xG data → Phase 2 rollback; investigate
  `PlayerService.ts` / `COLUMNS.GOALIE_GSAX`
- Cross-league notification leak → immediate site shutdown; the
  `NotificationService.ts:109` fix is not holding
- Lighthouse < 80 with LCP > 4s → check `apps/web/dist/assets/*.png`
  totals; if > 512 KB, the minification regressed

### Rollback

Phase 2 rollback command. If you see the notification leak specifically,
also disable the realtime subscription by commenting out the
`subscribeToNotifications` call in `NotificationContext` until
properly fixed — don't leave an active leak running.

---

## Phase 10 — Tonight's friends-test protocol

**Purpose.** You said you want to test with friends tonight. This is
the micro-version of the playoff beta: 5–10 real users, 30 minutes,
with you actively watching the dashboards from Phase 8.

### Pre-flight (5 min)

- [ ] Phases 0, 4, 6, 7, 8 complete
- [ ] Phase 5a (steady-state) at minimum has been run and passed
- [ ] All Phase 8 dashboards open in a dedicated browser window
- [ ] Rollback command in a separate terminal tab:

```bash
gcloud run services update-traffic citrus-api \
  --region=us-central1 \
  --to-revisions=$(gcloud run revisions list \
    --service=citrus-api --region=us-central1 \
    --format='value(name)' --limit=2 | tail -n1)=100
```

### The protocol

1. **You sign in first.** Create a test league you own. Note the UUID.
2. **Send your friends the site URL and the invite link.** Tell them:
   - Sign up with any email (not Google SSO yet — keeps the failure
     surface smaller)
   - Click the invite link once signed in
   - Browse around, try: player search, joining the league, looking
     at a goalie card, drafting if applicable
3. **Watch Phase 8 dashboards continuously.** Look for:
   - Cloud Run instance count climbing (2 → 3 → 4 is fine; 8+ is a flag)
   - 5xx count > 0 — look at the logs for the one that fired
   - Supabase connection pool > 180 — scale Supabase plan
   - Sentry new issues — open them as they arrive, triage live
4. **Have each friend report:**
   - What they tried
   - What broke (even small UI glitches)
   - How fast it felt (qualitatively)
5. **Afterwards (within 30 min of the test ending):**
   - Screenshot the Phase 8 dashboards at peak load — this is your
     baseline for the playoff beta
   - Open any Sentry issues that fired, triage P0/P1 vs noise
   - Write down everything your friends reported, categorized by
     severity
   - Compare friend-perceived latency to k6 p95 — if friends say
     "slow" but k6 said p95 < 1000ms, you have a frontend bundle /
     render issue, not a backend issue

### What "ready for 200 users" looks like

After the friends test, you can claim 200-user readiness when:

- [ ] 5a, 5c (minimum) have passed against the prod environment
- [ ] Friends test ran 30+ min with 5+ concurrent users and no P0
      issues
- [ ] Sentry dashboard is empty of unresolved production errors
- [ ] BetterStack monitors have been green for 24h
- [ ] You have a written incident-response plan (who to call, what to
      roll back, what to post to beta users) — this can be a 1-page
      doc in `docs/`

### What "not yet ready" looks like

- Any of the above is false
- Cloud Run hit maxScale during friends test
- Supabase realtime dashboard showed disconnects for any friend
- Any cross-league data leakage of any kind
- You, personally, are unable to reproduce the friends' bugs locally
  (means there's an environment-shaped gap you haven't found)

Do not rush past "not yet ready". An underprovisioned or buggy beta
that opens to 200 users is worse than a delayed launch — it poisons
the well for the next attempt.

---

## Appendix A — Emergency rollback paths

### "The API is 5xx'ing right now"

```bash
# Roll back Cloud Run to previous revision (< 30s)
gcloud run services update-traffic citrus-api \
  --region=us-central1 \
  --to-revisions=$(gcloud run revisions list \
    --service=citrus-api --region=us-central1 \
    --format='value(name)' --limit=2 | tail -n1)=100
```

### "The web bundle is broken"

```bash
# Roll back Firebase Hosting to previous release
firebase hosting:clone \
  citrus-fantasy-sports:live \
  citrus-fantasy-sports:live \
  --version previous
# You'll be prompted for the previous version ID — pick the last one
# marked "deployed"
```

### "There's a data leak / security regression"

1. Disable the public-facing site by setting `firebase hosting:disable`
   (maintenance mode). This takes the site offline immediately.
2. Roll back Cloud Run (above).
3. Post a status-page incident.
4. Investigate offline.

### "Supabase is rejecting all traffic"

Supabase has no self-service rollback. Contact Supabase support.
Meanwhile, the Cloud Run API will 503 on DB calls — users will see
"service unavailable". Post a status-page incident.

---

## Appendix B — What you should have open during the beta

A physical checklist of browser tabs:

1. GCP Cloud Monitoring dashboard (Phase 8)
2. Supabase → pooler (connection pool)
3. Supabase → realtime inspector
4. Sentry → Issues
5. BetterStack → Monitors (status)
6. The live site itself, signed in as an admin user
7. One terminal with the Cloud Run rollback command ready

If you can't keep all 7 open comfortably, use an additional monitor.
The muscle-memory of "see anomaly → look at the right tab → diagnose
in < 30s" is what you're training during the friends test.

---

## Appendix C — Explicitly out of scope for this runbook

Tracked elsewhere, do not confuse with this runbook's scope:

- **Replacing the in-memory cache with Redis / Memorystore.** Architectural
  follow-up; current in-process LRU bound is sufficient up to ~500 users
  on minScale=1. Revisit if we cross that threshold.
- **Server-side SSE/WebSocket notification broker.** Deferred per
  postmortem; the in-client filter + callback guard is the current
  mitigation.
- **Staging environment.** We're running staging-equivalent tests
  against the production project with dedicated test accounts; a
  separate staging GCP project is a P1 followup.
- **Schema-aware `COLUMNS.*` codegen.** The tripwire test at
  `packages/shared/src/constants/__tests__/columns.test.ts` is the
  stopgap.
- **Penetration test.** RLS audit + weekly CI is the minimum bar;
  full pentest is a pre-public-GA item.

---

**End of runbook.** Keep this file committed in the repo and update it
after every production incident — each phase should accumulate "what
we learned" notes in-line.

