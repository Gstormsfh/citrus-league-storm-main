# Citrus 1.0 (12) readiness — September 6, 2026

Preparation only: no final App Review submission or release. Unfinished Game Day work remains excluded. Xcode authentication works again; builds 9, 10 and 11 uploaded successfully. Candidate 12 replaces their client dependencies with security updates.

## Changes and validation

- Updated compatible locked dependencies, including Hono 4.13.7, node-server 1.19.17, undici 7.29.1, ws 8.21.3, protobufjs 7.6.6 and websocket-driver 0.7.5.
- Upgraded React Router DOM to 7.18.3 to address the remaining navigation advisory. The app already enabled both BrowserRouter v7 compatibility flags; those obsolete flags are removed. Declarative routing and React 18 remain in use. Upgrade reference: https://github.com/remix-run/react-router/blob/react-router%407.18.3/docs/upgrading/v6.md.
- Isolated dependency installation in this readiness checkout; the main Game Day checkout's node_modules was not modified.
- Full tests: 4,495 web, 1,840 server and 244 shared pass; six server tests remain skipped. Web TypeScript, server build and changed-file lint pass.
- Production dependency audit: zero moderate/high/critical findings, one low esbuild finding concerning a Windows development server. Citrus ships compiled assets and compiled Node server code, not that development server. Full developer-tooling audit still has findings; this is not a claim that every dependency is vulnerability-free.
- Build 12 production native sync, simulator build, device archive and distribution export succeed. Strict IPA signature verification passes; build number 12, production APNs and get-task-allow=false verified. Simulator launch loads the authenticated production reviewer league. Upload has been started; confirm its completion before counting it as uploaded.

## Deployment state

PR #413 is merged and production run 34058760394 succeeded. API revision citrus-api-00264-wq5 receives 100% of traffic. Candidate 12 dependency changes still require their own CI/deployment.

Old engine approval run 34057282562 was canceled before VM deployment. Build a replacement from the candidate 12 security commit and obtain its required environment approval. The existing production engine has not yet received the auction recovery/APNs update. Auction Test's 81 sales and original history were preserved when it was completed with user authorization.

## Still open

1. Deploy the updated engine through its guarded workflow; verify its fingerprint and a fresh disposable auction's nomination, bidding and recovery.
2. Test distribution/TestFlight production notification delivery and tap routing. The user's phone disconnected; its last installed local build is 9, not 12.
3. Verify actual Apple OAuth token retention and account-deletion revocation with a disposable Apple identity. Never delete Garrett's regular account.
4. Sign back into App Store Connect in Chrome; confirm build processing, attach the final candidate, upload screenshots and save verified private reviewer credentials/notes. Build 11 native screenshots are prepared; do not label them build 12 captures.
5. Verify third-party content rights or replace affected content.
6. Confirm moderation backup and response coverage; Garrett is primary.
7. Review generic dashboard rankings/category-format behavior and finish hands-on device journeys, including iPad lower-roster interaction.

Policies, published App Privacy, free pricing, Canada/United States availability and manual release were saved previously. See [build 11 evidence](RELEASE_CANDIDATE_1.0_11.md) for roster, projection and tablet fixes. Apple readiness remains incomplete; passing tests does not guarantee approval.
