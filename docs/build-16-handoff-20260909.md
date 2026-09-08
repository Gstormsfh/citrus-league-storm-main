# Build 16 handoff (written overnight 2026-09-09, ~02:00-03:30)

## READ FIRST: Build 15 was built with the wrong pipeline (my instruction)

I told you `npm run build && npx cap sync ios`. The repo's only sanctioned
native build is **`npm run ios:sync`** (`scripts/build-native.mjs`), which
sets `VITE_NATIVE=1` and then REFUSES a bundle that still carries the AdSense
loader, the PWA service worker, or the wrong API origin. The shell that Build
15 was archived from (`ios/App/App/public/`, synced 00:54) contains
`adsbygoogle` in index.html and `sw.js` + `registerSW.js` + workbox. Build 14
and earlier were built the right way (docs/apple/IOS_BUILD.md).

What that means: nothing is broken on screen, but (a) the AdSense loader is
exactly what the build script exists to keep out of a native binary, and (b) a
service worker inside Capacitor can keep serving Build 15's hashed assets
after a later App Store update replaces them. Both are reasons to make Build
16 the reviewed build: if Build 15 is still **Waiting for Review** when 16 is
uploaded, cancel the submission and swap the build (see the last section). If
Apple has already started, let 15 through and ship 16 right behind it.

Step 4 below uses `npm run ios:sync`. It reads `VITE_API_URL` from the repo
root `.env` (present: `https://citrusfantasysports.com`), so native API calls
go through Firebase Hosting rewrites, not straight to Cloud Run.

Build 15 is **Waiting for Review** (submitted Sep 8, 1:42 AM, submission
`422c9276-1e5b-4534-9dab-447079c112f7`). Everything below is **uncommitted in
the working tree** of `~/dev/citrus` on branch `fix/build-15-ci-guards` (the
branch you were on). Nothing was committed, pushed, deployed or applied to a
database. Typecheck passes for web, server and shared; the test suites could
not run from my side (vitest needs the Mac-native rolldown binding), so step 1
is you running them.

## What changed, by feedback item

**#21 Report a name reachable in the offseason (the review risk).**
`LeagueHQPhone` takes a `report` slot and draws it under the TEAMS list;
`LeagueDashboard` passes `ReportContentDialog` there (phone) and into the
desktop Teams card title. Standings keeps its own.

**#18 Invite card buried and unexplained.** `LeagueHQPhone` takes
`seats={{filled,max}}`; while seats are open the invite control moves to the
top of the League tab as a banner ("1 of 10 teams · 9 seats open"), expanded
(`InvitePlayersButton defaultOpen fill`). The card now says what the link and
the code are each for. Once full, the invite sits under the teams as before.

**#19 Invite accept screen.** New route `/join/:code` (`pages/InviteAccept.tsx`,
inside `ProtectedRoute` so signed-out invitees round-trip through `/auth` with
the code intact). Shows league name, "Garrett Storms invited you.", seats,
optional team name (moderated live), **Accept and join** / **Not now**;
already-a-member and full-league states. New server route
`GET /api/leagues/invite/:code` (admin client, case-insensitive, returns only
the drawn fields). `buildInviteLink` now emits
`https://citrusfantasysports.com/join/CODE` (upper-cased). The old
`/create-league?tab=join&code=` auto-join path still works for links already
sent. AASA already claims `/join/*`; it additionally claims `/auth?redirect=*`
and `universalLinkToPath` accepts that one shape (for old links).

**#20 Moderation message not shown.** `api/client.ts` now leads with the zod
`details` sentence on a `VALIDATION_ERROR` (was "Validation failed").
`CreateLeague` runs `moderationError` on the league name live (inline message
under the field) and on the join team name before the request.

**#8 Header over the iPhone clock.** It was the League **menu** (sliders icon):
a `fixed inset-0` overlay whose title row started at `pt-2`. It now carries
`env(safe-area-inset-top)`. The page chrome itself was already correct.

**#4 Draft clock.** Found a real mechanism, not just "looks fine": event frames
carry the DB `created_at`, so any delivery lag under the 30s guard (slow
commit, NOTIFY backlog, phone returning from background) leaked into the offset
EMA and moved the countdown by up to 30% of the lag per frame, then snapped
back on the next clean frame. `useClockOffsetEstimator` now treats the snapshot
reading (HTTP Date header + half RTT, a true server-now) as the seed and lets
event frames refine only within 1.5s of it. Four new tests. Verification query
for a real draft: `scripts/sql/draft_clock_verification.sql` (paste the league
id; an "AUTOPICK BEFORE DEADLINE" row would be a genuine engine clock bug).

