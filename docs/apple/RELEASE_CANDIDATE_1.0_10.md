# Citrus 1.0 (10) readiness — September 6, 2026

Final App Review submission and release remain unauthorized. Preparation, production fixes and testing are authorized; unfinished Game Day work is excluded.

Build 10 supersedes uploaded build 9. Xcode sign-in recovered. Both distribution export and App Store Connect upload succeeded; build 10 upload completed at 20:22 UTC. The exported IPA passes strict code-signature verification, identifies `com.citrussports.app` version 1.0/build 10, has production APNs entitlement, and disables debugger attachment. Apple processing/build attachment and distribution-device verification remain pending.

PR #412 merged as `9ac757d9ca144d9e198e2c00575c66ac181d192c`. It fixes the outlook's inconsistent projection total, removes individual points from upcoming-game cards, and calculates played-game/L7 points from raw stats under current league weights. It also fixes guarded engine Cloud Build status polling. Validation: full PR CI green, 42 focused engine tests, 18 player scoring/log tests, web TypeScript and changed-file lint pass.

Production deployment: `34057881573` started after merge; completion and deployed revision need verification. Engine workflow `34057282562` built commit `122065d8`, passed all preflight guards and waits for required owner approval. That engine source includes auction recovery and production APNs activation; the later client-only projection changes do not change its runtime.

Verified production reviewer journeys:
- Email/password sign-in in Chrome and native iPhone/iPad simulators.
- September 6 policy-consent screen appears; accepted only for the dedicated reviewer.
- Roster uses this review league's eight starter positions including two UTIL slots. Emptying UTIL, selecting an eligible bench player and reloading preserves the selection.
- Current projections and completed-season game logs finish loading.
- Build 10 iPhone player headline and outlook agree on the league projection; upcoming cards omit per-game points and the projection table retains raw stats.

Native build 10 iPhone screenshots are prepared under `/tmp/citrus-release10-screenshots/iphone-6.9/` at 1320×2868. iPad screenshots and final native walkthrough are in progress. Credentials remain private, outside Git. Chrome's App Store Connect session signed out; user has been asked to sign in again. Review notes are drafted privately but not saved as final verified instructions.

Outstanding submission gates:
- Approve and verify engine rollout, then nomination/bidding/history recovery in a fresh disposable auction.
- Production push delivery and notification-tap routing on a distribution/TestFlight build.
- Actual Apple OAuth/token retention/revocation using a disposable Apple identity; never delete or revoke Garrett's regular account.
- Final iPhone/iPad QA, screenshot upload, build attachment and reviewer credentials/notes.
- Evidence for third-party content rights or replacement of affected content; a free app is not itself evidence of permission.
- Moderation/support operating coverage: Garrett is primary; backup and monitored response routine still need confirmation.
- Assess generic dashboard/default rankings and category-format scoring presentation; the verified projection fixes do not establish that every app screen is league-specific.

Production policies, privacy labels, Canada/United States availability, free pricing and manual release were saved earlier. See [build 9 checkpoint](RELEASE_CANDIDATE_1.0_9.md) for deletion/moderation, auction-history preservation and earlier production evidence. This candidate is not yet cleared for submission and no Apple approval is guaranteed.
