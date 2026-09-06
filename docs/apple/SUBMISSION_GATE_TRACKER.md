# Submission gate tracker — September 6, 2026

Preparation is authorized. Production deployment and App Store submission remain held until the user approves the release. Passing tests do not guarantee Apple approval.

| Gate | Current evidence | Required closure |
|---|---|---|
| Useful native experience | Native draft push registration, sender, tap routing and phone UI exist | Real background notification, correct draft route, pick, interrupted-session recovery |
| Current integrated source | Readiness branch extends production/master `0700055c`; staging API at `60127a88` | Update staging engine (observed August 12 `a33788d2`) and verify against the candidate; integrate final content separately |
| APNs activation | New sandbox/topic-specific Apple key created; three secrets stored for staging engine | Apply tested startup configuration, verify sender configuration and actual delivery; production key/configuration still needed for TestFlight |
| Device build | Fresh staging build 1.0 (5) compiled and installed on paired iPhone Air; assets match synchronized source | User email sign-in and authenticated journey results; this is a staging test build, not the production submission archive |
| Account deletion | API/staging browser cleanup passed, signed-out confirmation preserved | Real Apple OAuth/token/revocation test remains paused pending suitable test identity |
| Moderation | Report/block/admin workflow passed staging integration | Garrett is primary owner; backup unassigned. Confirm daily review and appeals procedure |
| Policies and App Privacy | Staging policy content and active versions verified; Connect privacy draft saved | Production publication/activation and matching final provider configuration |
| Content rights | Account holder selected Yes in Connect | Underlying permitted-use basis remains unverified; obtain evidence or replace affected assets |
| Reviewer access | Disposable device login prepared privately | Populated release reviewer account, usable draft access, and verified walkthrough |
| Device QA | Startup/safe areas checked; local suites pass | Full iPhone/iPad journeys, poor connectivity, denied permissions, account switching and large text |
| Submission metadata | Description/contact/manual release saved as draft | Final content, screenshots, age rating, availability, agreements, distribution validation and build attachment |

## Moderation operating procedure

Garrett Storms is the primary owner based on the user's response. Review Admin → Content Reports and the support mailbox daily and handle urgent safety reports promptly. Inspect context before dismissing, removing, or suspending. Use the app's admin actions so decisions are audited. Handle appeals through the published support address. A backup owner has not been designated. Assigning an owner does not prove the mailbox is monitored or that automated alerts exist.

## Native review demonstration

1. Sign in using a populated reviewer account; access the sample league and roster immediately.
2. Open a review draft that can be used without waiting for a real scheduled event.
3. Allow notifications, background the app, and advance to the reviewer's pick.
4. Receive the draft-turn notification, tap it, and arrive in the correct draft room.
5. Make a pick, inspect the roster, leave/reopen the app, and verify state recovery.
6. Show lineup management and league chat, including report/block controls.

Only describe steps as verified in App Review notes after they work in the final build. Do not imply that one native plugin guarantees compliance with guideline 4.2.
