import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { watchServiceWorkerUpdates } from '../serviceWorkerUpdates';

class Workers extends EventTarget {
  controller: object | null = { version: 'old' };
  update = vi.fn().mockResolvedValue(undefined);
  register = vi.fn().mockResolvedValue({ update: this.update });
}
let workers: Workers;
let stop: (() => void) | undefined;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers();
  workers = new Workers();
  vi.stubGlobal('navigator', { serviceWorker: workers, onLine: true });
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('cached page upgrade lifecycle', () => {
  it('registers even when the app booted after load, and explicitly checks for a worker update', async () => {
    stop = watchServiceWorkerUpdates(vi.fn());
    await flush();
    expect(workers.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    expect(workers.update).toHaveBeenCalledOnce();
  });
  it('waits for load when the document is still loading', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    stop = watchServiceWorkerUpdates(vi.fn());
    expect(workers.register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    await flush();
    expect(workers.register).toHaveBeenCalledOnce();
  });
  it('offers an update when a new worker controls an existing page, without forcing reload', () => {
    const ready = vi.fn();
    stop = watchServiceWorkerUpdates(ready);
    workers.controller = { version: 'new' };
    workers.dispatchEvent(new Event('controllerchange'));
    expect(ready).toHaveBeenCalledOnce();
    workers.dispatchEvent(new Event('controllerchange'));
    expect(ready).toHaveBeenCalledOnce();
  });
  it('does not label the initial offline installation as an application update', () => {
    workers.controller = null;
    const ready = vi.fn();
    stop = watchServiceWorkerUpdates(ready);
    workers.controller = { version: 'first' };
    workers.dispatchEvent(new Event('controllerchange'));
    expect(ready).not.toHaveBeenCalled();
  });
  it('checks when returning to a visible online tab and coalesces event bursts', async () => {
    stop = watchServiceWorkerUpdates(vi.fn()); await flush();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(workers.update).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(workers.update).toHaveBeenCalledTimes(2);
  });
  it('does not check hidden/offline tabs and tolerates update failures', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    stop = watchServiceWorkerUpdates(vi.fn()); await flush();
    expect(workers.update).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('navigator', { serviceWorker: workers, onLine: false });
    window.dispatchEvent(new Event('online')); await flush();
    expect(workers.update).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { serviceWorker: workers, onLine: true });
    workers.update.mockRejectedValueOnce(new Error('network unavailable'));
    window.dispatchEvent(new Event('online')); await flush();
    expect(workers.update).toHaveBeenCalledOnce();
  });
  it('removes listeners when disposed and does not update after late registration', async () => {
    const ready = vi.fn();
    stop = watchServiceWorkerUpdates(ready); stop(); await flush();
    workers.controller = { version: 'later' };
    workers.dispatchEvent(new Event('controllerchange'));
    expect(ready).not.toHaveBeenCalled();
    expect(workers.update).not.toHaveBeenCalled();
  });
  it('does not block boot on registration failure or unavailable service workers', async () => {
    workers.register.mockRejectedValueOnce(new Error('denied'));
    stop = watchServiceWorkerUpdates(vi.fn()); await flush(); stop();
    vi.stubGlobal('navigator', {});
    expect(() => watchServiceWorkerUpdates(vi.fn())()).not.toThrow();
  });
});

it.each(['../../firebase.json', 'firebase.json'])('stable worker scripts revalidate in deployment config %s', (file) => {
  // Production CI invokes Hosting from the repository root; local web
  // commands use the workspace config. Both must carry the same exception.
  const config = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const rules = config.hosting.headers;
  for (const source of ['/sw.js', '/registerSW.js']) {
    const index = rules.findIndex((rule: { source: string }) => rule.source === source);
    const general = rules.findIndex((rule: { source: string }) => rule.source.includes('js|css'));
    expect(index).toBeGreaterThan(general);
    expect(rules[index].headers).toContainEqual({ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' });
  }
});


it('production Hosting selects the root config with worker cache exceptions', () => {
  const workflow = readFileSync(resolve('../../.github/workflows/production-deploy.yml'), 'utf8');
  const action = workflow.split('- name: Deploy to Firebase')[1]?.split('- name:')[0];
  expect(action).toContain('uses: FirebaseExtended/action-hosting-deploy@v0');
  // entryPoint defaults to the repository root, not apps/web, in this action.
  const entryPoint = action.match(/entryPoint:\s*["']?([^"'\s]+)/)?.[1] ?? '.';
  const config = JSON.parse(readFileSync(resolve('../..', entryPoint, 'firebase.json'), 'utf8'));
  expect(config.hosting.public).toBe('apps/web/dist');
  for (const source of ['/sw.js', '/registerSW.js']) {
    expect(config.hosting.headers).toContainEqual({ source, headers: [
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
    ] });
  }
});
