// Import React first to ensure it's available
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
// Import logger early to silence all console output (Sleeper-style)
import './utils/logger'

// Ensure root element exists
const rootElement = document.getElementById("root");
if (!rootElement) {
  // Silent - no console output (Sleeper-style)
  document.body.innerHTML = '<div style="padding: 20px; font-family: sans-serif;"><h1 style="color: red;">Error: Root element not found!</h1></div>';
  throw new Error("Root element not found! Make sure index.html has <div id='root'></div>");
}

// Add error handling for the root render
try {
  const root = createRoot(rootElement);
  
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
  
} catch (error) {
  // Silent - no console output (Sleeper-style)
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

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  // Silent - no console output (Sleeper-style)
  if (rootElement && rootElement.innerHTML.includes('Loading application...')) {
    rootElement.innerHTML = `
      <div style="padding: 20px; font-family: sans-serif; background: white; min-height: 100vh;">
        <h1 style="color: red; font-size: 24px; margin-bottom: 16px;">JavaScript Error</h1>
        <p style="color: #666; margin-bottom: 16px;">An error occurred while loading the application.</p>
        <pre style="background: #f5f5f5; padding: 16px; border-radius: 4px; overflow: auto; border: 1px solid #ddd;">
          <strong>Error:</strong> ${event.error?.message || event.message || 'Unknown error'}
          ${event.error?.stack ? `\n\n<strong>Stack:</strong>\n${event.error.stack}` : ''}
        </pre>
      </div>
    `;
  }
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  // Silent - no console output (Sleeper-style)
  if (rootElement && rootElement.innerHTML.includes('Loading application...')) {
    rootElement.innerHTML = `
      <div style="padding: 20px; font-family: sans-serif; background: white; min-height: 100vh;">
        <h1 style="color: red; font-size: 24px; margin-bottom: 16px;">Loading Error</h1>
        <p style="color: #666; margin-bottom: 16px;">A module failed to load. This might be a network issue.</p>
        <pre style="background: #f5f5f5; padding: 16px; border-radius: 4px; overflow: auto; border: 1px solid #ddd;">
          <strong>Error:</strong> ${event.reason?.message || String(event.reason) || 'Unknown error'}
        </pre>
      </div>
    `;
  }
});
