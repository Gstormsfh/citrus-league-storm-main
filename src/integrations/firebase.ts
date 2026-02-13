// Firebase Analytics — lightweight, fire-and-forget
// import { analytics, logEvent } from "@/integrations/firebase";
import { initializeApp } from "firebase/app";
import { getAnalytics, logEvent as firebaseLogEvent, isSupported } from "firebase/analytics";
import type { Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "citrus-fantasy-sports.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "citrus-fantasy-sports",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "citrus-fantasy-sports.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

// Analytics initializes async — not supported in all environments (SSR, some browsers)
let analytics: Analytics | null = null;

isSupported()
  .then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  })
  .catch(() => {
    // Silent — analytics is non-critical
  });

/**
 * Safe wrapper around Firebase logEvent.
 * No-ops if analytics isn't available (dev, SSR, ad-blockers).
 */
function logEvent(eventName: string, params?: Record<string, unknown>): void {
  if (analytics) {
    firebaseLogEvent(analytics, eventName, params);
  }
}

export { analytics, logEvent };
