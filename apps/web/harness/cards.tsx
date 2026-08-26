/** Roster-card gallery at a phone viewport. Real HockeyPlayerCard, real Tailwind. */
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import HockeyPlayerCard, { HockeyPlayer } from '../src/components/roster/HockeyPlayerCard';
import MobileRosterList from '../src/components/roster/MobileRosterList';

const base = (over: Partial<HockeyPlayer>): HockeyPlayer => ({
  id: 1, name: 'Connor McDavid', position: 'C', number: 97, starter: true,
  team: 'Edmonton Oilers', teamAbbreviation: 'EDM',
  stats: { goals: 34, assists: 66, points: 100, gamesPlayed: 71, shots: 219, hits: 42, blockedShots: 21, plusMinus: 18 },
  nextGame: { opponent: 'vs BOS', isToday: true, gameTime: '7:30 PM', gameStatus: 'scheduled' },
  ...over,
} as HockeyPlayer);

const RAW: { label: string; player: HockeyPlayer; inSlot?: boolean; locked?: boolean }[] = [
  { label: 'skater · season', player: base({}) },
  { label: 'skater · long name', player: base({ name: 'Alexander Wennberg-Nylander', position: 'LW', number: 8, teamAbbreviation: 'SEA' }) },
  { label: 'skater · live actuals', player: base({
      name: 'Nathan MacKinnon', number: 29, teamAbbreviation: 'COL',
      nextGame: { opponent: 'vs VGK', isToday: true, gameStatus: 'live', score: '2-1' },
      daily_actual_stats: { goals: 1, assists: 2, shots_on_goal: 7, hits: 3 }, daily_actual_points: 12.8 }) },
  { label: 'skater · IR', player: base({ name: 'Jack Hughes', number: 86, teamAbbreviation: 'NJD', position: 'C', status: 'IR' }) },
  { label: 'D · GTD', player: base({ name: 'Cale Makar', number: 8, teamAbbreviation: 'COL', position: 'D', status: 'GTD',
      stats: { goals: 21, assists: 71, points: 92, gamesPlayed: 80, shots: 216, hits: 30, blockedShots: 96, plusMinus: 27 } }) },
  { label: 'RW · big numbers', player: base({ name: 'Auston Matthews', number: 34, teamAbbreviation: 'TOR', position: 'RW',
      stats: { goals: 69, assists: 38, points: 107, gamesPlayed: 81, shots: 349, hits: 55, blockedShots: 29, plusMinus: 34 } }) },
  { label: 'goalie · season', player: base({ name: 'Igor Shesterkin', number: 31, teamAbbreviation: 'NYR', position: 'G',
      stats: { wins: 36, losses: 17, otl: 6, gaa: 2.58, savePct: 0.9134, saves: 1652, shutouts: 4, gamesPlayed: 55 } }) },
  { label: 'goalie · live actuals', player: base({ name: 'Jake Oettinger', number: 29, teamAbbreviation: 'DAL', position: 'G',
      stats: { wins: 35, losses: 14, otl: 6, gaa: 2.72, savePct: 0.9053, saves: 1430, shutouts: 2, gamesPlayed: 53 },
      nextGame: { opponent: '@ MIN', isToday: true, gameStatus: 'final', score: '4-2' },
      daily_actual_stats: { wins: 1, saves: 34, goals_against: 2 }, daily_actual_points: 10.8 }) },
  { label: 'skater · locked', player: base({ name: 'Mitch Marner', number: 16, teamAbbreviation: 'TOR', position: 'RW' }), locked: true },
  { label: 'skater · zero stats', player: base({ name: 'Rookie Callup', number: 72, teamAbbreviation: 'ANA', position: 'LW',
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
