# Capacitor spike plan — iOS TestFlight readiness

**Purpose.** Wrap the existing React web client (`apps/web/`) as an iOS binary via Capacitor for submission to TestFlight (private testing) and eventually the App Store. Calendar-critical: spike scheduled ~Aug 16, freeze Aug 17. **PLAN ONLY** — no installs / no builds executed by terminal per author-only mandate.

**Companion.** Merges T3 (Capacitor build plan) + T8 (Apple App Store gap analysis) per architect directive. Supersedes `docs/APPLE_APP_STORE_GAP_ANALYSIS.md` for the actionable checklist; that doc remains for historical Jan 2026 context.

**Author.** Terminal, 2026-08-08 third-shift under Garrett-away directive.

---

## §1 — Scope and non-scope

**In scope for the spike:**
- Install Capacitor + iOS platform to `apps/web/` (Vite-built React app).
- Configure `capacitor.config.ts` with app ID `com.citrusfantasysports.app`, name `Citrus Fantasy Sports`, web dir `dist`.
- Add iOS platform (`npx cap add ios`), generate Xcode project.
- Sync web build into iOS (`npm run build && npx cap sync ios`).
- Open Xcode, configure code signing (bundle ID + team), add app icons + launch screen, generate archive.
- Upload archive to App Store Connect via Xcode Organizer → TestFlight-internal.
- Install on Garrett's device via TestFlight; smoke-test.

**Non-scope for the spike (deferred to post-verify):**
- App Store review submission (TestFlight-internal only).
- Native plugin additions (push notifications, biometric auth, deep linking).
- Marketing metadata (screenshots, App Store description).
- Android platform (separate spike if Android becomes a target).

---

## §2 — Prerequisites Garrett must gather BEFORE the spike

**All must be in hand by Aug 15 evening. Any gap = spike delay.**

