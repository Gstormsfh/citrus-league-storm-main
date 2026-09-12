/**
 * What a manager is called (2026-09-11). See utils/profileName.ts.
 */
import { describe, it, expect } from 'vitest';
import { profileDisplayName, chosenUsername, isMintedUsername } from '../profileName';

describe('isMintedUsername', () => {
  it('knows the signup handle from a chosen one', () => {
    expect(isMintedUsername('user_36b04a61')).toBe(true);
    expect(isMintedUsername('user_a3f9c1')).toBe(true);
    expect(isMintedUsername('stormy')).toBe(false);
    expect(isMintedUsername('user_garrett')).toBe(false);
    expect(isMintedUsername(null)).toBe(false);
  });
});

describe('profileDisplayName', () => {
  it('the name he set wins', () => {
    expect(
      profileDisplayName({ display_name: 'Founder G', username: 'user_36b04a61', first_name: 'Garrett' }),
    ).toBe('Founder G');
  });

  it('a minted username is never the name', () => {
    expect(profileDisplayName({ display_name: null, username: 'user_36b04a61' })).toBe('Manager');
  });

  it('a chosen username is, when no display name is set', () => {
    expect(profileDisplayName({ display_name: null, username: 'stormy' })).toBe('stormy');
  });

  it('then the first and last name', () => {
    expect(
      profileDisplayName({ display_name: null, username: 'user_36b04a61', first_name: 'Garrett', last_name: 'Storms' }),
    ).toBe('Garrett Storms');
  });

  it('a first name alone is still a name', () => {
    expect(profileDisplayName({ username: 'user_36b04a61', first_name: 'Garrett' })).toBe('Garrett');
  });

  it('whitespace is not a name', () => {
    expect(profileDisplayName({ display_name: '   ', username: '  ', first_name: ' ' }, 'Unknown')).toBe('Unknown');
  });

  it('the caller picks the fallback, because the surfaces disagree on it', () => {
    expect(profileDisplayName(null, 'You')).toBe('You');
    expect(profileDisplayName(undefined, 'Unknown')).toBe('Unknown');
    expect(profileDisplayName({})).toBe('Manager');
  });
});

describe('chosenUsername', () => {
  it('is null until a manager picks one', () => {
    expect(chosenUsername({ username: 'user_36b04a61' })).toBeNull();
    expect(chosenUsername({ username: 'stormy' })).toBe('stormy');
    expect(chosenUsername(null)).toBeNull();
  });
});
