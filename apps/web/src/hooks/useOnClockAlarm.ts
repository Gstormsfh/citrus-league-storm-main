// DR-4 (2026-07-30) — on-clock alarm system.
//
// Reaches a user whose attention is elsewhere (another tab, another
// window). Three channels, all stopped the instant the pick lands,
// the clock expires, or the tab regains focus:
//
//   1. document.title flash — alternates "⏰ YOUR PICK — Citrus" with
//      the original title while amIOnClock && document.hidden.
//   2. Browser Notification — fires ONCE on the amIOnClock transition
//      to true, if Notification.permission === 'granted'. If 'default',
//      the caller can prompt via `requestNotificationPermission` (opt-
//      in, never nag). If 'denied', silent no-op.
//   3. Short sound — plays ONCE on the transition, only if tab is
//      hidden AND the mute toggle is not set. Autoplay-policy
//      rejections are swallowed silently (never surface an audio
//      error to a drafter).
//
// Mute toggle persists to localStorage under
// `citrus.draft.alarm.muted` (default: unmuted).

import { useEffect, useRef, useState, useCallback } from 'react';

const TITLE_FLASH_TEXT = '⏰ YOUR PICK — Citrus';
const TITLE_FLASH_INTERVAL_MS = 900;
const MUTE_STORAGE_KEY = 'citrus.draft.alarm.muted';

// A short data-URI beep (400Hz sine, ~150ms). Encoded WAV keeps the
// hook self-contained — no static asset to bundle or 404 on.
// Kept small (~2KB base64) so it's cheap to load.
const BEEP_DATA_URI =
  'data:audio/wav;base64,UklGRnQGAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YVAGAAAAAP8HpQ82F0IemyOFJ68pACpFKREnRSSMII8bmxYuEQwLQwRb/aX2C/DK6VLkoN9j2yzYENVs0kzQyM7YzWzNmM1IzoDPRNGb03zW8dl43WPhoOUp6uPuw/O9+MP9x/K7BJgKUxDJFdEaTx8+I3ImJil0KpsqECrgKN8mNSTMIMkcyxg1E2ANNQhSAiL73/O37AbmQeCV27DXTdSl0d3P0M6bzuzOEdD40W7UcNfy2vHedONa6EPtd/Lm94b9Nv7bA4EIvw1jEksXWhFTHDsgIiP2JJ0mYyfaJ8ImNCVKI4wgIhziF9UStgy+BiUACfnZ8bDrpuUt4IfaqNXP0YXOjMxJyxfLIcxbzcbPvNKI1nTa9d5w42Tolu2/8vT3Cv3PAksHggwAETQVYRj7GkkdCB4jH8UfMB+xHUUb0hcvE84N9weRAdD54PGm6qHkiN8j24bXbNQ90dLONc3vzGDNe86v0M/Uu9dW3G3f7uMR6WjuQ/O9+H79sAJPB9wLLA9zEzQXlBrjHEweQx89H1kfvB7oHZ4YvhTIETUM/gVdAAX52vI663fkyd6f2vzWmtI4z5DMWMs9y4nNQtDR0svUkNjE20zg5uMR6VfujfI0+GD8ZAF3Bs4KgA96EjIWtxi7HKUepR9YIA0hMSEXIWggVCBqHu4bkxgeEWkK7QQ//9v3/PDG6r7kzt6H2vTV3tKez5PN8sxWzUzOEtCS0jbW5tnl3Snjcegp7lTz+/gS/tECAAT7CBUOjBGwFTAY9RwzHiUf6h6cH6cehR3sGxYbkxQFDzAJVAOP/Db26e/l6RXjF97C2dfWs9J2z13Nk8u2zEnPfNGJ1IzY6ttW4CDlQeoc75n0Xfmy/toFHwoODjcS9RVpGA0brhw9HSofjB/PHy8fPB0ZG4EYCBQdD70JMwPO+dHy2Otu5T7f+Nk11ODP4M7wzKzMD87s0AXTNta62pjfIeQt6RTvGvSs+Yj+ZQNiCPQLfg8sExUW5xdKGdcbAB1DHc8dQx+lHy4dnBqIF1MTiw7lB9UBGvpH8r3rP+Ub34DZOtWX0YvOX8xry6XL08zHzhrRadU12WLdHONr52ns9fEG95X8VwFmB5UM9RC5FfsX4RiuGeUcSB4wIWMe1B6fHVYb7RhkEs4LzwWU/6D46/Ba6iflCd8u2W7VBtHTzs7NNs2XzuLQBNTV1lva9d5s5MXpee/M9Kb6uP/qA80Kdw6yEqQVKhkUG14ceR2fHt8fXR/PHhAdWhpsF9YSbA/tCAsCq/qC81/tSuek4ZfckdcO1FDRAM45zHrM/M3P0GXTGdcQ22HgvOO+6WXujfPJ+fH+8QK/Bw4L2Q4YEmoWzhi4Gvsb1x1IHiofSx4NHVUbrRj9E6UPvglIA4L8OvV17WLnEeF425nWWtOU0N7NHc0yzYbOZ9AT03fWetp+3jfjmeeD7C7yePcE/O0AtQVOCTMOJRPVFV4YWxpBHFcePR9GH7YeSx3TG7EYSBWvEQMMlwXJ/uz2P/AR6qXjCd6M2WzWH9Nn0MvOMc7QzTLPKtGE01/XPtoq33Xji+iP7bfyffcy/HMBrgUCC0EPlxJHFRUXAxr7GhAdiR1KHrgd7hxYG7oXPBRLD/gJnAM4/vX3lPDy6bHjjt/y2mLXi9TX0iPRJdBc0GjRMdMr1Sf...';

