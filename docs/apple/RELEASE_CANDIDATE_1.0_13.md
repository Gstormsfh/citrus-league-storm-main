# Citrus 1.0 (13) readiness — September 6, 2026

Updated September 7: the user returned and authorized completing the remaining checks and then submitting for App Review. This supersedes the previous preparation-only instruction. Submission remains dependent on closing the recorded gates; manual release remains selected, and unfinished Game Day remains excluded.

## Current gate status — September 7, 09:23 MDT

This table supersedes earlier intermediate statuses below.

| Gate | Verified status / remaining action |
| --- | --- |
| Build and listing | Build 13 validated and attached; four iPhone and three iPad screenshots uploaded; reviewer fields saved; manual release selected. Not submitted. |
| Production alignment | Production subsequently deployed `d6f5b041`, `6f1e95e1` and analytics-access hardening `43425e3a` successfully (runs 34086339562, 34087418445 and 34137910847). Diff since build 13's merged source changes server goalie goals-against selection, SQL-output monitoring/operations and database permissions only; no app/native/shared-package changes. Build 13 remains the candidate. |
| Apple sign-in and consent | Production Apple sign-in reached the account page. Refresh confirmed both current policies accepted September 7. Backend confirms an encrypted Apple cleanup token exists for `garrettstorms@hotmail.com`; no token contents were read. That identity predates this test and is the user's personal Apple identity, so it was preserved and no deletion/revocation is claimed. A genuinely disposable Apple-linked Citrus account is still required for the destructive proof. |
| TestFlight access | Build 13 is Waiting for TestFlight Beta App Review. The internal group still lists one tester and one build, while its tester row shows No Builds Available. No installation is claimed. The public version separately remains Prepare for Submission with Add for Review available and manual release selected. |
| Engine and push | Daylight approval was granted for run 34059704526 after read-only checks confirmed zero live drafts, zero scheduled in 24 hours and no freeze blockers. The deploy then failed at the first VM read because `citrus-deploy` lacks `compute.instances.get`; the last-look and all mutation steps were skipped, leaving production untouched. Grant the documented `citrusEngineDeployer` custom role plus `roles/logging.viewer`, then re-run and verify fingerprint, a fresh disposable auction and distribution push/tap. |
| Database security | Production internal analytics views and their source tables no longer grant `anon` or `authenticated` access; `service_role` read access is preserved. Supabase security-advisor errors fell from three to zero. PR 418 merged as `43425e3a`; all PR CI, RLS and production deployment checks passed. The remaining 162 advisor notices are 96 warnings and 66 informational findings and were not represented as resolved. |
| Physical release testing | TestFlight install, Apple native sign-in/deletion and remaining device journeys still required. Browser OAuth evidence is not native TestFlight evidence. |
| Content and operations | Third-party content-rights basis and moderation backup/response coverage remain unresolved. |

Focused application recheck at 09:00 MDT: 19 web tests passed across Apple-token retention, push registration/sign-out, account-deleted routing, content-report moderation and notification account switching. Forty-one server tests passed across Apple revocation/token validation, APNs delivery and notification services. Latest master CI runs for `d6f5b041` and `6f1e95e1` are green.

Dependency audit at 09:23 MDT found no moderate, high or critical issue in the production dependency tree. The remaining low-severity item is an `esbuild` development-server issue on Windows reached through build/test tooling; it is not packaged into the iOS application or production server runtime. The full development-tool tree separately contains upgrade advisories and is tracked as maintenance rather than represented as an App Store runtime gate.

PR 418 production run [34137910847](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34137910847) passed the draft-freeze guard, builds, web/server suites, type checks, high/critical audit and bundle check. It deployed serving API revision `citrus-api-00269-x5r`, whose image digest matched the expected commit and whose health check returned HTTP 200. Firebase Hosting version `bc5451b4a896fce2` deployed and the public-site health check also returned HTTP 200. Data Invariants run 34137910751 and post-merge CI run 34137910856 passed.


Return check at 02:04 MDT: iPhone is available/paired; Chrome App Store Connect requires sign-in. Engine run 34059704526 still awaits reviewer approval, and its final daylight recheck blocks deployment before 07:00 MDT. Do not approve an old preflight as a way around that recheck.

## Corrections since build 12

- Failed game-log or schedule requests now show a retry action, instead of cached DNPs or an empty season. Schedule errors are evicted immediately so retry can reach the network.
- Completed-season history, missing projections, loading and failed league-scoring reads do not show a misleading zero projection or open an empty breakdown. Genuine zero projections remain available.
- The generic Players list and player-card positional ranks reweight raw projections through ScoringCalculator using the selected league. League changes preserve the shared raw cache and calculate new totals. Missing categories in a sparse configured scoring object remain disabled.
- The existing dashboard-index response now includes raw projected PIM, SHP and goalie GA. These columns were verified in production; no schema migration or new query is needed. Draft projections consume them, preferring projected goalie GA over historical-rate fallback. Data-access review passes: existing authenticated route/service boundary, unchanged bounded read/cache, no authorization or mutation changes.
- Category/rotisserie player views keep raw stats without presenting a points-league total. Points leagues with enabled plus/minus disclose that this unprojected category is excluded. Plus/minus remains a model limitation, not a claimed supported projection.
- Expanded advanced cards receive the same league-scored index as the parent player card.

