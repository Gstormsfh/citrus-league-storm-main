# Citrus 1.0 (11) readiness — September 6, 2026

No final App Review submission or release is authorized. Continue preparation, production fixes and testing. Unfinished Game Day work remains excluded.

Build 11 supersedes uploaded builds 9 and 10. Xcode authentication is repaired. Build 10 uploaded successfully at 20:22 UTC, and its production deployment `34057881573` succeeded: API revision `citrus-api-00263-vrk` is ready and receives 100% of traffic; database/server/circuit-breaker health checks pass.

Build 11 closes issues found during iPad QA:
- League header actions no longer squeeze the league title into a thin column.
- The tablet/desktop starter grid uses distinct commissioner-configured UTIL IDs, matching the phone view. Tap targets use the shared slot configuration, including nondefault counts and forward leagues.
- IR display uses the league's configured count instead of assuming three.
- Roster cards adapt to the available column width; tablet view tabs remain visible without overlapping.
- Other-team views use the viewed league's fetched settings for slot layout and read-only fallback assignment, rather than writing a default lineup while another manager's team is being viewed.

Validation: 85 focused roster/layout tests pass, including two occupied utility slots, an empty second-utility move, legacy single-utility behavior and 0/1/2/4 IR counts. Web TypeScript and changed-file lint pass. Final build 11 simulator build and iOS archive succeeded. Distribution export and strict IPA checks pass (correct bundle/build, production APNs, no debugger attachment). App Store Connect upload succeeded at 20:37 UTC and Apple processing started. Build 11 screenshots are prepared for iPhone 6.9-inch and iPad 13-inch under `/tmp/citrus-release11-screenshots/`; final build attachment/upload of screenshots remains pending. PR #413 merged as `63c05026b208cb62c5d05aedd37e5c87ef21444d` after all checks passed. Production deployment `34058760394` succeeded; API revision `citrus-api-00264-wq5` is ready and receives 100% of traffic.

Verified earlier in the production reviewer account: email login, September 6 consent, a utility move surviving reload, current projections and completed-season game logs loading. Build 10 native iPhone headline and outlook agree on league projections; upcoming cards omit individual projected points. These fixes are included in build 11.

Engine workflow `34057282562` built commit `122065d8` and passed preflight, but was canceled before deployment when dependency advisories were discovered. It must be replaced with an image containing the security updates in candidate 12. No guard bypass was used. The owner-approved Auction Test completion preserved all 81 sales and original history.

Remaining submission gates:
1. Engine approval, rollout/fingerprint verification, and fresh disposable auction nomination/bidding/recovery test.
2. Distribution/TestFlight production push delivery and notification-tap routing.
3. Actual Apple sign-in, retained provider token and revocation through deletion using a disposable Apple identity. Garrett's regular account must remain untouched.
4. Final build processing/attachment, screenshots, private reviewer credentials and verified walkthrough. Chrome's Connect session signed out; user was asked to sign in again.
5. Evidence for third-party content rights, or replacement of affected content.
6. Moderation/support: Garrett is primary; confirm backup and monitored response coverage.
7. Assess generic dashboard/default rankings and category-format presentation. The verified point-scoring paths do not prove every surface is league-specific.

Policies, published privacy labels, free pricing, Canada/United States availability and manual release were saved earlier. [Build 9 evidence](RELEASE_CANDIDATE_1.0_9.md) records production deletion/moderation tests and earlier gates; [build 10 checkpoint](RELEASE_CANDIDATE_1.0_10.md) records scoring fixes and upload. Readiness remains incomplete; Apple approval is not guaranteed.

Physical-device update attempt: the previously connected iPhone Air is no longer available to CoreDeviceService, so build 11 was not installed on Garrett’s phone. Reconnect/unlock it for device validation. iPad lower-roster scrolling/tap behavior still needs a hands-on check; simulator input could not reliably exercise that gesture, so it is not recorded as passed.
