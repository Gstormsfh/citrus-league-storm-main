import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ native: vi.fn(() => true), open: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/nativeAuth', () => ({ isNativeShell: mocks.native }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.open } }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
import { interceptExternal, openExternal } from '../openExternal';
beforeEach(() => { vi.clearAllMocks(); mocks.native.mockReturnValue(true); mocks.open.mockResolvedValue(undefined); });
describe('native external links', () => {
  it('resolves legal paths against the public website, not capacitor localhost', async () => {
    await openExternal('/terms-of-service.html');
    expect(mocks.open).toHaveBeenCalledWith({ url: 'https://citrusfantasysports.com/terms-of-service.html' });
  });
  it('preserves external article URLs', async () => {
    await openExternal('https://www.nhl.com/news');
    expect(mocks.open).toHaveBeenCalledWith({ url: 'https://www.nhl.com/news' });
  });
  it('leaves ordinary web links and email handling to the browser', () => {
    expect(interceptExternal('mailto:CitrusFantasySports@Gmail.com')).toBe(false);
    mocks.native.mockReturnValue(false);
    expect(interceptExternal('/privacy-policy.html')).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('reports plugin failure instead of silently stranding the user', async () => {
    mocks.open.mockRejectedValue(new Error('unavailable'));
    expect(interceptExternal('/privacy-policy.html')).toBe(true);
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());
  });
});
