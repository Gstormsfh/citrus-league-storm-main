/**
 * What a manager is called, in one place.
 *
 * `handle_new_user` mints `user_<hex>` as a username at signup and nothing
 * replaces it until someone finishes ProfileSetup, so a username is not a
 * name until a person has chosen it. The order is: the display name he set,
 * else a username he chose, else his first and last name, else whatever the
 * caller wants to fall back to.
 *
 * Founder, 2026-09-11: "I made sure my display name was saved, this is what
 * should show everywhere." It did not. The league menu printed the minted
 * handle under his name, his chat messages posted under it, and all three
 * pool leaderboards plus the playoff-roster page read `username` first. Each
 * surface had its own rule, so each one drifted on its own schedule. This is
 * the rule.
 *
 * Moderation happens where the name is SAVED (routes/account.ts runs
 * moderationError over display_name, username, bio and the default team
 * name), so nothing here filters it again.
 */

export interface NamedProfile {
  display_name?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

/** `user_36b04a61`: minted at signup, chosen by nobody. */
export function isMintedUsername(username: string | null | undefined): boolean {
  return typeof username === 'string' && /^user_[0-9a-f]{6,}$/i.test(username.trim());
}

/** The username only counts as a name once a manager has picked one. */
export function chosenUsername(profile: NamedProfile | null | undefined): string | null {
  const username = profile?.username?.trim();
  if (!username || isMintedUsername(username)) return null;
  return username;
}

export function profileDisplayName(
  profile: NamedProfile | null | undefined,
  fallback = 'Manager',
): string {
  const display = profile?.display_name?.trim();
  if (display) return display;

  const username = chosenUsername(profile);
  if (username) return username;

  const full = [profile?.first_name, profile?.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ');
  if (full) return full;

  return fallback;
}
