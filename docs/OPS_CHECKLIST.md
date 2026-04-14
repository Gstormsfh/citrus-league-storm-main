# Ops checklist — playoff readiness

Console-side work that has to be done by a human with the right credentials.
None of this is code — it's GCP / Firebase / GitHub / Sentry / BetterStack
console work. Track status in the checkboxes.

Updated: 2026-04-14

---

## 1. Apply Cloud Run scaling config

- [ ] Done (date + initials: ____________)

**Why:** The April 10 disaster config (512Mi / 1 CPU / maxScale=3) is still
the running revision. The deploy workflow is now fixed so future pushes
won't reset to it, but the live service needs to be updated once.

**Steps:**

1. `gcloud auth login`
2. `gcloud config set project citrus-fantasy-sports`
3. From repo root:
   `gcloud run services replace ops/cloudrun/service.yaml --region=us-central1`
4. Verify:
   `gcloud run services describe citrus-api --region=us-central1 --format="value(spec.template.metadata.annotations)"`
   Expect `minScale: 1`, `maxScale: 10`, `cpu-throttling: false`,
   `startup-cpu-boost: true`, memory 2Gi, CPU 2.
5. Health check: `curl -s $API_URL/api/health`

---

## 2. Firebase Hosting: Blaze + billing cap + alert

- [ ] Done (date + initials: ____________)

**Why:** On the Spark free tier, hosting either hard-stops or uncapped-bills
if traffic spikes. April 10 shipped 3.4 MB of unused PNGs; an incident
like that on Spark would have torn through the free egress and left real
users on a broken cached bundle.

**Steps:**

1. https://console.firebase.google.com → `citrus-fantasy-sports` → **Upgrade** → **Blaze**.
2. Link/confirm billing account.
3. Budget cap: https://console.cloud.google.com/billing → billing account
   → **Budgets & alerts** → **Create budget**.
   - Name: `citrus-fantasy-sports hosting cap`
   - Project: `citrus-fantasy-sports`
   - Amount: $50/month (tune up after a month of real data)
   - Thresholds: 50%, 90%, 100%
   - Recipients: on-call email(s)
4. Optional hard-stop: Pub/Sub notifications + a disable-billing Cloud
   Function. Skip for now; email alerts are sufficient.

---

## 3. Verify GitHub repo secrets

- [ ] Done (date + initials: ____________)

**Why:** The change-freeze CI check, nightly batch, and production deploy
all rely on these. If any are missing, the workflows fail silently or
— worse — fail-open.

**Steps:**

1. https://github.com/gstormsfh/citrus-league-storm-main → **Settings** →
   **Secrets and variables** → **Actions**.
