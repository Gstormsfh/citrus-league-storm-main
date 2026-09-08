/**
 * PER-PAGE META FOR THE MARKETING SURFACES (2026-09-09).
 *
 * The site is a client-rendered SPA and shipped one <title> and one
 * description for every route, so Google, X and iMessage previews all saw
 * "Citrus - A Fresh Take on Fantasy Sports" whatever the page. This sets
 * the title, description, canonical and Open Graph tags per route from the
 * component, and restores the defaults on unmount. It is the floor, not
 * the fix: real HTML for crawlers is the prerender step (separate PR).
 */
import { useEffect } from 'react';

export const SITE = 'https://citrusfantasysports.com';
const DEFAULT_TITLE = 'Citrus - A Fresh Take on Fantasy Sports';
const DEFAULT_DESCRIPTION =
  'Fantasy hockey with a live draft room, an AI assistant GM and player analytics built on expected goals.';

export interface PageMeta {
  title: string;
  description: string;
  /** Route path, e.g. "/opening-night"; becomes the canonical URL. */
  path: string;
  image?: string;
}

function setMeta(selector: string, attr: 'content' | 'href', value: string, create: () => HTMLElement) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

export function applyPageMeta(meta: PageMeta): void {
  const title = meta.title.includes('Citrus') ? meta.title : `${meta.title} | Citrus Fantasy Sports`;
  document.title = title;
  const mk = (tag: string, attrs: Record<string, string>) => () => {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };
  setMeta('meta[name="description"]', 'content', meta.description, mk('meta', { name: 'description' }));
  setMeta('link[rel="canonical"]', 'href', `${SITE}${meta.path}`, mk('link', { rel: 'canonical' }));
  setMeta('meta[property="og:title"]', 'content', title, mk('meta', { property: 'og:title' }));
  setMeta('meta[property="og:description"]', 'content', meta.description, mk('meta', { property: 'og:description' }));
  setMeta('meta[property="og:url"]', 'content', `${SITE}${meta.path}`, mk('meta', { property: 'og:url' }));
  if (meta.image) setMeta('meta[property="og:image"]', 'content', meta.image, mk('meta', { property: 'og:image' }));
}

export function resetPageMeta(): void {
  applyPageMeta({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, path: '/' });
}

export function usePageMeta(meta: PageMeta): void {
  useEffect(() => {
    applyPageMeta(meta);
    return () => resetPageMeta();
    // The meta is static per page; re-run only when the path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.path]);
}
