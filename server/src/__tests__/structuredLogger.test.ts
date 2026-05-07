// Phase 4.5 chunk 11g.7 sub-step 7a — structured logger unit tests.
//
// Covers JSON shape, GCP severity mapping (`warn` → `WARNING`),
// LOG_LEVEL env filtering (DEBUG/INFO/WARNING/ERROR/SILENT), error
// extraction (Error vs unknown thrown values), context merging,
// and ISO timestamp formatting.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConsoleStructuredLogger } from '@citrus/shared';

/**
 * Snapshot the env so each test can mutate `process.env.LOG_LEVEL`
 * freely without leaking. The structured logger reads `LOG_LEVEL`
 * at construction time, so each test that exercises level
 * filtering creates a fresh logger after setting the env.
 */
let originalLogLevel: string | undefined;

beforeEach(() => {
  originalLogLevel = process.env.LOG_LEVEL;
  // Tests assert on console.log / console.error, so re-enable
  // emission via INFO default. Vitest setup file sets SILENT
  // for test runs — override per-test.
  process.env.LOG_LEVEL = 'DEBUG';
});

afterEach(() => {
  if (originalLogLevel === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = originalLogLevel;
  }
  vi.restoreAllMocks();
});

function capture() {
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { stdout, stderr };
}

describe('structuredLogger (chunk 11g.7 sub-step 7a)', () => {
  it('emits info as JSON with severity=INFO and time=ISO 8601', () => {
    const { stdout } = capture();
    const log = createConsoleStructuredLogger();
    log.info('lobby.constructed', { lobbyId: 'lobby-1', leagueId: 'league-1' });

    expect(stdout).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(stdout.mock.calls[0][0] as string);
    expect(parsed.severity).toBe('INFO');
    expect(parsed.event).toBe('lobby.constructed');
    expect(parsed.lobbyId).toBe('lobby-1');
    expect(parsed.leagueId).toBe('league-1');
    // ISO 8601 of the form 2026-05-07T12:34:56.789Z
    expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('emits warn as severity=WARNING (GCP-canonical name) on stderr', () => {
    const { stdout, stderr } = capture();
    const log = createConsoleStructuredLogger();
    log.warn('rpc.broadcast_failed', { eventId: 42 });

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(stderr.mock.calls[0][0] as string);
    expect(parsed.severity).toBe('WARNING');
    expect(parsed.event).toBe('rpc.broadcast_failed');
    expect(parsed.eventId).toBe(42);
  });

  it('emits error as severity=ERROR on stderr with err.message + err.stack', () => {
    const { stderr } = capture();
    const log = createConsoleStructuredLogger();
    const err = new Error('synthetic failure');
    log.error('rpc.threw', { lobbyId: 'lobby-1' }, err);

    const parsed = JSON.parse(stderr.mock.calls[0][0] as string);
    expect(parsed.severity).toBe('ERROR');
    expect(parsed.err.name).toBe('Error');
    expect(parsed.err.message).toBe('synthetic failure');
    expect(typeof parsed.err.stack).toBe('string');
    expect(parsed.err.stack.length).toBeGreaterThan(0);
  });

  it('emits error with serialized non-Error thrown values', () => {
    const { stderr } = capture();
    const log = createConsoleStructuredLogger();
    log.error('callback.threw', {}, 'plain string');

    const parsed = JSON.parse(stderr.mock.calls[0][0] as string);
    expect(parsed.err).toEqual({ message: 'plain string' });
    // No stack, no name for non-Error values.
    expect(parsed.err.stack).toBeUndefined();
    expect(parsed.err.name).toBeUndefined();
  });

  it('truncates very long stack traces to 2 KB', () => {
    const { stderr } = capture();
    const log = createConsoleStructuredLogger();
    const err = new Error('big');
    err.stack = 'A'.repeat(5000);
    log.error('big.err', {}, err);

    const parsed = JSON.parse(stderr.mock.calls[0][0] as string);
    expect(parsed.err.stack.length).toBe(2048);
  });

  it('LOG_LEVEL=INFO suppresses DEBUG emits', () => {
    process.env.LOG_LEVEL = 'INFO';
    const { stdout } = capture();
    const log = createConsoleStructuredLogger();
    log.debug('hot.path', { lobbyId: 'lobby-1' });
    expect(stdout).not.toHaveBeenCalled();
  });

  it('LOG_LEVEL=ERROR suppresses INFO and WARNING emits', () => {
    process.env.LOG_LEVEL = 'ERROR';
    const { stdout, stderr } = capture();
    const log = createConsoleStructuredLogger();
    log.info('event.a', {});
    log.warn('event.b', {});
    log.error('event.c', {});
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1); // only the error
    const parsed = JSON.parse(stderr.mock.calls[0][0] as string);
    expect(parsed.severity).toBe('ERROR');
  });

  it('LOG_LEVEL=SILENT short-circuits ALL emits (test-environment default)', () => {
    process.env.LOG_LEVEL = 'SILENT';
    const { stdout, stderr } = capture();
    const log = createConsoleStructuredLogger();
    log.debug('event.a', {});
    log.info('event.b', {});
    log.warn('event.c', {});
    log.error('event.d', {});
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('LOG_LEVEL=WARN is normalized to WARNING', () => {
    process.env.LOG_LEVEL = 'WARN';
    const { stdout, stderr } = capture();
    const log = createConsoleStructuredLogger();
    log.info('event.a', {});
    log.warn('event.b', {});
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it('merges arbitrary context fields preserving cross-cutting standardized fields', () => {
    const { stdout } = capture();
    const log = createConsoleStructuredLogger();
    log.info('action.processed', {
      correlationId: 'corr-123',
      lobbyId: 'lobby-1',
      teamId: 'team-A',
      // arbitrary action-specific fields:
      bidAmount: 25,
      strategySource: 'projections',
    });
    const parsed = JSON.parse(stdout.mock.calls[0][0] as string);
    expect(parsed.correlationId).toBe('corr-123');
    expect(parsed.lobbyId).toBe('lobby-1');
    expect(parsed.teamId).toBe('team-A');
    expect(parsed.bidAmount).toBe(25);
    expect(parsed.strategySource).toBe('projections');
  });

  it('handles undefined context arg gracefully', () => {
    const { stdout } = capture();
    const log = createConsoleStructuredLogger();
    log.info('startup.ready');
    const parsed = JSON.parse(stdout.mock.calls[0][0] as string);
    expect(parsed.severity).toBe('INFO');
    expect(parsed.event).toBe('startup.ready');
  });

  it('default no-op singleton emits nothing without activation', async () => {
    const { stdout, stderr } = capture();
    const { structuredLogger } = await import('@citrus/shared');
    structuredLogger.info('event.a', {});
    structuredLogger.warn('event.b', {});
    structuredLogger.error('event.c', {});
    structuredLogger.debug('event.d', {});
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});
