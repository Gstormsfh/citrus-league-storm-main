# Citrus 1.0 (11) readiness — September 6, 2026

No final App Review submission or release is authorized. Continue preparation, production fixes and testing. Unfinished Game Day work remains excluded.

Build 11 supersedes uploaded builds 9 and 10. Xcode authentication is repaired. Build 10 uploaded successfully at 20:22 UTC, and its production deployment `34057881573` succeeded: API revision `citrus-api-00263-vrk` is ready and receives 100% of traffic; database/server/circuit-breaker health checks pass.

Build 11 closes issues found during iPad QA:
- League header actions no longer squeeze the league title into a thin column.
- The tablet/desktop starter grid uses distinct commissioner-configured UTIL IDs, matching the phone view. Tap targets use the shared slot configuration, including nondefault counts and forward leagues.
- IR display uses the league's configured count instead of assuming three.
- Roster cards adapt to the available column width; tablet view tabs remain visible without overlapping.
- Other-team views use the viewed league's fetched settings for slot layout and read-only fallback assignment, rather than writing a default lineup while another manager's team is being viewed.

Validation: 85 focused roster/layout tests pass, including two occupied utility slots, an empty second-utility move, legacy single-utility behavior and 0/1/2/4 IR counts. Web TypeScript and changed-file lint pass. Final build 11 simulator build and iOS archive succeeded. Distribution export/upload, final native screenshots and production deployment must be recorded after verification.

Verified earlier in the production reviewer account: email login, September 6 consent, a utility move surviving reload, current projections and completed-season game logs loading. Build 10 native iPhone headline and outlook agree on league projections; upcoming cards omit individual projected points. These fixes are included in build 11.

Engine workflow `34057282562` built commit `122065d8` and passed preflight. It waits for Gstormsfh's required approval before VM restart. This image contains the auction recovery and production APNs changes; later commits are client-only changes. No guard bypass was used. The owner-approved Auction Test completion preserved all 81 sales and original history.

Remaining submission gates:
1. Engine approval, rollout/fingerprint verification, and fresh disposable auction nomination/bidding/recovery test.
2. Distribution/TestFlight production push delivery and notification-tap routing.
3. Actual Apple sign-in, retained provider token and revocation through deletion using a disposable Apple identity. Garrett's regular account must remain untouched.
4. Final build processing/attachment, screenshots, private reviewer credentials and verified walkthrough. Chrome's Connect session signed out; user was asked to sign in again.
5. Evidence for third-party content rights, or replacement of affected content.
6. Moderation/support: Garrett is primary; confirm backup and monitored response coverage.
7. Assess generic dashboard/default rankings and category-format presentation. The verified point-scoring paths do not prove every surface is league-specific.

Policies, published privacy labels, free pricing, Canada/United States availability and manual release were saved earlier. [Build 9 evidence](RELEASE_CANDIDATE_1.0_9.md) records production deletion/moderation tests and earlier gates; [build 10 checkpoint](RELEASE_CANDIDATE_1.0_10.md) records scoring fixes and upload. Readiness remains incomplete; Apple approval is not guaranteed.
