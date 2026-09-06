# Citrus 1.0 (9) readiness — September 6, 2026

Final App Store submission and release remain unauthorized. Production preparation, fixes, deployment and testing are authorized. Unfinished Game Day work is excluded.

| Item | Verified result | Remaining work |
|---|---|---|
| API and website | PR #411 merged as `8c2e534c`; production deployment `34055785617` succeeded. API revision `citrus-api-00262-xr8` serves 100% of traffic and health is good | Continue integrated device QA |
| Automated checks | 4,485 web, 1,828 server (6 existing skips), 244 shared tests passed. Full CI passed. Subsequent engine configuration tests: 31 passed | Validate subsequent changes as made |
| Native candidate | Production-configured 1.0 (9) archive succeeded; signature verification passed; installed and launched on iPhone Air | Distribution export failed with Apple session-expired error 1100 and missing distribution identity; Xcode team retrieval must recover |
| Auction history | Owner explicitly approved ending idle Auction Test. 195 original events and 81 sales backed up privately; completion event 196 appended, all 81 sales preserved and rostered | Deploy updated engine, then verify a fresh disposable auction |
| Engine deployment | Corrected workflow will deploy the matching startup script and production APNs settings in its guarded metadata update. Required-reviewer environment now exists for Gstormsfh | Build, preflight, owner approval, deployment and fingerprint verification |
| Push | Production credentials provisioned; API deployment supplies them. Sign-out now preserves other devices and tap handling; six lifecycle regressions pass | Production APNs delivery and tap routing in a distribution build remain unverified |
| Staging test cleanup | User received a staging-only draft alert at 19:38 UTC in the production app. Removed that phone's staging token and the old disposable league; regular accounts untouched | Do not count this alert as a production push test |
| Deletion and moderation | Production integration checks passed consent states, membership, sender identity, report queue, admin rejection, blocking, removal, suspension, avatar removal, account deletion, shared-league succession and orphan cleanup. Temporary fixtures cleaned up | Actual Apple OAuth/token retention/revocation with a disposable Apple identity |
| Privacy and terms | Both production HTML pages byte-match reviewed source. Required policy versions activated as `2026-09-06`; real user acceptance was not manufactured | Publish matching App Privacy labels and verify consent UI |
| Reviewer access | Dedicated production review account signs in; Citrus Review League has two populated rosters. Credentials kept outside repository | Verify browser/device journeys, save private Connect credentials and accurate walkthrough |
| Store listing | Free price saved; Canada and United States confirmed as available on app release. Optional Mac and Vision Pro availability disabled. Manual release retained | Screenshots, review notes, build upload/attachment, final content/metadata check |
| Developer account | Organization membership through August 28, 2027; required developer agreements accepted | Fix Xcode's empty Teams list. Auto-renew payment card is absent; this is not evidence of an expired current membership |
| Scoring and roster | Player-card and weekly projections calculate from league weights; commissioner slot recovery and initialization fixes are deployed to API/web and installed client | Verify UTIL save/reopen and league switching on device; generic dashboard rankings/category-format presentation remain to assess |
| Content rights | Permitted-use basis for third-party assets remains unverified | Obtain evidence or replace affected content; do not describe this as certified |
| Moderation operations | Garrett is primary queue owner; report/block/admin functionality passed production integration | Establish monitored support routine and backup owner |

The candidate is not yet cleared for submission. Apple approval is not guaranteed by local tests or one native feature. Runtime evidence must match the final distribution build.
