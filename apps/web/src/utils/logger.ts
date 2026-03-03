/**
 * Centralized logging utility - SLEEPER STYLE
 * Clean console in production, errors/warns visible in development
 */

const isDev = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Keep a reference to native console methods before anything overrides them
const nativeConsole = {
  error: typeof console !== 'undefined' ? console.error.bind(console) : () => {},
  warn: typeof console !== 'undefined' ? console.warn.bind(console) : () => {},
};

export const logger = {
  log: (..._args: any[]) => {
    // Silent - no console output (Sleeper-style)
  },

  error: (...args: any[]) => {
    // Always surface errors so developers can debug
    nativeConsole.error(...args);
  },

  warn: (...args: any[]) => {
    if (isDev) nativeConsole.warn(...args);
  },

  debug: (..._args: any[]) => {
    // Silent - no console output (Sleeper-style)
  },

  info: (..._args: any[]) => {
    // Silent - no console output (Sleeper-style)
  },
};

// Silence verbose console output but keep error/warn visible for debugging
if (typeof window !== 'undefined') {
  const noop = () => {};

  // Silence verbose methods — keep console.error and console.warn so crashes are visible
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.table = noop;
  console.group = noop;
  console.groupEnd = noop;
  console.groupCollapsed = noop;
  console.time = noop;
  console.timeEnd = noop;
  console.count = noop;
}