**#6 Stormy.** (a) The "terrifying first-run warning" is `confirmStormySharing`:
a system confirm on EVERY message, added Sep 6 for third-party-sharing consent.
It now asks once per user per device, in plain words, and remembers yes
(`citrus.stormy.sharing.<userId>`; cleared by account cleanup). (b) Answer
quality could not be judged: the log kept 200 chars of the question and none
of the answer. Migration `20260909020000_stormy_chat_log_answer_preview.sql`
adds `answer_preview` (600 chars) and `context_chars`; the server fills them.
After a day of Build 16 use, run the query in the migration header; a short
`context_chars` next to a generic answer means the client attached no league
(pre-draft, offseason, wrong active league), a long one means the prompt.
Note: the chat greeting promises "your roster, scoring and matchup are loaded",
which is false before the draft; that copy should soften in the offseason.

**#22 Latency (analysis only, nothing changed).** No react-query on the big
pages; each of Roster (4.8k lines, 23 effects), Matchup (6.1k, 19 effects) and
FreeAgents runs its own serial `await` chain on mount (`getAllPlayers` →
league → team → roster → …) before the first paint, and the full player pool
is re-fetched whenever the 5-minute in-memory cache has lapsed or the app was
relaunched. Measure before touching: on the phone, Safari → Develop → your
iPhone → Citrus → Network, clear, tap each bottom tab once, note request count
and the largest payload. Then the order of attack: (1) prefetch the player pool
and the active league's rosters right after auth, in parallel, while GM Office
renders; (2) persist the player pool (Capacitor Preferences or IndexedDB) with
a version stamp so relaunch does not refetch it; (3) split the serial chains
so the page paints with what it has.

## Second pass (03:30-05:00): the next tier

**#22 Latency, two concrete changes.** (1) `server/src/middleware/cacheControl.ts`:
`/api/players` (the whole pool, the largest response in the app) had no rule,
so it was `private, max-age=0` with no ETag and re-downloaded in full on every
relaunch and every lapse of the 5-minute client cache. It is now
`public, max-age=60, stale-while-revalidate=300` with an ETag, so the shell
revalidates with a 304 (test: `server/src/__tests__/cacheControl.players.test.ts`).
(2) `components/PrefetchWarm.tsx`, mounted in App.tsx: asks for the pool once,
1.2s after sign-in, never on a draft path; PlayerService shares the in-flight
request, so Roster/Free Agents/Players open onto a warm cache (test added).
The per-screen serial chains are untouched; measure first (protocol above).

**#7 Player dashboard from every card.** In `PlayerStatsModal` the DROP button
replaced the DASHBOARD link for rostered players, so your own players were the
one place the deep read was missing. Both now show, Dashboard in Citrus orange.
Heat-map overlap and filters on the dashboard itself: I need your screenshot.

**#12 Citrus characters as avatars.** Profile (phone hero row and desktop
avatar) offers Stormy, Lemon, Kiwi and Pineapple; picking one sets
`avatar_url` to the mascot's public URL, so every surface that draws an owner
picture shows it with no schema change. Tap one on Build 16 and check a team
row and the scoreboard disc pick it up.

**#13 Accomplishments (first half).** The Trophies tab drew `[]` for everyone.
`components/account/achievements.ts` derives them from figures the page
already holds (champion, playoffs, podium, first win / 10 wins / winning
record, draft day, commissioner, seasons, founding manager), rarest first,
nothing claimed without a number behind it (test added). Recent activity and
weekly points recaps are NOT done: they need a read of `player_transactions`
and matchup results per user, a proper feature for 1.0.1.

**#16 Write-up voice.** I read `utils/playerWriteup.ts`: it is templated
hockey prose with variation, not model output, and I could not tell which
write-up read as slop to you. Send a screenshot of the one that bothered you
and I will fix the register at its source.

## Step 1: run the tests (from `~/dev/citrus/apps/web`)

```
npx vitest run src/components/league/__tests__/LeagueHQPhone.test.tsx src/pages/__tests__/InviteAccept.test.tsx src/components/__tests__/PrefetchWarm.test.tsx src/components/account/__tests__/achievements.test.ts src/components/player/__tests__/PlayerStatsModal.recovery.test.tsx src/__tests__/appStoreShellGuard.test.ts src/__tests__/zLayerScaleGuard.test.ts src/utils/__tests__/inviteShare.test.ts src/api/__tests__/client.test.ts src/components/draft/v2/__tests__/DraftTimerV2.test.tsx src/lib/__tests__/stormySharing.test.ts src/components/__tests__/UniversalLinkDeepLink.test.tsx src/__tests__/leagueHqCompositionGuard.test.ts src/__tests__/aiVoiceGuard.test.ts src/__tests__/copyVoiceGuard.test.ts src/__tests__/linkGraphIntegrity.test.ts src/__tests__/mobileSweepGuard.test.ts 2>&1 | grep -E "×|FAIL|Test Files|Tests "
```

```
cd ~/dev/citrus/server && npx vitest run 2>&1 | grep -E "×|FAIL|Test Files|Tests "
```

Then the full web suite once (it is what production-deploy runs):

```
cd ~/dev/citrus/apps/web && npx vitest run 2>&1 | grep -E "×|FAIL|Test Files|Tests "
```

Paste me any `×` line. The guards I could not run and that most often bite:
`aiVoiceGuard` (em dashes in user-facing strings), `copyVoiceGuard` (toast
titles over 4 words), `linkGraphIntegrity` (new route), `mobileSweepGuard`.

