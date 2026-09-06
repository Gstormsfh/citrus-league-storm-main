# App Store Connect — release worksheet, September 6, 2026

The fields below have been prepared; the current saved draft state and outstanding items are recorded in [the resumed verification report](READINESS_CLOSEOUT_2026-09-06.md). Nothing has been submitted. See [the readiness report](SUBMISSION_READINESS_2026-09-06.md) for actual tests and release gates.

## App information

- Name: `Citrus Fantasy Sports`
- Subtitle: `Fresh-squeezed fantasy hockey`
- Primary category: Sports
- Bundle ID: `com.citrussports.app`
- Current candidate: version 1.0, build 5. Verify build-number availability in App Store Connect before upload.

## Description draft

Citrus Fantasy Sports brings season-long fantasy hockey to your phone. Create or join a league, draft your roster, manage your lineup, follow matchups and explore player statistics.

Use Stormy for fantasy hockey questions with your league context. Before sending a question, Citrus explains what information will be shared with Anthropic and asks for your permission. Stormy has a weekly question limit.

Citrus is not affiliated with or endorsed by the NHL or Apple.

Verify every advertised feature against the final device build. Do not advertise Draft Kit in mobile metadata or screenshots.

## Destinations

- Support: https://citrusfantasysports.com/contact
- Privacy: https://citrusfantasysports.com/privacy-policy.html
- Terms: https://citrusfantasysports.com/terms-of-service.html
- Support email: CitrusFantasySports@Gmail.com

All three HTTPS destinations returned 200 during this sweep. The revised policies are not live yet; publication is a release prerequisite. Email delivery was not tested.

## App Privacy worksheet

Disclose collection by both Citrus and its service providers, including optional collection. Confirm these answers against the final archive's privacy report and deployed service settings.

| Data | Linked | Purposes saved in draft |
|---|---|---|
| Name, email, phone | Yes | App functionality |
| Coarse location | Yes | App functionality, analytics |
| Emails/text messages, photos/videos, customer support | Yes | App functionality |
| Gameplay content, other user content | Yes | App functionality, product personalization |
| User ID | Yes | App functionality, analytics, product personalization |
| Device ID | Yes | App functionality, analytics |
| Product interaction | Yes | Analytics |
| Crash data, other diagnostic data | Yes | App functionality |

All 14 types are configured and saved, not published. No tracking is selected. The native build strips AdSense and disables Google signals/ad personalization. Location includes optional profile location and provider-derived coarse location; no device location permission is requested. Recheck actual deployed provider settings before publication.

## Age rating

Complete the current questionnaire, including user-generated content, messaging and assistant capabilities actually present. Do not reuse the old blanket “everything else No / 4+” answer. The policy minimum age is 13; if Apple's calculated rating is lower, use the higher-age override to match the minimum. This is not a Kids Category app. Review contest classifications against actual app behavior; the current terms describe no entry fees or monetary prizes.

[Apple age-rating instructions](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/)

## Review access

Provide a working email/password reviewer account through App Store Connect's private review credentials fields. Verify login, accepted current policies, membership in a populated league, roster/matchup/player access and a usable draft walkthrough. No reviewer credentials were created or tested in this sweep. Do not paste credentials in this repository.

Review notes should describe how to reach each feature and note that the NHL season state can affect available live games. Record the actual account/league setup, not invented demo data. Do not claim that this archive has passed device review until it has.

## Screenshots

Capture from the final device/simulator build. Current requirements allow 6.9-inch iPhone screenshots, with 6.5-inch required if the larger set is not supplied. A 13-inch iPad set is required because the project supports iPad (`TARGETED_DEVICE_FAMILY = 1,2`). Supply 1–10 images per required set, no alpha channel.

Suggested real screens: league home, draft, roster, matchup, player statistics. Do not use mockups or desktop-only product screens as app screenshots.

[Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
