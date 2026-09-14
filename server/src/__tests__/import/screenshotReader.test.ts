import { describe, it, expect, vi } from 'vitest';
import { ScreenshotReader, ScreenshotReadError, MAX_IMAGES_PER_READ, SYSTEM_PROMPT } from '../../import/screenshot/reader';
import { standings2023 } from './screenshotFixtures';

const img = (n = 1) => Array.from({ length: n }, (_, i) => ({ data: Buffer.from(`image-${i}`).toString('base64'), mediaType: 'image/jpeg' as const }));

function fetchReturning(body: unknown, status = 200) {
  const impl = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  return impl as unknown as typeof fetch & { mock: { calls: Array<[string, RequestInit]> } };
}

const toolReply = (input: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'tool_use', name: 'record_league_pages', input }],
  usage: { input_tokens: 1200, output_tokens: 300 },
  stop_reason: 'tool_use',
  ...extra,
});

describe('ScreenshotReader', () => {
  it('sends every image as a base64 block, the hints, and forces the tool; returns the validated reading', async () => {
    const fetchImpl = fetchReturning(toolReply({ pages: [standings2023] }));
    const reader = new ScreenshotReader('key-1', fetchImpl, 'claude-test');
    const res = await reader.read(img(2), { platform: 'yahoo', leagueName: 'Puck', season: 2023 });
    expect(res.extraction.pages).toHaveLength(1);
    expect(res.extraction.pages[0].standings?.[0].teamName).toBe('Dangle Dynasty 🏒');
    expect(res.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    expect(res.model).toBe('claude-test');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('key-1');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-test');
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_league_pages' });
    expect(body.tools[0].input_schema.properties.pages.items.required).toContain('season');
    const content = body.messages[0].content as Array<{ type: string; text?: string; source?: { data: string; media_type: string } }>;
    expect(content[0].text).toContain('2 images follow. The commissioner says they are from yahoo. The league is called "Puck". The commissioner says every page is about the 2023-24 season');
    const images = content.filter((c) => c.type === 'image');
    expect(images).toHaveLength(2);
    expect(images[0].source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: Buffer.from('image-0').toString('base64') });
  });

  it('never stores or logs the images: nothing but the reading comes back', async () => {
    const fetchImpl = fetchReturning(toolReply({ pages: [] }));
    const res = await new ScreenshotReader('k', fetchImpl).read(img(1));
    expect(JSON.stringify(res)).not.toContain(Buffer.from('image-0').toString('base64'));
  });

  it('refuses without a key, with no images, and with too many', async () => {
    await expect(new ScreenshotReader(undefined, fetchReturning({})).read(img(1))).rejects.toMatchObject({ status: 503, message: 'Screenshot import is not available yet.' });
    expect(new ScreenshotReader(undefined, fetchReturning({})).isConfigured()).toBe(false);
    await expect(new ScreenshotReader('k', fetchReturning({})).read([])).rejects.toMatchObject({ status: 400 });
    await expect(new ScreenshotReader('k', fetchReturning({})).read(img(MAX_IMAGES_PER_READ + 1))).rejects.toMatchObject({ status: 400 });
  });

  it('a reading that does not fit the page shape is refused, not written', async () => {
    const fetchImpl = fetchReturning(toolReply({ pages: [{ ...standings2023, season: 'twenty twenty-three' }] }));
    const err = await new ScreenshotReader('k', fetchImpl).read(img(1)).catch((e) => e);
    expect(err).toBeInstanceOf(ScreenshotReadError);
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/did not fit the page shape \(pages\.0\.season/);
  });

  it('busy, broken and overlong answers each get their own words', async () => {
    await expect(new ScreenshotReader('k', fetchReturning({ error: 'x' }, 429)).read(img(1))).rejects.toMatchObject({ status: 429, message: /busy/ });
    await expect(new ScreenshotReader('k', fetchReturning({ error: 'x' }, 500)).read(img(1))).rejects.toMatchObject({ status: 502, message: /answered 500/ });
    await expect(new ScreenshotReader('k', fetchReturning({ content: [{ type: 'text', text: 'hi' }] })).read(img(1))).rejects.toMatchObject({ status: 502, message: /no reading/ });
    await expect(new ScreenshotReader('k', fetchReturning(toolReply({ pages: [] }, { stop_reason: 'max_tokens' }))).read(img(1))).rejects.toMatchObject({ status: 422, message: /fewer screenshots/ });
    const dead = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(new ScreenshotReader('k', dead).read(img(1))).rejects.toMatchObject({ status: 502, message: /did not answer: ECONNRESET/ });
  });
});
