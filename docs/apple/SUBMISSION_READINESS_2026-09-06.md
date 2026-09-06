# Citrus Apple submission readiness — September 6, 2026

**Status: candidate prepared and locally validated; not all submission gates are closed.** No deployment, upload or Apple submission was performed. This audit cannot guarantee approval or absence of every possible defect.

## Scope and separation

Branch `fix/apple-submission-readiness`, based on `0700055c`, isolated checkout `/Users/gstorms/.codex/worktrees/2b59/citrus`. No model, statistics, shared scoring, database, migration or data-pipeline changes. DraftKitService and its tests are unchanged from the base; the analytics task can safely integrate its separate null-handling fixes. Prior readiness reports are historical evidence, not current certification.

## Changes

- Removed founders discounts, future plan promises, fake Stormy upgrade control and recurring-charge language. Mobile-visible marketing and policy copy do not describe paid products.
- Draft Kit remains intended for a future desktop purchase. Restored all existing entitlement restrictions. Native builds omit its page module; native apps at every width and phone web hide all three known links (desktop navbar, mobile drawer, League Dashboard) and redirect `/draft-kit/*` before mounting its content. Desktop retains the gated preview, with an unavailable-purchase explanation and no checkout button. The legacy authenticated checkout endpoint returns an unavailable response without consulting or changing entitlements.
- Fixed relative legal URLs passed to Capacitor Browser: `/terms-of-service.html` and `/privacy-policy.html` become absolute HTTPS website URLs. Failed native opening now shows an error. Existing external HTTPS URLs remain intact; web links retain normal behavior.
- Consolidated React `/privacy` and `/terms` pages onto the checked-in public HTML used by signup/account links. Corrected stale support addresses, storage-region text and Firebase/Sentry/Anthropic disclosures. Added `/support` as a local alias for Contact; the verified production support URL remains `/contact`.
- Analytics withdrawal disables SDK collection and prevents delayed initialization after consent was withdrawn. Added an optional analytics toggle in phone/desktop Account settings and the Privacy route. Tests cover decline, re-enable and the async race.
- Added a cancelable disclosure before each Stormy send, identifying Anthropic and the question/history/league/roster/matchup context. Cancel returns before message state changes, context fetching or the AI request. This does not implement backend consent persistence.
- Expanded app privacy manifest for profile photos, device identifiers, optional product interactions and linked diagnostics. Camera/photo purpose strings, export-encryption flag, URL scheme and existing push entitlement inspected. Increased iOS build number from 3 to 4.

## Verification ledger

| Gate | Evidence / limitation |
|---|---|
| Web build | `npm run build` passed |
| Web suite | 301 files, 4,446 tests passed after functional fixes |
| Server suite | 104 passed files, 1 skipped; 1,790 tests passed, 6 skipped |
| Shared suite | 10 files, 244 tests passed; no shared changes |
| TypeScript | Web and server `tsc --noEmit` clean |
| Lint | Web `eslint src/`: 0 errors, 9 existing warnings |
| Native bundle | Production database/API pairing verified; AdSense stripped; no PWA service worker; production React; release tag `citrus-fantasy@1.1.0+4` |
| iOS compile | Xcode 26.6, iOS 26.5 SDK, Release arm64 build succeeded |
| Signed archive | See final archive record below; local signing verification is not App Store Connect validation |
| Privacy files | `plutil` passed; app, Capacitor and Cordova privacy manifests present in signed archive |
| Phone browser | 393×852: legal page renders, free-access page visually checked, Draft Kit direct URL returned `/`, no Draft Kit link rendered |
| Final focused tests | Native exclusion, consent, AI disclosure, external links and account/terms guards rerun after final native build exclusion |

The native telemetry tag uses the existing web package version (1.1.0); Apple's bundle version remains 1.0 (4). They are different namespaces, not evidence of a different submitted app version.

## Link and route coverage

Source-audited 27 literal local destinations across Navbar, HockeyFooter, HockeyNav, Contact, Pricing, Auth, Profile and TermsGate. Each maps to an app route or bundled static legal document; `/draft-kit` matches the guarded wildcard route. All known Draft Kit link sites were searched globally. Preview/mockup routes remain development-only. This is route-resolution coverage, not proof that each authenticated journey completes.

