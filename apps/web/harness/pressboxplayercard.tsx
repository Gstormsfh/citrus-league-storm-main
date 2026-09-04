/**
 * PRESS BOX PLAYER CARD HARNESS — artboard 1a's sixth frame.
 *
 * The hero, the action bar, the tabs, the four tiles, the game log, the
 * upcoming strip and Stormy's read, mounted in the real components with the
 * artboard's own McDavid so each block can be measured against 1a.
 *
 * Every figure is the mock's.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import {
  PB_TYPE,
  PressBoxGameLog,
  PressBoxNoteCard,
  PressBoxPlayerCardHero,
  PressBoxSectionHead,
  PressBoxStatTiles,
  PressBoxTabs,
  PressBoxUpcomingCards,
  pressBoxPlayerCardGround,
} from '../src/components/pressbox';

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'log', label: 'Game log' },
  { key: 'splits', label: 'Splits' },
  { key: 'xg', label: 'xG' },
  { key: 'news', label: 'News · 3' },
];

const LOG = [
  { key: '1', date: '10/1', opponent: 'vs TOR', points: 8.4, cells: [1, 2, 4, '+2', 1, 0], toi: '14:20', latest: true },
  { key: '2', date: '9/30', opponent: '@ VAN', points: 11.6, cells: [2, 1, 6, '+1', 2, 1], toi: '22:41' },
  { key: '3', date: '9/29', opponent: '@ SEA', points: 4.3, cells: [0, 1, 3, '-1', 1, 0], toi: '21:02' },
  { key: '4', date: '9/28', opponent: 'vs CGY', points: 6.9, cells: [1, 1, 2, '0', 0, 1], toi: '20:18' },
  { key: 'avg', date: 'AVG', opponent: '4 GP', points: 7.8, cells: ['1.0', '1.3', '3.8', '+.5', '1.0', '.5'], toi: '19:35', summary: true },
];

function Harness() {
  return (
    <div
      style={{ width: 393, minHeight: 852, marginInline: 'auto', transform: 'translateZ(0)' }}
      className="relative bg-pressbox-surface"
      data-phone-frame="393x852"
    >
      <div className="absolute inset-0" style={pressBoxPlayerCardGround('#FF4B00')} aria-hidden="true" />

      <div className={`${PB_TYPE} relative px-3.5 pt-2`}>
        <PressBoxPlayerCardHero
          firstName="Connor"
          lastName="McDavid"
          ownerLine="→ GSTORMS"
          position="C"
          jersey="#97"
          teamAbbreviation="EDM"
          teamColor="#FF4B00"
          vitals={[
            { label: 'AGE', value: '29' },
            { label: 'HT', value: `6'1"` },
            { label: 'WT', value: '194' },
            { label: 'SHOOTS', value: 'L' },
            { label: 'EXP', value: '11' },
          ]}
          onClose={() => undefined}
        />

        <div className="flex gap-1.5 mt-3.5 font-plex font-semibold text-[11px] tracking-[0.06em]">
          <button type="button" className="flex-1 h-9 rounded-[9px] bg-white/[0.06] border border-white/[0.12] text-pressbox-text flex items-center justify-center gap-1.5">
            ⇄ TRADE
          </button>
          <button type="button" className="flex-1 h-9 rounded-[9px] bg-pressbox-grapefruit/[0.12] border border-pressbox-grapefruit/35 text-pressbox-grapefruit-text flex items-center justify-center">
            DROP
          </button>
          <button type="button" aria-label="Watch" className="w-9 h-9 rounded-[9px] bg-white/[0.06] border border-white/[0.12] text-pressbox-text flex items-center justify-center">
            ★
          </button>
          <button type="button" aria-label="Share to chat" className="w-9 h-9 rounded-[9px] bg-white/[0.06] border border-white/[0.12] text-pressbox-text flex items-center justify-center">
            ▢
          </button>
        </div>

        <PressBoxTabs tabs={TABS} activeKey="log" label="Player card view" className="px-0 gap-4 mt-3.5 border-white/10" />

        <PressBoxStatTiles
          className="mt-3"
          tiles={[
            { key: 'wk', label: 'WK 1 PTS', value: '31.2', tone: 'sage' },
            { key: 'szn', label: 'SZN PROJ', value: '681' },
            { key: 'rank', label: 'POS RANK', value: 'C1' },
            { key: 'xg', label: 'xG ± / 60', value: '+1.8', tone: 'orange' },
          ]}
        />

        <PressBoxGameLog className="mt-3" statHeadings={['G', 'A', 'SOG', '+/-', 'PPP', 'HIT']} rows={LOG} />

        <PressBoxSectionHead
          title="Upcoming"
          sm
          className="mt-3.5"
          action={<span className="font-plex font-medium text-[10px] text-pressbox-text/45">4 GAMES · 27.6 PROJ</span>}
        />

        <PressBoxUpcomingCards
          className="mt-2"
          games={[
            { key: '1', when: 'SAT 10/3', opponent: '@ CGY', note: '7.1 PROJ ·', noteTail: 'B2B' },
            { key: '2', when: 'MON 10/5', opponent: 'vs SJS', note: '7.4 PROJ · 28TH GA' },
            { key: '3', when: 'WED 10/7', opponent: 'vs WPG', note: '6.6 PROJ' },
          ]}
        />

        <PressBoxNoteCard
          className="mt-3"
          eyebrow="STORMY · xG READ"
          avatarSrc="/mascots/mascot-stormy.webp"
          body="Shooting 14.7% on 96th-percentile chances. Citrus xG has him +7.0 over expected — the finishing is real, not luck. Hold through the CGY back-to-back."
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/players/1']}>
    <Harness />
  </MemoryRouter>,
);
