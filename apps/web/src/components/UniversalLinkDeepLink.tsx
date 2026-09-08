import { useEffect } from 'react';
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
  if (url.pathname.startsWith('/auth') || url.pathname === '/reset-password' || url.pathname.startsWith('/api/')) return null;
  return `${url.pathname}${url.search}${url.hash}` || '/';
}

const UniversalLinkDeepLink = () => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let removed = false;
    let remove: (() => void) | null = null;
    const handled = new Set<string>();
    const dispatch = (url: string | null | undefined) => {
      if (!url || handled.has(url)) return;
      const path = universalLinkToPath(url);
      if (!path) return;
      handled.add(url);
      logger.info('[UniversalLink] routing ' + path);
      navigate(path, { replace: false });
    };
    (async () => {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appUrlOpen', ({ url }) => dispatch(url));
      if (removed) handle.remove();
      else remove = () => handle.remove();
      // Cold start: the launching link is not always delivered to the listener.
      const launch = typeof App.getLaunchUrl === 'function' ? await App.getLaunchUrl().catch(() => null) : null;
      dispatch(launch?.url);
    })();
    return () => {
      removed = true;
      remove?.();
    };
  }, [navigate]);

  return null;
};

export default UniversalLinkDeepLink;
