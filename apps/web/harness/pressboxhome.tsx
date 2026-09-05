/**
 * PRESS BOX HOME HARNESS — artboard 1a's first frame.
 *
 * The app header, the league-wide ticker, the league stack (one live, two
 * not) and tonight's three, mounted in the real components with the
 * artboard's own figures so the geometry can be measured against 1a before
 * the page is wired.
 *
 * Every figure is the mock's.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/pressboxFonts';
import '../src/index.css';
import {
  BOTTOM_CHROME_H,
  ChatBar,
  PB_TYPE,
  PressBoxAppHeader,
  PressBoxBottomNav,
  PressBoxLeagueCard,
  PressBoxScoreTicker,
  PressBoxSectionHead,
  PressBoxTonightCards,
} from '../src/components/pressbox';

const GAMES = [
  { id: '1', line: 'EDM 3 · TOR 2', state: '3rd 4:12', live: true },
  { id: '2', line: 'BOS 1 · NYR 1', state: '2nd', live: true },
  { id: '3', line: 'COL · LAK', state: '8:00' },
];

const TONIGHT = [
  { id: '1', gameLine: 'EDM · 3RD', name: 'McDavid', points: 8.4, unit: '1G 2A', played: true },
  { id: '2', gameLine: 'BOS · 2ND', name: 'Pastrnak', points: 2.1, unit: '3 SOG', played: true },
  { id: '3', gameLine: 'COL · 8:00', name: 'Makar', points: 6.2, unit: 'PROJ' },
];

function Harness() {
  return (
    <div
      style={{ width: 393, minHeight: 852, marginInline: 'auto', transform: 'translateZ(0)', paddingBottom: BOTTOM_CHROME_H }}
      className="relative bg-pressbox-surface"
      data-phone-frame="393x852"
    >
      <PressBoxAppHeader logoSrc="/favicon.svg" unread={3} />

      <div className={`${PB_TYPE} px-3`}>
        <PressBoxScoreTicker games={GAMES} className="mt-1.5" />

        <PressBoxSectionHead
          title="My leagues"
          className="px-1 pt-[18px] pb-2"
          action={<span className="font-plex font-medium text-[11px] text-pressbox-text/50">3 · WEEK 1</span>}
        />

        <div className="flex flex-col gap-2">
          <PressBoxLeagueCard
            name="Finalsz"
            crest="FZ"
            metaLine="12-TEAM · H2H PTS · 2ND"
            to="/league/1"
            badge="LIVE"
            you={{ name: 'Gstorms', score: 118.4, projection: 257.2, winPct: 64, isYou: true }}
            them={{ name: 'Puck Norris', score: 96.1, projection: 215.2, winPct: 36 }}
          />
          <PressBoxLeagueCard
            name="Puck Heads Dynasty"
            crest="PH"
            metaLine="10-TEAM · CATEGORIES · 7TH"
            to="/league/2"
            statLine="3–5 · 2–6"
            statNote="TRAILING 3 CATS"
            statNoteTone="bad"
          />
          <PressBoxLeagueCard
            name="Office Pick'em"
            crest="OP"
            metaLine="24 PLAYERS · PICK'EM · 4TH"
            to="/league/3"
            badge="6 PICKS DUE"
            badgeTone="due"
          />
        </div>

        <PressBoxSectionHead
          title="Tonight on your rosters"
          className="px-1 pt-[18px] pb-2"
          action={<span className="font-plex font-medium text-[11px] text-pressbox-text/50">9 GAMES</span>}
        />

        <PressBoxTonightCards players={TONIGHT} />
      </div>

      <ChatBar variant="stormy" author="Stormy" message="Forsberg sits tonight; Kaprizov on PP1 vs CHI is the swap" />
      <PressBoxBottomNav />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/']}>
    <Harness />
  </MemoryRouter>,
);
