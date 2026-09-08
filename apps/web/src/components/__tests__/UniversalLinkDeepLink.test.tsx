import { describe, it, expect } from 'vitest';
import { universalLinkToPath } from '../UniversalLinkDeepLink';

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
