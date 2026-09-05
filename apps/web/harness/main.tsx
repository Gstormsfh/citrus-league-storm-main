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
import '../src/pressboxFonts';
import '../src/index.css';
import { PlayerService, type Player } from '../src/services/PlayerService';
import { rosterApi } from '../src/api/rosters';
import { DropPlayerForAddDialog } from '../src/components/freeagents/DropPlayerForAddDialog';
import { CitrusToaster } from '../src/components/notifications/CitrusToaster';
import { HARNESS_PLAYERS, harnessDirectoryPlayer, harnessPlayer } from './players';

// Roster size is the variable under test — ?n=22 for a deep roster.
const N = Number(new URLSearchParams(location.search).get('n') ?? 22);

/**
 * THE ROSTER IS REAL (2026-09-02). This file used to build every row as
 * "Roster Player 01".."Roster Player 22" with `headshot_url: null`, so the
 * dialog under review showed a column of initials discs against a column of
 * placeholder strings — neither of which the app has ever rendered. In
 * production all 801 rows in `players` carry an NHL CDN headshot. The names
 * and the faces now come off the shared roster (harness/players.ts).
 *
 * The player being ADDED is held out of the roster: the dialog's whole job is
 * to choose someone to drop to make room, so the incoming player must not
 * already be on the team.
 */
const ADD_PLAYER = harnessPlayer('Aleksander Barkov');
const POOL = HARNESS_PLAYERS.filter((p) => p !== ADD_PLAYER);

// `?n=` above 59 CYCLES the roster rather than inventing anyone: a repeated
// real player is a fixture reading twice, a counter appended to a name is a
// string no NHL roster can produce. Ids stay unique either way — they are the
// index, not the player.
const ROSTER = Array.from({ length: N }, (_, i) =>
  harnessDirectoryPlayer(POOL[i % POOL.length], i) as unknown as Player,
);

// Runtime stubs. These are plain objects, so assignment is enough.
(rosterApi as any).getTeamRoster = async () => ({
  data: ROSTER.map((p) => ({ player_id: p.id })),
});
(PlayerService as any).getPlayersByIds = async () => ROSTER;

// Id 7999 keeps the incoming player clear of the roster's 7000+index ids for
// any ?n= a reviewer will ever type.
const ADD = harnessDirectoryPlayer(ADD_PLAYER, 999) as unknown as Player;

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
      <CitrusToaster />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
