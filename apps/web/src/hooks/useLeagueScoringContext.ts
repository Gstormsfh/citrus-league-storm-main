import { useEffect, useState } from 'react';
import { LeagueService, type League } from '@/services/LeagueService';

type Seed = Pick<League, 'id' | 'scoring_settings'> & Partial<League>;
/** League-keyed scoring hydration. Missing settings during a read never imply default scoring. */
export function useLeagueScoringContext(leagueId?: string | null, seedLeague?: Seed | null, enabled = true, allowPreview = false) {
  const seed = seedLeague != null && seedLeague.id === leagueId && Object.prototype.hasOwnProperty.call(seedLeague, 'scoring_settings') && seedLeague.scoring_settings !== undefined ? seedLeague : null;
  const seedKey = JSON.stringify(seed?.scoring_settings ?? null);
  const [state, setState] = useState<{ id: string; seedKey: string; league: Seed | null; ready: boolean } | null>(null);
  useEffect(() => {
    if (!enabled || !leagueId) return;
    let cancelled = false;
    let request = 0;
    setState({ id: leagueId, seedKey, league: seed, ready: Boolean(seed) });
    const refresh = async () => {
      const version = ++request;
      try {
        const result = await LeagueService.getLeague(leagueId);
        if (cancelled || version !== request) return;
        if (result.error || !result.league || result.league.id !== leagueId || !Object.prototype.hasOwnProperty.call(result.league, 'scoring_settings') || result.league.scoring_settings === undefined) throw new Error('League scoring unavailable');
        setState({ id: leagueId, seedKey, league: result.league, ready: true });
      } catch {
        if (!cancelled && version === request) setState(previous => ({ id: leagueId, seedKey, league: previous?.id === leagueId ? previous.league : null, ready: false }));
      }
    };
    // A matching context row already hydrated this render. Avoid replacing a
    // just-edited context with the service cache from before that edit.
    if (!seed) void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 120_000);
    const seededAt = Date.now();
    const focus = () => { if (!seed || Date.now() - seededAt >= 30_000) void refresh(); };
    window.addEventListener('focus', focus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', focus); };
    // Seed identity objects are recreated by context. Their scoring value is the invalidation key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, seedKey, enabled]);
  const current = state != null && state.id === leagueId && state.seedKey === seedKey ? state : null;
  const league = current?.league ?? seed;
  return {
    league,
    scoring: league?.scoring_settings ?? undefined,
    ready: enabled && (leagueId ? (current ? current.ready : Boolean(seed)) : allowPreview),
  };
}
