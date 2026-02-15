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

// Check if we have the minimum required config to initialize Firebase
const hasValidConfig = !!(firebaseConfig.apiKey && firebaseConfig.appId && firebaseConfig.projectId);

// Initialize Firebase (only if config is valid and not already initialized)
let app: FirebaseApp | null = null;
if (hasValidConfig) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  } catch {
    // Firebase init failed — analytics disabled silently
  }
}

// Initialize Analytics (only in browser environment, if supported, and if Firebase is initialized)
let analytics: Analytics | null = null;

// Function to get analytics instance (handles async initialization)
export const getAnalyticsInstance = (): Analytics | null => {
  return analytics;
};

// Initialize analytics — fully guarded so it can never crash the app
if (typeof window !== 'undefined' && app && hasValidConfig) {
  isSupported()
    .then((supported) => {
      if (supported && app) {
        try {
          analytics = getAnalytics(app);
        } catch {
          // Silently fail — analytics is non-critical
        }
      }
    })
    .catch(() => {
      // isSupported check failed — skip analytics
    });
}

export { app, analytics };
export default app;
