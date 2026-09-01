import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

/**
 * FIRST-RUN SWAP HINT (2026-09-01, Sleeper parity audit R2)
 *
 * On the phone roster the coloured position chip is the ONLY way to start a
 * lineup change, and the only sentence that said so lived in a desktop-only
 * aside. Sleeper, Yahoo and ESPN all use the position button as the trigger
 * too, so the gesture stays; this tells a manager once, the first time the
 * editable list appears, and then never again.
 *
 * Storage is best-effort. localStorage can throw (private mode, sandboxed
 * webviews, quota) and a hint is never worth a crash, so every access sits
 * in try/catch. If storage is unavailable the module-level guard still
 * caps it at once per page load.
 */

export const SWAP_HINT_STORAGE_KEY = 'citrus:roster:swap-hint-shown';

let firedThisSession = false;

/** Test seam — clears the once-per-load guard. */
export function resetSwapHintForTests(): void {
  firedThisSession = false;
}

export function useSwapHint(enabled: boolean): void {
  const { toast } = useToast();

  useEffect(() => {
    if (!enabled || firedThisSession) return;

    let seen = false;
    try {
      seen = localStorage.getItem(SWAP_HINT_STORAGE_KEY) === '1';
      if (!seen) localStorage.setItem(SWAP_HINT_STORAGE_KEY, '1');
    } catch {
      // Storage unavailable — fall through and show it this once.
    }

    firedThisSession = true;
    if (seen) return;

    toast({
      title: 'Tap a position to swap',
      description: 'The coloured chip on any row opens Line Change. Empty spots fill from the bench.',
    });
  }, [enabled, toast]);
}
