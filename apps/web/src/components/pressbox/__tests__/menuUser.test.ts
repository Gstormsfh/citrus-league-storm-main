/**
 * The league menu's footer identity (2026-09-11). See menuUser.ts.
 *
 * The bug this pins: `handle_new_user` mints `user_<hex>` at signup and
 * nothing replaces it until a manager picks a username, so the menu read
 * `Founder G / user_36b04a61` — a name he never chose, printed under the one
 * he did.
 */
import { describe, it, expect } from 'vitest';
import { menuUserFromProfile } from '../menuUser';

describe('menuUserFromProfile', () => {
  it('a minted username is not a handle', () => {
    expect(menuUserFromProfile({ display_name: 'Founder G', username: 'user_36b04a61' })).toEqual({
      displayName: 'Founder G',
      handle: null,
    });
  });

  it('a username he chose is shown under the name', () => {
    expect(menuUserFromProfile({ display_name: 'Founder G', username: 'stormy' })).toEqual({
      displayName: 'Founder G',
      handle: 'stormy',
    });
  });

  it('with no display name the chosen username is the name, not both lines', () => {
    expect(menuUserFromProfile({ display_name: null, username: 'stormy' })).toEqual({
      displayName: 'stormy',
      handle: null,
    });
  });

  it('a minted username and no display name falls back to You, still no handle', () => {
    expect(menuUserFromProfile({ display_name: null, username: 'user_a3f9c1' })).toEqual({
      displayName: 'You',
      handle: null,
    });
  });

  it('no profile, no identity', () => {
    expect(menuUserFromProfile(null)).toBeNull();
    expect(menuUserFromProfile(undefined)).toBeNull();
  });
});
