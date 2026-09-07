import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { retainAppleCleanupToken } from '../appleAccountCleanup';
const session = { access_token: 'session-token', provider_refresh_token: 'provider-token', user: { identities: [{ provider: 'apple' }] } } as Session;
describe('Apple cleanup token handoff', () => {
  it('sends the provider token only in an authenticated request body', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await retainAppleCleanupToken(session, request);
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/api/account/apple-token'), expect.objectContaining({
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session-token' },
      body: JSON.stringify({ refreshToken: 'provider-token' }),
    }));
  });
  it('does not report an unsuccessful handoff as complete', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(retainAppleCleanupToken(session, request)).rejects.toThrow('needs attention');
  });
  it('skips sessions without an Apple identity or provider token', async () => {
    const request = vi.fn<typeof fetch>();
    await retainAppleCleanupToken({ ...session, provider_refresh_token: null }, request);
    await retainAppleCleanupToken({ ...session, user: { ...session.user, identities: [] } }, request);
    expect(request).not.toHaveBeenCalled();
  });
});