| Item | Owner | Where | Notes |
|---|---|---|---|
| Apple Developer Program account | Garrett | developer.apple.com | Individual ($99/yr) OR Organization. **Organization needs D-U-N-S number (adds 1-2 weeks to enrollment)** — start with Individual if not already enrolled. |
| Bundle Identifier reservation | Garrett | App Store Connect | Reserve `com.citrusfantasysports.app` (or whichever) via App Store Connect → Certificates, Identifiers & Profiles. Must match `capacitor.config.ts`. |
| Xcode 15+ | Garrett | Mac App Store | Free. Latest stable. **REQUIRES macOS Sonoma 14+.** |
| macOS device | Garrett | own machine | Xcode does not run on Windows or Linux. If Garrett only has Windows, this is a HARD BLOCKER — need Mac access (rent M-series Mac Mini on Scaleway, borrow from someone, etc.). |
| Test device (iPhone/iPad) | Garrett | own device | iOS 15+ for TestFlight compatibility. |
| App icons | Garrett OR designer | asset generation | 1024×1024 App Store icon + full icon set (Apple's Human Interface Guidelines). Can use existing Citrus branding. Auto-gen from single high-res: https://icon.kitchen or `xcode-generate-icons`. |
| Launch screen | Garrett OR designer | asset generation | Storyboard OR full-bleed image. Recommend: dark forest background matching citrus2 tokens (C2.bg `#0F1F15`) with centered Citrus logo. |
| Privacy manifest | (existing) | `ios/Runner/PrivacyInfo.xcprivacy` | Already exists (per gap analysis Jan 2026). Verify still-current with Apple's latest requirements. |
| App-Store Connect **internal-tester group** | Garrett | ASC → TestFlight | Add himself + ~5 volunteers by email. Internal testers don't require App Store review, so distribution is instant. |

**Additional considerations:**
- Apple Developer enrollment can take days-to-weeks for Organization accounts. **Start Aug 8-10 if not already enrolled.**
- Bundle ID must be globally unique across all Apple developers; verify availability before reserving.

---

## §3 — Spike day-by-day plan (Aug 15-17)

### Aug 15 (Fri) — Prerequisites verification day

- [ ] Garrett confirms all §2 items in hand. **Any gap = STOP + escalate to Aug 16-17 window.**
- [ ] Terminal (in review capacity, no execution): re-read this doc + `docs/APPLE_APP_STORE_GAP_ANALYSIS.md` + gap-doc's Capacitor step-by-step (starting at line 162).
- [ ] Terminal authors any missing scaffold code (see §4 code slots) if not already in place. Local `npm install @capacitor/core @capacitor/cli @capacitor/ios --save-dev` deferred to spike day (per author-only rule today).

### Aug 16 (Sat) — SPIKE DAY (Garrett executes)

**Morning (Garrett's Mac):**
1. `cd apps/web && npm install @capacitor/core @capacitor/cli @capacitor/ios --save-dev`
2. `npx cap init "Citrus Fantasy Sports" com.citrusfantasysports.app --web-dir=dist`
3. Verify `capacitor.config.ts` created at `apps/web/`.
4. `npm run build` (produces `apps/web/dist/`)
5. `npx cap add ios` (creates `apps/web/ios/App/` Xcode project)
6. `npx cap sync ios` (copies web build into iOS bundle)
7. `npx cap open ios` (launches Xcode)

**Midday (Xcode):**
8. Xcode → Signing & Capabilities → Team: select developer account → check "Automatically manage signing"
9. Bundle Identifier: verify matches capacitor.config.ts
10. Add app icons: drag full set into Assets.xcassets → AppIcon
11. Add launch screen: configure LaunchScreen.storyboard OR replace with image asset
12. Info.plist: verify PrivacyInfo.xcprivacy is included (already in `apps/web/ios/Runner/` per gap-doc — copy or reference)
13. Build for physical device (⌘R with iPhone plugged in) — smoke test that app launches and loads the web client

**Afternoon (TestFlight):**
14. Product → Archive
15. Xcode Organizer → Distribute App → App Store Connect → Upload
16. Wait 5-30 min for App Store Connect processing.
17. ASC → TestFlight → App → Test Info → Internal Testing → add build → notify testers.
18. Testers receive TestFlight email → install via TestFlight app.
19. Smoke-test on device: WS connect to staging, ignition, pick, completion, sign-out.

**Success criteria:**
- [ ] Physical-device build launches without crash
- [ ] Web client visible + interactive in iOS webview
- [ ] WS connection established to staging engine
- [ ] At least one round-trip (fetch league list, click a league) works
- [ ] TestFlight distribution reaches Garrett's phone + at least one other tester's device

### Aug 17 (Sun) — Freeze day (no code changes)

- [ ] If Aug 16 succeeded: document result + move on to §5 WS-behavior verification passes (below).
- [ ] If Aug 16 hit blockers: report to outbox, prepare for a re-spike on next available window.

---

## §4 — Code slots to author BEFORE spike (author-only, no install)

Terminal authors these placeholder scaffolds in advance so Aug 16 spike executes install → cap init → build with zero-authoring-lag:

### 4.1 `capacitor.config.ts` template

Author to `apps/web/capacitor.config.ts.template` (rename on spike day). Content:

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.citrusfantasysports.app',
  appName: 'Citrus Fantasy Sports',
  webDir: 'dist',
  server: {
    // Production: load from bundled dist (empty url + androidScheme:https).
    // Dev-time toggle: set url to a local staging URL for hot-reload testing.
    // Leave commented for spike; enable only for local iteration.
    // url: 'https://staging.citrusfantasysports.com',
    // cleartext: false,
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
    // WKWebView-specific:
    scheme: 'App',
    // Prevent iOS gesture bounce on scroll (feels more native):
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0F1F15', // C2 token — matches citrus2 dark forest
      showSpinner: false,
    },
  },
};

export default config;
```

### 4.2 `.gitignore` additions

Author to `apps/web/.gitignore` additions section:
```
# Capacitor iOS
ios/App/Pods/
ios/App/build/
ios/App/Podfile.lock
DerivedData/
*.xcuserstate

