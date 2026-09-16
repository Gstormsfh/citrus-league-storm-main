# SDPN attribution: evidence, repair and release gate

Status: local code and fixture tests only. Not deployed, no production signup created, no real campaign conversion generated. Work started from refreshed `origin/master` at `822a83db`.

## Production evidence on September 16, 2026

- `https://citrusfantasysports.com/go/sdpn` returns HTTP 302, `Location: /?ref=sdpn`. Following it loads the homepage. This proves navigation, not reporting.
- Homepage asset `/assets/index-lmnx5-bA.js` includes `citrus.acquisition` local first-touch storage and the `acquisition_source` user-property call.
- The same deployed bundle has its analytics instance fixed at `null`, with no initialization branch. Consent changes persist the preference but cannot initialize the missing app. AnalyticsService therefore discards page/event calls.
- `.github/workflows/production-deploy.yml` passes Firebase API key, app ID and measurement ID but omits project ID. `config.ts` requires project ID before initialization. The repository's `VITE_FIREBASE_PROJECT_ID` secret exists; only secret names were inspected, never values.
- The current account-create route does not persist campaign attribution, and the existing admin stats route does not provide a campaign visit/signup report. A user property set on ordinary sign-in is not a signup-conversion counter.
- Read-only `firebase apps:list WEB --project citrus-fantasy-prod --json` failed due to the CLI authentication state. The linked GA4 property, custom dimensions, report ownership and user's report access have NOT been verified. No Google account or Analytics property was created or changed.

## Narrow implementation

1. Pass the existing project-ID secret to the production web build. A pre-build check rejects missing required analytics configuration instead of silently shipping disabled reporting.
2. Emit `campaign_visit` for a tagged arrival and `sign_up` for a newly created account. Both remain subject to optional analytics consent and Firebase availability.
3. Wait for asynchronous SDK readiness before marking campaign events sent. Denial clears pending campaign events. Consent withdrawal does not cause a bypass through the backend.
4. Existing first-touch source remains in the same browser across navigation and authentication. Tagged visits record the current source; signup events use the first touch, which may be an earlier campaign. These are explicitly different attribution models.
5. The server signup success response is evidence of account creation. The email-confirmation/OAuth path requires a recent locally recorded auth attempt plus an authenticated user whose creation timestamp falls inside that attempt and whose provider matches. An existing account login is excluded. Timestamp uncertainty fails closed and can undercount; this is not a backend-authoritative ledger.
6. Session storage deduplicates tagged arrivals for 30 minutes per source in the same tab. Local storage deduplicates signup events per account in that browser. In-memory protection handles repeated callbacks; no claim of global exactly-once delivery is made. Cleared storage, simultaneous tabs and blocked transport can affect counts.
7. No email, password, raw URL query, auth token or account ID is included in these event parameters. Campaign labels are bounded and validated. Native auth paths are excluded from the new signup tracker. No native build, deployment, migration, RLS policy, backend endpoint or customer account was changed.

## Where a report will be available

This PR does not add a report to Citrus Admin. The report is in the existing Firebase/GA4 product after access and release are verified:

1. Sign in to the **Citrus production Firebase project**. Open Analytics and its linked Google Analytics property. Confirm that the web stream's measurement ID is the one configured for the production build; do not infer this from the Hosting project name alone.
2. In the linked GA4 property's **Admin > Custom definitions**, register event-scoped dimensions for `campaign_source`, `first_touch_source` and `attribution_model`. Optionally add `campaign_name` and `campaign_medium`.
3. Create and save an Exploration called **SDPN campaign: visits and signups**. Use Event name as rows, Event count as the value, and filter `campaign_source` to `sdpn`. Keep `campaign_visit` and `sign_up` on separate rows. Label this **consented browser events**, not all visitors or all database accounts.
4. A second view can filter `first_touch_source=sdpn` for arrivals previously attributed to SDPN. Do not divide unlike tagged-arrival and first-touch-signup populations into a supposedly exact conversion rate.
5. Confirm the user can open the saved report. To share with the sponsor, export aggregate counts instead of granting broad access to unrelated analytics. No report has been created or shared by this task.

Firebase Analytics event documentation: https://firebase.google.com/docs/analytics/web/events
Recommended signup event: https://developers.google.com/analytics/devguides/collection/ga4/reference/events#sign_up

## What these counts do not cover

- Analytics denied, blocked cookies/storage, ad blockers, unsupported browsers, failed delivery, and visitors who never execute JavaScript can be missing. Accepting cookies does not guarantee the SDK's request reaches GA4.
- The SDK accepting `logEvent` is not receipt confirmation. The collector and report must be inspected after release.
- Same-browser return attribution is supported. Cross-device or cross-origin attribution is not added. `www` and apex origins have separate browser storage; test the exact public go-link origin through callback.
- Email confirmation does not count until an authenticated session is observed in the same browser. No fabricated conversion is sent from a confirmation-required or obfuscated signup response.
- No historical missing campaign metrics can be reconstructed from this change. Database signup totals and these browser-consented conversions are different measures.

## Release acceptance, still outstanding

- Review/merge the narrow PR and run the normal approved web deployment. Do not deploy from the old root checkout or rebuild native packages.
- Reauthenticate the Firebase/GA4 operator and verify project/stream/report access.
- In the deployed application, verify consent-denied produces no campaign event; then with an approved test browser and explicit consent, observe a tagged test arrival in DebugView and inspect the collector request. Keep test traffic out of the production campaign's final report.
- Use an explicitly approved test account/fixture to verify new email signup, email confirmation, Google/Apple callback, return navigation, failed signup, reload and existing-account login. Do not manufacture customer accounts. Confirm one signup event only for the new account.
- Verify the two report rows populate and the user can open the saved report. Until these steps pass, report the status as **code tested, live reporting not yet validated**.

## Local verification

Focused tests cover consent, asynchronous initialization, acquisition persistence, visit deduplication, auth round trips, older-account exclusion, failed signup, signup deduplication, malformed labels, unavailable storage and existing auth UI behavior. The build-config regression test catches the missing project-ID input. Live reads did not create production events or signups.
