# Citrus 1.0 (14) readiness — September 7, 2026

Build 14 supersedes build 13 as the App Store candidate. It includes the completed-draft history guard merged in PR 420 after hands-on review of the production reviewer league. The public App Store version has not been submitted and manual release remains selected.

## Candidate evidence

- PR 420 merged as `351b8b6db300b0f1e1498f4d24c56c4a59b52479`. Its full CI passed 4,497 web tests, the server suite, lint, both TypeScript checks, builds, the high/critical dependency audit and the bundle-size gate.
- A completed league that has roster assignments but no durable draft events no longer offers a dead Draft Results route. A stale or direct completed-draft link now terminates with an actionable unavailable state instead of loading forever.
- Production workflow [34144404289](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34144404289) passed all gates. API revision `citrus-api-00271-d8x` serves the merged image and passed HTTP health checks. Firebase Hosting version `07416ee312c3e2e9` deployed and the public site returned HTTP 200 with its security headers.
- The production-configured native build reports `citrus-fantasy@1.1.0+14`, uses `https://citrusfantasysports.com` and Supabase project `iezwazccqqrhrjupxzvf`, strips advertising, disables the service worker and includes only the App, Browser and Push Notifications Capacitor plugins.
- `xcodebuild archive` and App Store distribution export succeeded. The exported IPA is `com.citrussports.app`, version 1.0, build 14. Strict recursive signature verification passes. Entitlements contain production APNs and `get-task-allow=false`. App, Capacitor and Cordova privacy manifests pass `plutil`; archived public assets match synchronized source byte-for-byte.
- Local archive: `/Users/gstorms/Library/Developer/Xcode/Archives/2026-09-07/Citrus Release Candidate 1.0-14.xcarchive`. Exported IPA SHA-256: `75a1d9530b208fe1c119e13f6d411205a66069898c3832d4a5c89494adb62469`.

## Hands-on production checks

- The production reviewer session opened Citrus Review League on current iPhone and 13-inch iPad simulators.
- The commissioner roster settings rendered exactly: C 1, LW 1, RW 1, D 2, G 1, UTIL 2, BN 2 and IR 1. The roster showed two distinct utility slots and eight of eight starters.
- League-scored projections loaded for 1,252 skaters with nonzero totals. Connor McDavid's profile showed its projected stat breakdown. The same raw projections are reweighted by each league's enabled scoring categories and point values.
- The projected 2026–27 game log loaded 84 games; the completed 2025–26 log loaded 82 games with actual points. Neither remained on a spinner.
- The iPad layout exposed roster, navigation, moderation notice, Blocked Users and Contact Support without a layout failure.

## Remaining gates

1. Merge this build-number change, then upload build 14 to App Store Connect and wait for processing. Attach build 14 to the version and TestFlight group. Uploading or attaching a build is not public App Review submission.
2. Install build 14 through TestFlight on a physical iPhone and verify production Apple sign-in, safe areas, notification permission, delivery and tap routing. Build 13's beta-review state does not prove build 14 behavior.
3. Use a truly disposable Apple-linked Citrus identity to verify retained-token deletion and Apple authorization revocation. Preserve Garrett's regular Citrus/Apple identity.
4. Establish a support/moderation backup and response coverage; Garrett is currently the only named owner.
5. Record a defensible rights or licence basis for third-party league marks, player images and news content, or replace the affected material. The content-rights answer saved in App Store Connect is not itself evidence of permission.
6. Grant the deployment identity the documented Google Cloud permissions, deploy the previously gated draft-engine release, and verify a fresh disposable auction plus production push/tap. Do not reopen the completed Auction Test.

These are evidence and operational gates. The application code and locally exported build pass the checks above, but Apple approval cannot be guaranteed before the distribution and rights checks are complete.
