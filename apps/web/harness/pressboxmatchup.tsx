/**
 * PRESS BOX MATCHUP HARNESS — the artboard's Match screen, in the real
 * components, at 393, for a side-by-side diff.
 *
 * The rows are the artboard's rows with the artboard's states and figures.
 * Four names are substituted (Stamkos, Jack Hughes, Forsberg and the second
 * Larkin line are not on `harness/players.ts`, which is real identities with
 * real NHL ids and real CDN faces) — the STATES are unchanged: an upcoming
 * game, two finals, a DTD with no warmups, two live.
 *
 * Every figure is the mock's. This page answers "is the row right", not "is
 * the number right"; the strip at the bottom says so.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/pressboxFonts';
import '../src/index.css';
import {
  BOTTOM_CHROME_H,
  ChatBar,
  LeagueHeader,
  PressBoxBottomNav,
  PressBoxMatchupRow,
  PressBoxScoreBlock,
  PressBoxTabs,
  type PressBoxMatchupPlayer,
} from '../src/components/pressbox';
import { harnessPlayer, harnessRowPlayer } from './players';

declare global { interface Window { __log: string[] } }
window.__log = [];
const log = (s: string) => { window.__log.push(s); };

/** Last name only: this column is half a phone wide. */
const p = (who: string, state: Partial<PressBoxMatchupPlayer>): PressBoxMatchupPlayer => {
  const base = harnessRowPlayer(harnessPlayer(who));
  return { id: who, ...base, name: who.split(' ').slice(-1)[0], ...state };
};

const ROWS: Array<{ slot: string; you: PressBoxMatchupPlayer; them: PressBoxMatchupPlayer }> = [
  {
    slot: 'C',
    you: p('Connor McDavid', { metaLine: 'vs TOR 3RD · 1G 2A 4S', isLiveOrFinal: true, points: 8.4, projection: 6.9 }),
    them: p('John Tavares', { metaLine: '@ DAL · 8:30 PM · PP1', projection: 4.8 }),
  },
  {
    slot: 'C',
    you: p('Quinn Hughes', { metaLine: 'FINAL 4-2 · 2A 3S', isLiveOrFinal: true, points: 6.5, projection: 5.1 }),
    them: p('Dylan Larkin', { metaLine: 'FINAL 1-3 · 1S', isLiveOrFinal: true, points: 0.5, projection: 4.2 }),
  },
  {
    slot: 'LW',
    you: p('Mitch Marner', { metaLine: '@ DAL 8:30 · NO WARMUPS', projection: 0 }),
    them: p('Kirill Kaprizov', { metaLine: 'vs CHI 1ST · 2S', isLiveOrFinal: true, points: 1.0, projection: 6.1 }),
  },
  {
    slot: 'RW',
    you: p('David Pastrnak', { metaLine: 'vs NYR 2ND · 3S 1H', isLiveOrFinal: true, points: 2.1, projection: 6.6 }),
    them: p('Nikita Kucherov', { metaLine: 'vs FLA · 7:00 PM · PP1', projection: 7.3 }),
  },
  {
    slot: 'D',
    you: p('Cale Makar', { metaLine: 'vs LAK 8:00 · 26:10 TOI', projection: 6.2 }),
    them: p('Zach Werenski', { metaLine: 'FINAL 5-2 · 1G 1A 5S', isLiveOrFinal: true, points: 9.0, projection: 5.4 }),
  },
];

const TABS = [
  { key: 'lineups', label: 'Lineups' },
  { key: 'categories', label: 'Categories' },
  { key: 'bench', label: 'Bench' },
  { key: 'tonight', label: 'Tonight · 9' },
];

function Harness() {
  return (
    <div
      style={{ width: 393, minHeight: 852, marginInline: 'auto', transform: 'translateZ(0)', paddingBottom: BOTTOM_CHROME_H }}
      className="relative bg-pressbox-surface"
      data-phone-frame="393x852"
    >
      <LeagueHeader leagueId="harness-league" leagueName="Finalsz" weekLabel="WK 1" onWeekPress={() => log("week")} />

      <PressBoxScoreBlock
        you={{ name: 'Gstorms', record: '4–1 · 2ND', score: 118.4, projection: 257.2, gamesLeft: 27, winPct: 64 }}
        them={{ name: 'Puck Norris', record: '3–2 · 5TH', score: 96.1, projection: 215.2, gamesLeft: 26, winPct: 36 }}
        dayLabel="THU · DAY 4/7"
        days={[
          { label: 'MON', yours: 31.2, theirs: 18.0 },
          { label: 'TUE', yours: 42.6, theirs: 39.4 },
          { label: 'WED', yours: 22.1, theirs: 27.5 },
          { label: 'THU', yours: 22.5, theirs: 11.2, isToday: true },
          { label: 'FRI', yourGames: 6, theirGames: 5 },
          { label: 'SAT', yourGames: 9, theirGames: 10 },
          { label: 'SUN', yourGames: 7, theirGames: 8 },
        ]}
        onDayPress={(d) => log(`day:${d.label}`)}
      />

      {/* Section tabs — orange underline here, where the header strip uses
          sage. The artboard is deliberate about it: sage marks WHERE you are
          in the league, orange marks what you are looking at inside a screen. */}
      <PressBoxTabs tabs={TABS} activeKey="lineups" onSelect={(k) => log(`tab:${k}`)} label="Matchup view" />

      {ROWS.map((r, i) => (
        <PressBoxMatchupRow
          key={`${r.slot}-${i}`}
          slot={r.slot}
          you={r.you}
          them={r.them}
          onPlayerPress={(pl) => log(`player:${pl.name}`)}
        />
      ))}

      <p className="font-plex text-[9px] leading-relaxed text-pressbox-text/40 px-3 py-3">
        Identity and faces are real. Every figure is the mock&rsquo;s — four names are
        substituted for players not on the harness roster, with their states unchanged.
      </p>

      <ChatBar
        variant="chat"
        author="Puck Norris"
        message="McDavid hat trick watch, brutal"
        unread={12}
        onPress={() => log('chat')}
      />
      <PressBoxBottomNav />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/matchup/harness-league']}>
    <Harness />
  </MemoryRouter>,
);
