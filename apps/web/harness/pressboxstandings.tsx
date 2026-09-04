/**
 * PRESS BOX STANDINGS HARNESS — the artboard's table, in the real component.
 *
 * `page.html?p=standings` cannot show this: the harness league has no schedule,
 * so the page correctly renders its preseason state instead of a 0-0 table
 * (Standings.offseason). This mounts the table directly with the artboard's
 * own nine teams so the grid, the tint, the rail and the playoff line can be
 * compared line for line.
 *
 * Every figure is the mock's.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import {
  BOTTOM_CHROME_H,
  ChatBar,
  LeagueHeader,
  PressBoxBottomNav,
  PB_TYPE,
  PressBoxSegmented,
  PressBoxStandingsTable,
  type PressBoxStandingsRow,
} from '../src/components/pressbox';

declare global { interface Window { __log: string[] } }
window.__log = [];

const W = true, L = false;
const ROWS: PressBoxStandingsRow[] = [
  { teamId: '1', rank: 1, name: 'Bench Bosses',    subLine: '@derekv · 78% PO',  record: '5–0', pointsFor: 612.4, pointsAgainst: 498.1, streak: 'W5', lastFive: [W,W,W,W,W] },
  { teamId: '2', rank: 2, name: 'Gstorms',         subLine: '@gstorms · 71% PO', record: '4–1', pointsFor: 588.9, pointsAgainst: 521.3, streak: 'W2', lastFive: [L,W,W,W,W], isYou: true },
  { teamId: '3', rank: 3, name: 'Crease Lightning',subLine: '@lukel · 64% PO',   record: '4–1', pointsFor: 561.2, pointsAgainst: 530.0, streak: 'L1', lastFive: [W,W,W,W,L] },
  { teamId: '4', rank: 4, name: 'Sin Bin Saints',  subLine: '@hattrick · 55% PO',record: '3–2', pointsFor: 549.8, pointsAgainst: 540.2, streak: 'W1', lastFive: [L,W,L,W,W] },
  { teamId: '5', rank: 5, name: 'Puck Norris',     subLine: '@imanley · 49% PO', record: '3–2', pointsFor: 533.0, pointsAgainst: 529.7, streak: 'W1', lastFive: [W,L,L,W,W] },
  { teamId: '6', rank: 6, name: 'Apple Sauce',     subLine: '@meavs · 41% PO',   record: '3–2', pointsFor: 512.6, pointsAgainst: 515.9, streak: 'L2', lastFive: [W,W,W,L,L] },
  { teamId: '7', rank: 7, name: 'Top Shelf Ted',   subLine: '@fizzle · 33% PO',  record: '2–3', pointsFor: 498.2, pointsAgainst: 538.1, streak: 'L1', lastFive: [W,L,W,L,L] },
  { teamId: '8', rank: 8, name: 'Zamboni Drivers', subLine: '@cole · 24% PO',    record: '2–3', pointsFor: 487.7, pointsAgainst: 522.9, streak: 'W1', lastFive: [L,L,W,L,W] },
  { teamId: '9', rank: 9, name: 'Mighty Drunks',   subLine: '@bwrxx · 18% PO',   record: '1–4', pointsFor: 466.0, pointsAgainst: 551.4, streak: 'L3', lastFive: [W,L,L,L,L] },
];

const SEGMENTS = [
  { key: 'standings', label: 'STANDINGS' },
  { key: 'power', label: 'POWER' },
  { key: 'odds', label: 'PLAYOFF ODDS' },
  { key: 'median', label: 'MEDIAN' },
];

function Harness() {
  return (
    <div
      style={{ width: 393, minHeight: 852, marginInline: 'auto', transform: 'translateZ(0)', paddingBottom: BOTTOM_CHROME_H }}
      className="relative bg-pressbox-surface"
      data-phone-frame="393x852"
    >
      <LeagueHeader weekLabel="WK 5" />

      <div className={`${PB_TYPE} px-3 pt-2.5 border-t border-white/[0.08]`}>
        <PressBoxSegmented segments={SEGMENTS} activeKey="standings" label="Standings view" />

        <div className="flex items-center justify-between mt-[10px] font-plex font-medium text-[10px] text-pressbox-text/45">
          <span>WEEK 5 OF 24 · TOP 6 MAKE PLAYOFFS</span>
          <span>SORT: W–L ▾</span>
        </div>

        <PressBoxStandingsTable rows={ROWS} playoffSpots={6} className="mt-2" />
      </div>

      <p className="font-plex text-[9px] leading-relaxed text-pressbox-text/40 px-3 py-3">
        Every figure is the mock&rsquo;s — this page exists to compare the table&rsquo;s
        geometry against artboard 1a, not its numbers.
      </p>

      <ChatBar variant="chat" author="Bench Bosses" message="5–0 and nobody wants to talk about it" unread={12} />
      <PressBoxBottomNav />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/standings']}>
    <Harness />
  </MemoryRouter>,
);
