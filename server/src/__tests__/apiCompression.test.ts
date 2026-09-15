import { describe, it, expect, beforeAll } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { app } from '../app';

/**
 * APP-WIDE JSON COMPRESSION (2026-09-14, latency pass).
 *
 * Production measurement from a signed-in browser: 2.3 MB across 73 API
 * responses on the Matchup tab, none of it encoded. This pins the app-level
 * middleware, not a route: a JSON response under /api gzips when the client
 * accepts it and passes through raw when it does not. The JSON 404 is used
 * because it needs no auth and no database. Hono's JSON responses carry no
 * Content-Length, so its 1 KB threshold cannot apply and even small bodies
 * are encoded; that is the library's behaviour and this test documents it.
 */
beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

describe('API app compresses JSON transport', () => {
  it('gzips JSON when the client accepts gzip, byte-for-byte equal once decoded', async () => {
    const raw = await app.request('/api/nonexistent');
    expect(raw.status).toBe(404);
    expect(raw.headers.get('content-encoding')).toBeNull();
    const body = await raw.text();
    expect(JSON.parse(body).error.code).toBe('NOT_FOUND');

    const gz = await app.request('/api/nonexistent', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(gz.status).toBe(404);
    expect(gz.headers.get('content-type')).toMatch(/^application\/json/);
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect(gz.headers.get('vary')).toMatch(/Accept-Encoding/);
    expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(body);
  });

  it('leaves the body raw when the client declines encoding', async () => {
    const res = await app.request('/api/nonexistent', { headers: { 'Accept-Encoding': 'identity' } });
    expect(res.headers.get('content-encoding')).toBeNull();
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
