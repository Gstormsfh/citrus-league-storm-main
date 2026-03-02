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
