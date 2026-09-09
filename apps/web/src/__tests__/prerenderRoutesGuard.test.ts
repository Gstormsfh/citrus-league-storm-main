/**
 * PRERENDER ROUTES GUARD (2026-09-09).
 *
 * scripts/prerender.mjs writes static HTML for the public marketing routes
 * so crawlers get real text (Devorah's point 4). Three things drift on
 * their own and each one silently un-does that: a route in the sitemap
 * that is not prerendered, a prerendered route that no longer exists in the
 * router, and main.tsx losing the guard that clears a prerendered document
 * on a deep link. This test pins all three.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const script = readFileSync(join(SRC, '..', 'scripts', 'prerender.mjs'), 'utf8');
const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const main = readFileSync(join(SRC, 'main.tsx'), 'utf8');
const sitemap = readFileSync(join(SRC, '..', 'public', 'sitemap.xml'), 'utf8');

const routes = [...script.matchAll(/^\s*'(\/[a-z0-9-]*)',$/gm)].map((m) => m[1]);

describe('prerender routes guard', () => {
  it('lists the marketing routes', () => {
    expect(routes).toContain('/');
    expect(routes).toContain('/about');
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  it('every prerendered route exists in the router', () => {
    for (const r of routes) {
      expect(app, `${r} is prerendered but not routed`).toContain(`path="${r}"`);
    }
  });

  it('every sitemap URL is prerendered', () => {
    const urls = [...sitemap.matchAll(/<loc>https:\/\/citrusfantasysports\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1].replace(/\/$/, '') || '/');
    for (const u of urls) {
      expect(routes, `${u} is in the sitemap but not prerendered`).toContain(u);
    }
  });

  it('main.tsx clears a prerendered document meant for another route', () => {
    expect(main).toMatch(/data-prerendered/);
    expect(main).toMatch(/rootElement\.innerHTML = ''/);
  });
});
