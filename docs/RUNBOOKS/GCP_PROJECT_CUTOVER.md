# GCP Project Cutover — DNS Flip & Decommission

**Audience.** You + CTO, after the new stack in `citrus-fantasy-prod`
has been green for 24–48 hours of parallel run.

**Prerequisite.** `docs/RUNBOOKS/GCP_ORG_SETUP.md` is fully executed
and the checkboxes in Phase 11 are all ticked. Do not run this
runbook until that one is done.

**Goal.** Move 100% of `citrusfantasysports.com` traffic from the
`citrus-fantasy-sports` (gmail-parented) project to the
`citrus-fantasy-prod` (org-parented) project, then decommission the
old project cleanly.

**Expected downtime.** ~5–15 minutes during DNS propagation and SSL
re-issuance on the new Firebase Hosting. Schedule during a low-traffic
window. **Not during a scheduled draft** — see the change-freeze CI
guard (commit `5c10940`).

**Total time.** ~2 hours hands-on + overnight wait for DNS TTL.

---

## Pre-cutover checklist

- [ ] `citrus-fantasy-prod.web.app` has been live and green for ≥ 24h
- [ ] No Sentry errors tied to the new stack in the last 24h
- [ ] CTO has smoke-tested the new `.web.app` URL independently
- [ ] Google for Startups Cloud Program application status known
      (approved / pending / denied — affects your billing confidence)
- [ ] No live drafts scheduled in the next 48 hours in any league
      (verify: `SELECT league_id, scheduled_draft_time FROM leagues
      WHERE scheduled_draft_time > NOW() AND scheduled_draft_time <
      NOW() + interval '48 hours';`)
- [ ] Incident-on-call for the next 4 hours

---

## Phases (to be filled in before executing)

1. **Phase 1 — Rotate GitHub Actions secrets to new project**
   Before cutover so the next CI deploy targets the new project.
2. **Phase 2 — Add custom domain to new Firebase Hosting**
   Requires DNS control. Firebase generates challenge records,
   verifies domain ownership, re-issues SSL cert. Old project still
   serves while this happens.
3. **Phase 3 — DNS flip**
   Change A records for `citrusfantasysports.com` and CNAME for
   `api.citrusfantasysports.com` to point at new Firebase/Cloud Run.
   TTL: lower to 60s an hour before, raise back after propagation.
4. **Phase 4 — Monitor propagation**
   `dig +trace citrusfantasysports.com` from multiple geos. Wait for
   ≥ 95% of probes to see new records before declaring done.
5. **Phase 5 — Remove custom domain from old Firebase project**
   Releases the domain. Without this, can't point at new project
   cleanly in edge cases.
6. **Phase 6 — Remove Supabase auth redirect URLs for old project**
   Only after all users are confirmed on new stack.
7. **Phase 7 — Shut down old Cloud Run service**
   `gcloud run services delete citrus-api --project=citrus-fantasy-sports`
   after 48h of zero traffic on the old URL.
8. **Phase 8 — Revoke gmail access from old project, transfer**
   Optional: if old project is ever needed for historical reference,
   move it to org. Otherwise, shut it down in Phase 9.
9. **Phase 9 — Shut down old project**
   `gcloud projects delete citrus-fantasy-sports` after 30-day
   stability window.

---

## What this runbook WILL contain (once expanded)

Same format as `GCP_ORG_SETUP.md`:

- Exact commands for every step
- Expected outputs
- Troubleshooting per phase
- Rollback per phase (critical — DNS can always be reverted)
- Checkpoints per phase

## What this runbook does NOT touch

- Supabase — the database is shared across old and new stacks. No
  migration needed.
- Domain registrar — just DNS record edits. Registrar ownership stays.
- Google Workspace — unrelated to this cutover.
- Sentry project — will get a sibling note when we re-create under
  the new org identity (optional).

---

## Do not execute this runbook until:

1. `docs/RUNBOOKS/GCP_ORG_SETUP.md` Phase 11 smoke passes
2. 24h of parallel stability
3. Active change-freeze window (no drafts in next 48h)
4. You + CTO are both available and on-call

---

## Expansion owner

Expand this skeleton into a full runbook **after** Phase 11 of
`GCP_ORG_SETUP.md` passes. The expansion requires knowing:

- Your actual DNS provider (Cloudflare, Namecheap, Google Domains, etc.)
- Your actual custom domain records (subdomains in play, email MX,
  SPF/DKIM if on the apex)
- Confirmed Cloud Run URL for new project
- Confirmed Firebase default URL for new project

Without those specifics, the runbook would be generic and dangerous.
Write it with the actual values in hand.
