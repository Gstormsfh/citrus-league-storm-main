/**
 * The mobile MATCHUP lineup rows at a phone viewport — real
 * `MatchupPositionGroup` / `MatchupComparisonRow` / `PlayerCard` /
 * `CenterColumn`, real index.css, fixture players.
 *
 * Why this exists rather than `page.html?p=matchup` (2026-09-02): the whole
 * Matchup page needs `MatchupService` to return a matchup, and the harness
 * stubs only the three league GETs — the page renders "No matchup data
 * available" and the rows never mount, so the surface this file exists to
 * look at cannot be looked at there. The rows themselves need nothing but
 * two arrays of players, so they get mounted directly, the way cards.tsx
 * mounts MobileRosterList.
 *
 * The `.matchup-wrapper` / `.matchup-position-group` / `.matchup-team-header`
 * markup is copied from MatchupComparison so the stylesheet's mobile block
 * (`@media (max-width: 1023px)`) applies exactly as it does on the page.
 */
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { MatchupPositionGroup } from '../src/components/matchup/MatchupPositionGroup';

import { OPP, SLOTS, TODAY, USER } from './matchupFixtures';


function App() {
  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream">
      <div className="matchup-wrapper" style={{ boxSizing: 'border-box', padding: 0, margin: 0 }}>
        <div className="matchup-team-header bg-[#1A2A20]/95 backdrop-blur-sm border-b border-white/10 mb-1">
          <div className="matchup-team-header-side matchup-team-header-user">
            <span className="inline-flex items-center bg-pastel-orange/20 text-pastel-orange-soft ring-1 ring-pastel-orange/40 rounded-md font-jbmono uppercase font-bold text-[8px] px-1 py-0 tracking-wide flex-shrink-0">
              You
            </span>
            <span className="font-varsity text-[11px] md:text-xs uppercase truncate text-pastel-orange-soft">
              Harness FC
            </span>
          </div>
          <div className="matchup-team-header-center">
            <span className="font-mono text-[9px] text-white/55 uppercase">vs</span>
          </div>
          <div className="matchup-team-header-side matchup-team-header-opponent">
            <span className="font-varsity text-[11px] md:text-xs uppercase truncate text-pastel-cream">
              Ice Wolves
            </span>
          </div>
        </div>

        <div className="matchup-position-group" data-testid="starters">
          <MatchupPositionGroup
            userPlayers={USER}
            opponentPlayers={OPP}
            slotPositions={SLOTS}
            isUtilSlot={[false, false, false, false, false, false, false, true]}
            selectedDate={null}
          />
        </div>

        <div className="matchup-position-group" data-testid="bench">
          <MatchupPositionGroup
            userPlayers={[USER[2], USER[3]]}
            opponentPlayers={[OPP[3], OPP[7]]}
            slotPositions={['BN', 'BN']}
            isBench
            selectedDate={null}
          />
        </div>

        <div className="matchup-position-group" data-testid="day-view">
          <MatchupPositionGroup
            userPlayers={USER.slice(0, 5)}
            opponentPlayers={OPP.slice(0, 5)}
            slotPositions={SLOTS.slice(0, 5)}
            selectedDate={TODAY}
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