Explicit destinations checked: `/`, `/about`, `/armchair-gm`, `/armchair-gm?tab=mockdraft`, `/auth`, `/blog`, `/contact`, `/create-league`, `/draft-kit`, `/features`, `/free-agents`, `/gm-office/stormy`, `/news`, `/nhl/playoffs`, `/pool/confidence`, `/pool/pickem`, `/pool/survivor`, `/pricing`, `/privacy`, `/privacy-policy.html`, `/profile`, `/profile?tab=settings`, `/scores`, `/standings`, `/terms`, `/terms-of-service.html`, `/trade-analyzer`. `/support` was additionally added as an alias.

Read-only production HTTP checks returned 200 for `https://citrusfantasysports.com/contact`, `/privacy-policy.html` and `/terms-of-service.html`. Both policy responses lack the September 6 revision. An HTTP 200 on a SPA does not alone prove rendered support functionality; Contact source shows email/share-sheet/clipboard handoff, not a backend support ticket. Actual email delivery, every external news link, dynamic league/player URLs and authenticated mutations were not end-to-end tested here. No claim of “zero dead links everywhere” is justified.

## Release gates still open

1. **Publish and activate the revised policies.** Deploy the reviewed web assets/static HTML through the normal release process, then verify their exact text on the public URLs. Native Browser legal links use those public URLs, so the bundled copy does not remove this dependency. Coordinate database activation below; no changes were made to production.
2. **Verify complete account erasure and Apple authorization revocation.** Source implements in-app deletion, but no disposable account deletion was executed. Review current live RPC/cascades/storage cleanup and linked-provider behavior. See evidence and remediation below. Do not call this complete based on mocked tests or an older SQL snapshot.
3. **Run final device journeys.** Install the final candidate on an iPhone and iPad; test cold start, email/Apple/Google sign-in and cancel, email confirmation/reset return, policy reading and acceptance, new/existing account access, league join/create, draft pick/reconnect/exit, roster save, matchup/player loading, Stormy decline/accept, avatar picker with denied permissions, push opt-in/deep link and account deletion. None was proven on a physical device in this sweep.
4. **Prepare and verify review access.** Supply working private reviewer credentials and a populated review league/draft walkthrough. Backend availability and account state must be verified against the final candidate. No login credentials or demo data were invented.
5. **Complete App Store Connect.** Confirm latest accepted/uploaded build number, signing/distribution export, agreements, app record, privacy labels including service-provider collection, age questionnaire/13+ minimum policy, support/privacy URLs, content rights and final iPhone/iPad screenshots. The local archive is development-signed and has not been exported/validated/uploaded for distribution. No Connect state was read or changed.
6. **Integrate and revalidate independent work.** This candidate contains this isolated branch only. It does not include the ongoing data/model task's changes. Merge via normal review, rerun checks and regenerate the archive if the release source changes. Data validity and seasonal/live backend behavior remain owned by that task.

## Policy activation dependency (informational; data owner controls execution)

`apps/web/src/lib/consent.ts` now identifies the linked documents as `2026-09-06`. Both canonical HTML files have that revision date. The checked-in production schema snapshot defines `public.policy_versions` with one row per `policy_type` (primary key), `version`, `effective_from`, `requires_consent` and `updated_at`. `get_user_consent_status()` reads this table to drive TermsGate.

After confirming the current live schema and coordinating publication, the data owner should set the **existing** `terms_of_service` and `privacy_policy` rows to version `2026-09-06`, effective date `2026-09-06`, `requires_consent=true`, and stamp `updated_at`. Use its controlled migration/change workflow; do not insert duplicate policy types or backfill acceptance. Keep prior consent evidence. Verify a prior-version user is `outdated`, a new user can record both exact versions, the failed-write UI stays honest, and successful agreement reloads as `current`. Optional analytics is a separate client choice and must not be silently granted with legal consent. Without activation, TermsGate can still ask for the old server version despite displaying revised documents.

## Apple deletion/revocation evidence and smallest remediation

