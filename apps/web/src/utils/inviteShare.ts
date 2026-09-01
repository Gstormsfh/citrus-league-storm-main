/**
 * inviteShare — the one place that knows how to send a league invite.
 *
 * Two hard rules, both learned from the iOS build (2026-09-01):
 *
 * 1. Invite links must NEVER be built from window.location.origin. Inside
 *    the native shell that origin is capacitor://localhost, which produces
 *    links nobody else can open. Links always point at the public site.
 * 2. Scheme navigations (mail / text apps) are dead inside the iOS
 *    WKWebView — the buttons did nothing. On the native app the reliable
 *    send path is the OS share sheet (navigator.share), with the clipboard
 *    as the fallback. The scheme-based Email / Text buttons are a
 *    web-only affordance and must be hidden in the native app.
 */
import { Capacitor } from '@capacitor/core';

/** Canonical public origin for anything sent OFF the device. */
export const SITE_ORIGIN = 'https://citrusfantasysports.com';

/** True inside the iOS / Android shell; false in any browser. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** True when the OS share sheet is available (iOS/Android + some desktops). */
export function canSystemShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Invite link, always on the public origin. Routed through /auth so a
 * signed-out invitee authenticates first and lands on the join screen
 * with the code pre-filled; signed-in users pass straight through.
 */
export function buildInviteLink(joinCode: string): string {
  const joinPath = `/create-league?tab=join&code=${encodeURIComponent(joinCode)}`;
  return `${SITE_ORIGIN}/auth?redirect=${encodeURIComponent(joinPath)}`;
}

/**
 * Invite message: the tappable link AND the raw code, so it survives
 * mail clients that strip URLs.
 */
export function buildInviteText(leagueName: string, joinCode: string): string {
  return (
    `You're invited to join "${leagueName}" on Citrus Fantasy Sports!\n\n` +
    `Tap to join: ${buildInviteLink(joinCode)}\n\n` +
    `Or enter this code manually at citrusfantasysports.com:\n` +
    joinCode
  );
}

export type InviteShareResult = 'shared' | 'cancelled' | 'copied' | 'failed';

/**
 * Send the invite: OS share sheet first (Messages, Mail, WhatsApp — the
 * user picks), clipboard when no share API is available. 'cancelled'
 * means the user closed the sheet themselves — show nothing for it.
 */
export async function shareInvite(leagueName: string, joinCode: string): Promise<InviteShareResult> {
  const text = buildInviteText(leagueName, joinCode);
  if (canSystemShare()) {
    try {
      await navigator.share({
        title: `Join ${leagueName} on Citrus Fantasy Sports`,
        text,
      });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'cancelled';
      }
      // Share sheet refused (rare) — fall through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Web-only: open the user's mail client pre-filled. Dead in the native shell — gate on !isNativeApp(). */
export function emailInvite(leagueName: string, joinCode: string): void {
  const subject = encodeURIComponent(`Join ${leagueName} on Citrus Fantasy Sports`);
  const body = encodeURIComponent(buildInviteText(leagueName, joinCode));
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

/** Web-only: open the messages app pre-filled. Dead in the native shell — gate on !isNativeApp(). */
export function smsInvite(leagueName: string, joinCode: string): void {
  const body = encodeURIComponent(buildInviteText(leagueName, joinCode));
  // iOS Safari requires sms:&body= while Android uses sms:?body=
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const separator = isIOS ? '&' : '?';
  window.location.href = `sms:${separator}body=${body}`;
}
