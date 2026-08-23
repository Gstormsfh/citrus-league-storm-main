# Citrus Final Store-Readiness Audit — Aug 23, 2026 (evening)

Commissioner pass + league-mate pass + player-card/mugshot audit + all-screen-size sweep + scoring-settings proof, run live on prod with eyes and screenshots. This is the flags document for tonight's submission decision.

---

## 🔴 RED — decide/act before submitting

**R1. Google Play tonight is not physically possible.** There is no Android app in the repo — `npx cap add android` was never run: no `android/` project, no AndroidManifest, no signing keystore, no Play listing assets. The iOS shell exists and is submission-ready; Android is a separate build-out (roughly: `cap add android` + custom-scheme deep link config + icons/splash + signed AAB + Play listing + Data safety form). On top of the build-out, Google Play policy: **personal** developer accounts created after Nov 13, 2023 must run a closed test with **12 testers for 14 consecutive days** before production access — organization accounts are exempt. If your Play account is a personal one, Android is weeks away by policy, not effort. If it's an org account, it's build-out + review time. Tell me which account type you have and I'll size the real path. **iOS tonight: yes — with R2/R3 closed.**

**R2. The API server is one deploy behind — your push did NOT deploy it.** Tonight's push rotated the WEB bundle automatically (verified live: new bundle `index-BOe_Uu2O.js`, Apple button in the deployed Auth chunk). But the repo has no CI deploy for Cloud Run — `citrus-api` still runs the old revision. Proof: I re-ran the goalie-into-center-slot save on prod after your push and it **returned 200 again** (immediately reverted). The position-match validation, and tonight's projections fixes, are server-side — they need your API deploy (§Commands below).

**R3. Apple sign-in config (45 min, before Apple review).** The button is LIVE on prod now; until the Supabase Apple provider is configured, tapping it shows the graceful "isn't hooked up yet" copy — a reviewer tapping it = rejection risk. Also CONFIRM `citrussports://auth-callback` is in Supabase → Auth → URL Configuration → Redirect URLs — **native Google sign-in in the iOS app depends on that entry** (nativeAuth.ts documents it as a pending step). Task #192 has the exact click-path.

---

## 🟡 YELLOW — real bugs found tonight, all FIXED in your folder (ship with next push + API deploy)

**Y1. The draft room ranked every league with DEFAULT scoring.** Your exact question — "does 1 pt G / 1 pt A change rankings?" — the answer was NO in the draft room: a code comment confirmed "v2 passes no league scoringSettings to the pool." PlayerPool supports league scoring; the room never passed it. Live proof: I set Claude Engine Verify League to 1G/1A via the commissioner API (200), reloaded its pool — identical rankings. **Fixed**: the room now fetches the league's scoring at mount and feeds it to both the pool AND the client autodraft (they stay in lockstep). Proof screenshots (`evidence_scoring_default.png` / `evidence_scoring_custom_1g1a.png`): default ranks MacKinnon #1 at 502.0 FPTS; under 1G/1A the same pool re-ranks **McDavid 138.0 / Kucherov 130.0 / MacKinnon 127.0** — exact G+A arithmetic, goalies drop to 0.0. Also verified the good half: the DB scoring engine itself is per-league (`league_scoring_rules`), and scoring changes are correctly **locked once games have been scored** ("Cannot change scoring after games have been scored" — got that 400 on DACOSTA!, which is exactly right).

**Y2. Opponent team pages showed DRAFT-DAY rosters.** `/team/:id` built the roster from draft picks — stale after every trade/waiver move, and completely EMPTY for Team 2 in DACOSTA! (14 players in DB, zero rendered). **Fixed**: rewired to the current-roster source (roster_assignments via the admin API with draft-pick fallback — the same primitive the matchup page already uses correctly).

**Y3. Player card from the Matchup page had NO mugshot and jersey "#0".** The matchup→card conversion set `image: undefined, number: 0`. **Fixed**: mugshot now flows through (with NHL-CDN fallback by player id), "#0" is hidden when the number is unknown, and the no-image fallback shows initials instead of "0".

**Y4. Players page "Proj FP" showed "—" for all 974 players.** Root cause: projections are stored under the season they DESCRIBE (2026 = the 2026-27 season) but the dashboard joined on `getCurrentSeason()`, which stays 2025 until Sep 29 — zero rows all summer. Same bug in `/api/players/ros-projections`. **Fixed** with a shared `getProjectionsSeason()` (+9 unit tests covering the Sep 29 flip and no-double-advance). Server-side — live after your API deploy.

**Y5. Free Agents mobile widgets: player names were dead.** Top Trending / Top Projected rows on phone had no tap-to-card (desktop rows did; the main Available list did). **Fixed** — names open the fantasy card, parity with desktop.

**Y6. Players page tap looked like a no-op on phones.** The dashboard panel rendered BELOW the 400-row table at <1024px. **Fixed**: row tap now opens the same dashboard as a dismissible overlay; plus the table's name column is now sticky-left so horizontal swiping keeps context.

