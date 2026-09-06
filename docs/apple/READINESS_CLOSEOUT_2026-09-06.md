# Citrus Apple readiness — resumed code verification

Preparation only. No submission, release, production deployment, or migration application is authorized by this report. Content is still in progress. Apple approval is not guaranteed by local test results. This document supersedes the earlier report's statements about missing code and untouched App Store Connect fields; the earlier report remains historical evidence.

## Changes prepared

- Account deletion removes avatar object bytes under the authenticated user's folder before the database deletion. It fails visibly on incomplete cleanup and never treats malformed deletion results as success. Cross-system cleanup is retryable, not atomic: images or Apple access may already be removed if a later operation fails.
- Successful deletion leads to a public confirmation page with Apple's manual revocation instructions for legacy accounts without retained tokens. A direct visit does not falsely claim an account was deleted.
- Apple OAuth refresh-token retention uses a server-authenticated Apple identity, a direct Apple token-endpoint ownership check, AES-256-GCM encryption with user ID as authenticated additional data, and a service-role-only table. Deletion revokes Apple access before deleting the identity. Provider/storage failures do not report success. Old accounts without a retained token retain the manual-guidance fallback.
- Sign-out clears React Query, notification and draft state, account-owned browser content, Sentry identity, and Firebase identity. Stormy transcripts are scoped to individual accounts. Notification generations reject late responses from previous sessions, and load versions prevent older responses from undoing a post-block refresh.
- League chat has report/block/unblock controls, server-side sender identity, a baseline text filter, RLS blocking for historical messages, and bidirectional suppression of new messages. Direct client CHAT inserts and metadata rewrites are rejected. Admins have an oldest-first report queue and dismiss/remove/suspend actions with database authorization and audit logging.
- Optional phone, location, league messages and support information are reflected in privacy disclosures. Native analytics explicitly disables Google signals and ad personalization. App Privacy purposes and the app manifest are aligned.
- iPad startup inspection exposed a wide-navbar/status-bar overlap. Added safe-area padding to the navbar and sign-in layout; the header-height variable now includes the inset.
- iOS build number is 5. The native bundle strips ads, excludes desktop Draft Kit access, and disables service-worker caching.

## Verification evidence

- Full server suite: 1,811 passed, 6 existing skipped; shared suite: 244 passed.
- Full web suite after the account/moderation changes: **4,463 passed across 306 files**. The subsequent iPad safe-area-only adjustment passed 16 copy/link regression tests and a fresh native build. The first run caught one copy-length violation; the title was fixed and the entire suite rerun successfully.
- Both web/server TypeScript checks passed; the web check was repeated after the final notification load-order fix.
- Source lint: zero errors, nine existing warnings. Repository-wide web lint: zero errors, 32 warnings including harness files; no new warning suppression added.
- Staging transaction verified actual authenticated-role membership, sender identity, filter rejection, direct-write prevention, report ownership, nonadmin denial, historical/future blocking, removal and suspension. Rolled back all schema and fixtures.
- Separate staging transaction verified provider-token client privileges are denied and account deletion cascades the encrypted token. Rolled back.
- Earlier isolated production deletion probes passed for a basic account and a departing team owner with shared and orphaned leagues. All fixtures and deletions were rolled back; no real accounts deleted.
- Service tests cover token ownership mismatch, encryption/user binding, provider rejection, storage failure, missing configuration, legacy fallback, revocation failure, and deletion ordering.

## App Store Connect draft

Saved app name remains **Citrus Fantasy Sports**, subtitle **Fresh-squeezed fantasy hockey**, primary category Sports. Description, promotional text, keywords, support/marketing URLs, copyright, manual release choice, and review contact are saved. The contact phone is kept only in Connect.

All 14 selected privacy types have saved purposes, linked-to-identity answers, and no-tracking answers. There are no remaining “Set Up” entries; Publish is enabled but was **not clicked**. The policy URL is saved. Privacy publication remains held for the final release configuration.

Content rights “Yes” was recorded at the account holder's explicit instruction. The underlying rights to third-party logos, photos, news and data have **not** been independently verified. This declaration is not evidence that permission exists.

No build attached/uploaded, screenshots uploaded, or reviewer credentials entered. Age rating, availability/pricing, agreements and applicable business declarations still require final verification. The current content must determine the final questionnaire and screenshots.

## Runtime activation and testing still required

