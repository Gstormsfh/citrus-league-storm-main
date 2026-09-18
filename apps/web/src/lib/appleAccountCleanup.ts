import type { Session } from '@supabase/supabase-js';

/** Call outside the Supabase auth callback lock. Do not persist another copy of
 * the provider token in browser storage or put it in telemetry. */
const ATTEMPT_KEY = 'citrus.appleCleanup.attempted';

/** One attempt per user per browser session. The server answered 503 twice
 * on every page load of a web session (desktop QA, 2026-09-18); retrying
 * on each load cannot succeed where the last one failed and only adds two
 * failed requests to every visit. Nothing about the token is stored, only
 * the user id that was tried. */
function alreadyAttempted(userId: string): boolean {
  try {
    if (sessionStorage.getItem(ATTEMPT_KEY) === userId) return true;
    sessionStorage.setItem(ATTEMPT_KEY, userId);
  } catch { /* storage unavailable: attempt as before */ }
  return false;
}

export async function retainAppleCleanupToken(session: Session, request: typeof fetch = fetch): Promise<void> {
  if (!session.provider_refresh_token || !session.user.identities?.some((identity) => identity.provider === 'apple')) return;
  if (alreadyAttempted(session.user.id)) return;
  const response = await request(`${import.meta.env.VITE_API_URL || ''}/api/account/apple-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ refreshToken: session.provider_refresh_token }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Apple account cleanup setup needs attention');
}
