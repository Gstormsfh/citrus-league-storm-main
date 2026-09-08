/**
 * ROUTE UNLOCK (2026-09-09, QA pass 1).
 *
 * Radix dialogs and sheets put `pointer-events: none` on <body> while they
 * are open and lift it when they close. If one unmounts mid-close because
 * the page that owned it navigated away (the player card's Trade button did
 * exactly that), the lift can be skipped and every tap in the app is
 * ignored: to the person holding the phone, the app has frozen, and only a
 * force-quit clears it. This component is the safety net: after every route
 * change it checks, once the new page has painted, whether <body> is still
 * locked with no open dialog left to justify it, and lifts the lock.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const OPEN_LAYER = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export function releaseStrandedPointerLock(doc: Document = document): boolean {
  if (doc.body.style.pointerEvents !== 'none') return false;
  if (doc.querySelector(OPEN_LAYER)) return false;
  doc.body.style.pointerEvents = '';
  return true;
}

export function RouteUnlock() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Two frames: the first lets the old page's dialog finish unmounting,
    // the second runs after the new page has painted.
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        releaseStrandedPointerLock();
      });
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [pathname]);
  return null;
}

export default RouteUnlock;
