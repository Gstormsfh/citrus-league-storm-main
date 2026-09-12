/** Keep a loaded page usable, but offer an explicit reload when a newer worker
 * takes control. Registration alone does not replace the document's JS. */
export function watchServiceWorkerUpdates(onUpdateReady: () => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {};
  const workers = navigator.serviceWorker;
  let controller = workers.controller;
  let registration: ServiceWorkerRegistration | undefined;
  let stopped = false;
  let checking = false;
  let lastCheck = -Infinity;

  const changed = () => {
    const next = workers.controller;
    if (controller && next && next !== controller) onUpdateReady();
    controller = next;
  };
  const check = async () => {
    if (!registration || stopped || checking || document.visibilityState !== 'visible'
      || navigator.onLine === false || Date.now() - lastCheck < 60_000) return;
    checking = true;
    lastCheck = Date.now();
    try { await registration.update(); } catch { /* Offline or transient failure: keep the current page. */ }
    finally { checking = false; }
  };
  const register = async () => {
    try {
      const result = await workers.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      if (stopped) return;
      registration = result;
      void check();
    } catch { /* Registration failure must not block the app. */ }
  };
  workers.addEventListener('controllerchange', changed);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', register, { once: true });
  return () => {
    stopped = true;
    workers.removeEventListener('controllerchange', changed);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('online', check);
    window.removeEventListener('load', register);
  };
}
