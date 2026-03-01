/**
 * Centralized logging utility - SLEEPER STYLE
 * Completely silent console - no noise, clean browser console
 * All logging methods are no-ops to eliminate console clutter
 */

export const logger = {
  log: (..._args: any[]) => {
    // Silent - no console output (Sleeper-style)
  },
  
  error: (..._args: any[]) => {
    // Silent - no console output (Sleeper-style)
  },
  
  warn: (..._args: any[]) => {
    // Silent - no console output (Sleeper-style)
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
