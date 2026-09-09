/**
 * PRERENDER THE MARKETING PAGES (2026-09-09, Devorah's point 4).
 *
 * "The site is a JS app, so there is almost nothing for Google to crawl."
 * True: dist/index.html is an empty shell that fills in with JavaScript.
 * This script runs after `vite build`, serves dist locally, opens each
 * public marketing route in headless Chromium, and writes the rendered
 * document to dist/<route>/index.html. Firebase serves a directory's
 * index.html before the SPA catch-all, so a crawler fetching /about gets
 * the real headline and copy in the HTML, and a person gets the page
 * painted before React has even loaded. React then mounts on top (see
 * main.tsx: a prerendered document for a different route is cleared first,
 * so a deep link never flashes the homepage).
 *
 * Skips itself, loudly, when Playwright is not installed or PRERENDER=0,
 * so a plain local `npm run build` still works. CI installs Chromium and
 * asserts the output. The native build (scripts/build-native.mjs) calls
 * vite directly and never runs this.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist');

/** Public routes with real copy. Keep in sync with the sitemap. */
export const PRERENDER_ROUTES = [
  '/',
  '/about',
  '/features',
  '/pricing',
  '/guides',
  '/blog',
  '/podcasts',
  '/contact',
  '/waitlist',
  '/opening-night',
  '/bring-your-league',
  '/dangle',
  '/privacy',
  '/terms',
];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain',
};

function serveDist() {
  const shell = readFileSync(join(DIST, 'index.html'));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"prerender: no api"}');
      return;
    }
    const file = join(DIST, decodeURIComponent(url.pathname));
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(shell);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function main() {
  if (process.env.PRERENDER === '0') {
    console.log('prerender: skipped (PRERENDER=0)');
    return;
  }
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('prerender: dist/index.html missing, run vite build first');
    process.exit(1);
  }
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.warn('prerender: playwright not installed, marketing pages stay client-rendered (CI installs it)');
    if (process.env.CI) process.exit(1);
    return;
  }

  const server = await serveDist();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: 'CitrusPrerender/1.0' });
  const failures = [];

  for (const route of PRERENDER_ROUTES) {
    const page = await context.newPage();
    try {
      // 'load', not 'networkidle': a page that polls or keeps a socket open
      // never goes idle and would time out for no reason. The page has
      // rendered when the shell's #root has a heading in it (attached, not
      // necessarily visible: some pages hide the desktop heading below lg).
      await page.goto(`${origin}${route}`, { waitUntil: 'load', timeout: 45_000 });
      await page.waitForSelector('#root h1', { state: 'attached', timeout: 30_000 });
      await page.waitForTimeout(400);
      let html = await page.content();
      // Mark the document so main.tsx knows which route it carries.
      html = html.replace('<html', `<html data-prerendered="${route}"`);
      const outDir = route === '/' ? DIST : join(DIST, route.slice(1));
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'index.html'), html);
      const text = await page.evaluate(() => document.querySelector('#root')?.textContent?.trim().length ?? 0);
      console.log(`prerender: ${route.padEnd(20)} ${String(text).padStart(6)} chars of text`);
      if (text < 200) failures.push(`${route}: only ${text} chars of text`);
    } catch (err) {
      failures.push(`${route}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  server.close();
  if (failures.length) {
    console.error('prerender: FAILED\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log(`prerender: ${PRERENDER_ROUTES.length} routes written`);
}

main().catch((err) => {
  console.error('prerender: crashed', err);
  process.exit(1);
});
