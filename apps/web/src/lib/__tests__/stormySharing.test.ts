import { describe, expect, it, vi } from 'vitest';
import { confirmStormySharing } from '../stormySharing';
describe('Stormy third-party sharing permission', () => {
  it('requires explicit permission and identifies the recipient and context', () => {
    const prompt = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmStormySharing()).toBe(false);
    expect(prompt).toHaveBeenCalledWith(expect.stringMatching(/Anthropic.*[\s\S]*roster and matchup/));
    prompt.mockReturnValue(true);
    expect(confirmStormySharing()).toBe(true);
    prompt.mockRestore();
  });
});
