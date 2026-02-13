# Firebase Analytics Setup Guide

Firebase Analytics has been installed and integrated into the project. Follow these steps to complete the setup:

## Step 1: Get Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **citrus-fantasy-sports**
3. Click the gear icon ⚙️ next to "Project Overview"
4. Select **Project Settings**
5. Scroll down to **Your apps** section
6. If you don't have a web app, click **Add app** > **Web** (</> icon)
7. Register your app (you can name it "Citrus Fantasy Sports Web")
8. Copy the Firebase configuration object

## Step 2: Add Environment Variables

Create a `.env` file in the root directory (if it doesn't exist) and add:

```env
# Firebase Configuration (for Analytics)
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=citrus-fantasy-sports.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=citrus-fantasy-sports
VITE_FIREBASE_STORAGE_BUCKET=citrus-fantasy-sports.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id_here
VITE_FIREBASE_APP_ID=your_app_id_here
VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
```

**Important:** The `VITE_FIREBASE_MEASUREMENT_ID` is required for Analytics. You can find it in:
- Firebase Console > Project Settings > General > Your apps > Web app
- Or in Firebase Console > Analytics > Settings

## Step 3: Enable Google Analytics

1. In Firebase Console, go to **Analytics** in the left sidebar
2. If not already enabled, click **Get Started**
3. Select or create a Google Analytics account
4. Accept the terms and enable Analytics

## Step 4: Verify Setup

After adding the environment variables:

1. Restart your development server (`npm run dev`)
2. Open the browser console
3. Check for any Firebase initialization errors
4. Visit your app and check Firebase Console > Analytics > Realtime to see events

## What's Already Integrated

The following analytics tracking is already set up:

- ✅ **Page Views**: Automatically tracked on route changes
- ✅ **User Identification**: User ID set when users log in/out
- ✅ **Analytics Service**: Ready-to-use service for custom events

## Using Analytics in Your Code

```typescript
import { analyticsService } from '@/services/AnalyticsService';

// Log a custom event
analyticsService.logEvent('button_click', {
  button_name: 'draft_player',
  player_id: '123',
});

// Track draft events
analyticsService.logDraftEvent('pick_made', {
  round: 1,
  pick_number: 5,
  player_id: '123',
});

// Track league events
analyticsService.logLeagueEvent('league_created', 'league-id-123', {
  team_count: 10,
  draft_rounds: 21,
});
```

## Available Analytics Methods

- `logEvent(name, parameters)` - Generic event logging
- `logPageView(pageName, pagePath)` - Page view tracking
- `logUserAction(action, details)` - User action tracking
- `logDraftEvent(eventType, details)` - Draft-specific events
- `logLeagueEvent(eventType, leagueId, details)` - League-specific events
- `logRosterEvent(eventType, details)` - Roster-specific events
- `logMatchupEvent(eventType, details)` - Matchup-specific events
- `setUserId(userId)` - Set user ID for analytics
- `setUserProperties(properties)` - Set user properties

## Notes

- Analytics only works in browser environment (not SSR)
- Analytics will silently fail if Firebase is not configured (won't break the app)
- All analytics calls are wrapped in try-catch to prevent errors
