import type { DeskFile } from '../deskConnection';
import { SCORING_DEFAULTS } from '@citrus/shared';
export function deskFixture(): DeskFile {
  const { plus_minus: _unsupported, ...skater } = SCORING_DEFAULTS.skater;
  return { kind: 'citrus-connected-desk', version: 1, kit: {
    version: 1, fingerprint: 'a'.repeat(64), revision: 'b'.repeat(64), projectionDate: '2026-09-12', league: 'My custom league',
    weights: { skater, goalie: { ...SCORING_DEFAULTS.goalie } },
    players: [
      { key: 'canonical:8478402', name: 'Connor McDavid', team: 'EDM', position: 'C', rank: 1, points: 900, games: 80, goalie: false, totals: { goals: 40, assists: 80 } },
      { key: 'canonical:8482116', name: 'Tim Stützle', team: 'OTT', position: 'C', rank: 2, points: 600, games: 80, goalie: false, totals: { goals: 30, assists: 60 } },
    ],
  }, progress: { version: 1, fingerprint: 'a'.repeat(64), rows: [
    { key: 'canonical:8478402', drafted: true, target: true, note: 'My first option' },
  ] } };
}
