# Firebase Analytics Debugging Guide

## Quick Diagnostic Steps

### 1. Check Browser Console

Open your site (`www.citrusfantasysports.com`) and press **F12** to open DevTools, then check the **Console** tab.

**Look for:**
- ✅ `✅ Firebase Analytics initialized successfully` - Good!
- ⚠️ `⚠️ Firebase Analytics: Missing required config` - Config not loaded
- ⚠️ `⚠️ Analytics not initialized - page view not tracked` - Analytics failed to initialize
- ⚠️ `⚠️ Firebase Analytics not supported in this browser` - Browser issue

### 2. Test Analytics Manually

In the browser console on your site, run:

```javascript
// Check if analytics is initialized
import { getAnalyticsInstance } from '@/integrations/firebase/config';
console.log('Analytics instance:', getAnalyticsInstance());

// Try to log an event manually
import { analyticsService } from '@/services/AnalyticsService';
analyticsService.logEvent('test_event', { test: true });
```

### 3. Check Environment Variables

In the browser console, check if environment variables are loaded:

```javascript
console.log('API Key:', import.meta.env.VITE_FIREBASE_API_KEY ? '✅ Set' : '❌ Missing');
console.log('App ID:', import.meta.env.VITE_FIREBASE_APP_ID ? '✅ Set' : '❌ Missing');
console.log('Measurement ID:', import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ? '✅ Set' : '❌ Missing');
```

**If they're all `undefined`:** The `.env` file wasn't included in the build. You need to rebuild.

### 4. Check Firebase Console Settings

1. **Authorized Domains:**
   - Go to Firebase Console → Authentication → Settings → Authorized domains
   - Make sure `www.citrusfantasysports.com` is listed
   - Also check `citrusfantasysports.com` (without www)

2. **Analytics Enabled:**
   - Go to Firebase Console → Analytics
   - Make sure Analytics is enabled for your project

3. **Measurement ID:**
   - Go to Firebase Console → Project Settings → General
   - Scroll to "Your apps" → Web app
   - Verify the `measurementId` matches your `.env` file

### 5. Common Issues

#### Issue: Environment variables are `undefined` in production

**Cause:** `.env` file wasn't present when you ran `npm run build`

**Fix:**
1. Make sure `.env` file exists in project root
2. Rebuild: `npm run build`
3. Redeploy: `firebase deploy --only hosting`

#### Issue: "Analytics not initialized" in console

**Possible causes:**
- Domain not authorized in Firebase
- Ad blocker blocking Firebase Analytics
- Browser privacy settings blocking analytics
- Invalid Firebase config

**Fix:**
1. Add domain to Firebase authorized domains
2. Disable ad blocker and test
3. Check browser console for specific errors
4. Verify all Firebase config values in `.env`

#### Issue: Events not showing in Firebase Console

**Possible causes:**
- Analytics takes 24-48 hours for some reports (but Realtime should work immediately)
- Domain not authorized
- Wrong Firebase project

**Fix:**
1. Check Firebase Console → Analytics → **Realtime** (not Reports)
2. Realtime events should appear within seconds
3. If Realtime shows 0, check authorized domains

### 6. Network Tab Check

1. Open DevTools → **Network** tab
2. Filter by "analytics" or "google-analytics"
3. Look for requests to:
   - `google-analytics.com`
   - `analytics.google.com`
   - `firebase-analytics.com`

**If you see these requests:** Analytics is working, data is being sent.

**If you don't see these requests:** Analytics isn't initializing or is being blocked.

### 7. Ad Blocker Check

Many ad blockers block Firebase Analytics. Test by:
1. Opening site in **Incognito/Private mode**
2. Disabling ad blocker
3. Checking if events appear

### 8. Verify Build Includes Config

Check the built JavaScript file:
1. Go to your site
2. View page source
3. Search for your Firebase API key (first few characters)
4. If found: Config is in the build ✅
5. If not found: Config wasn't included in build ❌

## Still Not Working?

If after all these checks you still see 0 events:

1. **Double-check `.env` file:**
   - All variables start with `VITE_`
   - No typos in variable names
   - Values are complete (not truncated)

2. **Rebuild from scratch:**
   ```bash
   rm -rf dist node_modules/.vite
   npm run build
   firebase deploy --only hosting
   ```

3. **Check Firebase project:**
   - Make sure you're looking at the correct Firebase project
   - Verify project ID matches: `citrus-fantasy-sports`

4. **Contact support:**
   - Share browser console errors
   - Share Network tab screenshots
   - Share Firebase Console authorized domains list
