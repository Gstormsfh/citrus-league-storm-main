import { useLayoutEffect, useRef } from 'react';

/** Local diagnostics only. Epoch milliseconds share the browser/driver clock;
 * nextFrame is an rAF observation, not a guarantee that pixels were painted. */
export function createLoadTiming() {
  let scope = '';
  let generation = 0;
  let node: HTMLElement | null = null;
  let delivered: unknown;
  let observed: { value: unknown; loading: boolean; hasRows: boolean } | undefined;
  let frame: number | undefined;
  let snapshot: { pageStart: number; scope: number; load: number; stages: Record<string, number> } = { pageStart: Date.now(), scope: 0, load: 0, stages: {} };
  const flush = () => node?.setAttribute('data-load-timing', JSON.stringify(snapshot));
  const cancelFrame = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; };
  const mark = (token: number, stage: string) => {
    if (token !== generation) return;
    snapshot.stages[stage] ??= Date.now();
    // A background refresh may settle without another React render.
    if (stage === 'loadSettled' && delivered !== undefined && observed?.value === delivered
      && !observed.loading && observed.hasRows && snapshot.stages.error === undefined) {
      snapshot.stages.usableDataComplete ??= Date.now();
    }
    flush();
  };
  return {
    attach(element: HTMLElement | null) { node = element; flush(); },
    scope(key: string) {
      if (scope === key) return;
      scope = key;
      generation++;
      delivered = undefined;
      cancelFrame();
      snapshot = { pageStart: snapshot.pageStart, scope: snapshot.scope + 1, load: 0, stages: { scopeStart: Date.now() } };
      flush();
    },
    begin(key: string) {
      if (key !== scope) return -1;
      cancelFrame();
      delivered = undefined;
      generation++;
      const { scopeStart, authReady, leagueReady } = snapshot.stages;
      snapshot = { pageStart: snapshot.pageStart, scope: snapshot.scope, load: snapshot.load + 1, stages: {
        scopeStart, ...(authReady === undefined ? {} : { authReady }),
        ...(leagueReady === undefined ? {} : { leagueReady }), loadStart: Date.now(),
      } };
      flush();
      return generation;
    },
    mark,
    ready(auth: boolean, league: boolean) {
      if (auth) mark(generation, 'authReady');
      if (league) mark(generation, 'leagueReady');
    },
    delivered(token: number, value: unknown) {
      if (token !== generation) return;
      delivered = value;
      mark(token, 'dataDelivered');
    },
    observe(value: unknown, loading: boolean, hasRows: boolean) {
      observed = { value, loading, hasRows };
      if (delivered === undefined || delivered !== value) return;
      mark(generation, hasRows ? 'dataCommit' : 'emptyCommit');
      if (!loading && hasRows && snapshot.stages.loadSettled !== undefined && snapshot.stages.error === undefined) mark(generation, 'usableDataComplete');
      if (loading || !hasRows || snapshot.stages.error !== undefined || snapshot.stages.firstLineupCommit !== undefined) return;
      const token = generation;
      mark(token, 'firstLineupCommit');
      frame = requestAnimationFrame(() => { frame = undefined; mark(token, 'nextFrame'); });
    },
    dispose() { generation++; delivered = undefined; cancelFrame(); },
  };
}

export function useLoadTiming(scopeKey: string, rendered: unknown, loading: boolean, hasRows: boolean, authReady: boolean, leagueReady: boolean) {
  const ref = useRef<ReturnType<typeof createLoadTiming> | null>(null);
  if (!ref.current) ref.current = createLoadTiming();
  const timing = ref.current;
  useLayoutEffect(() => {
    timing.scope(scopeKey);
    timing.ready(authReady, leagueReady);
    timing.observe(rendered, loading, hasRows);
  });
  useLayoutEffect(() => () => timing.dispose(), [timing]);
  return { timing, rootRef: timing.attach, begin: () => timing.begin(scopeKey) };
}
