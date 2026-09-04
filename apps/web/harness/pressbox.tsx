/**
 * PRESS BOX ROSTER HARNESS — the reference screen, rebuilt in the real
 * components, for a side-by-side diff against artboard `#1a`.
 *
 * Every row below is the SAME ROW the artboard draws, with the same states
 * and the same figures, so the two can be put next to each other at 393 and
 * compared line by line. Two names are substituted -- Jack Hughes and Filip
 * Forsberg are not on `harness/players.ts`, and that file is real identities
 * with real NHL ids and real CDN faces, which is worth more than matching the
 * mock's cast. Their STATES are unchanged: a final, and a DTD with no warmups.
 *
 * THE FIGURES ARE THE MOCK'S. Ownership percentages, week totals and trends
 * do not exist in the app yet (no cross-league aggregate, no per-player week
 * total on the roster payload). They are here because the question this page
 * answers is whether the ROW is right, and a row missing two of its five
 * columns cannot answer it. The strip at the bottom says so on screen -- the
 * same thing `dashboard.html` and `advanced.html` already do for their
 * generated columns. The app renders only what is true; `showOwnership` and
 * `showWeek` are what separate the two.
 *
 * `?plain` drops both columns to show what the app renders TODAY.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import { BOTTOM_CHROME_H } from '../src/components/pressbox';
import {
  ChatBar,
  LeagueHeader,
  PressBoxBottomNav,
  PressBoxRosterList,
  PressBoxTeamCard,
  type PressBoxRosterSlotRow,
} from '../src/components/pressbox';
import { harnessPlayer, harnessRowPlayer } from './players';

declare global { interface Window { __log: string[] } }
window.__log = [];
const log = (s: string) => { window.__log.push(s); };

const params = new URLSearchParams(location.search);
const rich = !params.has('plain');

type State = Partial<PressBoxRosterSlotRow['player']>;

const row = (
  slotId: string,
  slot: string,
  who: string,
  state: State,
  flags: Omit<Partial<PressBoxRosterSlotRow>, 'player' | 'slotId' | 'slot'> = {},
): PressBoxRosterSlotRow => ({
  slotId,
  slot,
  player: { id: slotId, ...harnessRowPlayer(harnessPlayer(who)), ...state },
  ...flags,
});

/** The artboard's starters, in order, with its figures. */
const starters: PressBoxRosterSlotRow[] = [
  row('slot-C-1', 'C', 'Connor McDavid', {
    rosteredPct: 100, startedPct: 99,
    gameLabel: 'vs TOR 3RD', statLine: '1G 2A', isLiveOrFinal: true,
    todayActual: 8.4, todayProjection: 6.9, weekPoints: 31.2, weekTrendPct: 12,
  }),
  row('slot-C-2', 'C', 'Nathan MacKinnon', {
    rosteredPct: 99, startedPct: 94,
    gameLabel: 'FINAL 4-2', statLine: '2A 3SOG', isLiveOrFinal: true,
    todayActual: 6.5, todayProjection: 5.1, weekPoints: 18.9, weekTrendPct: 0,
  }),
  row('slot-LW-1', 'LW', 'Jason Robertson', {
    status: 'DTD', rosteredPct: 96, startedPct: 61,
    gameLabel: '@ DAL 8:30', statLine: 'NO WARMUPS', isLiveOrFinal: true,
    todayActual: null, todayProjection: 0, weekPoints: 4.1, weekTrendPct: -31,
  }, { dtd: true }),
  row('slot-LW-2', 'LW', 'Kirill Kaprizov', {
    rosteredPct: 100, startedPct: 98,
    gameLabel: 'vs CHI 1ST', statLine: '2SOG', isLiveOrFinal: true,
    todayActual: 1.0, todayProjection: 6.1, weekPoints: 22.0, weekTrendPct: 4,
  }),
  row('slot-RW-1', 'RW', 'David Pastrnak', {
    rosteredPct: 100, startedPct: 99,
    gameLabel: 'vs NYR 2ND', statLine: '3SOG', isLiveOrFinal: true,
    todayActual: 2.1, todayProjection: 6.6, weekPoints: 14.3, weekTrendPct: -1,
  }),
  row('slot-D-1', 'D', 'Cale Makar', {
    rosteredPct: 100, startedPct: 99,
    gameLabel: 'vs LAK 8:00 PM', statLine: 'PP1',
    todayProjection: 6.2, weekPoints: 19.7, weekTrendPct: 8,
  }),
];

