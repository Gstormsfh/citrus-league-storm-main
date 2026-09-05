/**
 * BOOT STAGES (PR3, 2026-09-04) — what the app loading screen's bar means.
 *
 * Motion board 2a: "Drive the progress bar from real boot stages: auth,
 * league context, first paint. Never fake-complete; if a stage exceeds 4s,
 * show the stage name under the bar." A bar that eases to 90% on a timer
 * and waits is a lie the user learns to distrust; this one moves when a
 * stage actually lands and the splash dismisses when the last one does.
 *
 * A module-scope store rather than context because the splash mounts
 * OUTSIDE AuthProvider (it has to be on screen before auth is known), and
 * the reporters are the providers themselves plus one component inside the
 * first route's Suspense boundary. `useSyncExternalStore` keeps the splash
 * in step without a render-loop of its own.
 */
import { useSyncExternalStore } from 'react';

export type BootStage = 'auth' | 'league' | 'paint';

/** In order, with the percent the bar reads once each is done. */
export const BOOT_STAGES: { key: BootStage; label: string; pct: number }[] = [
  { key: 'auth', label: 'Checking your session', pct: 25 },
  { key: 'league', label: 'Loading your leagues', pct: 55 },
  { key: 'paint', label: 'Drawing the first screen', pct: 100 },
];

const done = new Set<BootStage>();
const listeners = new Set<() => void>();
let version = 0;

export function reportBootStage(stage: BootStage): void {
  if (done.has(stage)) return;
  done.add(stage);
  version += 1;
  for (const l of listeners) l();
}

/** The furthest-along percent among the stages reported, and the first not yet done. */
export function bootProgress(): { pct: number; pending: { key: BootStage; label: string } | null; complete: boolean } {
  let pct = 0;
  let pending: { key: BootStage; label: string } | null = null;
  for (const s of BOOT_STAGES) {
    if (done.has(s.key)) pct = Math.max(pct, s.pct);
    else if (!pending) pending = { key: s.key, label: s.label };
  }
  return { pct, pending, complete: pending === null };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useBootProgress() {
  // The version is the snapshot; the derived object is computed per call
  // so the snapshot stays referentially stable between reports.
  useSyncExternalStore(subscribe, () => version, () => version);
  return bootProgress();
}

/** Tests only. */
export function _resetBootStages(): void {
  done.clear();
  version += 1;
  for (const l of listeners) l();
}
