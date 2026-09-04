/**
 * PRESS BOX ROSTER HARNESS (2026-09-04).
 *
 * The real `PressBoxRosterList` at 393x852, with the real sixty NHL players
 * and the real NHL CDN headshots, so the row can be LOOKED AT before it is
 * mounted on `Roster.tsx`. Nothing here is stubbed except the callbacks, which
 * log — the component under test is the shipped one.
 *
 * The states on screen are the ones the row exists to distinguish, top to
 * bottom: a live game, a final, a game still to come, a game-time decision, a
 * dual-eligible player in UTIL, an empty slot, and a bench that is playing.
 * If any two of those read the same at arm's length, the row has failed.
 *
 * `?week=1` turns the WK column on with a fabricated week figure — NOT for
 * judging the numbers, which are invented, but for checking that the five-
 * column grid still fits at 393px on the day real weekly data exists.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import {
  PressBoxRosterList,
  type PressBoxRosterSlotRow,
} from '../src/components/pressbox';
import { LeagueHeader, ChatBar, PressBoxBottomNav } from '../src/components/pressbox';
import { harnessPlayer, harnessRowPlayer } from './players';

declare global { interface Window { __log: string[] } }
window.__log = [];
const log = (s: string) => { window.__log.push(s); };

const showWeek = new URLSearchParams(location.search).has('week');

/** Identity and face come off the shared roster; the STATE is written here. */
const row = (
  slotId: string,
  slot: string,
  who: string,
  state: Partial<PressBoxRosterSlotRow['player']> = {},
  flags: Omit<Partial<PressBoxRosterSlotRow>, 'player' | 'slotId' | 'slot'> = {},
): PressBoxRosterSlotRow => {
  const p = harnessRowPlayer(harnessPlayer(who));
  return {
    slotId,
    slot,
    player: {
      id: slotId,
      ...p,
      weekPoints: showWeek ? Number((Math.random() * 30 + 5).toFixed(1)) : null,
      ...state,
    },
    ...flags,
  };
};

const starters: PressBoxRosterSlotRow[] = [
  row('slot-C-1', 'C', 'Connor McDavid', {
    gameLabel: 'vs TOR 2-1',
    statLine: '1G 2A 4 SOG',
    isLiveOrFinal: true,
    todayActual: 8.2,
    todayProjection: 6.9,
  }),
  row('slot-C-2', 'C', 'Nathan MacKinnon', {
    gameLabel: '@ DAL 8:30 PM',
    todayProjection: 7.4,
  }),
  row('slot-LW-1', 'LW', 'Jason Robertson', {
    gameLabel: 'FINAL 4-2',
    statLine: '2A 3 SOG',
    isLiveOrFinal: true,
    todayActual: 5.1,
    todayProjection: 5.8,
  }),
  row('slot-RW-1', 'RW', 'William Nylander', {
    status: 'GTD',
    gameLabel: 'vs EDM 2-1',
    isLiveOrFinal: true,
    todayActual: 0,
    todayProjection: 5.4,
  }, { dtd: true }),
  row('slot-UTIL', 'UTIL', 'Macklin Celebrini', {
    positionsLabel: 'C/LW',
    gameLabel: '@ NYR 7:00 PM',
    todayProjection: 6.1,
  }),
  row('slot-D-1', 'D', 'Cale Makar', {
    gameLabel: '@ DAL 8:30 PM',
    todayProjection: 6.8,
  }, { locked: true }),
  { slotId: 'slot-D-2', slot: 'D', player: null },
  row('slot-G-1', 'G', 'Scott Wedgewood', {
    gameLabel: '@ DAL 8:30 PM',
    todayProjection: 11.2,
  }),
];

const bench: PressBoxRosterSlotRow[] = [
  row('bench-1', 'BN', 'David Pastrnak', {
    gameLabel: 'vs FLA 1-0',
    statLine: '1G 2 SOG',
    isLiveOrFinal: true,
    todayActual: 4.1,
    todayProjection: 5.2,
  }),
  row('bench-2', 'BN', 'Adam Fox', {
    gameLabel: 'vs NJD 7:00 PM',
    todayProjection: 5.5,
  }),
  row('bench-3', 'BN', 'Cutter Gauthier', {
    gameLabel: 'No game',
    todayProjection: null,
  }),
];

function Harness() {
  const [day, setDay] = useState('THU');
  return (
    /* A FIXED 393px COLUMN, not a responsive page. The pane this is read in
       does not always honour viewport emulation, and a row measured at 980px
       is a row nobody will ever see -- the whole question this harness answers
       is what truncates when the name column is 233px wide, which only
       happens at 393. The frame is the measurement. */
    <div
      /* An INLINE style, not `w-[393px]`. `tailwind.config.ts` scans
         ./pages, ./components, ./app and ./src -- NOT ./harness -- so a class
         that appears only in a harness file is never generated and silently
         does nothing. That is worth knowing: it means every harness page can
         only use classes the app already uses somewhere. A width is not worth
         widening the app's content globs for. */
      style={{ width: 393, minHeight: 852, marginInline: 'auto' }}
      className="bg-pressbox-surface"
      data-phone-frame="393x852"
    >
      <LeagueHeader weekLabel="WK 1 · SEP 28-OCT 4" onWeekPress={() => log('week')} />
      <PressBoxRosterList
        days={['THU', 'FRI', 'SAT', 'WEEK']}
        activeDay={day}
        onDayChange={(d) => { log(`day:${d}`); setDay(d); }}
        starters={starters}
        bench={bench}
        startersFilled={starters.filter((r) => r.player != null).length}
        startersRequired={starters.length}
        benchPlayingCount={2}
        showWeek={showWeek}
        onSlotPress={(id) => log(`slot:${id}`)}
        onNamePress={(r) => log(`name:${r.slotId}`)}
        onEmptyPress={(id) => log(`fill:${id}`)}
      />
      <ChatBar
        variant="stormy"
        message="Nylander is a game-time decision. You have a healthy RW on the bench."
        actionLabel="FIX"
        onPress={() => log('chat')}
        onAction={() => log('fix')}
      />
      <PressBoxBottomNav />
    </div>
  );
}

// The header and the nav are Links: they need a router, and MemoryRouter at
// /roster is what puts the Team sub-tab in its active state.
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/roster?league=harness-league']}>
    <Harness />
  </MemoryRouter>,
);
