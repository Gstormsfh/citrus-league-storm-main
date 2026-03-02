/**
 * Centralized logging utility — shared across web and server
 *
 * In production, logging is silent (Sleeper-style).
 * Server-side implementations can override with createConsoleLogger().
 */

export interface Logger {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
}

const noop = (..._args: any[]) => {};

/**
 * Default silent logger — no console output
 * Override with createConsoleLogger() for environments that need real logging
 */
export const logger: Logger = {
  log: noop,
  error: noop,
  warn: noop,
  debug: noop,
  info: noop,
};

/**
 * Create a logger that actually outputs to console
 * Use this for the server where you want to see logs
 */
export function createConsoleLogger(): Logger {
  return {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console),
  };
}
