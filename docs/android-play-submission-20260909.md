# Android: Google Play submission runbook (2026-09-09)

Status at writing: Play Console organization account is registered and verified.
`apps/web/android` is a Capacitor 8.5 shell for `com.citrussports.app`
(targetSdk 36, Citrus icon and splash in place). This PR added the pieces the
shell was missing; everything below is the click path from here to review.

## What this PR changed

- `npm run android:sync` builds the web bundle through the same sanctioned
  `build:native` gate as iOS, copies the Xcode build number and marketing
  version into `android/app/build.gradle` (`scripts/android-version.mjs`), then
  runs `cap sync android`. Never hand edit `versionCode` / `versionName`.
- Android App Links intent filter in `AndroidManifest.xml` mirroring the iOS
  AASA paths, plus `public/.well-known/assetlinks.json` served by Firebase with
  a JSON header. The fingerprint slot reads `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`
  until step 6 below.
- Every `env(safe-area-inset-*)` in the app is now
  `var(--safe-area-inset-*,env(safe-area-inset-*))`, because an Android WebView
  reports 0 for `env()` while Capacitor 8 draws edge to edge and injects the
  `--safe-area-inset-*` variables instead. `androidSafeAreaGuard.test.ts`
  refuses new bare `env()` usages.
- Status and navigation bars painted Press Box surface (`#0C1811`) in
  `styles.xml`.

## 1. Tools

Install Android Studio (Hedgehog or newer) from developer.android.com/studio.
On first launch accept the SDK licences and let it install the default SDK
(API 36) and an emulator image (Pixel 8, API 35 or 36). Nothing else is needed;
Gradle wrapper and JDK come with Studio.

## 2. Build the shell

```bash
cd ~/dev/citrus/apps/web && npm run android:sync && npm run android:open
```

Studio opens `apps/web/android`. Wait for the Gradle sync to finish (bottom
status bar). Then Run > Run 'app' with an emulator selected. Check on the
emulator: header clears the status bar, bottom nav clears the gesture bar,
keyboard does not cover the Stormy input, invite screen opens once.

## 3. Create the upload key (once)

Build > Generate Signed App Bundle / APK > Android App Bundle > Next.
Key store path > Create new. Save it OUTSIDE the repo, for example
`~/Keys/citrus-upload.jks`. Password: put it in 1Password now. Alias
`citrus-upload`, validity 25 years, fill the certificate fields with Citrus
Fantasy Sports Inc. Remember the passwords: losing the upload key is a support
ticket with Google, not a rebuild.

Play App Signing (default for new apps) holds the real app signing key; this
upload key only signs what you send them.

## 4. Build the release bundle

Same dialog: choose the key store, select `release`, Finish. Studio writes
`apps/web/android/app/release/app-release.aab`.

## 5. Play Console: create the app and upload to Internal testing

play.google.com/console > Create app. Name "Citrus Fantasy Sports", default
language English (Canada), App, Free. Accept the declarations.

Left nav > Testing > Internal testing > Create new release > Upload the .aab.
Release name is filled from versionName; notes can be one line. Save, then
Review release, then Start rollout to Internal testing. Add your own email
under Testers > Create email list so you can install it from the link.

## 6. App Links: put the real fingerprint in assetlinks.json

Left nav > Setup > App signing (called App integrity in some layouts) > App
signing key certificate > copy the SHA-256 certificate fingerprint. Paste it
into `apps/web/public/.well-known/assetlinks.json` replacing
`REPLACE_WITH_PLAY_APP_SIGNING_SHA256` (keep the colons). Ship it as a web PR;
verify with:

```bash
curl -s https://citrusfantasysports.com/.well-known/assetlinks.json
```

Then in Play Console > Grow > Deep links, the domain should show verified
within a day. Until this lands, invite links open the browser on Android; the
app still works.

## 7. Store listing (Main store listing)

- App name: Citrus Fantasy Sports. Short description (80 chars max) and full
  description: reuse the App Store copy.
- App icon 512x512 PNG: export from the same source as the iOS 1024 icon.
- Feature graphic 1024x500: required. Press Box surface background, wordmark,
  one phone screenshot. (Claude Design.)
- Phone screenshots: 2 to 8, 16:9 or 9:16, at least 320px on the short side.
  The iOS 6.7 inch screenshots resized are fine.
- Category: Sports. Contact email: support@citrusfantasysports.com.
- Privacy policy: https://citrusfantasysports.com/privacy

## 8. Policy forms (App content, left nav)

- Privacy policy URL as above.
- Ads: No, the app does not contain ads (the native build strips AdSense;
  `build:native` asserts it).
- App access: All functionality available without special access is not
  true, since leagues need an account. Choose "All or some functionality is
  restricted" and add a test login (create a tester account for the reviewer).
- Content rating: complete the IARC questionnaire. It is a sports app with
  user generated content (team names, chat). Answer no to gambling with real
  money; the app is free to play.
- Target audience: 18 and over, or 13 and over if you want teens; the FAQ says
  no gambling so either passes. Do not pick under 13.
- News app: No. COVID app: No. Data safety: see below. Government app: No.
- Financial features: No.
- Health: No.

## 9. Data safety

Collected: name, email address (account), user IDs, app interactions
(analytics via Firebase), crash logs and diagnostics (Sentry), messages
(Stormy chat, in app). Not shared with third parties for advertising. Data is
encrypted in transit. Users can request deletion (account deletion exists in
Profile). Not collected: location, contacts, financial info, health.

## 10. Production

Once the internal build runs clean on a real Android device (ask a tester):
Left nav > Production > Create new release > pick the same bundle from the
library > Review > Start rollout. Review normally completes in under seven
days; new apps can take a little longer on the first submission.

## Push notifications on Android

Done in code (2026-09-09): `google-services.json` is in the project, so
`PushNotifications.register()` no longer kills the process, the token row
records `platform: 'android'`, and `PushService` sends to Android through FCM
HTTP v1 while iOS keeps going through APNs. The two transports are configured
independently, so a missing FCM credential leaves Android push dormant and
touches nothing on iOS.

What remains is two GitHub secrets. Firebase console > citrus-fantasy-prod >
Project settings > **Service accounts** > **Generate new private key**. That
downloads a JSON file; open it and copy two fields:

- `client_email` into the repo secret `FCM_CLIENT_EMAIL`
- `private_key` (the whole `-----BEGIN PRIVATE KEY-----...` string, newlines
  and all) into `FCM_PRIVATE_KEY`

Repo secrets live at github.com/Gstormsfh/citrus-league-storm-main >
Settings > Secrets and variables > Actions > New repository secret. The next
production deploy passes them to Cloud Run; `FCM_PROJECT_ID` is already a
literal in the workflow. Treat that JSON like the APNs `.p8`: it is a server
credential, not app config, and it never belongs in the repo.

## Known gaps to close before Production

- Real device pass on a modern Android phone (gesture nav, keyboard,
  universal links after step 6).
- Android push cannot be verified on the emulator without Play services; test
  it on a real device once the two secrets are set.