interface UseOnClockAlarmOptions {
  /** True iff derived.onClockTeamId === myTeamId. Alarm arms on false→true. */
  amIOnClock: boolean;
}

export function useOnClockAlarm({ amIOnClock }: UseOnClockAlarmOptions) {
  const [muted, setMutedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const originalTitleRef = useRef<string>(
    typeof document !== 'undefined' ? document.title : '',
  );
  const titleFlashIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const armedRef = useRef<boolean>(false);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    try {
      if (next) localStorage.setItem(MUTE_STORAGE_KEY, '1');
      else localStorage.removeItem(MUTE_STORAGE_KEY);
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, []);

  // Reset title (defensive cleanup called on stop + unmount).
  const stopTitleFlash = useCallback(() => {
    if (titleFlashIntervalRef.current !== null) {
      clearInterval(titleFlashIntervalRef.current);
      titleFlashIntervalRef.current = null;
    }
    if (typeof document !== 'undefined') {
      document.title = originalTitleRef.current;
    }
  }, []);

  const startTitleFlash = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (titleFlashIntervalRef.current !== null) return; // already running
    originalTitleRef.current = document.title;
    let alt = false;
    titleFlashIntervalRef.current = setInterval(() => {
      alt = !alt;
      document.title = alt ? TITLE_FLASH_TEXT : originalTitleRef.current;
    }, TITLE_FLASH_INTERVAL_MS);
  }, []);

  // Fire notification + sound ONCE on false→true transition.
  useEffect(() => {
    if (!amIOnClock) {
      // false OR became false — stop everything and reset arm.
      stopTitleFlash();
      armedRef.current = false;
      return;
    }
    if (armedRef.current) return; // already fired for this on-clock window
    armedRef.current = true;

    // Only alarm if tab is hidden (or not visible). If user is
    // already looking at the room, the sticky action bar is enough.
    const isHidden =
      typeof document !== 'undefined' && document.hidden;

    if (isHidden) {
      startTitleFlash();
      // Notification (fire-and-forget; swallow errors).
      try {
        if (
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted'
        ) {
          const n = new Notification('You’re on the clock', {
            body: 'Head back to the draft — the timer is running.',
            tag: 'citrus-draft-on-clock',
            silent: false,
          });
          void n;
        }
      } catch {
        /* ignore */
      }
      // Sound (swallow autoplay policy rejections).
      if (!muted) {
        try {
          const audio = new Audio(BEEP_DATA_URI);
          audio.volume = 0.5;
          void audio.play().catch(() => {
            /* autoplay policy — silent */
          });
        } catch {
          /* ignore */
        }
      }
    }
  }, [amIOnClock, muted, startTitleFlash, stopTitleFlash]);

  // Visibility change: if user tabs back in, stop the title flash
  // (they're looking now — the sticky bar handles the rest).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (!document.hidden) stopTitleFlash();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [stopTitleFlash]);

  // Unmount safety.
  useEffect(() => {
    return () => stopTitleFlash();
  }, [stopTitleFlash]);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    try {
      return await Notification.requestPermission();
    } catch {
      return 'denied';
    }
  }, []);

  return {
    muted,
    setMuted,
    requestNotificationPermission,
    notificationPermission:
      typeof Notification !== 'undefined'
        ? Notification.permission
        : ('unsupported' as const),
  };
}
