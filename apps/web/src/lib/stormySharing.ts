/**
 * STORMY SHARING PERMISSION.
 *
 * Stormy's answers come from Anthropic (Claude), so the question and the
 * league context leave Citrus. The person is told that and asked once
 * (App Store Guideline 5.1.1/5.1.2: consent before data goes to a third
 * party). 2026-09-09 (#6): this used to fire a system confirm on EVERY
 * message, with copy that read like a warning label, and was the
 * "terrifying new-user warning" in the Build 15 feedback. It now asks once
 * per signed-in user, in plain words, and remembers the answer on the
 * device. Declining is a real answer: the question stays in the box and
 * the next send asks again.
 */

const KEY_PREFIX = 'citrus.stormy.sharing.';

function key(userId: string | undefined): string {
  return `${KEY_PREFIX}${userId ?? 'anon'}`;
}

/** True when this user already said yes on this device. */
export function hasStormySharingConsent(userId: string | undefined): boolean {
  try {
    return window.localStorage.getItem(key(userId)) === 'yes';
  } catch {
    return false;
  }
}

export function rememberStormySharingConsent(userId: string | undefined): void {
  try {
    window.localStorage.setItem(key(userId), 'yes');
  } catch {
    /* private mode: ask again next time */
  }
}

/** The Account screen's "forget" and account cleanup call this. */
export function clearStormySharingConsent(userId: string | undefined): void {
  try {
    window.localStorage.removeItem(key(userId));
  } catch {
    /* nothing to clear */
  }
}

export const STORMY_SHARING_PROMPT =
  'Stormy is powered by Claude, made by Anthropic.\n\n' +
  'To answer, Stormy sends your question and the parts of your league it needs (roster, matchup, scoring) to Anthropic. ' +
  'Keep personal details out of the chat.\n\n' +
  'OK to send this and future questions? You will not be asked again on this device.';

/** Explicit permission before the current question and context leave Citrus. */
export function confirmStormySharing(userId?: string): boolean {
  if (hasStormySharingConsent(userId)) return true;
  const agreed = window.confirm(STORMY_SHARING_PROMPT);
  if (agreed) rememberStormySharingConsent(userId);
  return agreed;
}
