import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeSkeleton } from '../routeSkeleton';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP = readFileSync(resolve(HERE, '..', '..', 'App.tsx'), 'utf8');

describe('routeSkeleton — the Suspense fallback knows the screen from the path', () => {
  it('maps every league screen to its own skeleton under the league silhouette', () => {
    expect(routeSkeleton('/roster')).toEqual({ kind: 'roster', chrome: 'league' });
    expect(routeSkeleton('/team/abc')).toEqual({ kind: 'roster', chrome: 'league' });
    expect(routeSkeleton('/standings')).toEqual({ kind: 'standings', chrome: 'league' });
    expect(routeSkeleton('/matchup/L1/3')).toEqual({ kind: 'matchup', chrome: 'league' });
    expect(routeSkeleton('/league/L1')).toEqual({ kind: 'hq', chrome: 'league' });
    expect(routeSkeleton('/league/L1/playoffs')).toEqual({ kind: 'bracket', chrome: 'league' });
    expect(routeSkeleton('/free-agents')).toEqual({ kind: 'players', chrome: 'league' });
    expect(routeSkeleton('/waiver-wire')).toEqual({ kind: 'players', chrome: 'league' });
  });

  it('maps the app tabs under the app silhouette', () => {
    expect(routeSkeleton('/')).toEqual({ kind: 'home', chrome: 'app' });
    expect(routeSkeleton('/scores')).toEqual({ kind: 'scores', chrome: 'app' });
    expect(routeSkeleton('/players')).toEqual({ kind: 'browse', chrome: 'app' });
    expect(routeSkeleton('/players/8478402')).toEqual({ kind: 'browse', chrome: 'app' });
    expect(routeSkeleton('/news')).toEqual({ kind: 'news', chrome: 'app' });
    expect(routeSkeleton('/profile')).toEqual({ kind: 'account', chrome: 'app' });
  });

  it('draws no chrome for auth and the draft room, where a header would be wrong', () => {
    expect(routeSkeleton('/auth')).toEqual({ kind: 'list', chrome: 'none' });
    expect(routeSkeleton('/draft-v2/L1')).toEqual({ kind: 'list', chrome: 'none' });
    expect(routeSkeleton('/nowhere')).toEqual({ kind: 'list', chrome: 'none' });
  });

  it('names only paths App.tsx declares', () => {
    const declared = Array.from(APP.matchAll(/path="([^"]+)"/g)).map((m) => m[1]);
    const referenced = ['/roster', '/team/:teamId', '/standings', '/matchup', '/league/:leagueId', '/league/:leagueId/playoffs',
      '/free-agents', '/waiver-wire', '/trade-analyzer', '/schedule-manager', '/team-analytics', '/gm-office',
      '/players', '/scores', '/news', '/profile', '/create-league', '/settings', '/'];
    referenced.forEach((r) => expect(declared, r).toContain(r));
  });
});
