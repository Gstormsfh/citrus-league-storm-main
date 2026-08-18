# iOS build — from zero to device (Mac day)

The scaffold in `apps/web/ios/` is Capacitor 8, **Swift Package Manager** based —
no CocoaPods, nothing to install beyond Xcode itself.

## One-time setup (on the Mac)

```bash
cd citrus-league-storm-phase45
npm install                      # picks up @capacitor/* added 2026-08-15
cd apps/web
npm run ios:sync                 # build:native (asserts env!) + cap sync
npm run ios:open                 # opens Xcode
```

**`ios:sync` now runs `scripts/build-native.mjs`, which REFUSES to build if:**
the Supabase env vars aren't baked into the bundle (that build white-screens),
**`VITE_API_URL` is unset** (every API call fails inside the shell — relative
`/api/*` has no Firebase rewrite on `capacitor://localhost`; add the absolute
Cloud Run origin to `.env`), or the AdSense tag survived the native strip
(AdSense is prohibited in native apps; the web build keeps it).

**Two-click manifest step (once, in Xcode):** drag
`ios/App/App/PrivacyInfo.xcprivacy` into the App group and tick App target
membership. Apple cross-checks it against your App Store Connect privacy
labels (ITMS-91053). Also: submissions now require **Xcode 16 / iOS 18 SDK**.

In Xcode: select the App target → Signing & Capabilities → set your Team
(requires the Apple Developer account). Bundle ID is already
`com.citrussports.app` — settle this NOW; changing it after the App Store
Connect record exists is painful.

Then ⌘R on a simulator, or a plugged-in iPhone.

## Every subsequent web change

```bash
npm run ios:sync    # rebuild web + re-copy. The shell can never ship stale.
```

## The two known engineering items (Tue plan)

1. **OAuth redirect — CODE DONE (2026-08-15).** `src/lib/nativeAuth.ts` +
   the platform branch in `AuthContext.signInWithOAuth`; the
   `citrussports://` scheme is registered in Info.plist. 7 unit tests pin
   that the WEB login path is byte-for-byte unchanged. Two steps remain:
   (a) **Supabase dashboard, one minute:** Auth → URL Configuration →
   Redirect URLs → add `citrussports://auth-callback`;
   (b) verify the round trip on a real device Tuesday — the only part
   that cannot be tested without the shell.
2. **Push notifications** (`@capacitor/push-notifications` + APNs key) —
   draft-turn alerts. This is also our substance answer to App Review
   guideline 4.2 ("more than a repackaged website").

## Icons / splash — DONE (2026-08-16), do not regenerate

Real CitrusSports art is installed and verified end-to-end: the citrus-slice
mark (rendered from `public/favicon.svg`) as the 1024×1024 App Store icon on
the forest field, and a matching 2732² splash in all three scale slots.
Chain confirmed on-disk: Contents.json filenames match, LaunchScreen.storyboard
references the `Splash` imageset, pbxproj compiles the catalog with
`ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`, and `cap sync` does not touch
the asset catalog, so the art survives every rebuild.

**Do NOT run `npx @capacitor/assets generate`** — it overwrites this catalog.
Only reach for it if you deliberately replace the brand art, and re-verify the
three checks above afterwards. Sanity check in Xcode: the icon shows in the
App target's General tab the moment the project opens.

## What NOT to do

- Don't point the shell at a remote URL (`server.url`) for the store build —
  bundled `dist/` is the Apple-preferred shape and what this config does.
- Don't rename the appId casually (see above).
