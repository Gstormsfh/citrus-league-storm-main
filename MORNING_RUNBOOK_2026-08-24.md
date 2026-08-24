# Morning Runbook — Aug 24 (deploys stuck + overnight fixes to ship)

**State when you left:** prod is frozen at bundle `index-3zCT67YD` — nothing after commit `9bad9960` has deployed (web OR API), across `1bf0684a` and `b068dc5f`. I could not see or restart CI from my side (no gcloud/firebase auth reaches me), so overnight I fixed everything in code on your disk instead. Morning = diagnose CI (2 min) + one push + one verify pass.

## 1) See what CI is doing (the earlier check looked in the wrong place)

`gcloud builds list` with no region only shows GLOBAL builds — GitHub-triggered builds are usually REGIONAL. Run:

```powershell
gcloud builds list --project citrus-fantasy-prod --region us-central1 --limit 5
gcloud builds list --project citrus-fantasy-prod --region northamerica-northeast1 --limit 5
gcloud builds list --project citrus-fantasy-staging --region us-central1 --limit 5
```

Whichever shows rows: if the latest is FAILURE, get its log with
`gcloud builds log <BUILD_ID> --project <proj> --region <region>` and paste me the tail — I'll fix the cause immediately.

## 2) If CI is dead/mysterious — deploy manually (both are proven paths)

**Web (Firebase Hosting)** — from the repo root, your machine is already firebase-authed:
```powershell
npm run build --workspace=apps/web
firebase deploy --only hosting --project citrus-fantasy-prod
```
(If auth expired: `npx firebase-tools login --reauth` first. Hard-refresh with Ctrl+Shift+R after — the PWA service worker caches aggressively.)

**API (Cloud Run)** — same pattern as your rollback runbook:
```powershell
$SHA = git rev-parse --short=8 HEAD
docker build -f server/Dockerfile -t us-central1-docker.pkg.dev/citrus-fantasy-prod/citrus-api/server:${SHA} .
docker push us-central1-docker.pkg.dev/citrus-fantasy-prod/citrus-api/server:${SHA}
gcloud run deploy citrus-api --image us-central1-docker.pkg.dev/citrus-fantasy-prod/citrus-api/server:${SHA} --region us-central1 --project citrus-fantasy-prod
```

## 3) Push the overnight fixes FIRST (they're on disk, uncommitted)

```powershell
cd C:\Users\garre\Documents\citrus-league-storm-phase45
git add -A
git commit -m "Overnight polish: standings desktop grid placement, FA + draft-pool mugshots, roster grid density, projected title"
git push
```

What's in it (all suites green — web 1,924 / server 1,187, build clean):
- **Standings desktop was genuinely broken** — CSS grid auto-placement put the standings TABLE in the 200px rail column and gave League Activity the wide one. Every region now has explicit `col-start/row-start`. (This is the same disease as View Others and the roster grid — third and last instance found in a full grep.)
- **Mugshots everywhere (Sleeper parity):** Free Agents Top Trending + Top Projected + All Players rows, and the draft pool — desktop table rows AND the mobile cards (`evidence_pool_cards_with_mugshots.png`). Images self-hide if the CDN fails, so no broken-image squares.
- **"Top Projected (Remaining Week)" title** no longer wraps over three lines.
- Plus everything still queued from last night's stuck deploys: View Others rail rebuild, matchup cream→dark conversion, roster starters grid density, OtherTeam current-roster + fall-through fixes, by-ids season filter, Players page overlay/sticky column.

## 4) After deploys land, ping me — I verify live, with eyes:

Team 2 page shows 14 players · Suzuki FA card reads 29/72 (matches table) · Standings desktop layout correct at 1280 · View Others rail clean · matchup rows dark · roster grid 3-across · pool avatars on prod · everything from the earlier ledger stays green.

## 5) Apple account (from last night, unchanged)

D-U-N-S lookup → **Organization** enrollment (never Individual — it publishes as "Garrett Storms") → expedite call if pending >48h. Full links in my earlier message / FINAL_AUDIT doc. Android: closed-test question still open (org vs personal Play account).

## Also on your disk
- `NANO_BANANA_PROMPTS.md` — ready-to-run image-gen prompt sheet (empty states, card heroes, milestones) with exact sizes + palette. Generate → drop into `apps/web/public/art/` → I wire them in.
