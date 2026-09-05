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
  return {
    displayName: profile.display_name || username || 'You',
    handle: profile.username ?? null,
  };
}
