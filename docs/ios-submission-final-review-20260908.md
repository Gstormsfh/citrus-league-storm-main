# iOS 1.0 submission — final review list (8 Sept 2026, evening)

Garrett's feedback from the test draft and player pages, triaged, plus items found by
inspection of `apps/web` and `apps/web/ios`. Sections are ordered by what App Review
will reject first, then by what a new user hits first. Nothing here is fixed yet; this
is the work order for Claude Code. Keep Build 15 scoped to A + B; C ships in 1.0.1.

## A. App Review blockers (fix before Build 15)

**A1. Sign in with Apple — present (corrected).** `AuthContext.signInWithOAuth`
accepts `'google' | 'apple'` and the account page lists the Apple identity; Garrett
confirms Apple sign-ins work. Remaining check only: the Apple button is at least as
prominent as Google on the sign-in screen (Guideline 4.8 wording).

**A2. User-generated content with no moderation (Guideline 1.2) — Garrett's #1.** No
profanity or slur filter exists anywhere in `apps/web`, `server`, `packages` or the
migrations (the only matches are unrelated). Team names, league names and any chat are
UGC. Minimum for review: (i) server-side filter on team/league/display names at write
time (a maintained word list plus leet/spacing normalisation, rejecting rather than
masking), (ii) a "report" action on names/messages that writes to a `content_reports`
table, (iii) a commissioner/admin path to rename or remove, (iv) block/mute if there is
any user-to-user chat. Put the filter in the RPC/service layer, not the client.

**A3. Invite / login links open Safari, not the app — Garrett's #2. IMPLEMENTED
2026-09-08 (uncommitted, untested — no node_modules in the review environment).**
Files: `apps/web/ios/App/App/App.entitlements` (Associated Domains:
`applinks:citrusfantasysports.com`, `www.`, `webcredentials:`),
`apps/web/public/.well-known/apple-app-site-association` (Team ID `TFMG57326Z`, bundle
`com.citrussports.app`; includes `/create-league?code=…`, `/join*`, `/joined`,
`/league/*`, `/draft*`; excludes `/api/*`, `/auth/*`, `/reset-password`, which stay on
the `citrussports://` scheme), `apps/web/firebase.json` (stop ignoring dotfiles so
`.well-known` deploys; JSON content-type header; static rewrite ahead of the SPA
catch-all), `apps/web/src/components/UniversalLinkDeepLink.tsx` (+ test) mounted in
`App.tsx` next to `NativeAuthDeepLink` — routes the https path into the SPA via
`appUrlOpen` and `getLaunchUrl`. `SceneDelegate.swift` already forwards
`continue userActivity` to Capacitor. Still to do by Garrett: enable Associated Domains
on the App ID in the developer portal, deploy the web app, verify the AASA over HTTPS,
rebuild, test from Messages.

**A4. Demo account on the App Store Connect version page.** "Sign-in required" is
toggled on; the reviewer needs a working username/password with a league already
drafted so every tab renders. Verify before Add for Review.

## B. Must-fix before Build 15 (correctness or first-impression)

**B1. Draft clock — Garrett's #4.** "A bit of a clock glitch on my side" in the second
test draft. Before shipping: pull the engine logs for that draft (`draft_events` /
engine deploy logs on GCE) for the pick where it happened, compare server `deadline_at`
against the client's displayed countdown, and check the client uses server time
(offset from the heartbeat) rather than `Date.now()`. If the client clock is local,
that is the bug; the countdown must be `deadline_at − serverNow`. Add a test that
drifts the device clock ±30 s and asserts the displayed clock is unchanged.

**B2. "Starters left · D 8" is mislabelled, not miscalculated — Garrett's #3.
IMPLEMENTED 2026-09-08: chip now reads "D 2 · 8" (open slots · startable left), strip
label "Need · left"; test updated. Untested here.**
`OnClockActionBar.tsx` renders `draftDecision.startersLeft` = "startable D left in a
league this size"; the tooltip says so, the chip does not. A user reads it as "you need
8 D". Change the chip to the two numbers that matter: "D · 2 open · 8 left" (open slots
first). Same audit for every Stormy/tip surface: each must be derived from the live
draft state (this one is; the copy was wrong).

**B3. WebSocket error on reload into the draft — Garrett's #5.** `ConnectionBanner.tsx`
already distinguishes fatal / reconnecting and avoids "Connection lost" as first
impression; the reload path is showing the raw error state. On mount/reload, show
"Reconnecting to the draft room…" with a spinner and a Retry after ~5 s; never show a
WebSocket string to a user.