1. Apply the two pending migrations through the normal controlled release workflow, then deploy the matching API before the client. The migration files have been tested only inside rolled-back transactions.
2. Configure `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, and `APPLE_TOKEN_ENCRYPTION_KEY` on the API server only. The client ID must match the Supabase Apple web OAuth client; the encryption key is 32 random bytes encoded as 64 hex characters. Store these in the server's secret manager, never Vite variables or source control. The existing `scripts/ops/generate-apple-client-secret.mjs` prepares Apple client secrets. Rotate the signing secret before expiry; rotating the encryption key requires re-encrypting retained rows with the old key first.
3. With an actual disposable Apple account, complete OAuth, verify an encrypted row exists without printing it, delete through the UI, verify Apple authorization is revoked, storage/account rows are gone, the client is signed out, and reauthorization works. Repeat after a simulated transient Apple failure. Mock tests are not proof of production Apple integration. Token-retention errors currently emit an explicit server/client failure; monitor `Apple account cleanup token was not retained` and the capture endpoint's failure rate.
4. Publish the exact policies and activate the corresponding existing policy-version rows together. Current production policy versions were still January 13 when inspected. Never manufacture user acceptance. Verify old users see the new consent gate and successful consent reloads as current.
5. Run integrated iPhone/iPad journeys against the activated backend: auth/cancel/reset links, policy consent, league access, draft/reconnect, lineup save, Stormy permission, avatar permission denial, push/deep links, report/block/admin resolution, deletion, and account switching. Cold-start evidence alone does not close these.
6. Prepare a real populated reviewer account and private walkthrough after final content integration, then capture accurate device screenshots. Rebuild/retest the final integrated release source. Local development signing is not distribution validation.

## Citrus moderation operations

Before enabling chat for release, designate a support owner and backup to check Admin → Content Reports and the published support mailbox daily, with urgent safety reports prioritized immediately. This is a proposed operating procedure, not confirmation that someone has accepted the role or that an alert is deployed. Verify a test report actually reaches the queue and a nonadmin cannot access it.

Operators review context, dismiss unsupported reports, remove offending messages, and suspend repeat/severe offenders. Record decisions through the queue so the transaction logs them. Support must handle appeals; an authorized operator can remove the corresponding `chat_suspensions` row through controlled administration and audit that decision. The current UI does not have an unsuspend action.

The baseline chat word filter does not classify every abuse pattern, profile name, avatar, or linked third-party image. Human review and the final content/UGC assessment remain necessary. Report/block controls plus a regex do not by themselves establish full guideline compliance.

Draft-night impact: chat retains the existing message fanout. Blocking uses indexed user pairs, the admin queue is bounded to the oldest 100 open reports, and foreign-key indexes cover deletion/moderation lookups. These changes do not alter the draft engine, scoring, or data pipeline.

## Evidence locations

Logs are local temporary artifacts: `/tmp/citrus-apple-final-build.log`, `/tmp/citrus-apple-full-web.log`, `/tmp/citrus-apple-full-server.log`, `/tmp/citrus-apple-full-shared.log`, `/tmp/citrus-apple-final-web-types.log`, `/tmp/citrus-apple-final-server-types.log`, `/tmp/citrus-apple-final-lint.log`, `/tmp/citrus-apple-native5.log`, `/tmp/citrus-apple-archive5.log`, `/tmp/citrus-apple-simulator5.log`.

References: [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple), [Supabase provider-token handling](https://supabase.com/docs/guides/auth/social-login), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## Final local artifact

`/Users/gstorms/Library/Developer/Xcode/Archives/2026-09-06/Citrus Readiness 1.0-5.xcarchive` was rebuilt after the iPad correction. Xcode reported ARCHIVE SUCCEEDED; strict recursive code-signature verification passed. The synchronized native assets and privacy manifest match the archive byte-for-byte. This is a local development-signed archive, not an App Store distribution validation.

Simulator startup reached the sign-in UI on iPhone 17 Pro Max and iPad Pro 13-inch. The iPad status-bar overlap was reproduced, fixed and visually rechecked. Evidence: `/tmp/citrus-apple-iphone-startup.png` and `/tmp/citrus-apple-ipad-startup-fixed.png`. These are startup QA evidence, not final marketing screenshots or proof of authenticated journeys.

The existing Apple key was found locally. A newly signed client secret and encryption key were prepared in an owner-only file outside the repository; nothing was deployed. An intentional invalid-refresh-token probe returned Apple's `invalid_grant` response rather than `invalid_client`. This is a limited configuration probe, not proof of successful OAuth, token retention or revocation for a real account.
