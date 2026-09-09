import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { logger } from '@/utils/logger';

/**
 * Universal links (2026-09-08): an https://citrusfantasysports.com/... link tapped
 * in Messages, Mail or Safari opens the native app instead of the browser once
 * Associated Domains (App.entitlements) and /.well-known/apple-app-site-association
 * are live. Capacitor delivers the URL through the same 'appUrlOpen' event the
 * custom-scheme auth flow uses; this component routes the web path into the SPA.
 *
 * Auth and reset links are excluded in the AASA and stay on the citrussports://
 * scheme handled by NativeAuthDeepLink, so nothing here touches sessions.
 */
export const UNIVERSAL_LINK_HOSTS = new Set(['citrusfantasysports.com', 'www.citrusfantasysports.com']);

export function universalLinkToPath(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !UNIVERSAL_LINK_HOSTS.has(url.hostname)) return null;
  // /auth?redirect=... is the invite link (utils/inviteShare.ts) and belongs in-app;
  // /auth/callback and friends are OAuth returns and stay with the browser.
  const inviteAuth = url.pathname === '/auth' && url.searchParams.has('redirect');
  if ((url.pathname.startsWith('/auth') && !inviteAuth) || url.pathname === '/reset-password' || url.pathname.startsWith('/api/')) return null;
  return `${url.pathname}${url.search}${url.hash}` || '/';
}

/**
 * INVITE-LOOP (2026-09-09, TestFlight screen recording). The first version of
 * this component keyed its effect on `navigate`, and react-router hands out a
 * new `navigate` on every location change. So: launch URL dispatched ->
 * navigate('/join/CODE') -> new `navigate` -> effect re-ran with a fresh
 * `handled` set -> getLaunchUrl() answered the same URL -> navigate again.
 * The invite screen flipped between "Opening your invite" and "You are
 * already in ..." about once a second until the app was force-closed.
 *
 * Dedupe now lives at module scope, so a URL is routed once per process no
 * matter how many times the component re-renders or re-mounts, and the
 * listener is registered once with the latest `navigate` read from a ref.
 */
const handledUrls = new Set<string>();
let launchUrlConsumed = false;

/** Test hook. */
export function resetUniversalLinkState(): void {
  handledUrls.clear();
  launchUrlConsumed = false;
}

/**
 * Route one universal link into the SPA. Returns the path it navigated to, or
 * null when the URL was not a universal-link target or was already handled.
 */
export function routeUniversalLink(
  raw: string | null | undefined,
  navigate: (path: string, opts?: { replace?: boolean }) => void,
): string | null {
  if (!raw || handledUrls.has(raw)) return null;
  const path = universalLinkToPath(raw);
  if (!path) return null;
  handledUrls.add(raw);
  logger.info('[UniversalLink] routing ' + path);
  navigate(path, { replace: false });
  return path;
}

const UniversalLinkDeepLink = () => {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let removed = false;
    let remove: (() => void) | null = null;
    (async () => {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appUrlOpen', ({ url }) =>
        routeUniversalLink(url, (p, o) => navigateRef.current(p, o)),
      );
      if (removed) handle.remove();
      else remove = () => handle.remove();
      // Cold start: the launching link is not always delivered to the
      // listener, and it is the SAME url for the life of the process, so it
      // is read exactly once.
      if (!launchUrlConsumed) {
        launchUrlConsumed = true;
        const launch = typeof App.getLaunchUrl === 'function' ? await App.getLaunchUrl().catch(() => null) : null;
        routeUniversalLink(launch?.url, (p, o) => navigateRef.current(p, o));
      }
    })();
    return () => {
      removed = true;
      remove?.();
    };
    // Registered once per mount; `navigate` is read through the ref.
  }, []);

  return null;
};

export default UniversalLinkDeepLink;
