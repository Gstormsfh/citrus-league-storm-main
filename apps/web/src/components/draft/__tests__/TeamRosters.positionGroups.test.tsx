/**
 * THE RAIL COUNTS THE LEAGUE'S GROUPS (2026-09-10).
 *
 * Found on production: league "Keeper Test" is `positionType: 'forward'`
 * with rosterSlots { F: 6, D: 4, G: 2, UTIL: 1 }, and its draft rail told
 * the manager "C 5 · LW 2 · RW 1 · D 4 · G 2" — five buckets against three
 * that exist. The counts came from an exact string match on the player's
 * raw position against a hardcoded C/LW/RW/D/G literal.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TeamRosters } from '../TeamRosters';

afterEach(cleanup);

const TEAMS = [{ id: 't1', name: 'G Daddy', owner: 'Manager', color: '#FF6B1A', picks: [] }];

const pick = (id: string, position: string, round: number) => ({
  id,
  teamId: 't1',
  teamName: 'G Daddy',
  playerId: id,
  playerName: `Player ${id}`,
  position,
  round,
  pick: round,
  timestamp: 0,
});

// Two centres, a winger of each hand, two defencemen, a goalie.
const HISTORY = [
  pick('1', 'C', 1),
  pick('2', 'C', 2),
  pick('3', 'LW', 3),
  pick('4', 'RW', 4),
  pick('5', 'D', 5),
  pick('6', 'D', 6),
  pick('7', 'G', 7),
];

/**
 * The summary chips read `F 4`, `D 2` and so on. One team is rendered, so
 * the whole document is unambiguous — walking up from the team name to a
 * card element is the kind of DOM archaeology that breaks on a wrapper div.
 * Pick rows print a bare letter and never match; names are `Player 1`.
 */
const chips = (): string[] =>
  screen
    .getAllByText(/^(C|LW|RW|F|D|G) \d+$/)
    .map((n) => n.textContent!.trim());

describe('TeamRosters position summary', () => {
  it('an F/D/G league counts three groups and folds every forward into F', () => {
    render(
      <TeamRosters
        positionType="forward"
        teams={TEAMS}
        draftHistory={HISTORY}
        userTeamId="t1"
      />,
    );
    expect(chips()).toEqual(['F 4', 'D 2', 'G 1']);
    expect(screen.queryByText('C 2')).toBeNull();
    expect(screen.queryByText(/^LW /)).toBeNull();
  });

  it('an individual-position league is unchanged: five buckets, exact positions', () => {
    render(
      <TeamRosters teams={TEAMS} draftHistory={HISTORY} userTeamId="t1" />,
    );
    expect(chips()).toEqual(['C 2', 'LW 1', 'RW 1', 'D 2', 'G 1']);
    expect(screen.queryByText(/^F \d/)).toBeNull();
  });

  it('each pick row prints the letter its own league uses', () => {
    const { unmount } = render(
      <TeamRosters teams={TEAMS} draftHistory={[pick('1', 'C', 1)]} userTeamId="t1" />,
    );
    expect(screen.getByText('C')).toBeTruthy();
    unmount();
    render(
      <TeamRosters
        positionType="forward"
        teams={TEAMS}
        draftHistory={[pick('1', 'C', 1)]}
        userTeamId="t1"
      />,
    );
    expect(screen.getByText('F')).toBeTruthy();
    expect(screen.queryByText('C')).toBeNull();
  });
});