## Step 2: database (Supabase SQL editor, project CitrusFantasySports · main)

Paste the contents of `supabase/migrations/20260909020000_stormy_chat_log_answer_preview.sql`
and run it. Then confirm:

```
select column_name from information_schema.columns where table_name = 'stormy_chat_log' order by ordinal_position;
```

Expect `answer_preview` and `context_chars` in the list.

## Step 3: commit, PR, merge, deploy (your clicks)

```
cd ~/dev/citrus && git add -A apps/web/src apps/web/public server/src supabase/migrations/20260909020000_stormy_chat_log_answer_preview.sql scripts/sql docs/build-16-handoff-20260909.md docs/ios-submission-final-review-20260908.md && git status --short
```

Check the list is only the files named in this document plus
`apps/web/ios/App/App.xcodeproj/project.pbxproj` (your Build 15 bump; include
it). Then:

```
git commit -m "fix(ios): build 16 review follow-ups: invite accept screen, report reachable offseason, moderation message, clock offset guard, stormy consent once" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push -u origin fix/build-15-ci-guards
```

```
gh pr create --base master --head fix/build-15-ci-guards --title "fix(ios): build 16 review follow-ups" --body "See docs/build-16-handoff-20260909.md."
```

Merge when CLEAN; production-deploy ships the server route and the web build
(including the AASA that now also claims /auth?redirect=). Watch it:

```
gh run watch $(gh run list --workflow production-deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

## Step 4: Build 16

From `~/dev/citrus/apps/web`, on master after the merge:

```
git -C ~/dev/citrus fetch origin master && git -C ~/dev/citrus checkout -B build-16 origin/master
```

Set the build number FIRST (the native build script bakes it into
`VITE_APP_VERSION` for Sentry): Xcode → App target → General → Build `16`,
save. Then:

```
cd ~/dev/citrus/apps/web && npm run ios:sync && npm run ios:open
```

If `ios:sync` prints `NATIVE BUILD REJECTED`, paste me the reason; do not fall
back to `npm run build`. Then confirm the shell is clean:

```
grep -c adsbygoogle ~/dev/citrus/apps/web/ios/App/App/public/index.html; ls ~/dev/citrus/apps/web/ios/App/App/public/ | grep -c sw.js
```

Expect `0` and `0`. Xcode: Product → Archive → Distribute → App Store Connect.

## Step 5: phone smoke test on Build 16 (TestFlight)

1. League tab: invite banner at the top ("1 of N teams · seats open"), with the
   explanation line. "Report a name" under the TEAMS list. Submit one report;
   check `select * from content_reports order by created_at desc limit 1;`.
2. Copy invite link → paste in Messages → tap. It should open **in the app** on
   "Join <league>?" with your name as commissioner and the seat count. Tap
   **Not now**; nothing joined. (A second account joining via Accept is the
   full check.)
3. Create a league named `sh1t show`: the message under the field should say
   "Keep it clean…" before you even submit.
4. Open the League menu (sliders icon): the X and the league pill sit below the
   status bar.
5. Stormy: first message asks once, in the new words; second message does not
   ask.

## If Apple has not started reviewing Build 15 by the time 16 is uploaded

App Store Connect → the submission → **Cancel Submission** → version page →
Build → swap to 16 → Add for Review → Submit. Back of the queue, same as
holding would have been. If the status already says **In Review**, leave 15
alone and ship 16 as 1.0.1 after approval.

## Files touched (second pass adds)

components/PrefetchWarm.tsx (new, +test) · components/PlayerStatsModal.tsx ·
components/account/ProfilePhone.tsx · components/account/achievements.ts (new, +test) ·
pages/Profile.tsx · server/src/middleware/cacheControl.ts ·
server/src/__tests__/cacheControl.players.test.ts (new)

## Files touched (first pass)

apps/web/src/App.tsx · api/client.ts · api/leagues.ts · api/__tests__/client.test.ts ·
components/InvitePlayersButton.tsx · components/StormyChatBubble.tsx ·
components/UniversalLinkDeepLink.tsx (+test) · components/draft/v2/DraftTimerV2.tsx (+test) ·
components/league/LeagueHQPhone.tsx (+test) · components/pressbox/LeagueMenu.tsx ·
lib/stormySharing.ts (+test) · lib/accountCleanup.ts · pages/CreateLeague.tsx ·
pages/DraftRoomV2.tsx · pages/LeagueDashboard.tsx · pages/StormyAssistant.tsx ·
pages/InviteAccept.tsx (new, +test) · utils/inviteShare.ts (+test) ·
public/.well-known/apple-app-site-association ·
server/src/routes/leagues.ts · server/src/routes/stormy.ts ·
server/src/services/StormyAssistantService.ts · server/src/__tests__/leagueInviteRoute.test.ts (new) ·
supabase/migrations/20260909020000_stormy_chat_log_answer_preview.sql (new) ·
scripts/sql/draft_clock_verification.sql (new) · docs/ios-submission-final-review-20260908.md
