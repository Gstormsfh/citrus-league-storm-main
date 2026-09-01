/**
 * inviteShare — unit tests.
 *
 * The two iOS-build rules under test:
 * 1. Links always point at the public origin (the in-app origin is
 *    capacitor://localhost and produces unopenable links).
 * 2. shareInvite prefers the OS share sheet, treats a user-dismissed
 *    sheet as silence, and falls back to the clipboard elsewhere.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SITE_ORIGIN,
  buildInviteLink,
  buildInviteText,
  canSystemShare,
  shareInvite,
} from '../inviteShare';

afterEach(() => {
  vi.restoreAllMocks();
   
  delete (navigator as any).share;
});

describe('buildInviteLink', () => {
  it('always uses the public https origin, never the runtime origin', () => {
    const link = buildInviteLink('ABC123');
    expect(link.startsWith('https://citrusfantasysports.com/')).toBe(true);
    expect(link).not.toContain('localhost');
    expect(SITE_ORIGIN).toBe('https://citrusfantasysports.com');
  });

  it('routes through auth with the join path (code included) as redirect', () => {
    const link = buildInviteLink('ABC123');
    expect(link).toContain('/auth?redirect=');
    expect(decodeURIComponent(link.split('redirect=')[1])).toBe(
      '/create-league?tab=join&code=ABC123',
    );
  });

  it('URL-encodes the join code', () => {
    const link = buildInviteLink('A&B 1');
    expect(decodeURIComponent(link.split('redirect=')[1])).toContain(
      `code=${encodeURIComponent('A&B 1')}`,
    );
  });
});

describe('buildInviteText', () => {
  it('carries the tappable link AND the raw code fallback', () => {
    const text = buildInviteText('Puck Norris', 'ZZ99');
    expect(text).toContain(buildInviteLink('ZZ99'));
    expect(text).toContain('ZZ99');
    expect(text).toContain('Puck Norris');
  });
});

describe('shareInvite', () => {
  it('uses the OS share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
     
    (navigator as any).share = share;
    expect(canSystemShare()).toBe(true);
    await expect(shareInvite('League', 'C0DE')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('C0DE') }),
    );
  });

  it('treats a dismissed share sheet as cancelled, without falling back', async () => {
     
    (navigator as any).share = vi
      .fn()
      .mockRejectedValue(new DOMException('user dismissed', 'AbortError'));
    const write = vi.fn();
    vi.stubGlobal('navigator', {
      ...navigator,
      share: (navigator as unknown as { share: unknown }).share,
      clipboard: { writeText: write },
    });
    await expect(shareInvite('League', 'C0DE')).resolves.toBe('cancelled');
    expect(write).not.toHaveBeenCalled();
  });

  it('copies the invite when no share API exists', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    await expect(shareInvite('League', 'C0DE')).resolves.toBe('copied');
    expect(write).toHaveBeenCalledWith(expect.stringContaining('C0DE'));
  });

  it('reports failure when neither share nor clipboard is available', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await expect(shareInvite('League', 'C0DE')).resolves.toBe('failed');
  });
});