const bench: PressBoxRosterSlotRow[] = [
  row('bench-1', 'BN', 'Nick Suzuki', {
    positionsLabel: 'C', rosteredPct: 84, startedPct: 52,
    gameLabel: 'vs OTT 1ST', statLine: '1A', isLiveOrFinal: true,
    todayActual: 2.0, todayProjection: 4.9, weekPoints: 9.1,
  }),
  row('bench-2', 'BN', 'Adam Fox', {
    positionsLabel: 'D', rosteredPct: 91, startedPct: 44,
    gameLabel: 'vs NJD 7:00 PM', todayProjection: 5.5, weekPoints: 12.8,
  }),
  row('bench-3', 'BN', 'Cutter Gauthier', {
    positionsLabel: 'LW', rosteredPct: 48, startedPct: 12,
    gameLabel: 'No game', todayProjection: null, weekPoints: 6.2,
  }),
  row('bench-4', 'BN', 'Josh Morrissey', {
    positionsLabel: 'D', rosteredPct: 63, startedPct: 21,
    gameLabel: '@ VAN 10:00 PM', todayProjection: 4.4, weekPoints: 11.5,
  }),
  row('bench-5', 'BN', 'Carter Hart', {
    positionsLabel: 'G', rosteredPct: 55, startedPct: 18,
    gameLabel: 'No game', todayProjection: null, weekPoints: 0,
  }),
  row('bench-6', 'BN', 'Macklin Celebrini', {
    positionsLabel: 'C', rosteredPct: 77, startedPct: 39,
    gameLabel: 'vs SEA 8:00 PM', todayProjection: 5.9, weekPoints: 14.6,
  }),
];

function Harness() {
  const [day, setDay] = useState('THU');
  return (
    /* A FIXED 393px COLUMN, and `transform` on it so the `position: fixed`
       chat bar and bottom nav resolve against THIS box instead of the
       browser window. Without it they span the whole pane and the screen
       reads as a narrow list under full-width chrome -- which is a harness
       artefact, not the phone, and it is exactly what made this page look
       broken the first time it was shown.
       An inline style, not a class: tailwind.config.ts does not scan
       harness/, so a class used only here is never generated. */
    <div
      /* paddingBottom reserves the chat bar + nav. Without it the last bench
         row sits UNDER the fixed chrome, which is a real bug on the phone and
         not just here -- every Press Box page owes its content this much. */
      style={{
        width: 393,
        minHeight: 852,
        marginInline: 'auto',
        transform: 'translateZ(0)',
        paddingBottom: BOTTOM_CHROME_H,
      }}
      className="relative bg-pressbox-surface"
      data-phone-frame="393x852"
    >
      <LeagueHeader weekLabel="WK 1 · SEP 28-OCT 4" onWeekPress={() => log('week')} />
      <PressBoxRosterList
        days={['THU', 'FRI', 'SAT', 'WEEK']}
        activeDay={day}
        onDayChange={(d) => { log(`day:${d}`); setDay(d); }}
        starters={starters}
        bench={bench}
        startersFilled={13}
        startersRequired={13}
        benchPlayingCount={2}
        showWeek={rich}
        showOwnership={rich}
        teamCard={
          <PressBoxTeamCard
            teamName="Gstorms"
            record="4–1"
            rank="2ND"
            winPct={64}
            yourScore={118.4}
            theirScore={96.1}
            actions={[
              { glyph: '⚡', label: 'Optimize', primary: true, onPress: () => log('optimize') },
              { glyph: '⇄', label: 'Trade', onPress: () => log('trade') },
              { glyph: '+', label: 'Add', onPress: () => log('add') },
              { glyph: '☰', label: 'Log', onPress: () => log('log') },
            ]}
          />
        }
        onSlotPress={(id) => log(`slot:${id}`)}
        onNamePress={(r) => log(`name:${r.slotId}`)}
        onEmptyPress={(id) => log(`fill:${id}`)}
      />

      {/* Says on screen which columns are not real yet. Same contract the
          dashboard and advanced harnesses carry. */}
      <p className="font-plex text-[9px] leading-relaxed text-pressbox-text/40 px-3 py-3">
        Identity and faces are real. ROS%/START%, the week totals and the trends are the
        mock&rsquo;s figures — no cross-league ownership aggregate exists and the roster payload
        carries no per-player week total. Open <code>?plain</code> for what the app renders today.
      </p>

      <ChatBar
        variant="stormy"
        message="Forsberg not in warmups. Suzuki to LW is +4.1 tonight."
        actionLabel="SWAP"
        onPress={() => log('chat')}
        onAction={() => log('swap')}
      />
      <PressBoxBottomNav />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/roster?league=harness-league']}>
    <Harness />
  </MemoryRouter>,
);
