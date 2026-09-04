/**
 * PRESS BOX LEAGUE HQ HARNESS — artboard 1a's LEAGUE tab.
 *
 * The matchup list and the tile grid, mounted in the real components with the
 * artboard's own six teams so the card geometry, the mirrored bars and the
 * two tile sizes can be measured against 1a before the page is wired.
 *
 * Every figure is the mock's.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { BarChart3, ArrowLeftRight, TrendingUp, MessageSquare, CalendarDays, Trophy } from 'lucide-react';
import '../src/index.css';
import {
  BOTTOM_CHROME_H,
  ChatBar,
  LeagueHeader,
  PB_TYPE,
  PressBoxBottomNav,
  PressBoxLeagueMatchupCard,
  PressBoxSectionHead,
  PressBoxTile,
} from '../src/components/pressbox';

const MATCHUPS = [
  {
    home: { name: 'Gstorms', winPct: 64, points: 118.4, gamesLeft: 27, isYou: true },
    away: { name: 'Puck Norris', winPct: 36, points: 96.1, gamesLeft: 26 },
  },
  {
    home: { name: 'Crease Lightning', winPct: 51, points: 104.7, gamesLeft: 25 },
    away: { name: 'Sin Bin Saints', winPct: 49, points: 103.9, gamesLeft: 28 },
  },
  {
    home: { name: 'Top Shelf Ted', winPct: 22, points: 71.3, gamesLeft: 24 },
    away: { name: 'Bench Bosses', winPct: 78, points: 127.5, gamesLeft: 27 },
  },
];

const TILES = [
  { key: 'standings', title: 'Standings', stat: "You're 2nd · 1.5 GB · +42.6 PF", to: '/standings', Icon: BarChart3 },
  { key: 'transactions', title: 'Transactions', stat: '14 this week · 2 trades pending', to: '/waiver-wire', Icon: ArrowLeftRight },
  { key: 'power', title: 'Power rankings', stat: "Stormy's weekly · You ↑2 to #3", to: '/standings', Icon: TrendingUp },
  { key: 'commish', title: 'Commish note', stat: 'Waivers process 2am MT. Trade deadline Mar 6.', to: '/standings', Icon: MessageSquare },
  { key: 'draft', title: 'Draft results', stat: '18 rds · Snake · Grade B+ (#4)', to: '/draft', Icon: CalendarDays },
  { key: 'history', title: 'League history', stat: 'Est. 2024 · 2 champions · Legend', to: '/standings', Icon: Trophy },
];

function Harness() {
  return (
    <div
      style={{ width: 393, minHeight: 852, marginInline: 'auto', transform: 'translateZ(0)', paddingBottom: BOTTOM_CHROME_H }}
      className="relative bg-pressbox-surface"
      data-phone-frame="393x852"
    >
      <LeagueHeader weekLabel="WK 1 · SEP 28–OCT 4" />

      <div className={`${PB_TYPE} flex flex-col gap-3 border-t border-white/[0.08] px-3 pt-3`}>
        <PressBoxSectionHead
          title="Matchups"
          action={<span className="font-plex font-medium text-[11px] text-pressbox-orange-soft">WEEK 1 &rsaquo;</span>}
        />

        <div className="flex flex-col gap-1.5">
          {MATCHUPS.map((m) => (
            <PressBoxLeagueMatchupCard key={m.home.name} home={m.home} away={m.away} />
          ))}
        </div>

        <p className="text-center font-plex font-medium text-[11px] text-pressbox-text/45">
          + 3 MORE MATCHUPS
        </p>

        <div className="grid grid-cols-2 gap-2">
          {TILES.map((t) => (
            <PressBoxTile key={t.key} title={t.title} stat={t.stat} to={t.to} Icon={t.Icon} dense />
          ))}
        </div>
      </div>

      <ChatBar variant="chat" author="Puck Norris" message="anyone moving a D for Marner? sitting on 3" unread={12} />
      <PressBoxBottomNav />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/league/1']}>
    <Harness />
  </MemoryRouter>,
);
