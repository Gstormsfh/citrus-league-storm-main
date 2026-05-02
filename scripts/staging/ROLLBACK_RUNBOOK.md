# Production Rollback Runbook

**Last updated**: 2026-05-02 (pre-ship of v2 dark theme playoff suite + propagation trigger)

This runbook covers rollback of the three deployable surfaces that
production runs on:

1. **Firebase Hosting** — the static React frontend at `citrusfantasysports.com`
2. **Cloud Run** — the Hono API server at `citrus-api` (region `us-central1`)
3. **Supabase Postgres** — schema state, specifically the
   `trg_propagate_playoff_winner` trigger applied 2026-05-02 via MCP

The runbook assumes you have:

- `firebase` CLI authenticated as a user with deploy access to project
  `citrus-fantasy-prod`
- `gcloud` CLI authenticated to project `citrus-fantasy-prod`
- Supabase MCP access to project `iezwazccqqrhrjupxzvf`
  (CitrusFantasySports)
- Read access to GitHub Actions to monitor deploys

---

## Capture pre-deploy state (run BEFORE merging staging-setup → master)

These commands snapshot the currently-live release IDs so you have an
exact rollback target. Run locally and save the output to this file
(or paste into the deploy PR description) before triggering the deploy.

### Firebase Hosting current release

```bash
firebase hosting:sites:list --project citrus-fantasy-prod

firebase hosting:releases:list \
  --site citrus-fantasy-prod \
  --project citrus-fantasy-prod \
  --limit 5
```

Expected output: a table of recent releases. Note the **first row's
release ID** — that's the current live release. Save as
`PREDEPLOY_FIREBASE_RELEASE` below.

```
PREDEPLOY_FIREBASE_RELEASE=<paste here>
PREDEPLOY_FIREBASE_RELEASE_TIMESTAMP=<paste here>
```

### Cloud Run current revision

```bash
gcloud run revisions list \
  --service=citrus-api \
  --region=us-central1 \
  --project=citrus-fantasy-prod \
  --limit=5 \
  --format="table(name,creationTimestamp,active,servingPercentage:label=TRAFFIC%)"
```

Expected output: rows with `Active=Yes` and `TRAFFIC%=100` on the
current live revision. Save as `PREDEPLOY_CLOUDRUN_REVISION` below.

```
PREDEPLOY_CLOUDRUN_REVISION=<paste here>
PREDEPLOY_CLOUDRUN_REVISION_TIMESTAMP=<paste here>
```

### Supabase trigger state (already verified 2026-05-02)

```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.triggers
   WHERE trigger_name = 'trg_propagate_playoff_winner') AS trigger_present,
  (SELECT COUNT(*) FROM information_schema.routines
   WHERE routine_name = 'propagate_playoff_series_winner') AS function_present;
```

Expected: `trigger_present=1`, `function_present=1`.

Confirmed at 2026-05-02 immediately after MCP apply: ✅ both = 1.

---

## Scenarios

### Scenario A — Web frontend looks broken

Symptoms: `citrusfantasysports.com` renders blank, throws JavaScript
errors, has visibly-wrong styling, navigation is broken, or PWA
install/splash is corrupted.

**Cause**: bad bundle from the most recent Firebase Hosting deploy.

**Recovery time**: ~2 minutes (clone-and-deploy of prior release).

**Steps**:

1. Open Firebase Console → Hosting → `citrus-fantasy-prod` → Releases
   tab. Or use the CLI:

   ```bash
   firebase hosting:releases:list \
     --site citrus-fantasy-prod \
     --project citrus-fantasy-prod \
     --limit 10
   ```

2. Locate `PREDEPLOY_FIREBASE_RELEASE` from the pre-deploy capture
   above. This is the last known good release.

3. Rollback via console: click the three-dot menu on
   `PREDEPLOY_FIREBASE_RELEASE` → "Rollback to this version". The
   console clones the release into a new live deployment.

