# Citrus Fantasy Hockey — React Native Migration & Apple App Store Compliance Checklist

**Generated: February 8, 2026**
**Scope: Full codebase audit of citrus-league-storm-main**

---

## TABLE OF CONTENTS

1. [CRITICAL BLOCKERS — Must Fix Before Submission](#1-critical-blockers)
2. [Apple App Store Review Guidelines Compliance](#2-apple-app-store-review-guidelines)
3. [React Native Migration — Screen-by-Screen Inventory](#3-react-native-migration-inventory)
4. [Component Migration Map](#4-component-migration-map)
5. [Service/Business Logic Layer (Platform-Agnostic)](#5-service-layer)
6. [Database & Backend Readiness](#6-database-backend)
7. [Authentication System](#7-authentication)
8. [Third-Party Dependencies — RN Equivalents Needed](#8-dependencies)
9. [Asset & Media Inventory](#9-assets)
10. [iOS-Specific Requirements](#10-ios-specific)
11. [App Store Metadata Requirements](#11-metadata)

---

## 1. CRITICAL BLOCKERS — Must Fix Before Submission {#1-critical-blockers}

These are **guaranteed rejection reasons** if not addressed:

### 1.1 PAYMENTS — Apple IAP Compliance (Guideline 3.1.1)

| Issue | Current State | Required Action |
|---|---|---|
| Pricing page shows $4.99/mo Pro and $9.99/mo Commissioner tiers | **UI-only, no payment backend** — buttons do nothing (`src/pages/Pricing.tsx`) | Must implement Apple In-App Purchase (StoreKit 2) for ALL digital subscriptions. Cannot use Stripe/external payments for digital goods on iOS. |
| No subscription management | No billing tables, no subscription status tracking in database | Create `user_subscriptions` table, integrate RevenueCat or StoreKit 2 directly |
| No restore purchases flow | N/A | Apple **requires** a "Restore Purchases" button for all subscription apps |
| No subscription terms displayed at purchase | N/A | Must show subscription price, duration, and auto-renewal terms at point of purchase per Apple guidelines |
| 30% Apple commission not accounted for | Pricing shows $4.99/$9.99 | Pricing must account for Apple's 30% cut (15% after year 1 with App Store Small Business Program) |

### 1.2 ACCOUNT DELETION (Guideline 5.1.1)

| Issue | Current State | Required Action |
|---|---|---|
| Account deletion uses `supabase.auth.admin.deleteUser()` | `src/pages/Settings.tsx:145` — This requires a **service role key** which cannot be in client code | Must create a Supabase Edge Function or RPC with `SECURITY DEFINER` to handle deletion server-side |
| No `delete_user_account()` RPC exists in database | Missing from all 145+ migrations | Create a server-side RPC that cascades deletion of all user data |
| No data export before deletion | Privacy policy promises data export (Section 5.1) | Must implement `export_user_data()` to fulfill your own privacy policy promises |
| Deletion not guaranteed within 30 days | No scheduled/queued deletion mechanism | Apple requires account deletion to complete within a reasonable timeframe |
| Settings.tsx has duplicate import | `AdSpace` imported twice (lines 14 & 17) — **will cause build error** | Remove duplicate import |

### 1.3 PRIVACY & CONSENT TRACKING (Guideline 5.1.2)

| Issue | Current State | Required Action |
|---|---|---|
| No Terms/Privacy acceptance checkbox on signup | `src/pages/Auth.tsx` — signup form has no consent checkbox | Add mandatory "I agree to Terms of Service and Privacy Policy" checkbox before account creation |
| No consent tracking in database | No `user_privacy_consent` table exists | Create table to log when users accepted which version of privacy policy |
| No App Tracking Transparency (ATT) prompt | No tracking framework present | If you add ANY analytics (even first-party device IDs), you need ATT prompt on iOS 14.5+ |
| Privacy policy page mismatch | `src/pages/Privacy.tsx` has a 5-section stub; `public/privacy-policy.html` has the full 15-section version | Consolidate — use one authoritative version. The React page must show the full policy. |
| Privacy Nutrition Label not prepared | N/A | Must complete App Store Privacy Nutrition Label declaring all data collected |

### 1.4 LEGAL DOCUMENT ISSUES

| Issue | File | Required Action |
|---|---|---|
| Terms of Service Section 14.1 has placeholder text | `public/terms-of-service.html:329` — says `[Your State/Country]` | Replace with actual governing jurisdiction |
| Contact page has fake phone number | `src/pages/Contact.tsx:168` — `+1 (555) 123-4567` | Use real phone number or remove |
| Contact page has fake address | `src/pages/Contact.tsx:182` — `123 Citrus Lane, Suite 456, Orlando, FL 32801` | Use real address or remove |
| Contact form doesn't actually send | `src/pages/Contact.tsx:32` — `setTimeout` simulates submission | Must wire to actual backend (Supabase Edge Function or email service) |
| Social media links are dead | `src/pages/Contact.tsx:197-219` — All social links point to `#` | Must link to real profiles or remove entirely. Apple reviewers WILL click these. |

---

## 2. APPLE APP STORE REVIEW GUIDELINES COMPLIANCE {#2-apple-app-store-review-guidelines}

### 2.1 Safety (Section 1)

| Guideline | Status | Action Required |
|---|---|---|
| 1.1 Objectionable Content | PASS | Fantasy hockey is clean content |
| 1.2 User-Generated Content | NEEDS WORK | Team names and league names are user-generated. Need: (1) content filter for offensive names, (2) report/flag mechanism, (3) block user capability |
| 1.3 Kids Category | N/A | Not targeting kids; ToS states 13+ minimum |
| 1.4 Physical Harm | PASS | No physical harm content |
| 1.5 Developer Information | NEEDS WORK | Must have valid, reachable support URL and contact info (current contact form is fake) |

### 2.2 Performance (Section 2)

| Guideline | Status | Action Required |
|---|---|---|
| 2.1 App Completeness | NEEDS WORK | Pricing page shows tiers but buttons do nothing. Several "coming soon" features. Apple rejects incomplete apps. |
| 2.2 Beta/Demo | NEEDS WORK | Remove any test mode flags (`VITE_TEST_MODE`, `VITE_TEST_DATE`) from production builds |
| 2.3 Accurate Metadata | PENDING | App name, description, screenshots must match actual functionality |
| 2.4 Hardware Compatibility | PENDING | Must support current iOS devices (iPhone, iPad if universal) |
| 2.5 Software Requirements | PENDING | Target minimum iOS 15.0+ for React Native |

### 2.3 Business (Section 3)

| Guideline | Status | Action Required |
|---|---|---|
| 3.1.1 In-App Purchase | BLOCKER | All digital subscriptions MUST use Apple IAP. Cannot link to web for payment. |
| 3.1.2 Subscriptions | BLOCKER | Must implement auto-renewable subscriptions via StoreKit 2 |
| 3.1.3 Free Apps | OK if free-only | If you launch free-only first (no paid tiers), this is fine |
| 3.2 Other Business Model Issues | NEEDS WORK | Ad-supported model mentioned in Free tier — must use Apple-compliant ad SDK (AdMob, etc.) |

### 2.4 Design (Section 4)

| Guideline | Status | Action Required |
|---|---|---|
| 4.0 Human Interface Guidelines | NEEDS WORK | Full HIG audit needed during RN build (see Section 10) |
| 4.1 Copycats | PASS | Original app with unique branding |
| 4.2 Minimum Functionality | PASS | Substantial fantasy sports functionality |
| 4.5 Apple Sites and Services | NEEDS WORK | Sign in with Apple uses Chrome icon for Google (`<Chrome />` in Auth.tsx line 214) — must use proper Google logo |
| 4.8 Sign in with Apple | NEEDS WORK | Already have Apple OAuth but must use official Apple Sign-In button styling per HIG |

### 2.5 Legal (Section 5)

| Guideline | Status | Action Required |
|---|---|---|
| 5.1 Privacy | NEEDS WORK | See Section 1.3 above — consent tracking, ATT, nutrition label all needed |
| 5.1.1 Data Collection and Storage | NEEDS WORK | Must declare all data types in App Store Connect |
| 5.1.2 Data Use and Sharing | PASS (mostly) | Privacy policy covers this well in the HTML version |
| 5.2 Intellectual Property | NEEDS WORK | NHL disclaimer exists but must ensure no NHL logos/trademarks used as app icons or in screenshots. Player headshots from `assets.nhle.com` need licensing review. |
| 5.3 Gaming/Gambling | NEEDS REVIEW | Fantasy sports is legal but varies by jurisdiction. ToS correctly states "no entry fees, no monetary prizes" — this is critical to maintain. |
| 5.6 Developer Code of Conduct | PASS | N/A |

---

## 3. REACT NATIVE MIGRATION — SCREEN-BY-SCREEN INVENTORY {#3-react-native-migration-inventory}

Every screen in the app, what it does, and what needs to change for React Native.

### 3.1 Marketing/Public Pages (12 screens)

These are **web-only** and should NOT be in the React Native app. They belong on your website.

| Screen | File | RN Action |
|---|---|---|
| Homepage | `src/pages/Index.tsx` | EXCLUDE — web only |
| Features | `src/pages/Features.tsx` | EXCLUDE — web only |
| Pricing | `src/pages/Pricing.tsx` | REBUILD as IAP subscription screen |
| About | `src/pages/About.tsx` | EXCLUDE — link to web |
| Careers | `src/pages/Careers.tsx` | EXCLUDE — web only |
| Blog | `src/pages/Blog.tsx` | EXCLUDE — web only |
| News | `src/pages/News.tsx` | EXCLUDE or convert to in-app feed |
| Guides | `src/pages/Guides.tsx` | EXCLUDE or convert to in-app help |
| Podcasts | `src/pages/Podcasts.tsx` | EXCLUDE — web only |
| Contact | `src/pages/Contact.tsx` | REPLACE with in-app support (email link or Zendesk) |
| Privacy Policy | `src/pages/Privacy.tsx` | REPLACE with WebView loading `privacy-policy.html` or native text |
| Terms of Service | `src/pages/Terms.tsx` | REPLACE with WebView loading `terms-of-service.html` or native text |

### 3.2 Authentication Pages (7 screens) — ALL MUST MIGRATE

| Screen | File | RN Migration Notes |
|---|---|---|
| Auth (Login/Signup) | `src/pages/Auth.tsx` | Rebuild with React Native components. Must use Apple's official Sign-In button component (`@invertase/react-native-apple-authentication`). Google sign-in needs `@react-native-google-signin/google-signin`. |
| OAuth Callback | `src/pages/AuthCallback.tsx` | Replace with deep-link handling (`react-native-url-polyfill` + Supabase deep link config) |
| Profile Setup | `src/pages/ProfileSetup.tsx` | Direct port — form inputs only |
| Profile Editor | `src/pages/Profile.tsx` | Direct port — form inputs only |
| Password Reset | `src/pages/ResetPassword.tsx` | Direct port — may use deep link from email |
| Email Verification | `src/pages/VerifyEmail.tsx` | Replace with deep link handler |
| Settings | `src/pages/Settings.tsx` | Rebuild — must include: subscription management, notification preferences, account deletion, legal links |

### 3.3 Core Game Pages (14 screens) — ALL MUST MIGRATE

| Screen | File | RN Migration Notes |
|---|---|---|
| League Dashboard | `src/pages/League.tsx` | Complex rebuild — tabs, real-time data, multiple sub-components |
| Create/Join League | `src/pages/CreateLeague.tsx` | Direct port — form + league code entry |
| Matchup View | `src/pages/Matchup.tsx` | **Most complex screen** — 21 sub-components, charts, live scoring. Recharts must become `react-native-svg-charts` or `victory-native`. |
| Roster Management | `src/pages/Roster.tsx` | Rebuild drag-and-drop — `dnd-kit` has no RN equivalent. Use `react-native-draggable-flatlist` instead. |
| Standings | `src/pages/Standings.tsx` | Direct port — table/list data |
| Draft Room | `src/pages/DraftRoom.tsx` | **Critical real-time screen** — 8+ sub-components, timers, live picks. Needs careful WebSocket/Supabase realtime testing. |
| Free Agents | `src/pages/FreeAgents.tsx` | Direct port — search + list |
| Waiver Wire | `src/pages/WaiverWire.tsx` | Direct port — list + claim actions |
| Trade Analyzer | `src/pages/TradeAnalyzer.tsx` | Rebuild — uses charts (Recharts → RN chart lib) |
| Team Analytics | `src/pages/TeamAnalytics.tsx` | Rebuild — heavy chart usage |
| Schedule Manager | `src/pages/ScheduleManager.tsx` | Direct port — calendar/list view |
| GM Office | `src/pages/GmOffice.tsx` | Rebuild — dashboard with 6 sub-components |
| Stormy AI Chat | `src/pages/GmOfficeStormy.tsx` | Rebuild as chat interface — consider `react-native-gifted-chat` |
| Team View | `src/pages/TeamView.tsx` | Direct port — read-only roster |
| Playoffs | `src/pages/Playoffs.tsx` | Direct port — bracket visualization |

### 3.4 Error Pages

| Screen | File | RN Action |
|---|---|---|
| 404 Not Found | `src/pages/NotFound.tsx` | Replace with RN error boundary + navigation fallback |

---

## 4. COMPONENT MIGRATION MAP {#4-component-migration-map}

### 4.1 shadcn/ui Components (48) — ALL MUST BE REPLACED

shadcn/ui is web-only (Radix UI primitives). Every component needs a React Native equivalent.

| shadcn Component | React Native Replacement |
|---|---|
| `Button` | `react-native` Pressable + custom styling OR `react-native-paper` Button |
| `Card` | Custom `View` with shadow styling |
| `Input` | `TextInput` from react-native |
| `Label` | `Text` from react-native |
| `Dialog` | `react-native-modal` or RN `Modal` |
| `Sheet` (bottom sheet) | `@gorhom/bottom-sheet` |
| `Drawer` | `@react-navigation/drawer` |
| `Tabs` | `@react-navigation/material-top-tabs` or custom |
| `Select` | `@react-native-picker/picker` |
| `Checkbox` | `react-native` custom or `react-native-paper` |
| `Switch` | `Switch` from react-native |
| `Slider` | `@react-native-community/slider` |
| `Toast/Sonner` | `react-native-toast-message` |
| `DropdownMenu` | Custom or `react-native-popup-menu` |
| `Table` | `FlatList` with row components |
| `ScrollArea` | `ScrollView` from react-native |
| `Separator` | `View` with borderBottom |
| `Accordion` | `react-native-collapsible` or custom `Animated` |
| `AlertDialog` | `Alert.alert()` from react-native |
| `Avatar` | `Image` with rounded styling |
| `Badge` | Custom `View` + `Text` |
| `Breadcrumb` | Not needed in mobile — use navigation stack |
| `Calendar` | `react-native-calendars` |
| `Carousel` | `react-native-reanimated-carousel` (replaces Embla) |
| `Chart` | `victory-native` or `react-native-chart-kit` (replaces Recharts) |
| `Command` | Custom search/filter component |
| `Form` | `react-hook-form` works in RN (keep as-is) |
| `HoverCard` | N/A on mobile — use press/long-press instead |
| `NavigationMenu` | `@react-navigation/native` |
| `Pagination` | Infinite scroll with `FlatList.onEndReached` |
| `Popover` | `react-native-popover-view` |
| `Progress` | `react-native` custom or `react-native-progress` |
| `RadioGroup` | Custom radio buttons |
| `Skeleton` | `react-native-skeleton-placeholder` |
| `Tooltip` | Long-press info or `react-native-walkthrough-tooltip` |
| `Toggle/ToggleGroup` | Custom Pressable components |
| `Textarea` | `TextInput` with `multiline={true}` |
| `Sidebar` | `@react-navigation/drawer` |
| `InputOTP` | `react-native-otp-entry` |

### 4.2 Custom Components — Migration Effort

| Component | File | Effort | Notes |
|---|---|---|---|
| Navbar | `src/components/Navbar.tsx` | REPLACE | Use `@react-navigation/native` header |
| Footer | `src/components/Footer.tsx` | REMOVE | Not needed in mobile app |
| MobileBottomNav | `src/components/MobileBottomNav.tsx` | REPLACE | Use `@react-navigation/bottom-tabs` |
| AdSpace | `src/components/AdSpace.tsx` | REBUILD | Must use `react-native-google-mobile-ads` or Apple-compliant ad SDK |
| ErrorBoundary | `src/components/ErrorBoundary.tsx` | PORT | Works similarly in RN |
| LoadingScreen | `src/components/LoadingScreen.tsx` | PORT | Replace with RN ActivityIndicator + branding |
| ProtectedRoute | `src/components/ProtectedRoute.tsx` | REPLACE | Use navigation guards in React Navigation |
| StormyChatBubble | `src/components/StormyChatBubble.tsx` | REBUILD | Floating action button + modal chat |
| CitrusBackground | `src/components/CitrusBackground.tsx` | REBUILD | RN gradient (`react-native-linear-gradient`) |
| PlayerStatsModal | `src/components/PlayerStatsModal.tsx` | REBUILD | RN Modal + chart replacements |
| PasswordStrength | `src/components/auth/PasswordStrength.tsx` | PORT | Simple logic, just restyle |

### 4.3 Matchup Components (21) — Heaviest Migration

All in `src/components/matchup/`. These are the most complex components with charts, live data, and animations.

| Component | Effort | Key Challenge |
|---|---|---|
| ScoreCard | Medium | Restyle only |
| DailyPointsChart | High | Recharts → victory-native |
| MatchupComparison | High | Complex layout + animations |
| MatchupSidebar | High | Becomes bottom sheet or tab on mobile |
| GameLogosBar | Medium | Image loading + layout |
| LiveUpdates | High | Real-time Supabase subscription — test on RN |
| PlayerCard | Medium | Restyle + touch interactions |
| WeeklySchedule | Medium | Calendar-like layout |
| All others (13) | Medium each | Layout + style conversions |

### 4.4 Draft Components (8) — Real-Time Critical

All in `src/components/draft/`. Real-time functionality is critical here.

| Component | Effort | Key Challenge |
|---|---|---|
| DraftBoard | High | Grid layout + real-time updates |
| DraftTimer | High | Accurate timer + background state |
| PlayerPool | High | Large list virtualization (`FlatList`) |
| DraftHistory | Medium | List view |
| DraftQueue | Medium | Drag-reorder queue |
| DraftControls | Medium | Button actions |
| DraftLobby | Medium | Waiting room with real-time user count |
| TeamRosters | Medium | Multi-team view |

---

## 5. SERVICE/BUSINESS LOGIC LAYER {#5-service-layer}

These files are **platform-agnostic** and can be reused in React Native with minimal changes.

| Service | File | RN Compatible? | Changes Needed |
|---|---|---|---|
| AuditService | `src/services/AuditService.ts` | YES | None — pure Supabase calls |
| DraftService | `src/services/DraftService.ts` | YES | None |
| LeagueService | `src/services/LeagueService.ts` | YES | None |
| MatchupService | `src/services/MatchupService.ts` | YES | None |
| NotificationService | `src/services/NotificationService.ts` | PARTIAL | Add push notification logic (APNs) |
| PlayerService | `src/services/PlayerService.ts` | YES | None |
| RosterService | `src/services/RosterService.ts` | YES | None |
| StandingsService | `src/services/StandingsService.ts` | YES | None |
| TradeService | `src/services/TradeService.ts` | YES | None |
| WaiverService | `src/services/WaiverService.ts` | YES | None |
| All others (7-8 services) | Various | YES | None |

**Key win:** ~90% of business logic is pure TypeScript + Supabase SDK calls. It ports directly.

### 5.1 State Management — Portable

| Store/Context | File | RN Compatible? |
|---|---|---|
| AuthContext | `src/contexts/AuthContext.tsx` | PARTIAL — OAuth flow needs deep-link rewrite |
| LeagueContext | `src/contexts/LeagueContext.tsx` | YES |
| Notification Store (Zustand) | `src/stores/notificationStore.ts` | YES — Zustand works in RN |
| React Query setup | Various hooks | YES — TanStack Query works in RN |

---

## 6. DATABASE & BACKEND READINESS {#6-database-backend}

### 6.1 Supabase — Fully RN Compatible

The Supabase JS SDK (`@supabase/supabase-js`) works identically in React Native. No backend changes needed for basic functionality.

**However, these database-level items must be added:**

| Required Table/Function | Purpose | Priority |
|---|---|---|
| `delete_user_account()` RPC | Server-side account deletion (Apple requirement) | CRITICAL |
| `export_user_data()` RPC | GDPR/CCPA data export | CRITICAL |
| `user_privacy_consent` table | Track ToS/Privacy acceptance per user | CRITICAL |
| `user_subscriptions` table | Track IAP subscription status | CRITICAL (if paid tiers) |
| `push_notification_tokens` table | Store APNs/FCM device tokens | HIGH |
| `user_notification_preferences` table | Per-user notification opt-in/out | HIGH |
| `content_reports` table | Report offensive team/league names | MEDIUM |

### 6.2 Supabase Auth — RN-Specific Changes

| Item | Change Needed |
|---|---|
| OAuth redirect URLs | Must register custom URL scheme (e.g., `citrus://auth/callback`) in Supabase dashboard |
| Session storage | Replace `localStorage` with `@react-native-async-storage/async-storage` — Supabase RN adapter handles this |
| Deep linking | Configure iOS Universal Links for email verification + password reset links |
| Apple Sign-In | Must use native `ASAuthorizationController` via `react-native-apple-authentication` (not web OAuth redirect) |
| Google Sign-In | Must use native Google Sign-In SDK via `@react-native-google-signin/google-signin` |

### 6.3 Supabase Realtime — Test Required

Real-time subscriptions (used in draft room, live scoring, notifications) work in RN but need testing for:
- Background/foreground transitions (iOS suspends WebSockets in background)
- Reconnection logic when app returns from background
- Battery impact of persistent connections

---

## 7. AUTHENTICATION SYSTEM {#7-authentication}

### 7.1 Current Auth Flows & Required Changes

| Flow | Current Implementation | RN Change Required |
|---|---|---|
| Email/Password Sign-Up | `AuthContext.signUp()` → Supabase | Works as-is, but add ToS consent checkbox |
| Email/Password Sign-In | `AuthContext.signIn()` → Supabase | Works as-is |
| Google OAuth | Web redirect flow via Supabase | Must use native Google Sign-In SDK |
| Apple OAuth | Web redirect flow via Supabase | **MUST** use native Apple Sign-In (Apple requires this for iOS apps) |
| Password Reset | Email link → `/reset-password` | Must handle via deep link / universal link |
| Email Verification | Email link → `/auth/callback` | Must handle via deep link / universal link |
| Session Persistence | `localStorage` (via Supabase default) | Switch to `AsyncStorage` adapter |
| Auth State Listener | `onAuthStateChange` subscription | Works in RN — ensure cleanup on unmount |
| SOC 2 Audit Logging | `AuditService.logLogin()` fire-and-forget | Works as-is |

### 7.2 Sign in with Apple — Specific Requirements (Guideline 4.8)

Since the app offers Google Sign-In, Apple **requires** Sign in with Apple as an option. Current implementation exists but needs:

1. Use `react-native-apple-authentication` native module (NOT web OAuth)
2. Use Apple's official button styling (`ASAuthorizationAppleIDButton`)
3. Handle Apple's "Hide My Email" relay — app must work with private relay emails
4. Handle Apple's "name sharing" — first sign-in only provides name; must cache it
5. Must be positioned as prominently as Google Sign-In (same size, same section)

---

## 8. THIRD-PARTY DEPENDENCIES — RN EQUIVALENTS {#8-dependencies}

### 8.1 Direct Replacements Needed

| Web Package | Version | React Native Replacement | Notes |
|---|---|---|---|
| `react-router-dom` | 6.26.2 | `@react-navigation/native` + stack/tab/drawer | Complete navigation rewrite |
| `@radix-ui/*` (15 packages) | Various | See Component Map (Section 4.1) | All must be replaced |
| `recharts` | 2.12.7 | `victory-native` or `react-native-chart-kit` | All charts must be rewritten |
| `embla-carousel-react` | 8.3.0 | `react-native-reanimated-carousel` | Carousel rebuild |
| `@dnd-kit/*` (3 packages) | 6.3.1 | `react-native-draggable-flatlist` | Drag-and-drop roster management |
| `sonner` | 1.5.0 | `react-native-toast-message` | Toast notifications |
| `cmdk` | 1.0.0 | Custom search component | Command palette not standard on mobile |
| `vaul` | 0.9.3 | `@gorhom/bottom-sheet` | Drawer/sheet component |
| `react-day-picker` | 8.10.1 | `react-native-calendars` | Date picker |
| `react-resizable-panels` | 2.1.3 | N/A — not applicable on mobile | Remove, use tabs/stacks instead |
| `next-themes` | 0.3.0 | `react-native` Appearance API | Dark mode |
| `tailwindcss` | 3.4.11 | `nativewind` (Tailwind for RN) OR `StyleSheet.create` | Complete style system change |
| `lucide-react` | 0.462.0 | `lucide-react-native` | Direct equivalent exists |
| `input-otp` | 1.2.4 | `react-native-otp-entry` | OTP input |

### 8.2 Packages That Work As-Is in RN

| Package | Version | Notes |
|---|---|---|
| `@supabase/supabase-js` | 2.56.1 | Works with AsyncStorage adapter |
| `@tanstack/react-query` | 5.56.2 | Works identically in RN |
| `zustand` | 5.0.9 | Works identically in RN |
| `zod` | 3.23.8 | Works identically in RN |
| `react-hook-form` | 7.53.0 | Works identically in RN |
| `@hookform/resolvers` | 3.9.0 | Works identically in RN |
| `date-fns` | 4.1.0 | Works identically in RN |
| `class-variance-authority` | 0.7.1 | Works if using NativeWind |
| `clsx` | 2.1.1 | Works if using NativeWind |

### 8.3 NEW Dependencies Required for iOS

| Package | Purpose |
|---|---|
| `react-native` | Core framework |
| `expo` | Recommended managed workflow |
| `@react-navigation/native` | Navigation |
| `@react-navigation/stack` | Stack navigation |
| `@react-navigation/bottom-tabs` | Bottom tab bar |
| `react-native-screens` | Native screen optimization |
| `react-native-safe-area-context` | Safe area handling (notch, etc.) |
| `react-native-gesture-handler` | Touch/gesture handling |
| `react-native-reanimated` | Animations |
| `@react-native-async-storage/async-storage` | Persistent storage (replaces localStorage) |
| `react-native-apple-authentication` | Sign in with Apple |
| `@react-native-google-signin/google-signin` | Google Sign-In |
| `react-native-push-notification` or `expo-notifications` | Push notifications |
| `react-native-splash-screen` or `expo-splash-screen` | Launch screen |
| `react-native-svg` | SVG support (for icons, charts) |
| `react-native-webview` | For Privacy/Terms pages |
| `react-native-google-mobile-ads` | Ads (if ad-supported tier) |
| `react-native-iap` or `expo-in-app-purchases` | Apple In-App Purchases |
| `@react-native-firebase/app` | Firebase (if keeping analytics) |
| `react-native-keychain` | Secure credential storage |

---

## 9. ASSET & MEDIA INVENTORY {#9-assets}

### 9.1 App Icons Required for iOS Submission

| Asset | Required Size | Current State | Action |
|---|---|---|---|
| App Icon | 1024x1024 (no transparency, no rounded corners) | `og-image.png` is 512x512 | Must create 1024x1024 icon |
| App Icon (all sizes) | 20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024 | NOT GENERATED | Generate full icon set (Xcode asset catalog) |
| `apple-touch-icon.png` | 180x180 | **MISSING** — referenced in HTML but file doesn't exist | Must create |
| Launch Screen | Storyboard or image set | NOT CREATED | Must create iOS launch screen |

### 9.2 Existing Assets to Bundle

| Asset | File | Size | Bundle? |
|---|---|---|---|
| Loading Citrus | `public/loading-citrus.png` | 192x192 | YES — loading/splash |
| Loading Narwhal | `public/loading-narwhal.png` | 192x192 | YES — alternate loading |
| Favicon | `public/favicon.ico` | 48x48 | NO — web only |
| OG Image | `public/og-image.png` | 512x512 | NO — web only |
| Placeholder SVG | `public/placeholder.svg` | N/A | YES — fallback images |
| Citrus brand images | `assets/images/Gemini_Generated_Image_*.png` | Various | REVIEW — bundle selectively |

### 9.3 External Image Loading

| Image Type | Source | RN Handling |
|---|---|---|
| NHL Player Headshots | `https://assets.nhle.com/mugs/nhl/...` | Use `Image` component with `uri` source + cache (`react-native-fast-image`) |
| Team Logos | Various NHL CDN URLs | Same — cache aggressively |

### 9.4 App Store Screenshots Required

| Device | Required | Count |
|---|---|---|
| iPhone 6.7" (15 Pro Max) | YES | 3-10 screenshots |
| iPhone 6.5" (11 Pro Max) | YES | 3-10 screenshots |
| iPhone 5.5" (8 Plus) | Optional but recommended | 3-10 screenshots |
| iPad Pro 12.9" (6th gen) | Required if universal app | 3-10 screenshots |
| iPad Pro 12.9" (2nd gen) | Required if universal app | 3-10 screenshots |

---

## 10. iOS-SPECIFIC REQUIREMENTS {#10-ios-specific}

### 10.1 Apple Human Interface Guidelines (HIG) Compliance

| HIG Requirement | Action Needed |
|---|---|
| Safe Area insets | All screens must respect notch, Dynamic Island, home indicator |
| Navigation patterns | Use native iOS navigation (push/pop stacks, tab bars, modals) — not web-style routing |
| Tab bar | Maximum 5 tabs. Suggested: Home, Matchup, Roster, Draft, More |
| Back button | Must use iOS system back button (not custom) |
| Pull-to-refresh | Add to all data-driven screens (matchups, standings, roster) |
| Haptic feedback | Add for key interactions (draft pick, trade confirm, roster lock) |
| Dark mode | Must support iOS system dark mode (`Appearance` API) |
| Dynamic Type | Support iOS text size accessibility settings |
| VoiceOver | All interactive elements need accessibility labels |
| Keyboard handling | Forms must scroll to avoid keyboard overlap (`KeyboardAvoidingView`) |
| Status bar | Must adapt to light/dark contexts |
| Loading states | Use native `ActivityIndicator` or skeleton screens — no web spinners |

### 10.2 iOS Capabilities Required (Xcode)

| Capability | Purpose | Entitlement |
|---|---|---|
| Sign in with Apple | Authentication | `com.apple.developer.applesignin` |
| Push Notifications | Alerts for draft, trades, scores | `aps-environment` |
| Associated Domains | Deep links for email verification, password reset | `com.apple.developer.associated-domains` |
| In-App Purchase | Subscriptions (if paid tiers) | `com.apple.developer.in-app-payments` |
| Background Modes | Background fetch for scores (optional) | `com.apple.developer.background-modes` |

### 10.3 Info.plist Required Entries

| Key | Value | Why |
|---|---|---|
| `NSAppTransportSecurity` | Allow Supabase + NHL API domains | Network access |
| `CFBundleURLSchemes` | `citrus` (for deep links) | OAuth callbacks, email links |
| `LSApplicationQueriesSchemes` | If linking to other apps | Optional |
| `ITSAppUsesNonExemptEncryption` | `NO` (standard HTTPS only) | Export compliance |
| `NSUserTrackingUsageDescription` | Only if using ATT | Tracking permission prompt text |
| `UIBackgroundModes` | `remote-notification`, `fetch` (if needed) | Push + background refresh |
| `UILaunchStoryboardName` | Launch screen storyboard | Required |
| `UISupportedInterfaceOrientations` | Portrait preferred for phone | Orientation lock |

### 10.4 iOS Version & Device Support

| Requirement | Recommendation |
|---|---|
| Minimum iOS version | iOS 15.0 (supports 95%+ of active devices) |
| iPhone support | Required |
| iPad support | Recommended (universal app ranks higher) |
| Bitcode | No longer required (deprecated in Xcode 14) |

---

## 11. APP STORE METADATA REQUIREMENTS {#11-metadata}

Everything needed in App Store Connect before submission:

| Field | Status | Notes |
|---|---|---|
| App Name | NEEDED | "Citrus Fantasy Hockey" (max 30 chars) |
| Subtitle | NEEDED | e.g., "AI-Powered Fantasy Hockey" (max 30 chars) |
| Category | NEEDED | Primary: Sports, Secondary: Games |
| Age Rating | NEEDED | Likely 12+ (fantasy sports competition) |
| Privacy Policy URL | READY | `https://citrus-fantasy-sports.web.app/privacy-policy.html` |
| Support URL | NEEDED | Must be a working URL with real contact method |
| Marketing URL | OPTIONAL | Website URL |
| Description | NEEDED | Max 4000 chars, first 3 lines most visible |
| Keywords | NEEDED | Max 100 chars, comma-separated |
| What's New | NEEDED | Release notes for each version |
| Screenshots | NEEDED | See Section 9.4 |
| App Preview Video | OPTIONAL | 15-30 second video showing key features |
| App Icon | NEEDED | 1024x1024 PNG, no alpha |
| Copyright | NEEDED | e.g., "2026 Citrus Fantasy Hockey" |
| Contact Information | NEEDED | Real name, address, phone for developer |
| Demo Account | NEEDED | Apple reviewer needs login credentials. Create a demo account with populated league data. |
| Notes for Reviewer | RECOMMENDED | Explain fantasy sports mechanics, note it's free (no gambling), provide demo league instructions |

### 11.1 App Store Privacy Nutrition Label

Must declare in App Store Connect:

| Data Type | Collected? | Linked to User? | Used for Tracking? |
|---|---|---|---|
| Email Address | YES | YES | NO |
| Name | YES (optional) | YES | NO |
| Phone Number | YES (optional) | YES | NO |
| Coarse Location | YES (optional, text) | YES | NO |
| User ID | YES | YES | NO |
| Game Content (rosters, etc.) | YES | YES | NO |
| Browsing History | NO | N/A | N/A |
| Search History | NO | N/A | N/A |
| Diagnostics/Crash Data | YES (if Firebase) | NO | NO |
| Performance Data | YES (if Firebase) | NO | NO |

---

## SUMMARY: PRIORITY EXECUTION ORDER

### Phase 0 — Pre-Migration Fixes (Do Before Writing Any RN Code)

1. Fix `Settings.tsx` duplicate `AdSpace` import (build error)
2. Replace `[Your State/Country]` placeholder in Terms of Service
3. Remove fake contact info or replace with real info
4. Fix dead social media links (remove or point to real profiles)
5. Wire contact form to actual backend
6. Consolidate Privacy Policy (React page vs HTML page mismatch)
7. Create `delete_user_account()` Supabase RPC function
8. Create `user_privacy_consent` database table
9. Add ToS/Privacy acceptance to signup flow

### Phase 1 — React Native Project Setup

1. Initialize RN project (Expo recommended: `npx create-expo-app`)
2. Configure navigation (`@react-navigation/native`)
3. Set up Supabase client with AsyncStorage adapter
4. Configure deep linking scheme (`citrus://`)
5. Set up NativeWind or StyleSheet system
6. Port service layer (copy `src/services/` — mostly works as-is)
7. Port state management (AuthContext, LeagueContext, Zustand store)

### Phase 2 — Core Auth Screens

1. Build Auth screen with native Apple Sign-In + Google Sign-In
2. Build Profile Setup screen
3. Build Settings screen with account deletion
4. Configure deep link handling for email verification + password reset
5. Test full auth flow end-to-end

### Phase 3 — Core Game Screens

1. League Dashboard
2. Roster Management (with drag-and-drop replacement)
3. Matchup View (with chart replacements)
4. Standings
5. Free Agents + Waiver Wire
6. Draft Room (real-time critical — test extensively)

### Phase 4 — Apple Compliance

1. Implement In-App Purchases (if launching with paid tiers)
2. Add push notification support
3. Complete App Store Privacy Nutrition Label
4. Generate all required app icons and screenshots
5. Create launch screen
6. Create demo account for Apple reviewer
7. Prepare App Store metadata

### Phase 5 — Pre-Submission QA

1. Test on physical iPhone (not just simulator)
2. Test on minimum supported iOS version
3. Test all deep links
4. Test app backgrounding/foregrounding (WebSocket reconnection)
5. Test account deletion end-to-end
6. Test Sign in with Apple "Hide My Email"
7. Run Xcode Accessibility audit
8. Run Apple's App Store validation in Xcode
9. Submit for TestFlight review first
10. Address any TestFlight feedback before production submission

---

## FILES REFERENCED IN THIS AUDIT

```
src/pages/Auth.tsx
src/pages/Pricing.tsx
src/pages/Privacy.tsx
src/pages/Terms.tsx
src/pages/Settings.tsx
src/pages/ProfileSetup.tsx
src/pages/Contact.tsx
src/pages/Index.tsx
src/contexts/AuthContext.tsx
src/contexts/LeagueContext.tsx
src/integrations/supabase/client.ts
src/components/AdSpace.tsx
src/components/Navbar.tsx
src/components/MobileBottomNav.tsx
src/components/ErrorBoundary.tsx
src/components/matchup/* (21 components)
src/components/draft/* (8 components)
src/components/roster/* (4 components)
src/components/mobile/* (6 components)
src/components/ui/* (48 shadcn components)
src/services/* (17 service files)
src/stores/notificationStore.ts
public/manifest.json
public/privacy-policy.html
public/terms-of-service.html
public/robots.txt
supabase/migrations/* (145+ files)
package.json
firebase.json
tailwind.config.ts
vite.config.ts
```

---

*This checklist was generated by a full audit of the citrus-league-storm-main codebase. No code was modified.*
