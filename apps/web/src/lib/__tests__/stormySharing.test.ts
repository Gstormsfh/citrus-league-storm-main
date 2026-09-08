import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmStormySharing, hasStormySharingConsent, clearStormySharingConsent } from '../stormySharing';

describe('Stormy third-party sharing permission', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('requires explicit permission and identifies the recipient and context', () => {
    const prompt = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmStormySharing('u1')).toBe(false);
    expect(prompt).toHaveBeenCalledWith(expect.stringMatching(/Anthropic[\s\S]*roster, matchup, scoring/));
    expect(hasStormySharingConsent('u1')).toBe(false);
    prompt.mockReturnValue(true);
    expect(confirmStormySharing('u1')).toBe(true);
    prompt.mockRestore();
  });

  // 2026-09-09 (#6): once, not on every message.
  it('asks once per user on a device and remembers the yes', () => {
    const prompt = vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(confirmStormySharing('u1')).toBe(true);
    expect(confirmStormySharing('u1')).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    // Another account on the same phone is asked on its own.
    expect(confirmStormySharing('u2')).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(2);
    prompt.mockRestore();
  });

  it('a no is not remembered, and a forget asks again', () => {
    const prompt = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(true);
    expect(confirmStormySharing('u1')).toBe(false);
    expect(confirmStormySharing('u1')).toBe(true);
    clearStormySharingConsent('u1');
    expect(confirmStormySharing('u1')).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(3);
    prompt.mockRestore();
  });
});
