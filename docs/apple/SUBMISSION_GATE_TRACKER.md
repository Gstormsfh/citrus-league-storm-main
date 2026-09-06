# Submission gate tracker — September 6, 2026

Preparation and testing against production are authorized. The user explicitly redirected final device validation to production on September 6. App Store submission remains held; testing authorization alone does not activate the pending backend migrations and release deployment. Passing tests do not guarantee Apple approval.

| Gate | Current evidence | Required closure |
|---|---|---|
| Useful native experience | Staging APNs accepted the real draft alert at 18:35:19 UTC (sent=1, failed=0); regular staging user made pick 1 at 18:36:32 UTC | User confirmation of background alert and tap destination; interrupted-session recovery |
| Current integrated source | Readiness branch extends production/master `0700055c`; staging API, web and engine aligned to `cdd03fb8`; deployment and CI passed | Integrate final content separately; user explicitly deferred unfinished Game Day work |
| APNs activation | Sandbox/topic-specific key active in staging engine; real APNs send accepted. Production/topic-specific key prepared privately | Bind production key/configuration when deployment is authorized, then verify TestFlight delivery |
| Device build | Fresh staging build 1.0 (5) compiled and installed on paired iPhone Air; assets match synchronized source | Regular staging account signed in, registered notifications and made a saved draft pick. Complete remaining journeys; this is a staging test build, not the production submission archive |
| Account deletion | API/staging browser cleanup passed, signed-out confirmation preserved | Real Apple OAuth/token/revocation test remains paused pending suitable test identity |
| Moderation | Report/block/admin workflow passed staging integration | Garrett is primary owner; backup unassigned. Confirm daily review and appeals procedure |
| Policies and App Privacy | Staging policy content and active versions verified; Connect privacy draft saved | Production publication/activation and matching final provider configuration |
| Content rights | Latest Connect inspection found neither rights radio selected; earlier recorded-Yes claim was not confirmed by persisted UI | Underlying permitted-use basis remains unverified; obtain evidence or replace affected assets |
| Reviewer access | Disposable device login prepared privately | Populated release reviewer account, usable draft access, and verified walkthrough |
| Device QA | Startup/safe areas checked; local suites pass | Full iPhone/iPad journeys, poor connectivity, denied permissions, account switching and large text |
| Submission metadata | Description/contact/manual release saved; age questionnaire saved as 13+ using provisional sports/news/chat assumptions | Recheck rating against final content; finish free pricing, screenshots, availability, agreements, distribution validation and build attachment |

## Moderation operating procedure

Garrett Storms is the primary owner based on the user's response. Review Admin → Content Reports and the support mailbox daily and handle urgent safety reports promptly. Inspect context before dismissing, removing, or suspending. Use the app's admin actions so decisions are audited. Handle appeals through the published support address. A backup owner has not been designated. Assigning an owner does not prove the mailbox is monitored or that automated alerts exist.

## Native review demonstration

1. Sign in using a populated reviewer account; access the sample league and roster immediately.
2. Open a review draft that can be used without waiting for a real scheduled event.
3. Allow notifications, background the app, and advance to the reviewer's pick.
4. Receive the draft-turn notification, tap it, and arrive in the correct draft room.
5. Make a pick, inspect the roster, leave/reopen the app, and verify state recovery.
6. Show lineup management and league chat, including report/block controls.

Only describe steps as verified in App Review notes after they work in the final build. Do not imply that one native plugin guarantees compliance with guideline 4.2.

## Current device-test fixture

The isolated Citrus Device Review league (`44aaa754-275e-4bb9-9e1a-359cce4408bf`) is retained for device QA. Its commissioner is disposable; the other participant is the user's regular staging account. Do not delete that regular account or revoke its Apple authorization. A durable user pick and subsequent draft connections were observed; these do not by themselves prove notification display or tap routing. Clean up only the fixture after the device walkthrough.

Staging engine boot storage was expanded from 10 GB to 30 GB after image pull ran out of space. The retry succeeded with healthy subscription and current candidate image. Production was unchanged. Local validation: 4,465 web, 1,821 server (6 existing skips), and 244 shared tests passed; both TypeScript checks passed; lint had zero errors and nine existing warnings.

## Production validation pivot

The user requested production data for remaining submission checks. The native bundle was freshly rebuilt with production mode, API `https://citrusfantasysports.com`, and Supabase `iezwazccqqrhrjupxzvf`; native build assertions passed. Production API health is good, but its live revision remains `citrus-api-00261-4w7` at `0700055c`. The production engine metadata identifies `e0896890`, with no APNs startup configuration or APNs environment metadata. Production push is therefore still an activation/verification gap; staging APNs acceptance must not be presented as production delivery evidence.

## Auction Test production regression — open

The user reported missing historical picks and frozen nomination controls in production league `600a958a-2c0a-458d-838a-4b9042ae6b35`. Read-only inspection found 195 durable events, including draft_started at seq 1 and prior auction sales. The stored snapshot begins at seq 2, reports 81 sales but zero total picks, and has negative remaining roster slots. No real league data was modified.

Prepared fixes preserve draft_started/draft_completed in HTTP snapshots, resolve round capacity from the actual leagues columns when JSON settings omit it, restore the client sales feed and sold-player filter without double-deducting snapshot budgets, and reject invalid auction snapshot capacities for canonical full replay. Targeted validation: 294 client draft tests and 47 server tests passed; both TypeScript checks passed; changed client files lint clean. Nomination behavior and prior picks must still be verified in the updated production-backed phone build after the API/engine fixes are activated. The installed phone build predates these fixes. This gate is not closed.

## Production roster settings regression

For Test at golf, production confirms C2/LW2/RW2/D4/G2/UTIL2, BN5 and IR2. The saved base lineup contains the legacy `slot-UTIL` alias. The phone's numbered UTIL rows and older roster recovery/move code could disagree about placement. Prepared client corrections canonicalize aliases, ignore nonstarter slot metadata, preserve valid unique assignments, use the current league configuration during asynchronous loading and initialization, and compare swap IDs consistently. Regression coverage includes UTIL2, UTIL0, custom F slots, reserved positions, and goalie exclusion. 285 targeted tests and the web TypeScript check pass; changed client files lint clean. Production phone build 6 built successfully, was installed and launched; the user's save/reopen verification is pending. No league settings or saved user lineups were directly modified.

Server initialization also assigned only the first unassigned skater to UTIL and hardcoded three IR slots. Both are corrected in the candidate; four initialization tests cover UTIL counts 0–3 and IR0. Production backend activation remains pending. The prior auction paused-state comparison was corrected to replay the wire pause events (LobbyStatus does not include paused); web TypeScript passes after this correction.
