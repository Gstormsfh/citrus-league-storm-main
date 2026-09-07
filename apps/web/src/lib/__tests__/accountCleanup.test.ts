import { beforeEach, describe, expect, it } from 'vitest';
import { clearAccountContent, stormyStorageKey } from '../accountCleanup';

describe('account content cleanup', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('removes chat, lineup and draft content while preserving device preferences', () => {
    const personal = ['stormyMessages', 'stormyApiHistory', stormyStorageKey('alice', 'stormyMessages'),
      'lineup_team_team-a', 'draft-queue-league-a', 'citrus:activeLeagueId:alice',
      'citrus:offline-draft-entry:league-a', 'citrus.consent.signup'];
    for (const key of personal) localStorage.setItem(key, 'private content');
    localStorage.setItem('citrus_analytics_consent', 'denied');
    sessionStorage.setItem('citrus:postAuthRedirect', '/profile');
    clearAccountContent();
    for (const key of personal) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem('citrus_analytics_consent')).toBe('denied');
    expect(sessionStorage.getItem('citrus:postAuthRedirect')).toBeNull();
  });

  it('isolates authenticated and guest transcripts', () => {
    localStorage.setItem(stormyStorageKey('alice', 'stormyMessages'), 'alice history');
    expect(localStorage.getItem(stormyStorageKey('bob', 'stormyMessages'))).toBeNull();
    expect(localStorage.getItem(stormyStorageKey(undefined, 'stormyMessages'))).toBeNull();
  });
});
