// Firebase configuration
// Get these values from Firebase Console > Project Settings > General > Your apps
// All values come from VITE_FIREBASE_* environment variables (set in .env)

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAnalytics, Analytics, isSupported, setAnalyticsCollectionEnabled, setUserId } from 'firebase/analytics';

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

// Cookie consent key used by the consent banner
const CONSENT_KEY = 'citrus_analytics_consent';
export const ANALYTICS_CONSENT_EVENT = 'citrus:analytics-consent';

function hasAnalyticsConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

// Initialize Analytics (only after user consent)
let analytics: Analytics | null = null;

export const getAnalyticsInstance = (): Analytics | null => hasAnalyticsConsent() ? analytics : null;

function initAnalytics() {
  if (typeof window === 'undefined' || !app || analytics) return;
  isSupported()
    .then((supported) => {
      if (supported && app && !analytics && hasAnalyticsConsent()) {
        try {
          analytics = initializeAnalytics(app, { config: {
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
          } });
          setAnalyticsCollectionEnabled(analytics, true);
        } catch {
          // Silently fail
        }
      }
    })
    .catch(() => {});
}

// Auto-init only if consent was previously granted
if (hasAnalyticsConsent()) {
  initAnalytics();
}

/**
 * Call after user grants analytics consent.
 * Persists the choice and boots Firebase Analytics.
 */
export function grantAnalyticsConsent() {
  try { localStorage.setItem(CONSENT_KEY, 'granted'); } catch { /* noop */ }
  if (analytics) setAnalyticsCollectionEnabled(analytics, true);
  else initAnalytics();
  window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
}

/**
 * Call if user declines analytics.
 */
export function denyAnalyticsConsent() {
  try { localStorage.setItem(CONSENT_KEY, 'denied'); } catch { /* noop */ }
  if (analytics) {
    setAnalyticsCollectionEnabled(analytics, false);
    setUserId(analytics, null);
  }
  window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
}

/**
 * Check if the user has made a consent choice yet.
 */
export function hasConsentChoice(): boolean {
  try {
    const val = localStorage.getItem(CONSENT_KEY);
    return val === 'granted' || val === 'denied';
  } catch {
    return false;
  }
}

export { app, analytics };
export default app;
