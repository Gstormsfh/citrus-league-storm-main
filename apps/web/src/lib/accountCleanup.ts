/** Clear account content without erasing device accessibility/preferences. */
export function clearAccountContent(): void {
  const exact = new Set(['stormyMessages', 'stormyApiHistory', 'citrus.consent.signup',
    'citrus.audit.lastLoginSessionId', 'citrus-armchair-gm-trades']);
  const prefixes = ['citrus:stormy:', 'citrus:activeLeagueId:', 'lineup_team_', 'draft-queue-',
    'citrus:offline-draft-entry:', 'citrus:autodraft:'];
  try {
    for (const key of Object.keys(localStorage)) {
      if (exact.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key);
    }
    sessionStorage.removeItem('citrus:postAuthRedirect');
  } catch { /* Storage may be disabled. Authentication cleanup still runs. */ }
}

/** Never load unscoped legacy chat into another person's session. */
export function stormyStorageKey(userId: string | undefined, kind: 'stormyMessages' | 'stormyApiHistory'): string {
  return `citrus:stormy:${userId ?? 'guest'}:${kind}`;
}