4. **Verify** within 60 seconds:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://citrusfantasysports.com/
   ```

   Expect `200`. Hard-refresh in browser (Ctrl+Shift+R / Cmd+Shift+R)
   to bypass service worker cache. The PWA service worker may serve
   stale assets for ~5 minutes — users on the app shell may not see
   the rollback until SW updates. In a hard incident, advise users
   to clear site data.

5. **Post-rollback**: investigate the bad release in a feature
   branch. Do NOT amend or force-push to master.

### Scenario B — Save flow broken / API errors

Symptoms: pick saves return 4xx/5xx, `/api/health` returns non-200,
specific endpoints error (e.g., `POST /api/playoff-pools/bracket-pickem/picks`
fails), Cloud Run revision shows error rate spike in logs.

**Cause**: bad Cloud Run revision from the most recent deploy.

**Recovery time**: ~30 seconds (traffic redirect, no rebuild).

**Steps**:

1. List revisions:

   ```bash
   gcloud run revisions list \
     --service=citrus-api \
     --region=us-central1 \
     --project=citrus-fantasy-prod \
     --limit=10 \
     --format="table(name,creationTimestamp,active,servingPercentage)"
   ```

2. Identify `PREDEPLOY_CLOUDRUN_REVISION` from the pre-deploy capture.
   This is the last known good revision.

3. Redirect 100% of traffic back to the prior revision:

   ```bash
   gcloud run services update-traffic citrus-api \
     --region=us-central1 \
     --project=citrus-fantasy-prod \
     --to-revisions=PREDEPLOY_CLOUDRUN_REVISION=100
   ```

   Replace `PREDEPLOY_CLOUDRUN_REVISION` with the actual revision name.

4. **Verify** within 30 seconds:

   ```bash
   API_URL=$(gcloud run services describe citrus-api \
     --region=us-central1 \
     --project=citrus-fantasy-prod \
     --format='value(status.url)')

   curl -s -o /dev/null -w "%{http_code}\n" "$API_URL/api/health"
   ```

   Expect `200`. Then test a real endpoint that was failing — e.g.,
   submit a bracket-pickem pick from staging-test account and verify
   200 response.

5. **Post-rollback**: investigate Cloud Run logs at `console.cloud.google.com/logs/...?project=citrus-fantasy-prod`
   for the failed revision. The bad revision still exists; just no
   traffic. You can also pin a specific image tag if needed:

   ```bash
   gcloud run services update citrus-api \
     --region=us-central1 \
     --project=citrus-fantasy-prod \
     --image=us-central1-docker.pkg.dev/citrus-fantasy-prod/citrus-api/server:<known-good-sha>
   ```

### Scenario C — Both broken

Symptoms: simultaneous frontend AND API failure. Possible causes:
shared dependency (e.g., bad Supabase env var change, broken auth
middleware), or the deploy gate let two bad changes through.

**Recovery time**: ~3 minutes total if run in parallel.

**Steps**: run **A** and **B** in parallel from two terminals. Order
of operations doesn't matter — Firebase rollback restores the static
bundle, Cloud Run rollback restores API.

After both rollbacks complete:

```bash
# Verify
curl -s -o /dev/null -w "frontend: %{http_code}\n" https://citrusfantasysports.com/

API_URL=$(gcloud run services describe citrus-api \
  --region=us-central1 --project=citrus-fantasy-prod \
  --format='value(status.url)')
curl -s -o /dev/null -w "api: %{http_code}\n" "$API_URL/api/health"

