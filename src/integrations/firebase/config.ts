// Firebase configuration
// Get these values from Firebase Console > Project Settings > General > Your apps
// All values come from VITE_FIREBASE_* environment variables (set in .env)

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAnalytics, Analytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

// Firebase API keys always start with "AIzaSy" — if it doesn't match, the key
// is missing or invalid and we must NOT call initializeApp (which would trigger
// the Installations service and throw an uncatchable async 400 error).
const apiKeyLooksValid = typeof firebaseConfig.apiKey === 'string'
  && firebaseConfig.apiKey.startsWith('AIzaSy')
  && firebaseConfig.apiKey.length > 20;

const hasValidConfig = apiKeyLooksValid
  && !!firebaseConfig.appId
  && !!firebaseConfig.projectId;

// Initialize Firebase (only if config is fully valid)
let app: FirebaseApp | null = null;
if (hasValidConfig) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  } catch {
    // Firebase init failed — analytics disabled silently
    app = null;
  }
}

// Initialize Analytics
let analytics: Analytics | null = null;

export const getAnalyticsInstance = (): Analytics | null => analytics;

if (typeof window !== 'undefined' && app) {
  isSupported()
    .then((supported) => {
      if (supported && app) {
        try {
          analytics = getAnalytics(app);
        } catch {
          // Silently fail
        }
      }
    })
    .catch(() => {});
}

export { app, analytics };
export default app;
