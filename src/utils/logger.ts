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

// Override global console methods to silence all output (Sleeper-style)
// This ensures even direct console.log() calls are silenced
if (typeof window !== 'undefined') {
  const noop = () => {};
  
  // Store original console methods (in case we need them for debugging)
  // Access via: window.__originalConsole.log('debug message')
  (window as any).__originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    table: console.table,
    group: console.group,
    groupEnd: console.groupEnd,
    groupCollapsed: console.groupCollapsed,
    trace: console.trace,
    time: console.time,
    timeEnd: console.timeEnd,
    count: console.count,
    clear: console.clear,
  };
  
  // Override ALL console methods with no-ops
  console.log = noop;
  console.error = noop;
  console.warn = noop;
  console.info = noop;
  console.debug = noop;
  console.table = noop;
  console.group = noop;
  console.groupEnd = noop;
  console.groupCollapsed = noop;
  console.trace = noop;
  console.time = noop;
  console.timeEnd = noop;
  console.count = noop;
  console.clear = noop;
  
  // Also silence console.assert, console.dir, etc.
  if (console.assert) console.assert = noop;
  if (console.dir) console.dir = noop;
  if (console.dirxml) console.dirxml = noop;
  if (console.profile) console.profile = noop;
  if (console.profileEnd) console.profileEnd = noop;
  
  // Silence React DevTools if present
  if ((window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook.onCommitFiberRoot) {
      hook.onCommitFiberRoot = function(..._args: any[]) {
        // Silent - no React DevTools console output
      };
    }
  }
}
