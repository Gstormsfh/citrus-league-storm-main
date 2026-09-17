import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { PlayerPool } from '../src/components/draft/PlayerPool';
import { DEFAULT_SCORING } from '@citrus/shared';
import { HARNESS_PLAYERS, harnessHeadshotUrl } from './players';

// THE ROSTER IS REAL (harness/README.md): 20 of the 60 real players, real
// ids, faces on the NHL CDN. Stat lines are derived so sorting has spread.
const players = HARNESS_PLAYERS.slice(0, 20).map((h, i) => {
  const g = h.position === 'G';
  return {
    id: h.nhlId, full_name: h.name, position: h.position, eligible_positions: [h.position],
    team: h.team, jersey_number: h.jersey, status: null, headshot_url: harnessHeadshotUrl(h.team, h.nhlId), last_updated: null,
    games_played: 82 - i, goals: h.goals ?? 40 - i, assists: h.assists ?? 60 - i, points: h.points ?? 100 - 2 * i, plus_minus: h.plusMinus ?? 10 - i,
    shots: h.shots ?? 300 - 5 * i, hits: 50 + i, blocks: 40 + i, pim: 20, ppp: 30 - i, shp: 2, icetime_seconds: 1200 * (82 - i),
    xGoals: 30.5 - i, wins: g ? h.wins ?? 40 : null, losses: g ? h.losses ?? 20 : null, ot_losses: g ? h.otLosses ?? 5 : null,
    saves: g ? 1700 : null, shutouts: g ? 4 : null, goals_against_average: g ? h.gaa ?? 2.4 : null, save_percentage: g ? h.savePct ?? 0.915 : null,
    highDangerSavePct: 0, goalsSavedAboveExpected: 0,
  };
});
const proj = new Map(players.map((p, i) => [p.id, { total: 400 - i * 12.5, perGp: (400 - i * 12.5) / 80, gamesRemaining: 80 }]));
createRoot(document.getElementById('root')!).render(
  <div style={{ width: Number(new URLSearchParams(location.search).get('w') || 1040) }}>
    <PlayerPool
      availablePlayers={players as never}
      onPlayerSelect={() => {}}
      onPlayerDraft={() => {}}
      selectedPlayer={null}
      draftedPlayers={[]}
      isDraftActive
      isYourTurn
      scoringSettings={DEFAULT_SCORING}
      scoringReady
      projectedFptsMap={proj as never}
    />
  </div>,
);
