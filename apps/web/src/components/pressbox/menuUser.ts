/**
 * The league menu's footer identity, from the profile as every league page
 * reads it (2026-09-04): the display name, else a username that is not the
 * generated `user_1a2b3c` placeholder, else `You`.
 */
export function menuUserFromProfile(
  profile: { display_name?: string | null; username?: string | null } | null | undefined,
): { displayName: string; handle?: string | null } | null {
  if (!profile) return null;
  const username = profile.username && !/^user_[0-9a-f]{6,}$/i.test(profile.username) ? profile.username : null;
  // The placeholder is filtered out of the handle too (2026-09-11). It was
  // only kept out of the display name, so a manager who had named himself
  // still read `Founder G / user_36b04a61` in the menu — handle_new_user's
  // minted username handed back to him as if he had chosen it. And a handle
  // equal to the name above it is not a second line, it is the same line
  // twice.
  const displayName = profile.display_name || username || 'You';
  return {
    displayName,
    handle: username && username !== displayName ? username : null,
  };
}
