# Citrus 1.0 (13) readiness — September 6, 2026

Preparation only. The user is away from the computer for approximately four hours and authorized continued independent work. Final App Review submission/release remains prohibited, and unfinished Game Day remains excluded.

## Corrections since build 12

- Failed game-log or schedule requests now show a retry action, instead of cached DNPs or an empty season. Schedule errors are evicted immediately so retry can reach the network.
- Completed-season history, missing projections, loading and failed league-scoring reads do not show a misleading zero projection or open an empty breakdown. Genuine zero projections remain available.
- The generic Players list and player-card positional ranks reweight raw projections through ScoringCalculator using the selected league. League changes preserve the shared raw cache and calculate new totals. Missing categories in a sparse configured scoring object remain disabled.
- The existing dashboard-index response now includes raw projected PIM, SHP and goalie GA. These columns were verified in production; no schema migration or new query is needed. Draft projections consume them, preferring projected goalie GA over historical-rate fallback. Data-access review passes: existing authenticated route/service boundary, unchanged bounded read/cache, no authorization or mutation changes.
- Category/rotisserie player views keep raw stats without presenting a points-league total. Points leagues with enabled plus/minus disclose that this unprojected category is excluded. Plus/minus remains a model limitation, not a claimed supported projection.
- Expanded advanced cards receive the same league-scored index as the parent player card.

Validation: full web suite passed 4,506 tests before the final conditional plus/minus note; the final focused suite passes 91 tests, including that note, league switching, retry, past-season absence and genuine zero. Server suite passes 1,840 tests with six skipped; server build, web TypeScript and changed-file lint pass. Native build 13 sync, archive, simulator build, distribution export and strict IPA signature verification succeeded. The IPA identifies build 13, production APNs and get-task-allow=false. Xcode confirmed upload success at 21:42 UTC on September 6; App Store processing and attachment remain unverified. Source commit: 94ca4b08cd42c9b7a2437c8ca039ebf44b8ee4e0. PR: https://github.com/Gstormsfh/citrus-league-storm-main/pull/415. Production deployment is still pending.

On the iPad simulator, build 13 loads the production reviewer roster and upcoming projections. Switching to completed-season history loads game rows and actual points while the unavailable SZN PROJ tile remains a dash. Physical-device and TestFlight testing remain outstanding.

## Existing live release and blocked steps

[Build 12](RELEASE_CANDIDATE_1.0_12.md) is uploaded, and its website/API security updates are live at API revision citrus-api-00265-r67. Its post-deployment consent, moderation and disposable-account deletion checks passed with all fixtures cleaned up.

Engine run [34059704526](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34059704526) built pinned commit 47c469faae3707de3ca3317cc0d6374a29146983 and passed all preflight checks. It remains pending the required GitHub environment approval. The build 13 changes do not modify the engine runtime or its APNs/recovery code, so the existing engine approval remains applicable.

After that approval: verify engine fingerprint, then nomination, bidding and recovery in a fresh disposable auction. Do not reopen the completed Auction Test; its 81 sales/history were preserved.

Still required: Chrome App Store Connect sign-in and final build processing/attachment/screenshots/reviewer fields; reconnect the iPhone for the latest build and distribution/TestFlight push/tap tests; actual Apple OAuth and deletion/revocation with a disposable Apple identity; hands-on iPad scrolling and remaining device journeys; content-rights evidence or replacement assets; moderation backup/response coverage. Garrett’s regular account must remain untouched.

The metadata worksheet now reflects published privacy, live policies, prepared reviewer access, free pricing and Canada/United States availability. Earlier status documents remain historical evidence. Readiness is not complete, and Apple approval is not guaranteed.