**B4. Stormy — Garrett's #6.** Three separate issues: (i) answer quality ("ass") — pull
the last 50 Stormy conversations from the edge-function logs and read them; the usual
causes are the system prompt not receiving league context (roster, scoring, week) or
the model answering from a stale snapshot — verify the context payload actually
contains the user's roster and settings; (ii) the first-run warning modal — replace
with one calm sentence inside the chat ("Stormy can be wrong. Check the numbers before
you trade.") and no interstitial; (iii) the chat bubble opening "obscure" — open as a
clean bottom sheet with the composer focused, no dimmed half-state.

**B5. Draft board / history shows the pre-randomisation order — Garrett's #9.**
`DraftLobby.tsx` carries `effectiveOrder` / `randomizedOrder`; the board and history
must read the same `effectiveOrder` the engine used, not the league's default team
order. Also give commissioners the three options explicitly: Random (with a visible
reveal), Custom (drag list), Default. Persist the chosen order on the draft row so
every client renders the same one.

**B6. League tab header overlaps the iPhone status bar — Garrett's #8.**
`PressBoxLeagueChrome` already paints `pt-[env(safe-area-inset-top)]` on a sticky
wrapper (fixed 2026-09-05 for Team). Find which surface on the LEAGUE tab renders a
header outside that chrome (or before it mounts) and route it through the same
wrapper; reproduce on the phone, not the simulator.

**B7. My Team tab in the draft room: scroll overlaps position headers — Garrett's #11.**
Sticky position group headers are not offset for the tab bar; fix the sticky top
offset and check every team, not only the user's.

**B8. Old "Go to draft room" graphic — Garrett's #14. IMPLEMENTED 2026-09-08:**
`Matchup.tsx` draft_not_completed state now uses `/mascots/scene-draft.webp` instead of
the 🏒 emoji tile. Untested here.

**B9. Stormy draft-room tip overflows on smaller iPhones and is generic — Garrett's
#10.** Two lines max, ellipsis, and the content must come from the live draft read
(positional scarcity to next pick, best available vs. ADP, the user's open slots) —
the same `draftDecision` payload B2 uses, not canned text.

**B10. Type size — Garrett's #15.** Tables and secondary labels: +1 pt on the smallest
tier only (11 → 12, 12 → 13). Nothing else changes. Check Dynamic Type at the default
size on an iPhone SE-class screen.

## C. Ship in 1.0.1 (do not hold Build 15 for these)

**C1. Player dashboard everywhere — Garrett's #7.** Player card = the same dashboard
on free-agent and roster cards, not draft-room only; citrus accent on the Players tab;
fix the name/filter overlap on the heat map; add a one-line legend for 5v5 / PP / xG /
G−xG.

**C2. Profile avatars — Garrett's #12.** A set of simple Citrus cartoon characters,
randomly assigned, changeable in Account.

**C3. Weekly write-ups, accomplishments, points — Garrett's #13.** Trophies later.

**C4. Write-up quality — Garrett's #16.** The fix is inputs, not prompting: feed the
write-up the player's actual numbers relative to his own baseline and his position
peers (the percentile rows already on the card), what changed since last week, and
one concrete game reference. Ban superlatives without a number. Re-read the top-30
players' write-ups by hand before release.

**C5. Latency — Garrett's #17.** Measure first: add a route-timing log (time to first
paint per tab) and pull the p50/p95 for Players, Matchup, League. The usual culprits in
this app: sequential Supabase calls on mount, unindexed filters on player tables, and
rendering the full player list before virtualising. Fix the top two, then re-measure.

## D. Added by inspection

**D1.** Account deletion in-app exists (`Profile.tsx`, `api/account.ts`) — required by
5.1.1(v); verify it fully deletes, not just signs out.
**D2.** `PrivacyInfo.xcprivacy` exists — confirm it lists the APIs actually used
(UserDefaults, file timestamp, system boot time) and the data-collection categories
match the App Store privacy label you fill in.
**D3.** Export compliance: `ITSAppUsesNonExemptEncryption` is already `false` in
Info.plist — nothing to do.
**D4.** Reviewer notes should state that projections are informational and no real-money
play exists (keeps the app out of the gambling category review path).
**D5.** EU trader status banner in App Store Connect: either exclude EU territories for
1.0 or provide the trader details; otherwise the app is removed from the EU store.

## Not in scope tonight
xG model and database work continues in the analytics worktree and is unaffected by
this build.

## Added during Build 15 smoke test (2026-09-09, 1:05 AM)

18. **Invite Players card is buried and unexplained (League tab, phone).** With one team in
    the league the card renders below Trades/Schedule/My team/GM office/League settings and
    the TEAMS list, i.e. under the fold, and nothing says what "Share invite" does versus the
    code. For Build 16: when `teams.length < maxTeams`, render an invite banner at the top of
    the League tab ("1 of 10 teams · Invite your league") with a single primary SHARE INVITE
    action, and under the code a one-liner: "Friends can tap the link or enter this code in
    the app." Keep the existing card for the full-league case. Also verify the shared link is
    the universal-link form (`/create-league?tab=join&code=…`) so it opens in-app on Build 15+.

19. **Invite acceptance screen.** Product intent (Garrett, 1:10 AM): link opens the app on a
    screen that says who invited you to which league, with an Accept button; join happens on
    Accept, not silently. Today `CreateLeague.autoJoin` joins the moment a signed-in user
    lands. Build 16: `InviteAccept` at `/join/:code` (already in the AASA), share link becomes
    `/join/<code>`, `/auth?redirect=` remains the signed-out fallback only.
    Also in this tree, uncommitted: AASA now claims `/auth` when it carries `redirect`, and
    `universalLinkToPath` accepts that one shape (test added). Ship with Build 16, not before:
    Build 15's router ignores `/auth`, so deploying the AASA alone would open the app and drop
    the link.

20. **Moderation message not surfaced on create-league.** On device, `sh1t show` and other
    names were refused (server/DB guard works) but the UI showed the generic "error validating
    the league" instead of the zod message. Build 16: client-side `moderateText` on the name
    field with an inline message, and surface the server 400 message on the fallback path.

21. **Report a name unreachable in the offseason (review risk, Guideline 1.2).** Standings is
    gated on the season, and that is the only place the report dialog is mounted. Build 16:
    mount `ReportContentDialog` under the TEAMS list on the League tab (always visible), keep
    the Standings one. Reviewer note for Build 15 points at Standings and at creation-time
    rejection.

22. **Navigation latency.** Every tab feels like it reloads everything on mount. Before
    touching it: capture a per-screen request waterfall on device (Safari Web Inspector
    attached to the app) and count requests per navigation; then cache league context and
    the player directory across tabs.
