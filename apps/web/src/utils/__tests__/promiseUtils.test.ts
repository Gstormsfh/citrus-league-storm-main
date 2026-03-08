import { describe, it, expect, vi } from 'vitest';
import { withTimeout } from '../promiseUtils';

describe('withTimeout', () => {
  it('resolves when the promise finishes before the timeout', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, 1000);
    expect(result).toBe('success');
  });

  it('resolves with the correct value for non-string types', async () => {
    const promise = Promise.resolve(42);
    const result = await withTimeout(promise, 1000);
    expect(result).toBe(42);
  });

  it('resolves with objects', async () => {
    const data = { id: 1, name: 'test' };
    const promise = Promise.resolve(data);
    const result = await withTimeout(promise, 1000);
    expect(result).toEqual(data);
  });

  it('rejects with timeout error when promise takes too long', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slowPromise, 10)).rejects.toThrow('Request timed out');
  });

  it('uses the default error message when none is provided', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slowPromise, 10)).rejects.toThrow('Request timed out');
  });

  it('uses a custom error message when provided', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slowPromise, 10, 'Custom timeout')).rejects.toThrow('Custom timeout');
  });

  it('propagates the original error when the promise rejects before timeout', async () => {
    const failingPromise = Promise.reject(new Error('original error'));
    await expect(withTimeout(failingPromise, 1000)).rejects.toThrow('original error');
  });

  it('clears the timeout when the promise resolves successfully', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const promise = Promise.resolve('done');
    await withTimeout(promise, 5000);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('clears the timeout when the promise rejects', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const failingPromise = Promise.reject(new Error('fail'));
    try {
      await withTimeout(failingPromise, 5000);
    } catch {
      // expected
    }
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('resolves with null when the promise resolves with null', async () => {
    const result = await withTimeout(Promise.resolve(null), 1000);
    expect(result).toBeNull();
  });

  it('resolves with undefined when the promise resolves with undefined', async () => {
    const result = await withTimeout(Promise.resolve(undefined), 1000);
    expect(result).toBeUndefined();
  });

  it('rejects with a proper Error instance on timeout', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      await withTimeout(slowPromise, 10);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('works with a very short timeout when the promise is already resolved', async () => {
    const result = await withTimeout(Promise.resolve('fast'), 1);
    expect(result).toBe('fast');
  });

  it('handles a promise that resolves with an array', async () => {
    const result = await withTimeout(Promise.resolve([1, 2, 3]), 1000);
    expect(result).toEqual([1, 2, 3]);
  });
});
