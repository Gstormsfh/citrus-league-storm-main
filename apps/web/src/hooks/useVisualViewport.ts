/**
 * The visual viewport: what is actually on screen once the iOS keyboard is
 * up. In a WKWebView the layout viewport does not shrink when the keyboard
 * opens; `window.innerHeight` stays put, the visual viewport shrinks, and
 * the web view scrolls the page to reveal the focused field. A fixed layer
 * sized to the layout viewport (Stormy's chat) then runs under the keyboard
 * and the whole page slides off the top: "Stormy overflows the screen when
 * the keyboard opens" (QA pass 1, 2026-09-09).
 *
 * This hook reports the visual viewport's height and offset so a layer can
 * size itself to what is visible. It also pins the page scroll back to the
 * top while the keyboard is open, because a fixed layer that already fits
 * the visible area must not be pushed around by the web view's own scroll.
 */
import { useEffect, useState } from 'react';

export interface VisualViewportState {
  /** Visible height in CSS px, or null when the API is unavailable. */
  height: number | null;
  /** Top offset of the visible area relative to the layout viewport. */
  offsetTop: number;
  /** True when the visible height is well short of the layout height. */
  keyboardOpen: boolean;
}

const KEYBOARD_THRESHOLD_PX = 120;

function read(): VisualViewportState {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return { height: null, offsetTop: 0, keyboardOpen: false };
  const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX;
  return { height: vv.height, offsetTop: vv.offsetTop, keyboardOpen };
}

export function useVisualViewport(pinPageWhileKeyboardOpen = true): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(read);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const next = read();
      setState(next);
      if (pinPageWhileKeyboardOpen && next.keyboardOpen && (window.scrollY !== 0 || next.offsetTop !== 0)) {
        window.scrollTo(0, 0);
      }
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [pinPageWhileKeyboardOpen]);

  return state;
}
