/**
 * League scoreboard strip harness (2026-09-01, audit M7).
 *
 * Renders the REAL ScoreboardStrip at a phone viewport in every state it has
 * — a live week with the viewer losing, a final week, a bye, a two-team
 * league — plus the desktop rail at the aside's 220px, with the tap wired the
 * way Matchup.tsx wires it (the tapped chip becomes the viewed one).
 *
 * `?n=10` renders a 20-team league (10 chips) so the fades and snap can be
 * looked at with real overflow. `window.__log` records every switch.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../src/pressboxFonts';
import '../src/index.css';
import { ScoreboardStrip } from '../src/components/matchup/ScoreboardStrip';
import type { WeekMatchupRow } from '../src/components/matchup/scoreboard';

declare global { interface Window { __log: string[] } }
window.__log = [];
const log = (s: string) => { window.__log.push(s); };

const TODAY = '2026-10-14';
const NAMES = [
  'Citrus Crushers', 'Thunder Titans', 'Puck Dynasty', 'Ice Wolves', 'Rink Rats',
  'Slapshot Society', 'Zamboni Drivers', 'Northern Lights', 'Biscuit Bandits', 'Top Shelf',
  'Glass Cannons', 'Blue Line Bombers', 'Hat Trick Heroes', 'Five Hole Five', 'Crease Kings',
  'Odd Man Rush', 'Power Play Posse', 'Dump and Chase', 'Sin Bin Squad', 'Backdoor Tap-Ins',
];

const league = (pairs: number, status: 'in_progress' | 'completed'): WeekMatchupRow[] =>
  Array.from({ length: pairs }, (_, i) => ({
    id: `m${i + 1}`,
    team1_id: `t${2 * i + 1}`,
    team2_id: `t${2 * i + 2}`,
    team1_score: (37 + ((i * 29) % 61) + 0.4).toFixed(1),
    team2_score: (37 + ((i * 17 + 9) % 61) + 0.8).toFixed(1),
    status,
    week_end_date: '2026-10-17',
    team1_name: NAMES[(2 * i) % NAMES.length],
    team2_name: NAMES[(2 * i + 1) % NAMES.length],
  }));

const n = Math.max(1, parseInt(new URLSearchParams(location.search).get('n') || '6', 10));

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="px-3 font-jbmono text-[10px] uppercase tracking-[0.2em] text-white/55">{title}</p>
      {children}
    </div>
  );
}

function App() {
  // Viewer owns t2 (losing in m1 on the fixture), so their chip shows the
  // orange ring with the OPPONENT'S score in sage — identity ≠ standing.
  const [viewed, setViewed] = useState('m1');
  const rows = league(n, 'in_progress');
  const done = league(n, 'completed');
  const select = (id: string) => { log(`switch:${id}`); setViewed(id); };

  return (
    <div className="min-h-screen bg-pastel-surface py-3 space-y-6">
      <Block title={`live week · viewer owns t2 · ${n} matchups @ 393`}>
        <ScoreboardStrip matchups={rows} ownMatchupId="m1" ownTeamId="t2" viewedMatchupId={viewed} onSelect={select} week={5} live today={TODAY} />
      </Block>
      <Block title="week on, nothing live right now">
        <ScoreboardStrip matchups={rows} ownMatchupId="m2" ownTeamId="t3" viewedMatchupId="m2" onSelect={select} week={5} today={TODAY} />
      </Block>
      <Block title="final week">
        <ScoreboardStrip matchups={done} ownMatchupId="m1" ownTeamId="t1" viewedMatchupId="m1" onSelect={select} week={4} today={TODAY} />
      </Block>
      <Block title="bye + one-matchup league">
        <ScoreboardStrip
          matchups={[{ ...rows[0], id: 'bye', team2_id: null, team2_name: undefined, team2_score: null }]}
          ownMatchupId="bye"
          ownTeamId="t1"
          viewedMatchupId="bye"
          onSelect={select}
          week={5}
          today={TODAY}
        />
      </Block>
      <Block title="desktop rail @ 220px">
        <div className="px-3">
          <div className="w-[220px]">
            <ScoreboardStrip layout="rail" matchups={rows} ownMatchupId="m1" ownTeamId="t2" viewedMatchupId={viewed} onSelect={select} week={5} live today={TODAY} />
          </div>
        </div>
      </Block>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
