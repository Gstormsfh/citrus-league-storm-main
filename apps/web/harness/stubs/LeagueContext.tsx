/** Harness stub for @/contexts/LeagueContext. */
import type { ReactNode } from 'react';

export const isDemoLeague = () => false;

export const LeagueProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

const LEAGUE = {
  userLeagueState: 'active-user' as const,
  activeLeagueId: 'harness-league',
  // The Press Box header reads `activeLeague` for the name and the crest
  // (2026-09-04). Without it the header rendered an empty title and a "?"
  // disc, which reads as a broken component rather than a thin fixture.
  // draft_status + created_at (2026-09-05): Roster resolves its week from
  // these; without them the harness never showed the week-bound chrome.
  activeLeague: {
    id: 'harness-league',
    name: 'Finalsz',
    commissioner_id: 'harness-user',
    draft_status: 'completed',
    created_at: '2026-09-01T18:00:00.000Z',
    settings: { crestTeam: 'EDM', teamsCount: 12, scoringFormat: 'h2h-points' },
    // The league menu's lines (2026-09-05): the waiver clock, the draft's
    // length, the join code behind `share link`.
    waiver_process_time: '02:00:00',
    draft_rounds: 18,
    join_code: 'HARNESS',
  },
  activeLeagueFormat: { leagueType: 'fantasy', scoringFormat: 'h2h-points' },
  leagues: [{ id: 'harness-league', name: 'Harness League' }],
  /**
   * THE APP HOME (2026-09-04) reads `userLeagues`: every league the
   * manager is in, with enough of the row to name a week and a format.
   * The active one is the artboard's; the other two are the artboard's
   * other two cards, with states the real read can produce.
   */
  userLeagues: [
    {
      id: 'harness-league', name: 'Finalsz', commissioner_id: 'harness-user', draft_status: 'completed',
      created_at: '2026-09-01T18:00:00.000Z', settings: { teamsCount: 12, scoringFormat: 'h2h-points' },
    },
    {
      id: 'harness-league-2', name: 'Puck Heads Dynasty', commissioner_id: 'owner-2', draft_status: 'completed',
      created_at: '2026-09-01T18:00:00.000Z', settings: { teamsCount: 10, scoringFormat: 'h2h-categories' },
    },
    {
      id: 'harness-league-3', name: 'Office Pick\'em', commissioner_id: 'owner-3', draft_status: 'not_started',
      created_at: '2026-09-01T18:00:00.000Z', settings: { teamsCount: 24, leagueType: 'pickem' },
    },
  ],
  // `?hold=1` freezes the context in its loading state, so a page's loading
  // branch (PR3: the chrome over the skeleton) can be reviewed.
  loading: new URLSearchParams(location.search).get('hold') === '1',
  isChangingLeague: false,
  leagueContextLoading: new URLSearchParams(location.search).get('hold') === '1',
  setActiveLeagueId: () => {},
  refreshLeagues: async () => {},
};

export const useLeague = () => LEAGUE;