# Capacitor Android (future)
android/.gradle/
android/build/
android/app/build/
android/local.properties
android/.idea/
```

### 4.3 Update root package.json scripts

Recommended additions to `apps/web/package.json`:
```json
{
  "scripts": {
    "cap:sync": "npm run build && npx cap sync",
    "cap:open:ios": "npx cap open ios",
    "cap:build:ios": "npm run build && npx cap sync ios && npx cap open ios"
  }
}
```

---

## §5 — WS behavior on iOS webview (THE TWELVE-critical)

**Concern.** THE TWELVE will have participants on phones. iOS aggressively suspends web content when the app backgrounds. A phone locking mid-pick MUST NOT strand the user.

**iOS WKWebView WS behavior (research summary):**

- **Foreground + screen-on:** WS behaves like desktop browser. Ping/pong keeps connection alive.
- **App backgrounded (user switches away):** iOS suspends JavaScript execution within ~5s. WS connection held open by OS network stack, but no JS events fire, no rendering. Autopick expiring server-side while user's app is backgrounded → server autopicks their slot; client learns on resume via snapshot resync.
- **Screen-off (phone locked):** Same as backgrounded — JS suspended.
- **Screen-on but app not in foreground (e.g., app switcher visible):** Suspension applies.
- **Push notifications (not yet configured):** would wake the app briefly but require APNs setup — NOT in spike scope.

**Required client behavior post-resume:**
1. WS reconnect (already handled by `runner.ts` backoff logic).
2. Snapshot request on reconnect → full state reload (already handled by `LobbyManager.addConnection` → snapshot delivery).
3. Fold snapshot's recentEvents → derivedState catches up (already handled by `deriveDraftState.foldEvents` + F27b-1 bootstrap semantics).
4. If completed while app was backgrounded → F28 completion banner renders (F28 client work covered).

**Verification steps for spike Aug 16 afternoon:**
- [ ] Open draft room on iPhone via TestFlight build
- [ ] Background app for 30 seconds during in_progress draft
- [ ] Re-open app; verify state resumes correctly (no crash, correct on-clock team, correct clock deadline)
- [ ] Lock phone during draft; wait 60 seconds; unlock + reopen app; verify same
- [ ] Force-quit app; reopen; verify full state reload via snapshot

**Docket for post-spike (out of scope):**
- Push notifications on on-clock event (requires APNs).
- Background audio to keep app foreground during draft (Apple may reject — audio-only apps don't).

---

## §6 — Signing prerequisites (Garrett's checklist)

Consolidated from Apple + Capacitor documentation:

1. **Apple Developer Program membership** ($99/yr Individual or $99/yr Organization+D-U-N-S). Sign up at developer.apple.com.
2. **App Store Connect access** (auto-provisioned with dev-program).
3. **Certificates:**
   - Development certificate (for local device builds)
   - Distribution certificate (for App Store / TestFlight uploads)
   - Xcode "Automatically manage signing" handles both if configured properly
4. **Provisioning profiles:**
   - Development profile (paired with development cert + registered device UDIDs)
   - Distribution profile (paired with distribution cert; auto-created for App Store distribution)
5. **App-Store-Connect App record:**
   - Bundle ID reserved
   - App Information filled in (name, category, primary language)
   - Age rating questionnaire
   - Privacy policy URL (Citrus already has `/privacy` page)
6. **TestFlight:**
   - Internal testers (up to 100, no App-Store review, instant)
   - External testers (up to 10,000, requires beta-review, ~24-48h approval per build)

---

## §7 — Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Garrett doesn't have Mac access | med | HARD BLOCKER | Rent Scaleway M-series Mac Mini ($15/day); OR borrow from friend/coworker |
| Apple Developer enrollment slow (Org D-U-N-S) | high if Org path | 1-2 week delay | Start with Individual enrollment first |
| Bundle ID `com.citrusfantasysports.app` already taken | low | need alt bundle ID | Try `.io`, `.fantasy`, `.ca`; also check trademark |
| WS suspend-on-background breaks draft UX | high | user frustration | Snapshot-resync on resume works today; document limitation in Player Guide; docket push-notification for post-launch |
| Xcode signing errors on first build | med | few-hour debug | Apple's "Automatically manage signing" resolves most; StackOverflow + Capacitor Discord for edge cases |
| TestFlight processing >30 min | low | delay | Non-blocking; wait it out |
| App rejected by Apple during external-review | out of spike scope | need submission-quality assets + copy | Internal-tester-only path avoids this entirely for spike |
| iOS webview UI issues (safe-area, viewport, gestures) | med | polish tax | Capacitor handles most; iOS-specific CSS may need `env(safe-area-inset-top)` etc. |

---

## §8 — App Store readiness checklist (T8 merged content)

Consolidated from `docs/APPLE_APP_STORE_GAP_ANALYSIS.md` (Jan 2026) into an actionable dashboard.

### DONE (as of 2026-08-08 audit)
- [x] Privacy policy page (`/privacy` route)
- [x] Terms of service page (`/terms` route)
- [x] `ios/Runner/PrivacyInfo.xcprivacy` scaffold exists
- [x] Info.plist scaffold exists
- [x] Web app itself: React 18 + TypeScript + Vite, deployed to Firebase Hosting, feature-complete for fantasy hockey MVP
- [x] Clean codebase (per gap-doc "Code Quality: All Perfect ✅")
- [x] App features complete (draft, roster, matchup, pool games all live per gap-doc)

### BLOCKS TestFlight (must clear before Aug 16 spike)
- [ ] **Apple Developer Program enrollment** (Garrett — start Aug 8-10 if not already)
- [ ] **Mac + Xcode 15+** (Garrett — verify or rent)
- [ ] **Bundle ID reserved** (Garrett — App Store Connect, matches capacitor.config.ts)
- [ ] **App icons full set** (Garrett or designer — 1024×1024 baseline + full sizes)
- [ ] **Launch screen asset or storyboard** (Garrett or designer — dark forest + logo)
- [ ] **Capacitor scaffolds authored** (Terminal — §4 templates; done post-authoring)

### BLOCKS App-Store submission (post-TestFlight, later target)
- [ ] External-tester group + external beta review
- [ ] App Store screenshots (multiple device sizes)
- [ ] App Store description + marketing copy
- [ ] Age rating questionnaire
- [ ] Full privacy manifest per Apple's latest requirements (verify existing scaffold)
- [ ] Support URL (existing `/contact` may suffice)
- [ ] Marketing URL (existing homepage)

### MUST GATHER (specifically Garrett's to-do before Aug 15)
- [ ] Apple Developer account credentials (Apple ID)
- [ ] Mac machine (own OR rental confirmed)
- [ ] Test device (iPhone/iPad) — verify iOS 15+
- [ ] App icons file (or agree on generation approach)
- [ ] Launch screen decision (storyboard vs image)
- [ ] Internal-tester email list (self + volunteers who agreed to install TestFlight)
- [ ] Domain to configure for `capacitor.config.ts` server.url IF using local-dev-time hot-reload path

### DOCKETED FOR POST-SPIKE (not blocking)
- Push notifications (APNs setup — 1-2 day task on its own)
- Deep linking (draft-room-invite via URL scheme)
- Native biometric auth (Face ID / Touch ID for login)
- Android platform (separate spike)
- Full App Store submission (post-TestFlight validation)

---

## §9 — Post-spike report template

Author to `docs/RUNBOOKS/CAPACITOR_SPIKE_REPORT_2026-08-16.md` on spike day:

```
# Capacitor spike report — 2026-08-16

## Result
[SUCCESS / PARTIAL / BLOCKED]

## Sections
- Prereqs status:
- Cap init + iOS add: [ISO timestamp, notes]
- First device build: [timestamp, any errors]
- Xcode Archive: [timestamp, any errors]
- App Store Connect upload + processing: [timestamp, minutes]
- TestFlight distribution: [timestamp, testers notified]
- Device install: [Garrett + N other testers]
- Smoke-test results (per §5 WS-behavior checklist)

## Blockers surfaced
- [any]

## Next steps
- [any]
```

---

## §10 — Related docs

- `docs/APPLE_APP_STORE_GAP_ANALYSIS.md` — Jan 2026 historical context (superseded by this doc for actionable content)
- `docs/RUNBOOKS/THE_TWELVE_DRAFT_NIGHT.md` — draft-night runbook (Section 6e single-client-glitch + 6f simultaneous WS drop reference the WS-behavior concerns detailed in §5 here)
- `docs/PROJECT_PLAN.md` (if exists) — Phase 5+ calendar for post-spike scaling

---

**Sign-off.** This is a PLAN. No installs, no builds, no cap-init performed by terminal. Aug 16 execution is Garrett's per standing rules. Terminal available for real-time authoring assistance during spike if new code needs to land.
