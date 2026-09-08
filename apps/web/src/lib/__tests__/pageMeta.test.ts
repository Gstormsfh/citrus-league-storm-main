import { describe, it, expect, beforeEach } from 'vitest';
import { applyPageMeta, resetPageMeta, SITE } from '../pageMeta';

beforeEach(() => {
  document.head.innerHTML = '<meta name="description" content="old">';
  document.title = 'x';
});

describe('applyPageMeta', () => {
  it('sets title, description, canonical and Open Graph for the route', () => {
    applyPageMeta({ title: 'Opening Night Pick\'em', description: 'Pick the winners.', path: '/opening-night' });
    expect(document.title).toBe("Opening Night Pick'em | Citrus Fantasy Sports");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Pick the winners.');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE}/opening-night`);
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(`${SITE}/opening-night`);
  });

  it('does not double the brand when the title already carries it, and resets to the defaults', () => {
    applyPageMeta({ title: 'Citrus Fantasy Sports', description: 'd', path: '/about' });
    expect(document.title).toBe('Citrus Fantasy Sports');
    resetPageMeta();
    expect(document.title).toBe('Citrus - A Fresh Take on Fantasy Sports');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE}/`);
  });
});
