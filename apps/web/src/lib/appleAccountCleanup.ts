import type { Session } from '@supabase/supabase-js';

/** Call outside the Supabase auth callback lock. Do not persist another copy of
 * the provider token in browser storage or put it in telemetry. */
export async function retainAppleCleanupToken(session: Session, request: typeof fetch = fetch): Promise<void> {
  if (!session.provider_refresh_token || !session.user.identities?.some((identity) => identity.provider === 'apple')) return;
  const response = await request(`${import.meta.env.VITE_API_URL || ''}/api/account/apple-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ refreshToken: session.provider_refresh_token }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Apple account cleanup setup needs attention');
}
