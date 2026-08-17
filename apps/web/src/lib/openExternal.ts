/**
 * SWEEP (2026-08-15) — external links inside the iOS shell.
 *
 * On the web, `target="_blank"` opens a new tab and the app stays put.
 * Inside a Capacitor webview there are no tabs: the SAME webview
 * navigates to the external site and the user is stranded there with
 * no back affordance — the app is simply gone until they force-quit.
 * News links, and the Terms/Privacy links on the signup screen a
 * reviewer will absolutely tap, all had this failure mode.
 *
 * `openExternal(url)` routes through the system browser sheet when
 * native (SFSafariViewController via @capacitor/browser — same
 * mechanism the OAuth flow already uses) and is a no-op signal on the
 * web, where the anchor's own target="_blank" behaviour is correct and
 * should proceed untouched.
 *
 * Usage on an anchor — keep href/target for the web path, add:
 *   onClick={(e) => { if (interceptExternal(url)) e.preventDefault(); }}
 */

import { isNativeShell } from '@/lib/nativeAuth';

/** Open a URL in the system browser sheet. Native-only effect. */
export async function openExternal(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}

/**
 * Anchor onClick helper: returns true (and kicks off the system
 * browser) when the click must be intercepted — i.e. we are inside the
 * shell. Returns false on the web so the default anchor behaviour
 * (new tab) proceeds exactly as before.
 */
export function interceptExternal(url: string): boolean {
  if (!isNativeShell()) return false;
  void openExternal(url);
  return true;
}
