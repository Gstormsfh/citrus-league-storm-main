# Firebase Analytics Troubleshooting

## Issue: Analytics showing 0 events in Firebase Dashboard

### Common Causes & Solutions

#### 1. Environment Variables Not Available in Production

**Problem:** `.env` file is only for local development. In production (Firebase Hosting), environment variables need to be set differently.

**Solution:** For Firebase Hosting, you have two options:

**Option A: Set environment variables in Firebase Hosting (Recommended)**
1. Go to Firebase Console > Hosting
2. Click on your site
3. Go to Settings > Environment Variables
4. Add all your `VITE_FIREBASE_*` variables (without the `VITE_` prefix won't work - Vite needs the prefix)
5. Redeploy

**Option B: Use Firebase Hosting Build Configuration**
Create a `firebase.json` with build configuration, or set environment variables in your CI/CD pipeline before building.

**Option C: Hardcode config for production (Not recommended for security)**
Only if the values are safe to expose (they are for Firebase config).

#### 2. Missing measurementId

**Problem:** `VITE_FIREBASE_MEASUREMENT_ID` is required for Analytics but might be missing.

**Solution:**
1. Go to Firebase Console > Project Settings > General
2. Scroll to "Your apps" section
3. Click on your Web app
4. Find the `measurementId` (starts with `G-`)
5. Add it to your `.env` file as `VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX`

#### 3. Analytics Not Initializing

**Check in Browser Console:**
1. Open your site (citrusfantasysports.com)
2. Open browser DevTools (F12)
3. Go to Console tab
4. Look for:
   - Firebase initialization errors
   - "Firebase Analytics initialization warning" messages
   - Any errors related to `getAnalytics`

**Test Analytics Manually:**
```javascript
// In browser console on your site:
import { analyticsService } from '@/services/AnalyticsService';
analyticsService.logEvent('test_event', { test: true });
```

#### 4. Domain Not Authorized

**Problem:** Firebase Analytics might block events from unauthorized domains.

**Solution:**
1. Go to Firebase Console > Project Settings > General
2. Scroll to "Your apps" section
3. Click on your Web app
4. Under "Authorized domains", make sure `citrusfantasysports.com` is listed
5. If not, add it

#### 5. Ad Blockers

**Problem:** Browser ad blockers can block Firebase Analytics.

**Solution:**
- Test in incognito mode with ad blockers disabled
- Check if events appear when ad blocker is off

### Quick Diagnostic Steps

1. **Check if config is loaded:**
   ```javascript
   // In browser console:
   console.log('API Key:', import.meta.env.VITE_FIREBASE_API_KEY);
   console.log('Measurement ID:', import.meta.env.VITE_FIREBASE_MEASUREMENT_ID);
   ```
   If these are `undefined`, environment variables aren't being loaded.

2. **Check if Analytics is initialized:**
   ```javascript
   // In browser console:
   import { getAnalyticsInstance } from '@/integrations/firebase/config';
   console.log('Analytics:', getAnalyticsInstance());
   ```
   Should not be `null` if properly initialized.

3. **Check Firebase Console:**
   - Go to Firebase Console > Analytics > Realtime
   - Should show events within seconds of page load
   - If nothing appears, Analytics isn't working

### For Production Deployment

Since you're using Firebase Hosting, the environment variables need to be available at **build time**, not runtime. Vite bakes environment variables into the build.

**To fix production:**
1. Make sure `.env` file has all values
2. Rebuild: `npm run build`
3. Redeploy: `firebase deploy --only hosting`

The environment variables are embedded in the JavaScript bundle during build, so they need to be in `.env` when you run `npm run build`.
