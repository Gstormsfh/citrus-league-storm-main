/** Roster-card gallery at a phone viewport. Real HockeyPlayerCard, real Tailwind. */
import { createRoot } from 'react-dom/client';
import '../src/pressboxFonts';
import '../src/index.css';
import HockeyPlayerCard, { HockeyPlayer } from '../src/components/roster/HockeyPlayerCard';
import MobileRosterList from '../src/components/roster/MobileRosterList';
import { harnessPlayer, harnessRowPlayer } from './players';

/**
 * THE GALLERY IS REAL (2026-09-02). Every case below used to be a name typed
 * into this file with no face field at all, so `HockeyPlayerCard` fell
 * straight through to the team crest on all ten cards and the gallery could
 * not show the one element it exists to show. Production carries a headshot
 * on all 801 rows of `players`; these ten now carry the same URLs.
 *
 * `harnessRowPlayer` supplies name, face, team, jersey and position. Each
 * case then overrides ONLY the state it exists to test — IR, GTD, locked,
 * live actuals, zeroed stats — because the state is the case and the player
 * never was.
 */
const base = (who: string, over: Partial<HockeyPlayer>): HockeyPlayer => ({
  id: 1,
  ...harnessRowPlayer(harnessPlayer(who)),
  starter: true,
  stats: { goals: 34, assists: 66, points: 100, gamesPlayed: 71, shots: 219, hits: 42, blockedShots: 21, plusMinus: 18 },
  nextGame: { opponent: 'vs BOS', isToday: true, gameTime: '7:30 PM', gameStatus: 'scheduled' },
  ...over,
} as HockeyPlayer);

const RAW: { label: string; player: HockeyPlayer; inSlot?: boolean; locked?: boolean }[] = [
  // `team` is the FULL club name on this one card, on purpose: the directory
  // hands rows either form, and `mugTeamAbbrev` only builds a crest URL from a
  // 2-4 letter code — this is the case that proves it falls back to
  // `teamAbbreviation` instead of requesting a 404 on "Edmonton Oilers".
  { label: 'skater · season', player: base('Connor McDavid', { team: 'Edmonton Oilers' }) },
  // Was the invented 27-character "Alexander Wennberg-Nylander". The
  // truncation case is now bounded by the longest name that can actually
  // reach this card: 20 characters, and a real defenceman.
  { label: 'skater · long name', player: base('Oliver Ekman-Larsson', {}) },
  { label: 'skater · live actuals', player: base('Nathan MacKinnon', {
      nextGame: { opponent: 'vs VGK', isToday: true, gameStatus: 'live', score: '2-1' },
      daily_actual_stats: { goals: 1, assists: 2, shots_on_goal: 7, hits: 3 }, daily_actual_points: 12.8 }) },
  // IR / GTD are the STATE each row tests; the players are real and healthy.
  { label: 'skater · IR', player: base('Jack Eichel', { status: 'IR' }) },
  { label: 'D · GTD', player: base('Cale Makar', { status: 'GTD',
      stats: { goals: 21, assists: 71, points: 92, gamesPlayed: 80, shots: 216, hits: 30, blockedShots: 96, plusMinus: 27 } }) },
  { label: 'RW · big numbers', player: base('David Pastrnak', {
      stats: { goals: 69, assists: 38, points: 107, gamesPlayed: 81, shots: 349, hits: 55, blockedShots: 29, plusMinus: 34 } }) },
  { label: 'goalie · season', player: base('Andrei Vasilevskiy', {
      stats: { wins: 36, losses: 17, otl: 6, gaa: 2.58, savePct: 0.9134, saves: 1652, shutouts: 4, gamesPlayed: 55 } }) },
  { label: 'goalie · live actuals', player: base('Jake Oettinger', {
      stats: { wins: 35, losses: 14, otl: 6, gaa: 2.72, savePct: 0.9053, saves: 1430, shutouts: 2, gamesPlayed: 53 },
      nextGame: { opponent: '@ MIN', isToday: true, gameStatus: 'final', score: '4-2' },
      daily_actual_stats: { wins: 1, saves: 34, goals_against: 2 }, daily_actual_points: 10.8 }) },
  { label: 'skater · locked', player: base('Mitch Marner', {}), locked: true },
  // Was "Rookie Callup", a name. The zeros are the case — a call-up who has
  // not played — so they stay; the player wearing them is real.
  { label: 'skater · zero stats', player: base('Cutter Gauthier', {
      stats: { goals: 0, assists: 0, points: 0, gamesPlayed: 0, shots: 0, hits: 0, blockedShots: 0, plusMinus: 0 },
      nextGame: undefined }) },
];

const CASES = RAW.map((c, i) => ({ ...c, player: { ...c.player, id: 100 + i } as HockeyPlayer }));

function App() {
  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream">
      <div className="px-4 py-4">
        <h1 className="font-varsity text-base mb-3">Starters grid — 2 cols @ phone</h1>
        <div className="grid grid-cols-2 gap-2" data-testid="grid-2">
          {CASES.map((c) => (
            <div key={c.label} data-case={c.label} className="w-full">
              <HockeyPlayerCard player={c.player} isInSlot isLocked={c.locked} />
            </div>
          ))}
        </div>

        <h1 className="font-varsity text-base mt-8 mb-3">Bench grid — real w-[168px] flex-wrap</h1>
        <div className="flex flex-wrap justify-center gap-1.5" data-testid="grid-3">
          {CASES.map((c) => (
            <div key={c.label} data-case3={c.label} className="flex-shrink-0 w-[168px]">
              <HockeyPlayerCard player={c.player} isLocked={c.locked} />
            </div>
          ))}
        </div>
      </div>

      <div className="px-0 pb-8">
        <h1 className="font-varsity text-base mt-8 mb-3 px-4">Mobile roster list @ 393</h1>
        <div data-testid="mobile-list">
          <MobileRosterList
            starters={CASES.slice(0, 6).map((c) => c.player)}
            bench={CASES.slice(6).map((c) => c.player)}
            ir={[]}
            slotAssignments={Object.fromEntries(
              CASES.slice(0, 6).map((c, i) => [c.player.id as string, ['C', 'LW', 'RW', 'D', 'D', 'G'][i]]),
            )}
            positionType="individual"
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
