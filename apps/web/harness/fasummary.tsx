import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { Card, CardContent, CardHeader, CardTitle } from '../src/components/ui/card';
import { FreeAgentSummaryTable } from '../src/components/freeagents/FreeAgentSummaryTable';
import { HARNESS_PLAYERS, harnessHeadshotUrl } from './players';

// The two summary cards on desktop Free Agents, side by side at the width
// they get between the two rails (about 430px each at 1512). `?w=NNN` sets
// the card width. Names are the long ones on purpose.
const w = Number(new URLSearchParams(location.search).get('w') || 430);
const games = (team: string) => [
  { game_date: '2026-09-29', home_team: team, away_team: 'BOS' },
  { game_date: '2026-10-01', home_team: 'TBL', away_team: team },
  { game_date: '2026-10-03', home_team: team, away_team: 'DET' },
] as never;
const base = HARNESS_PLAYERS.slice(0, 6).map((h, i) => ({
  id: String(h.nhlId), full_name: h.name, position: h.position, eligible_positions: [h.position], team: h.team,
  jersey_number: h.jersey, status: null, headshot_url: harnessHeadshotUrl(h.team, h.nhlId), last_updated: null,
  games_played: 80, goals: 30, assists: 40, points: 70, plus_minus: 5, shots: 200, hits: 10, blocks: 10, xGoals: 20,
  wins: null, losses: null, ot_losses: null, saves: null, goals_against_average: null, save_percentage: null,
  highDangerSavePct: 0, goalsSavedAboveExpected: 0, is_on_waivers: i === 1, games: games(h.team),
  adds: 120 - i * 17, weeklyProjection: 14.4 - i * 0.3, gamesThisWeek: 3, expectedStarts: h.position === 'G' ? 1.9 : null,
}));
const noop = () => {};
const common = { positionType: 'individual' as const, isWatched: (p: { id: string }) => p.id === base[2].id, addState: (p: { is_on_waivers?: boolean }) => (p.is_on_waivers ? 'claim' as const : 'add' as const), pendingPlayerId: null, onOpen: noop, onToggleWatch: noop, onAdd: noop };
createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
    <div style={{ width: w }}>
      <Card><CardHeader><CardTitle>Top Trending</CardTitle></CardHeader><CardContent>
        <FreeAgentSummaryTable players={base as never} metric={{ header: 'Adds', render: (p) => <span className="font-bold text-green-600">{(p as { adds: number }).adds}</span> }} {...common} />
      </CardContent></Card>
    </div>
    <div style={{ width: w }}>
      <Card><CardHeader><CardTitle>Top Projected</CardTitle></CardHeader><CardContent>
        <FreeAgentSummaryTable players={base as never} metric={{ header: 'Proj', render: (p) => {
          const q = p as { weeklyProjection: number; position: string; expectedStarts: number | null };
          return (
            <div className="flex flex-col items-end">
              <span className="font-bold text-pastel-sage-soft">{q.weeklyProjection.toFixed(1)}</span>
              <span className="text-[10px] text-white/55 whitespace-nowrap">{q.position === 'G' ? `${q.expectedStarts?.toFixed(1)} STARTS` : '3 TEAM GP'}</span>
            </div>
          );
        } }} {...common} />
      </CardContent></Card>
    </div>
  </div>,
);
