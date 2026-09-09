import { describe, it, expect, beforeEach, vi } from 'vitest';
import { universalLinkToPath, routeUniversalLink, resetUniversalLinkState } from '../UniversalLinkDeepLink';

describe('universalLinkToPath', () => {
  it('routes invite links into the SPA with their query intact', () => {
    expect(universalLinkToPath('https://citrusfantasysports.com/create-league?tab=join&code=ABCD')).toBe('/create-league?tab=join&code=ABCD');
    // The invite link the app actually shares (utils/inviteShare.buildInviteLink).
    expect(universalLinkToPath('https://citrusfantasysports.com/auth?redirect=%2Fcreate-league%3Ftab%3Djoin%26code%3DQHNEPZ')).toBe('/auth?redirect=%2Fcreate-league%3Ftab%3Djoin%26code%3DQHNEPZ');
    expect(universalLinkToPath('https://citrusfantasysports.com/auth/callback?code=x')).toBeNull();
    expect(universalLinkToPath('https://citrusfantasysports.com/auth')).toBeNull();
    expect(universalLinkToPath('https://www.citrusfantasysports.com/league/123')).toBe('/league/123');
  });
  it('ignores hosts, schemes and paths that are not universal-link targets', () => {
    expect(universalLinkToPath('citrussports://auth-callback#access_token=x')).toBeNull();
    expect(universalLinkToPath('https://evil.example/create-league?code=X')).toBeNull();
    expect(universalLinkToPath('https://citrusfantasysports.com/auth/callback#x')).toBeNull();
    expect(universalLinkToPath('https://citrusfantasysports.com/reset-password')).toBeNull();
    expect(universalLinkToPath('https://citrusfantasysports.com/api/health')).toBeNull();
    expect(universalLinkToPath('not a url')).toBeNull();
  });
});

describe('routeUniversalLink', () => {
  beforeEach(() => resetUniversalLinkState());

  it('routes a url exactly once per process, however many times it is offered', () => {
    const navigate = vi.fn();
    const url = 'https://citrusfantasysports.com/join/QHNEPZ';
    expect(routeUniversalLink(url, navigate)).toBe('/join/QHNEPZ');
    // Re-render, re-mount, launch url re-read: all no-ops.
    expect(routeUniversalLink(url, navigate)).toBeNull();
    expect(routeUniversalLink(url, navigate)).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/join/QHNEPZ', { replace: false });
  });

  it('ignores non-targets without marking anything handled', () => {
    const navigate = vi.fn();
    expect(routeUniversalLink('https://citrusfantasysports.com/auth/callback?code=x', navigate)).toBeNull();
    expect(routeUniversalLink(null, navigate)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
