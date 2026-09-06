# Citrus 1.0 (9) readiness — September 6, 2026

Final App Store submission and release remain unauthorized. Production preparation, fixes, deployment and testing are authorized. Unfinished Game Day work is excluded.

| Item | Verified result | Remaining work |
|---|---|---|
| API and website | PR #411 merged as `8c2e534c`; production deployment `34055785617` succeeded. API revision `citrus-api-00262-xr8` serves 100% of traffic and health is good | Continue integrated device QA |
| Automated checks | 4,485 web, 1,828 server (6 existing skips), 244 shared tests passed. Full CI passed. Subsequent engine deployment/configuration tests: 42 passed | Validate subsequent changes as made |
| Native candidate | Production-configured 1.0 (9) archive installed on iPhone Air. After Xcode sign-in, distribution export and strict IPA signature verification succeeded; production APNs entitlement confirmed. App Store Connect upload succeeded at 20:12 UTC | Wait for Apple processing, attach build and install distribution build for production push QA |
| Auction history | Owner explicitly approved ending idle Auction Test. 195 original events and 81 sales backed up privately; completion event 196 appended, all 81 sales preserved and rostered | Deploy updated engine, then verify a fresh disposable auction |
| Engine deployment | Corrected workflow will deploy the matching startup script and production APNs settings in its guarded metadata update. Required-reviewer environment exists for Gstormsfh. Build 834e81ab succeeded but GitHub run 34056763132 failed reading logs. Commit `122065d8` polls build status without log-bucket access; 11 new success/failure tests pass. Corrected run `34057282562` passed image build and all preflight checks; waiting for required owner approval | Owner approval, deployment and fingerprint verification |
| Push | Production credentials provisioned; API deployment supplies them. Sign-out now preserves other devices and tap handling; six lifecycle regressions pass | Production APNs delivery and tap routing in a distribution build remain unverified |
| Staging test cleanup | User received a staging-only draft alert at 19:38 UTC in the production app. Removed that phone's staging token and the old disposable league; regular accounts untouched | Do not count this alert as a production push test |
| Deletion and moderation | Production integration checks passed consent states, membership, sender identity, report queue, admin rejection, blocking, removal, suspension, avatar removal, account deletion, shared-league succession and orphan cleanup. Temporary fixtures cleaned up | Actual Apple OAuth/token retention/revocation with a disposable Apple identity |
| Privacy and terms | Both production HTML pages byte-match reviewed source. Required policy versions activated as `2026-09-06`; real user acceptance was not manufactured. Matching App Privacy labels published in Connect | Verify consent UI |
| Reviewer access | Dedicated production review account signs in; Citrus Review League has two populated rosters. Credentials kept outside repository | Verify browser/device journeys, save private Connect credentials and accurate walkthrough |
| Store listing | Free price saved; Canada and United States confirmed as available on app release. Optional Mac and Vision Pro availability disabled. Manual release retained | Screenshots, review notes, processed build attachment, final content/metadata check. Chrome Connect session signed out after upload; user asked to sign back in |
| Developer account | Organization membership through August 28, 2027; required developer agreements accepted | Xcode sign-in restored and distribution upload succeeded. No current signing blocker |
| Scoring and roster | Player-card and weekly projections calculate from league weights; commissioner slot recovery and initialization fixes are deployed to API/web and installed client | Verify UTIL save/reopen and league switching on device; generic dashboard rankings/category-format presentation remain to assess |
| Content rights | Permitted-use basis for third-party assets remains unverified | Obtain evidence or replace affected content; do not describe this as certified |
| Moderation operations | Garrett is primary queue owner; report/block/admin functionality passed production integration | Establish monitored support routine and backup owner |

The candidate is not yet cleared for submission. Apple approval is not guaranteed by local tests or one native feature. Runtime evidence must match the final distribution build.

## Follow-up client corrections for build 10

Production reviewer UI verified sign-in, September 6 policy consent, filling the second UTIL slot and retaining the selected player after reload. The season log and league breakdown load. QA found the outlook still quoted a default projection and upcoming cards still showed per-game points. The follow-up uses the same league total in the outlook, removes those card point labels, and derives played-game/L7 totals from raw stats with current league weights. Build 9 remains uploaded but is not the final candidate; build 10 must be built and verified.
