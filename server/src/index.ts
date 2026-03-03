// Load .env from monorepo root before anything else
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env');
try {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file is optional — Cloud Run / production injects env vars directly
}

// ── Proxy support ─────────────────────────────────────────────────────
// Some environments (e.g., Cloud Run, container sandboxes) route outbound
// traffic through an HTTP proxy. Node.js's native fetch() does not honor
// https_proxy by default, so we configure undici's global dispatcher.
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.GLOBAL_AGENT_HTTP_PROXY;
if (proxyUrl) {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    console.log('[proxy] Global fetch proxy configured');
  } catch (e: any) {
    console.warn('[proxy] Failed to configure proxy:', e.message);
  }
}

import { serve } from '@hono/node-server';
import { app } from './app';

const port = parseInt(process.env.PORT || '3001', 10);

const server = serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`Citrus API server running on http://localhost:${info.port}`);
});

// ── Graceful shutdown ────────────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed. Goodbye.');
    process.exit(0);
  });

  // Force exit after 10 seconds if connections don't drain
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
