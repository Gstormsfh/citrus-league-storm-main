# Pre-Draft Readiness Checklist

**Owner:** On-call engineer
**When:** Run T-60 minutes before every scheduled live draft
**Sign-off:** Required by at least one engineer before draft opens

This is a hard checklist, not a guideline. Every item must pass before the
draft room opens. The April 10 2026 disaster
(`docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md`) happened because there was no
checklist — seven unrelated defects lined up the same afternoon and
every one of them was preventable by a simple pre-flight check.

If any item below fails and cannot be fixed in under 15 minutes, **page
the commissioner and postpone the draft.** A 30-minute delay is far
cheaper than a 40-minute outage in front of every owner in the league.

---

## T-60 minutes — Infrastructure

- [ ] **Cloud Run scaling is correct.**
      `gcloud run services describe citrus-api --region=us-central1 --format="value(spec.template.metadata.annotations)"`
      Expected: `minScale=1, maxScale=10`, `cpu-throttling=false`,
      `startup-cpu-boost=true`. Memory = 2Gi, CPU = 2.
      If wrong: `gcloud run services replace ops/cloudrun/service.yaml --region=us-central1`

- [ ] **Cloud Run is healthy.**
      `curl -s https://api.citrusfantasy.com/api/health | jq .`
      Expected: `{"status":"ok"}` in under 500ms. If slow or failing,
      roll back to the last known-good revision before the draft.

- [ ] **At least one warm instance is running.**
      Cloud Run metrics → Container instance count should show ≥ 1.
      If showing 0, cold-start latency on the first pick will be 3-5s.

- [ ] **Firebase Hosting is on Blaze plan with budget cap set.**
      Firebase Console → Usage and billing. Check current month is under
      the cap. Draft traffic will burst egress.

- [ ] **No active Supabase incidents.** Check
      [status.supabase.com](https://status.supabase.com/). If Realtime
      is degraded, postpone — Broadcast + postgres_changes both flow
      through that service.

---

## T-45 minutes — Change Freeze

- [ ] **No production deploys in the last 24 hours.**
      `git log --since="24 hours ago" --grep="deploy\|release" origin/master`
      Should return empty. The change freeze CI check enforces this
      automatically, but verify manually.

- [ ] **No in-flight PRs targeting `master`.** Close or block-merge
      anything that would deploy during the draft window.

- [ ] **No Supabase migrations pending.** `ls supabase/migrations/` — the
      latest should already be applied in production.

---

## T-30 minutes — Application Health

- [ ] **Player card loads for a goaltender.**
      Pick any G from the app and open their card. Must return 200 with
      a non-null `goalsSavedAboveExpected`. If 500, the
      `GOALIE_GSAX_COLUMNS` regression is back — do NOT proceed.

- [ ] **Notification cross-league leak is gone.**
      In a browser, open the draft room for a league you are in, then
      in a second browser (different user), make a pick in a DIFFERENT
      league. The first browser should NOT receive that notification.
      If it does, the comma-filter bug regressed.

- [ ] **Bundle size check passed in last CI run.**
      GitHub Actions → latest `master` CI run → "Dist PNG budget gate"
      step is green. If red, do NOT deploy — the 5.1 MB Gemini PNG
      regression is back.

- [ ] **Draft pick flow works end-to-end.** Open the draft room for a
      test league, draft one player, confirm:
      - Pick appears in history within 100ms (Broadcast fast path)
      - Timer resets on all clients
      - No console errors
      - Draft order advances correctly

---

## T-15 minutes — Rollback Readiness

- [ ] **Previous Cloud Run revision is pinned and retrievable.**
      `gcloud run revisions list --service=citrus-api --region=us-central1 --limit=5`
      Write down the last-known-good revision name. If the draft breaks,
      you will roll forward to it:
      `gcloud run services update-traffic citrus-api --to-revisions=<REV>=100 --region=us-central1`

- [ ] **`nuclear_reset_draft` RPC is available.**
      `SELECT proname FROM pg_proc WHERE proname = 'nuclear_reset_draft';`
      Must return one row. If empty, the February 2026 migration is
      missing — draft rollback will be impossible.

- [ ] **Commissioner knows how to pause the draft.** Confirm with the
      commissioner they have access to the Draft Control admin page
      and know the pause button location. If they don't, walk them
      through it before the draft starts.

---

## T-5 minutes — Final Go/No-Go

- [ ] **Start a browser recording of the draft room.** Any commercial
      screen recorder is fine — this is insurance for forensic review
      if something goes wrong.

- [ ] **Post in #engineering-oncall:** "Draft starting for league
      `<league-id>` at `<time>`. All checks green. On-call: @you."

- [ ] **Stay on-call for the full draft window.** Typical 12-team
      drafts take 45-90 minutes. Do not start anything you can't drop.

---

## During the draft — Watch list

Keep these open in separate tabs:

1. **Cloud Run metrics** —
   `https://console.cloud.google.com/run/detail/us-central1/citrus-api/metrics`
   Watch: request count, p99 latency, error rate. Alarm if p99 > 2s
   or error rate > 1%.

2. **Supabase logs** —
   `https://supabase.com/dashboard/project/<project-id>/logs/edge-logs`
   Watch for: 401 cascades, realtime connection churn, RLS denials.

3. **Browser console** — Keep the draft room open for one of the owners
   and watch the JS console. Any uncaught errors should trigger a
   Sentry alert; verify the Sentry inbox is empty before drafts start.

4. **The postmortem document** —
   `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md`. If anything goes wrong,
   this is the reference for what to look for.

---

## If something breaks

1. **Pause the draft.** Commissioner → Draft Control → Pause.
   This stops the timer and freezes the state. Do this FIRST, before
   diagnosing.

2. **Capture state.**
   - Screenshot the current draft room for every owner if possible.
   - `gcloud logging read 'resource.type="cloud_run_revision"'
      --limit=100 --format=json > /tmp/draft-incident-$(date +%s).json`
   - Note the last successful pick's `id` and `pick_number`.

3. **Roll back Cloud Run** if the incident started after a recent deploy:
   `gcloud run services update-traffic citrus-api
   --to-revisions=<last-known-good>=100 --region=us-central1`

4. **If the draft state is corrupted**, the commissioner can run
   `nuclear_reset_draft(p_league_id, p_session_id)` via Supabase SQL
   editor. This preserves draft history but resets the board.

5. **Communicate.** Tell the commissioner what's happening in real
   time. They tell the owners. Silence is worse than bad news.

6. **Postmortem.** Start a new postmortem document the same day,
   following the template in `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md`.
   Forensic accuracy decays fast — write it while memory is fresh.

---

## Related documents

- `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md` — Why this checklist exists.
- `docs/EMERGENCY_RUNBOOK.md` — General outage response.
- `docs/DATA_LOSS_BUG_POSTMORTEM_JAN15.md` — January 2026 precedent.
- `ops/cloudrun/service.yaml` — Cloud Run declarative config.
- `supabase/migrations/20260207100000_add_draft_picks_delete_policy_and_reset_rpc.sql`
  — `nuclear_reset_draft` RPC definition.
