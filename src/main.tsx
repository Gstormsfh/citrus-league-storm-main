// Import React first to ensure it's available
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
// Import logger early to silence all console output (Sleeper-style)
import './utils/logger'
// Initialize Sentry error monitoring (no-ops if not installed or configured)
import { initSentry } from './integrations/sentry/config'
initSentry();

// Ensure root element exists
const rootElement = document.getElementById("root");
if (!rootElement) {
  // Silent - no console output (Sleeper-style)
  document.body.innerHTML = '<div style="padding: 20px; font-family: sans-serif;"><h1 style="color: red;">Error: Root element not found!</h1></div>';
  throw new Error("Root element not found! Make sure index.html has <div id='root'></div>");
}

// Clear loading screen inline styles so the app can scroll normally
rootElement.removeAttribute('style');

// Tell the index.html boot monitor that React is taking over
(window as any).__REACT_MOUNTED = true;

// Add error handling for the root render
try {
  const root = createRoot(rootElement);

  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );

} catch (error) {
  console.error('Critical render error:', error);
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 20px; font-family: sans-serif; background: white; min-height: 100vh; display: flex; align-items: center; justify-content: center;">
        <div style="max-width: 600px;">
          <h1 style="color: red; font-size: 24px; margin-bottom: 16px;">Critical Error</h1>
          <p style="color: #666; margin-bottom: 16px;">The application failed to start. Check the console for details.</p>
          <pre style="background: #f5f5f5; padding: 16px; border-radius: 4px; overflow: auto; border: 1px solid #ddd; font-size: 12px;">
            <strong>Error:</strong> ${error instanceof Error ? error.message : String(error)}
            ${error instanceof Error && error.stack ? `\n\n<strong>Stack:</strong>\n${error.stack}` : ''}
          </pre>
        </div>
      </div>
    `;
  }
}

// Auto-reload once on chunk load failures (stale cache after deploy)
function handleChunkError(errorMsg: string): boolean {
  const isChunkError = errorMsg.includes('Failed to fetch dynamically imported module')
    || errorMsg.includes('Unexpected token')
    || errorMsg.includes('Loading chunk')
    || errorMsg.includes('Loading CSS chunk');

  if (isChunkError) {
    const lastReload = sessionStorage.getItem('chunk_reload');
    const now = Date.now();
    // Only auto-reload once per 30 seconds to avoid infinite loops
    if (!lastReload || now - parseInt(lastReload) > 30000) {
      sessionStorage.setItem('chunk_reload', String(now));
      window.location.reload();
      return true;
    }
  }
  return false;
}

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  const msg = event.error?.message || event.message || '';
  if (handleChunkError(msg)) return;
});

// Handle unhandled promise rejections (dynamic imports fail as rejected promises)
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason) || '';
  if (handleChunkError(msg)) return;
});
