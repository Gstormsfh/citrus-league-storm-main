/**
 * Mobile layout harness — NOT part of the app bundle, NOT committed.
 *
 * Renders one real component at a real phone viewport so a layout bug can be
 * reproduced and measured in a browser instead of argued about. Services are
 * patched at runtime (they are plain objects), so nothing here touches the
 * network or Supabase.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../src/index.css';
import { PlayerService, type Player } from '../src/services/PlayerService';
import { rosterApi } from '../src/api/rosters';
import { DropPlayerForAddDialog } from '../src/components/freeagents/DropPlayerForAddDialog';
import { Toaster } from '../src/components/ui/toaster';

const POS = ['C', 'LW', 'RW', 'D', 'D', 'C', 'RW', 'LW', 'D', 'C', 'G', 'G'];

function mkPlayer(i: number): Player {
  const position = POS[i % POS.length];
  const goalie = position === 'G';
  return {
    id: String(9000 + i),
    full_name: `Roster Player ${String(i + 1).padStart(2, '0')}`,
    position,
    eligible_positions: [position],
    team: ['EDM', 'COL', 'TOR', 'BOS', 'TBL'][i % 5],
    jersey_number: String(i + 10),
    status: 'active',
    roster_status: null,
    is_ir_eligible: false,
    headshot_url: null,
    last_updated: null,
    games_played: goalie ? 40 - i : 82 - i,
    goals: goalie ? 0 : 30 - i,
    assists: goalie ? 0 : 40 - i,
    points: goalie ? 0 : 70 - 2 * i,
    plus_minus: 10 - i,
    shots: 200 - i,
    hits: 50 - i,
    blocks: 40 - i,
    pim: 20,
    ppp: 10,
    shp: 1,
    icetime_seconds: goalie ? 140000 : 70000,
    xGoals: 12,
    wins: goalie ? 25 : null,
    losses: goalie ? 15 : null,
    ot_losses: goalie ? 4 : null,
    saves: goalie ? 1200 : null,
    shutouts: goalie ? 3 : null,
    shots_faced: goalie ? 1320 : null,
    goals_against: goalie ? 110 : null,
    goals_against_average: goalie ? 2.51 : null,
    save_percentage: goalie ? 0.913 : null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
    goalie_gp: goalie ? 40 - i : undefined,
  } as Player;
}

// Roster size is the variable under test — ?n=22 for a deep roster.
const N = Number(new URLSearchParams(location.search).get('n') ?? 22);
const ROSTER = Array.from({ length: N }, (_, i) => mkPlayer(i));

// Runtime stubs. These are plain objects, so assignment is enough.
(rosterApi as any).getTeamRoster = async () => ({
  data: ROSTER.map((p) => ({ player_id: p.id })),
});
(PlayerService as any).getPlayersByIds = async () => ROSTER;

const ADD = { ...mkPlayer(99), id: '1', full_name: 'Nathan MacKinnon', position: 'C', team: 'COL' } as Player;

function App() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button data-testid="reopen" onClick={() => setOpen(true)}>open</button>
      <DropPlayerForAddDialog
        open={open}
        onOpenChange={setOpen}
        addPlayer={ADD}
        leagueId="harness-league"
        teamId="harness-team"
        userId="harness-user"
      />
      <Toaster />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
