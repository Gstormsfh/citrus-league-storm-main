// Firebase configuration
// Get these values from Firebase Console > Project Settings > General > Your apps
// Or from Firebase Console > Project Settings > General > SDK setup and configuration

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAnalytics, Analytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDvNht3HFeikaT_gS4PQDCKl2LpxgLZL34',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'citrus-fantasy-sports.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'citrus-fantasy-sports',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'citrus-fantasy-sports.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '565653385598',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:565653385598:web:b1bb4ccd62ebda2c92432f',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-444BMD2Z3P',
};

// Validate Firebase config in development
if (import.meta.env.DEV) {
  const requiredFields = ['apiKey', 'appId', 'measurementId'];
  const missingFields = requiredFields.filter(field => !firebaseConfig[field as keyof typeof firebaseConfig]);
  if (missingFields.length > 0) {
    console.warn('⚠️ Firebase Analytics: Missing required config fields:', missingFields);
    console.warn('Make sure your .env file has all VITE_FIREBASE_* variables set');
  }
}

// Initialize Firebase (only if not already initialized)
let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Initialize Analytics (only in browser environment and if supported)
let analytics: Analytics | null = null;

// Function to get analytics instance (handles async initialization)
export const getAnalyticsInstance = (): Analytics | null => {
  return analytics;
};

// Initialize analytics synchronously if possible, otherwise async
if (typeof window !== 'undefined') {
  try {
    // Try to initialize immediately (works in most cases)
    analytics = getAnalytics(app);
  } catch (error) {
    // If that fails, try async initialization
    isSupported().then((supported) => {
      if (supported) {
        try {
          analytics = getAnalytics(app);
        } catch (err) {
          // Analytics already initialized or error occurred
          console.warn('Firebase Analytics initialization warning:', err);
        }
      }
    }).catch(() => {
      // Analytics not supported or error during initialization
      // This is fine - analytics will gracefully fail
    });
  }
}

export { app, analytics };
export default app;