**Y7. Trade Center card zeros.** McDavid's card showed PPP 0 — PPP/SHP/PIM/xG were never wired in TradeAnalyzer's card mapping (same class of bug as yesterday's goalie stat fix). **Fixed.**

---

## 🟢 VERIFIED GOOD tonight (eyes on prod)

- **Mugshots: 100% coverage, rendering everywhere.** DB: 817/817 (season 2026), 1,085/1,085 (2025), 801/801 (players). Rendering verified on Roster card, Players table (401 imgs, 0 broken, lazy-load fills as you scroll), Trade Center rows, draft pool. First-ever open of a card can show the photo tile ~1–2s late (NHL CDN cold fetch) — cosmetic, noted below.
- **Player cards open with full attributes** from: Roster (tap name), Free Agents main list (name + info), Matchup lineups (tap name), Trade Center (info button), Players page (row → dashboard), draft room pool (info button → card with headshot — verified in earlier session). Attributes: G/A/PTS/+−/SOG+SH%/GP/PPP/HIT/BLK/PIM, goalie variants, Overview/Detailed/Game Log tabs, projection banner ("84 upcoming games · total proj").
- **"84 upcoming games" is CORRECT** — the 2026-27 season is the NHL's new 84-game schedule; verified all 32 teams have exactly 84 regular-season rows. Schedule ingest is right.
- **Commissioner pass**: scoring-settings PUT works pre-season and is correctly refused after games scored; roster-slots/settings save paths verified earlier tonight and yesterday (200s).
- **League-mate pass** (made myself a non-commissioner via a test league): member HQ shows "The commissioner will start the draft…" with NO commissioner controls; commissioner-only API returns **403 "Commissioner privileges required"**. UI gating + server gating both hold.
- **All-screen-size sweep** (true 390×844, 768×1024, 1024×768 + interactive 821px pass): zero horizontal page overflow on roster, matchup, players, free agents, waiver wire, standings, HQ, draft room, GM office, transactions. Wide tables scroll inside their own containers (correct pattern). The NEW mobile card draft pool is live on prod and verified at 390px (`evidence_live_prod_mobile_pool_390.jpg`).
- **Transactions history**: clean single-row trades, real names, statuses — the dedupe + name fixes holding on prod.
- **Suites**: web 1,924 ✓, server 1,187 ✓, shared 89 ✓ (incl. 9 new season tests), lint ✓, build ✓.

---

## 🟤 BEIGE — logged, not blocking

- Stormy's floating button overlaps first-column content at ~600–1023px widths (any floating button overlaps something; benign at 390 and desktop).
- Card headshot tile can appear empty ~1–2s on very first open (CDN cold). A monogram placeholder would polish it.
- Completed draft room header says "2/28 picks made" on leagues whose rosters were seeded without a full engine draft (data-state artifact of test leagues; real drafts show n/n).
- Matchup header "Week 1/29" vs roster "1/27" (calendar candidates vs playable weeks) — known cosmetic.
- Info buttons lack aria-labels (a11y polish, not an App Review item in practice).
- Engine `MAX_SEASON_GAMES = 82` clamp — harmless with the 84-game season (affects all veterans equally in value ordering); align post-launch.
- Prod DB password rotation after launch (flagged earlier).
- Profile "Recent Activity" still empty (pre-existing note).

---

## Commands (in order)

**1. Push tonight's audit fixes** (11 files in your folder):
```powershell
cd C:\Users\garre\Documents\citrus-league-storm-phase45
git add -A
git commit -m "Final audit: league scoring wired into draft room + autodraft, current-roster team pages, matchup card mugshot/number, projections season fix, FA mobile card taps, players mobile overlay + sticky column, trade card stats"
git push
```
Web deploys itself from the push (proven tonight).

**2. Deploy the API** (carries position-match validation + projections fixes — R2):
```powershell
cd C:\Users\garre\Documents\citrus-league-storm-phase45
$SHA = git rev-parse --short=8 HEAD
docker build -f server/Dockerfile -t us-central1-docker.pkg.dev/citrus-fantasy-prod/citrus-api/server:${SHA} .
docker push us-central1-docker.pkg.dev/citrus-fantasy-prod/citrus-api/server:${SHA}
gcloud run deploy citrus-api --image us-central1-docker.pkg.dev/citrus-fantasy-prod/citrus-api/server:${SHA} --region us-central1 --project citrus-fantasy-prod
```
(Registry path taken from your rollback runbook. If your usual API deploy differs, use yours — the image just needs to contain tonight's `server/` + `packages/shared`.)

Then I re-verify live: goalie-in-C must 400, Proj FP must populate, scoring-wired pool on a custom league.

**3. Apple provider config** (R3, task #192) → **4. TestFlight device smoke** (task #194: both OAuth round-trips, push prompt, throwaway-account deletion) → **5. Submit iOS.**

**Google Play**: answer the account-type question (R1) and I'll lay out the exact Android path with timeline.

---

*Test-league mutations tonight: Engine Verify League scoring flipped to 1G/1A and restored to defaults (200/200); Claude Proof League commissioner flipped to Topher for the league-mate pass and flipped back; the invalid goalie-in-C lineup save was reverted immediately both times it was made. DACOSTA!, Gstorms roster, and all real data untouched.*