Observed chain: Profile → UserAccountService → `POST /api/account/delete` → AccountService → `delete_user_account()` SQL RPC. The checked-in August 13 production snapshot deletes `auth.users` and related application rows inside an atomic PL/pgSQL function. The repository contains no Apple `/auth/revoke` call, Apple-token capture/store, or Apple consent-revoked handler in that chain. Native sign-in uses Supabase OAuth/PKCE, and normal sign-out handles the Citrus/Supabase session. The Supabase Apple docs describe its sign-in exchange but do **not** establish that this application's direct SQL deletion revokes Apple authorization. Live hosted hooks/provider behavior were not inspected, so this is a repository gap plus an unverified live dependency, not a claim about all Supabase deployments.

Apple TN3194 identifies `/auth/revoke` as the programmatic token invalidation mechanism. It also documents a fallback when no refresh/access token or authorization code is available: still fulfill deletion, direct the user to manually revoke access, and leave the client unauthenticated. The current UI has no such post-deletion instructions. Do not block deletion while trying to recover missing provider tokens.

Smallest scoped path: verify whether hosted integration already revokes Apple authorization on deletion with a disposable Apple-linked account. If not, coordinate a backend-owned secure token capture/revocation path using the matching Apple client ID and server-held signing secret, plus a revocation notification handler and failure tests. For existing accounts lacking usable credentials, add Apple's documented manual-revocation guidance after successful deletion and local sign-out. Test reauthorization and ensure all relevant app/storage data is erased. This work must respect the data owner's active scope; no schema/token-storage change or destructive account test was attempted here.

Sources: [Apple deletion support](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple), [Supabase Apple integration](https://supabase.com/docs/guides/auth/social-login/auth-apple).

## Current Apple requirements checked

- iOS uploads require the iOS 26 SDK or later since April 28, 2026; this machine's SDK meets that requirement. [Apple submission requirements](https://developer.apple.com/app-store/submitting/)
- App completeness, accurate metadata, review access, privacy, account deletion and explicit third-party AI permission apply. This sweep added the AI disclosure before sending context. [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Include required SDK privacy manifests/signatures and disclose provider practices in App Privacy. Embedded manifest presence alone does not validate every nutrition-label answer. [SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/), [App Privacy](https://developer.apple.com/app-store/app-privacy-details/)
- The old 4+ shortcut and two-iPhone-size screenshot checklist were stale. See the updated [metadata worksheet](APP_STORE_METADATA.md), [age rating instructions](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/) and [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

## Final archive record

Final candidate: `/Users/gstorms/Library/Developer/Xcode/Archives/2026-09-06/Citrus Submission Candidate 1.0-4.xcarchive`.

- `xcodebuild archive`: **ARCHIVE SUCCEEDED** with local signing, no provisioning changes or upload.
- `codesign --verify --deep --strict`: valid on disk; satisfies designated requirement.
- Bundle `com.citrussports.app`, version **1.0**, build **4**, arm64; Xcode 26.6 / SDK iphoneos26.5.
- Signed as Apple Development: Garrett Storms (229258LSZ3), team TFMG57326Z. Distribution export/App Store validation remains pending.
- Archived Terms, Privacy and app privacy manifest match current source byte-for-byte. App/Capacitor/Cordova manifests are embedded. DraftKit page chunk is absent; removed founders/upgrade/checkout-offer phrases are absent from native JS.
- Final focused run: **7 files / 37 tests passed** after the last native-exclusion and analytics-preference synchronization changes. Final web TypeScript clean; lint still 0 errors / 9 warnings. Full suites above precede those narrow final changes.
- Build logs: `/tmp/citrus-readiness-native.log`, `/tmp/citrus-readiness-candidate-archive.log`; test logs `/tmp/citrus-readiness-web-tests.log`, `/tmp/citrus-readiness-server-tests.log`, `/tmp/citrus-readiness-shared-tests.log`, `/tmp/citrus-readiness-final-targeted.log`.

## Integration

Review/cherry-pick this branch's commit into the release branch without replacing independent data/model work. Run repository checks after integration. If runtime source changes, rebuild with `npm run build:native --workspace=apps/web`, sync Capacitor, and archive again; do not reuse this isolated candidate as proof for merged source. Normal `cap sync` may resolve local dependency symlinks into machine-specific SPM paths; this commit retains the original portable package references. No environment files or dependency folders are committed.