2. Confirm all of these exist (values are hidden, that's expected):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_MEASUREMENT_ID`
   - `VITE_SENTRY_DSN`
   - `FIREBASE_SERVICE_ACCOUNT`
   - `GCP_SA_KEY`
3. Source of Supabase values: https://supabase.com/dashboard → project →
   **Settings** → **API**.
   - Project URL → `VITE_SUPABASE_URL`
   - anon public → `VITE_SUPABASE_ANON_KEY`
   - service_role → `SUPABASE_SERVICE_ROLE_KEY` (never commit this)
4. Repo **variable** (not secret) `OVERRIDE_DRAFT_FREEZE` — create empty
   so the change-freeze workflow runs by default.

---

## 4. Sentry alert rules

- [ ] Done (date + initials: ____________)

**Why:** Sentry is wired up via `VITE_SENTRY_DSN` but has no alert rules,
so errors pile up silently. Draft-room JS errors should page on sight.

**Steps:**

1. https://sentry.io → Citrus project → **Alerts** → **Create Alert** →
   **Issues**.
2. Rule 1 — high error rate:
   - Name: `Error spike — 5+ errors in 5 min`
   - Filter: `environment = production`
   - Condition: `Number of events in an issue is more than 5 in 5 minutes`
   - Action: email + Slack (if wired) + PagerDuty (if wired)
3. Rule 2 — immediate page on any draft error:
   - Name: `Draft room error — immediate page`
   - Filter: `environment = production`, optional `tags.route = draft`
   - Condition: `Number of events in an issue is more than 0 in 1 minute`
   - Action: same as above
4. Send a test event from project settings to confirm delivery.

If `environment = production` filter shows no data, the SDK init is not
tagging environment — flag to engineering.

---

## 5. Uptime monitoring

- [ ] Done (date + initials: ____________)

**Why:** Right now we find out about outages from users. That is too late
mid-draft.

**Steps (BetterStack):**

1. https://betterstack.com → sign up (free tier: 10 monitors, 3-min checks).
2. **Uptime** → **Create monitor**.
3. Monitor 1 — API:
   - URL: `https://api.citrusfantasy.com/api/health` (or Cloud Run URL)
   - Interval: 1 minute
   - Expected: status 200, body contains `"status":"ok"`
   - Alert on: 2 consecutive failures
   - Channels: email + SMS
4. Monitor 2 — Frontend:
   - URL: `https://citrusfantasysports.com/`
   - Interval: 3 minutes
   - Expected: status 200
   - Alert on: 2 consecutive failures
5. Enable "SSL certificate expiration" on both — free 14-day early warning.

**UptimeRobot alternative:** same flow, Dashboard → Add Monitor → HTTP(s).

---

## 6. Cloud Run ops dashboard

- [ ] Done (date + initials: ____________)

**Why:** The pre-draft checklist asks the on-call to keep 4 browser tabs
open and watch metrics during a draft. One dashboard is much more likely
to actually get watched.

**Steps:**

1. https://console.cloud.google.com/monitoring → **Dashboards** →
   **Create dashboard**.
2. Name: `citrus-api live draft`.
3. Filter every widget to service `citrus-api`, region `us-central1`.
4. Widgets:
   - Request count (line)
   - Request latency p50/p95/p99 (line)
   - Instance count (area)
   - CPU utilization (line)
   - Memory utilization (line)
   - Response codes grouped by `response_code_class` (stacked area)
5. Save. Copy URL. Paste into `docs/RUNBOOKS/PRE_DRAFT_CHECKLIST.md`
   "During the draft — Watch list" as the top link.

---

## 7. Consolidate duplicate `firebase.json`

- [ ] Done (date + initials: ____________)

**Why:** The repo ships two byte-identical `firebase.json` files — one at
repo root (authoritative, used by `production-deploy.yml`) and one at
`apps/web/firebase.json` (only used when an engineer runs
`npm run deploy` from inside `apps/web/`). If they drift, local deploys
ship a different CSP than production — the class of bug that made
April 10 take two extra hours to diagnose.

**Steps (code change, not console — tracked here because it's cleanup
adjacent to §2 Blaze work):**

1. Decide: keep root only (recommended — matches production CI).
2. Delete `apps/web/firebase.json` and `apps/web/.firebaserc`.
3. Update `apps/web/package.json` scripts:
   - `"deploy": "npm run build && cd ../.. && firebase deploy --project citrus-fantasy-sports"`
   - `"deploy:hosting": "cd ../.. && firebase deploy --only hosting --project citrus-fantasy-sports"`
4. Verify: `npm run deploy --dry-run --workspace=apps/web` from repo root.
5. Document in `CLAUDE.md`: "All Firebase config lives at repo root."

---

## Ongoing: Secret rotation

- [ ] Next rotation due: ____________

**Why:** Supabase service role, GCP SA key, Firebase SA, Sentry DSN —
all are long-lived secrets. Rotate every 90 days; rotate immediately if
there's any suspicion of exposure (force-push to public, laptop loss, etc).

**Process:** Generate new secret in source console → update GitHub
secret → revoke old secret → verify next CI run passes.
