import { useEffect, useRef, type MutableRefObject } from 'react';

const createLifetime = () => ({ active: true, timers: new Set<ReturnType<typeof setTimeout>>() });

/** Owns continuations and loader deadlines for one mounted Matchup page. */
export function useMatchupRouteLifetime(loading: MutableRefObject<boolean>) {
  const lifetime = useRef(createLifetime());
  useEffect(() => {
    const current = createLifetime();
    lifetime.current = current;
    return () => {
      current.active = false;
      current.timers.forEach(clearTimeout);
      current.timers.clear();
      loading.current = false; // StrictMode setup may reuse this ref with a new lifetime.
    };
  }, [loading]);
  return lifetime;
}