# Smoke-test a bracket-pickem save flow end-to-end as a real user.
```

If A succeeds but B fails, frontend will load but API calls error.
If B succeeds but A fails, API works but the page won't render.
Either partial state is worse than the original simultaneous failure
in some ways (UX-wise) so verify both 200 before declaring recovery.

### Scenario D — Trigger causing DB issues

Symptoms: bracket data corruption (e.g., R2 seeds populated with
wrong teams), `nhl_playoff_series` UPDATE statements throwing errors,
user reports that "my pick disappeared" or "wrong team showing in
R2".

**Cause hypothesis**: the propagation trigger
`trg_propagate_playoff_winner` is misbehaving — either the function
logic has a bug we missed, or it interacts badly with manual data
fixes a commissioner makes via `nhl-staff` admin tools.

**Recovery time**: ~1 second (DROP TRIGGER).

**Important**: dropping the trigger removes FUTURE propagation but
does NOT undo past propagations. R2 rows currently populated stay
populated. If past propagations are themselves wrong, additional
manual UPDATEs are needed to reset specific rows.

**Steps**:

1. Open Supabase MCP or run via psql with service role.

2. Drop trigger and function:

   ```sql
   DROP TRIGGER IF EXISTS trg_propagate_playoff_winner
     ON public.nhl_playoff_series;

   DROP FUNCTION IF EXISTS public.propagate_playoff_series_winner();
   ```

3. **Verify** trigger and function are gone:

   ```sql
   SELECT
     (SELECT COUNT(*) FROM information_schema.triggers
      WHERE trigger_name = 'trg_propagate_playoff_winner') AS trigger_present,
     (SELECT COUNT(*) FROM information_schema.routines
      WHERE routine_name = 'propagate_playoff_series_winner') AS function_present;
   ```

   Expect both `0`.

4. **Decide whether to also revert specific R2 data**. The trigger
   only writes to NULL slots, so any R2 data populated by the
   trigger came from R1 winners. If those R1 winners are correct
   and the only issue is "the trigger misfired in some other way",
   leave R2 as-is. If R2 data itself is wrong, manually UPDATE the
   affected rows.

5. **Post-rollback**: the underlying bug (cron silent for 14 days,
   `sync_playoff_results.py` cascade-claim docstring lie) is now
   exposed again. Either re-fix the trigger and re-apply, or fix
   the cron urgently. KNOWN_GAPS Path B + Path C entries cover this.

### Scenario E — Worst case (all three broken)

Symptoms: simultaneous frontend, API, AND DB issues. Almost certainly
a deploy that combined a bad bundle, bad image, AND a side-effect on
DB state (e.g., a migration that ran inadvertently — though the
production-deploy.yml doesn't run migrations, so this would have to
come from a separate MCP apply).

**Recovery time**: ~5 minutes if run in parallel; ~10 minutes if
run sequentially with verification between each.

**Order of operations** (parallel where possible, but verify after
each):

1. **First**: drop trigger via MCP (Scenario D step 2). This
   stabilizes DB state and prevents further data issues from being
   amplified by trigger fires during the rest of the rollback.

2. **In parallel**:
   - Run Scenario A (Firebase rollback)
   - Run Scenario B (Cloud Run rollback)

3. **Verify in this order**:
   - DB: trigger gone, query R2 to confirm no further writes
     happening unexpectedly
   - API: `/api/health` returns 200 from the rolled-back revision
   - Frontend: loads with the rolled-back bundle

4. **Smoke test**: log in as a known account and verify the save
   flow works end-to-end. Don't declare recovery until a real
   user-facing flow succeeds.

5. **Post-rollback investigation**: write a postmortem. This
   scenario implies either a pre-deploy gate gap (something that
   should have caught the bad change) or a cross-system interaction
   we don't have a model for.

---

## Operator notes

### What the production-deploy pipeline does NOT do

The `.github/workflows/production-deploy.yml` workflow:

- ✅ Builds + deploys the web bundle to Firebase Hosting
- ✅ Builds + deploys the Cloud Run image
- ❌ Does NOT run Supabase migrations
- ❌ Does NOT modify Supabase schema
- ❌ Does NOT change Cloud Run env vars beyond what's in the workflow
- ❌ Does NOT touch the `data-pipeline/` cron
- ❌ Does NOT change `.firebaserc` or `firebase.json` at runtime

So a bad merge to master can break the **frontend bundle** or **API
revision**, but it cannot directly cause DB issues. Trigger /
schema rollback (Scenario D) is only relevant when DB changes are
made via separate MCP applies (like the 2026-05-02 propagation
trigger apply).

### When NOT to roll back

- **Slow API responses but eventually succeeding**: not a rollback
  scenario. Investigate as performance regression.
- **One feature flag is broken but the rest works**: feature-flag
  off, don't roll back the whole deploy.
- **CSS-only visual issue on one page**: hot-fix forward. Faster
  than a full rollback for a non-blocking issue.
- **A single user reports a bug**: triage first. Confirm scope
  before rolling back a deploy that affects everyone.

### Communications

- If you roll back: post in #engineering Slack with what was rolled
  back, what symptoms were seen, and current verified state. Link
  to this runbook section.
- If users may have seen errors: post a brief status update to
  whatever user-comms channel exists (none formal yet — flag as a
  KNOWN_GAPS entry to add a status page).

### After rollback

- File a follow-up issue capturing the failed change and what
  needs to be fixed before re-deploy.
- Add a regression test if one was missing.
- Update this runbook if the scenario surfaced anything new (e.g.,
  a recovery-time estimate that was wildly off, or a verification
  step that didn't catch the issue).

---

## Quick reference card

```
Frontend broken    → A: firebase console → rollback to PREDEPLOY_FIREBASE_RELEASE
API broken         → B: gcloud run services update-traffic citrus-api --to-revisions=PREDEPLOY_CLOUDRUN_REVISION=100
DB trigger issue   → D: DROP TRIGGER trg_propagate_playoff_winner + DROP FUNCTION propagate_playoff_series_winner via MCP
Both code-paths    → C: A and B in parallel
Everything         → E: D first, then A+B in parallel
```

Project IDs:
- Firebase: `citrus-fantasy-prod`
- Cloud Run: `citrus-api` in `us-central1`
- Supabase prod: `iezwazccqqrhrjupxzvf` (CitrusFantasySports)
- Supabase staging: `jjgspcpvqaiitloglxbb` (citrus-staging)

Site:
- Prod URL: https://citrusfantasysports.com
- API health: <Cloud Run URL>/api/health
