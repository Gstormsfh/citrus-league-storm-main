import { describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { AppleAccountService } from '../services/AppleAccountService';
import { createChain, createMockSupabase } from './helpers';
const config = { clientId: 'test.client', clientSecret: 'test-secret', encryptionKey: 'ab'.repeat(32) };
const user: User = { id: 'alice', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '', identities: [{ id: 'identity', identity_id: 'identity', user_id: 'alice', provider: 'apple', identity_data: { sub: 'apple-alice' } }] };
function response(subject = 'apple-alice') {
  const claims = Buffer.from(JSON.stringify({ sub: subject, aud: config.clientId, iss: 'https://appleid.apple.com', exp: Date.now()/1000+3600 })).toString('base64url');
  return Response.json({ id_token: `header.${claims}.signature` });
}
describe('Apple account cleanup', () => {
  it('validates the identity and stores only authenticated encryption bound to the user', async () => {
    const chain = createChain();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const service = new AppleAccountService(createMockSupabase({ apple_provider_tokens: chain }), config, request);
    await service.storeToken(user, 'private-refresh-token');
    const saved = chain.upsert.mock.calls[0][0] as { user_id: string; client_id: string; sealed_token: string };
    expect(saved.user_id).toBe('alice');
    expect(saved.sealed_token).not.toContain('private-refresh-token');
    chain.maybeSingle.mockResolvedValue({ data: saved, error: null });
    expect(await service.revoke(user)).toBe('revoked');
    expect(request.mock.calls[1][0]).toBe('https://appleid.apple.com/auth/revoke');
    expect((request.mock.calls[1][1]?.body as URLSearchParams).get('token')).toBe('private-refresh-token');
    expect(chain.delete).not.toHaveBeenCalled();
    await expect(service.revoke({ ...user, id: 'bob' })).rejects.toThrow('Could not unlock');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('rejects a valid provider token belonging to another Apple identity', async () => {
    const chain = createChain();
    const request = vi.fn<typeof fetch>().mockResolvedValue(response('apple-bob'));
    const service = new AppleAccountService(createMockSupabase({ apple_provider_tokens: chain }), config, request);
    await expect(service.storeToken(user, 'other-token')).rejects.toThrow('identity validation');
    expect(chain.upsert).not.toHaveBeenCalled();
  });
  it('surfaces provider rejection and storage failure without exposing tokens', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('provider-secret-detail', { status: 400 }));
    const service = new AppleAccountService(createMockSupabase(), config, request);
    await expect(service.storeToken(user, 'secret')).rejects.toThrow('Apple token validation failed');
    request.mockResolvedValue(response());
    const chain = createChain({ error: { message: 'private database detail' } });
    await expect(new AppleAccountService(createMockSupabase({ apple_provider_tokens: chain }), config, request).storeToken(user, 'secret')).rejects.toThrow('Could not retain');
  });
  it('uses manual guidance only when no retained token exists, not when its lookup fails', async () => {
    const client = createMockSupabase();
    const service = new AppleAccountService(client, config);
    expect(await service.revoke(user)).toBe('manual');
    expect(await service.revoke({ id: 'email-user' } as User)).toBe('not_applicable');
    client.from.mockReturnValue(createChain({ error: { message: 'Offline' }, data: null }));
    await expect(service.revoke(user)).rejects.toThrow('Could not read');
  });
  it('requires configuration and an Apple identity before attempting token validation', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new AppleAccountService(createMockSupabase(), { ...config, encryptionKey: '' }, request).storeToken(user, 'secret')).rejects.toThrow('not configured');
    await expect(new AppleAccountService(createMockSupabase(), config, request).storeToken({ id: 'email' } as User, 'secret')).rejects.toThrow('identity required');
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps account cleanup retryable when Apple revocation fails', async () => {
    const chain = createChain();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(null, { status: 503 }));
    const service = new AppleAccountService(createMockSupabase({ apple_provider_tokens: chain }), config, request);
    await service.storeToken(user, 'token');
    chain.maybeSingle.mockResolvedValue({ data: chain.upsert.mock.calls[0][0], error: null });
    await expect(service.revoke(user)).rejects.toThrow('Please retry deletion');
    expect(chain.delete).not.toHaveBeenCalled();
  });
});
