# Submission gate tracker — September 6, 2026

**Latest consolidated status:** [Release candidate 1.0 (9)](RELEASE_CANDIDATE_1.0_9.md). The entries below preserve earlier test history; use the consolidated status for current deployment and device state.

Preparation and testing against production are authorized. The user explicitly redirected final device validation to production on September 6. The user subsequently authorized completing all remaining gates, including production updates, while explicitly withholding final App Store submission. Deployment preflight and verification still apply. Passing tests do not guarantee Apple approval.

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

## Production projections and game-log regression

Build 6 was verified to target the production API, database and public key. Actual phone requests selected `season=2025` for the upcoming September/October 2026 projection window. Roster ROS and week requests now use the projections season. A read-only production check confirmed positive 2026 projection rows still exist for the inspected player.

The player modal depended on the changing enriched player object. Effect cleanup cancelled an in-flight request while the duplicate-key guard prevented its replacement, leaving the spinner active and totals reset. A stable game-log identity now depends only on ID/team/position, and cleanup releases the request key for StrictMode/retry. Hook regression verifies enrichment cannot cancel the active request but changing player does. Web types and changed-source lint pass. Full web run: 4,471 passed, one outdated source guard failed because it expected the old player object dependency; that guard was updated to the new identity and its suite rerun successfully. Production-configured build 7 built successfully; device validation of restored totals and both season tabs remains required.

## Projection presentation and league scoring

The player-card change hides individual projected fantasy points/ranges while preserving raw game stats. SZN PROJ expands a count × league weight breakdown. The card uses its explicit league or active league context and ScoringCalculator with raw projections; configured missing categories contribute zero. Goalies use start-aware raw ROS totals when available. Tests cover goals weighted 1 vs 10, three vs eight enabled categories, negative goalie GA, and display/button behavior. Targeted component suites: 414 pass; TypeScript passes. Build 8 device verification remains pending.

App-wide parity remains open: roster week totals and generic player dashboard rankings still use precomputed points. Categories formats need category-specific presentation rather than interpreting points as category standings.

## Current release verdict — not ready to submit

The user confirmed the production data and repaired game log, and accepted the build 8 projection presentation. That does not establish app-wide dynamic scoring. Weekly roster projections now use raw stats and the league calculator in the candidate; regression tests verify goals at 1 vs 10 and refusal to substitute stored default totals when raw stats are missing. The matching batch endpoint now includes PPP, SHP and shutouts and defaults to the projection season. These changes are not installed or deployed yet. Generic player dashboard scoring/rankings and category formats remain to review.

Remaining submission gates: deploy/verify the auction and roster backend corrections; production APNs activation and distribution-build delivery; real Apple OAuth/revocation with a disposable identity; production policy/privacy alignment and moderation operations; populated reviewer access; final screenshots/content/availability/business declarations and distribution build validation/attachment; final integrated iPhone/iPad testing. Content-rights basis remains unverified. Apple guidelines were checked again on September 6 at https://developer.apple.com/app-store/review/guidelines/ — sections 2.1, 1.2, 4.2, 5.1 and 5.2 remain relevant. No submission performed.

## September 6 follow-through validation

Full current-candidate suites passed: 4,479 web, 1,828 server (6 pre-existing skips), and 244 shared. The production draft-freeze RPC returned no blockers at 19:33 UTC. This is a preflight observation, not permission to skip rechecking before deployment.

A further push lifecycle defect was found: sign-out deleted every device token for the account and removed the global notification-tap listener. The fix scopes deletion to this installation, preserves tap handling, cleans temporary registration listeners, and serializes registration with sign-out to prevent a late token write. Regression coverage includes other-device preservation, account switching, reload, registration failure/timeout, native unregister failure, and an in-flight save. Production device-token RLS was inspected and restricts reads/writes to auth.uid(). This fix still needs native build verification.

Production activation progress: moderation (`apple_review_ugc_controls`) and server-only Apple token storage (`apple_provider_token_cleanup`) are now applied. The production rollback probe passed membership, sender identity, filtering, direct-write prevention, ownership, admin-only moderation, blocking, removal and suspension checks. No disposable test data persisted. Existing production push preference and avatar baseline do not require the staging parity migrations.

Production Apple cleanup and APNs credentials are now provisioned in Secret Manager and the deployment's repository secrets; the production encryption key is independent of staging and preserved on rerun. API/engine activation and actual distribution delivery remain pending. The security advisor flags the new server-only tables as RLS-with-no-policy (intentional deny-all for clients) and guarded chat/admin functions as authenticated SECURITY DEFINER endpoints; their authorization paths passed the rollback probe. Existing unrelated sports-data views are still flagged by the advisor and remain to assess: player_gar_inputs, xg_model_coverage, player_toi_by_situation.
