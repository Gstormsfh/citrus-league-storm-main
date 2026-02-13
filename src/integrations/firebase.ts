// Firebase Analytics — lightweight, fire-and-forget
// import { analytics, logEvent } from "@/integrations/firebase";
import { initializeApp } from "firebase/app";
import { getAnalytics, logEvent as firebaseLogEvent, isSupported } from "firebase/analytics";
import type { Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDvNht3HFeikaT_gS4PQDCKl2LpxgLZL34",
  authDomain: "citrus-fantasy-sports.firebaseapp.com",
  projectId: "citrus-fantasy-sports",
  storageBucket: "citrus-fantasy-sports.firebasestorage.app",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:565653385598:web:b1bb4ccd62ebda2c92432f",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-444BMD2Z3P",
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