Validation: final CI passes all checks, including 4,507 web tests across 314 files. The focused suite passes 91 tests covering the disclosure, league switching, retry, past-season absence and genuine zero. Server suite passes 1,840 tests with six skipped; server build, web TypeScript and changed-file lint pass. Native build 13 sync, archive, simulator build, distribution export and strict IPA signature verification succeeded. The IPA identifies build 13, production APNs and get-task-allow=false. Xcode confirmed upload success at 21:42 UTC on September 6; App Store processing and attachment remain unverified. Source commit: 94ca4b08cd42c9b7a2437c8ca039ebf44b8ee4e0. PR: https://github.com/Gstormsfh/citrus-league-storm-main/pull/415. PR 415 merged as b00ac2928f2b7654aaa3c6299188d08d985bc1d1. Production workflow [34062067865](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34062067865) passed its gate and completed API and website deployment successfully. API revision `citrus-api-00266-bcq` serves 100% of traffic; database, server and circuit-breaker health checks pass. An authenticated read using the disposable reviewer identity verified all three new raw projection fields on 1,406 dashboard rows, with numeric-or-null values throughout and nonzero PIM/SHP/GA values in the returned data. No regular user records were changed by that read.

On the iPhone simulator, fresh email sign-in reaches the production reviewer league and its eight configured starter slots, including both UTIL slots. On both iPhone and iPad simulators, build 13 loads the production reviewer roster, upcoming projections and the tap-to-open league scoring breakdown. Switching to completed-season history loads game rows and actual points while the unavailable SZN PROJ tile remains a dash. Physical-device and TestFlight testing remain outstanding. Seven unmodified native PNG captures are packaged at `/tmp/Citrus-Build-13-Screenshots.zip`, with dimensions, source and SHA-256 hashes in the manifest. They are preparation artifacts, not uploaded App Store screenshots.

## Previous release evidence and remaining blocked steps

[Build 12](RELEASE_CANDIDATE_1.0_12.md) was uploaded, and its website/API security updates shipped at API revision citrus-api-00265-r67. Build 13’s deployment supersedes that revision and retains those fixes. Its post-deployment consent, moderation and disposable-account deletion checks passed with all fixtures cleaned up.

Engine run [34059704526](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34059704526) built pinned commit 47c469faae3707de3ca3317cc0d6374a29146983 and passed all preflight checks. It remains pending the required GitHub environment approval. The build 13 changes do not modify the engine runtime or its APNs/recovery code, so the existing engine approval remains applicable.

After that approval: verify engine fingerprint, then nomination, bidding and recovery in a fresh disposable auction. Do not reopen the completed Auction Test; its 81 sales/history were preserved.

Still required: Chrome App Store Connect sign-in and final build processing/attachment/screenshots/reviewer fields; reconnect the iPhone for the latest build and distribution/TestFlight push/tap tests; actual Apple OAuth and deletion/revocation with a disposable Apple identity; hands-on iPad scrolling and remaining device journeys; content-rights evidence or replacement assets; moderation backup/response coverage. Garrett’s regular account must remain untouched.

The metadata worksheet now reflects published privacy, live policies, prepared reviewer access, free pricing and Canada/United States availability. Earlier status documents remain historical evidence. Readiness is not complete, and Apple approval is not guaranteed.

## September 7 App Store Connect follow-through

Chrome sign-in restored. Apple reports build 1.0 (13) as Validated, with production APNs, get-task-allow=false and no non-exempt encryption. Build 13 is attached to the iOS 1.0 version draft. Reviewer login, Garrett’s phone/email and the verified roster/player/game-log walkthrough notes were saved; manual release remains selected. Sensitive form values are omitted from browser DOM snapshots, so their presence was checked visually. No Add for Review or final submission action was taken.

Created internal TestFlight group `Citrus Release QA` with automatic distribution disabled, added only build 13 and Garrett’s existing App Store Connect account. Group confirms one tester and one build. Initial tester status was `No Builds Available` while the group build was `Ready to Test`; installation/invitation acceptance is not yet verified. User was asked to check TestFlight and install 1.0 (13).

Four native iPhone screenshots were prepared for the 6.9-inch media slot, whose accepted dimensions include 1320×2868. The file chooser accepted selection but Chrome rejected `setFiles` with `Not allowed`; no screenshot upload is claimed complete. Browser upload documentation requires enabling the ChatGPT extension’s `Allow access to file URLs`; the user has been given that exact setup step. iPad screenshots also remain to upload.

Screenshot permission resolved after the user restarted/reconfigured the Chrome extension. App Store Connect confirms four screenshots in the iPhone 6.9-inch slot and three in the iPad 13-inch slot, using the unchanged build 13 native PNG captures. No upload validation alerts were shown; Save is disabled after automatic persistence. This supersedes the upload-permission blocker above. Screenshots are uploaded; final device testing, engine activation, content-rights basis and moderation operations remain separate gates.

## TestFlight access investigation — September 7, 03:10 MDT onward

The internal group's build changed to Testing, but both the group tester table and All Testers still show No Builds Available for Garrett. No resend action is exposed. One remove/re-add of only the reversible group membership did not resolve it; the Apple account and TestFlight tester record were preserved. Individual assignment leads to a beta-review submission wizard, which was cancelled without submitting.

App-wide beta description, feedback/contact information, marketing/privacy URLs and reviewer login/notes were previously blank and have now been saved. Save is disabled and no alerts appear. This closes missing beta metadata but does not prove tester activation. A support request draft is prepared at `/tmp/Citrus-TestFlight-Support.txt`; it has not been sent. The user has been asked about a separate test Apple identity and moderation backup coverage. No new code or production deployment was made during this investigation.

User confirmed a separate Apple identity reserved for testing is available. A production `/auth` tab is open and signed out, and the user was asked to complete Continue with Apple using that identity and report the displayed email. No test identity has yet been verified and no deletion/revocation was attempted. Preserve the regular Citrus and Apple accounts.
