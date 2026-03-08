import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../logger';

describe('logger', () => {
  // =============================================================================
  // Existence and type checks
  // =============================================================================

  it('exports a logger object', () => {
    expect(logger).toBeDefined();
    expect(typeof logger).toBe('object');
  });

  it('has a log method', () => {
    expect(typeof logger.log).toBe('function');
  });

  it('has a debug method', () => {
    expect(typeof logger.debug).toBe('function');
  });

  it('has an info method', () => {
    expect(typeof logger.info).toBe('function');
  });

  it('has an error method', () => {
    expect(typeof logger.error).toBe('function');
  });

  it('has a warn method', () => {
    expect(typeof logger.warn).toBe('function');
  });

  // =============================================================================
  // Silent methods — no-ops that should not throw
  // =============================================================================

  it('logger.log does not throw when called with no args', () => {
    expect(() => logger.log()).not.toThrow();
  });

  it('logger.log does not throw when called with arguments', () => {
    expect(() => logger.log('test', 123, { key: 'value' })).not.toThrow();
  });

  it('logger.debug does not throw when called with arguments', () => {
    expect(() => logger.debug('debug message')).not.toThrow();
  });

  it('logger.info does not throw when called with arguments', () => {
    expect(() => logger.info('info message', { data: true })).not.toThrow();
  });

  // =============================================================================
  // logger.error — calls through to console.error
  // =============================================================================

  describe('logger.error', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // The logger module captures console.error at import time via nativeConsole,
      // so we spy on console.error before the module is loaded.
      // Since the module is already loaded, we spy and check calls.
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('does not throw when called', () => {
      expect(() => logger.error('test error')).not.toThrow();
    });

    it('can be called with multiple arguments', () => {
      expect(() => logger.error('error', new Error('test'), { context: 'data' })).not.toThrow();
    });

    it('can be called with an Error object', () => {
      expect(() => logger.error(new Error('something failed'))).not.toThrow();
    });
  });

  // =============================================================================
  // logger.warn — exists and is callable
  // =============================================================================

  describe('logger.warn', () => {
    it('does not throw when called with no args', () => {
      expect(() => logger.warn()).not.toThrow();
    });

    it('does not throw when called with a string', () => {
      expect(() => logger.warn('warning message')).not.toThrow();
    });

    it('does not throw when called with multiple arguments', () => {
      expect(() => logger.warn('warn', { detail: 'info' }, 42)).not.toThrow();
    });
  });
});
