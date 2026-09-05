/**
 * CREATE LEAGUE, AS DATA (PR10o, 2026-09-04).
 *
 * The Create League page is 1,300 lines of hand-written form: eleven
 * sections of Labels, Selects, Inputs, Switches and radio cards, each
 * wired by hand to one of forty pieces of state. The Press Box settings
 * screen already knows how to draw a setting as a row with its value on
 * the right and its rule underneath, and a new league's settings ARE the
 * settings screen's settings before there is a league -- so the phone
 * states each one here as a `SettingField` and draws nothing by hand.
 *
 * Every field reads and writes the page's own state, so the phone and the
 * desktop form can never disagree about a value, and the create path is
 * the page's own `handleCreateLeague`. The rules under the rows are the
 * desktop form's own help lines, shortened to a phone.
 *
 * ONE ROW PER STAT. The desktop scoring section draws a switch AND a
 * points select for each of thirteen stats. Here a stat is one select
 * whose first option is `Off`: choosing it disables the stat, choosing a
 * value enables it and sets the points, and the row shows `OFF` or `+2`.
 * Same state, half the rows.
 */
import type { LeagueStatSetting } from '@citrus/shared';
import {
  type LeagueType,
  type ScoringFormat,
  type DraftType,
  type PickemFormat,
  LEAGUE_TYPE_LABELS,
  LEAGUE_TYPE_DESCRIPTIONS,
  SCORING_FORMAT_LABELS,
  SCORING_FORMAT_DESCRIPTIONS,
  DRAFT_TYPE_LABELS,
  DRAFT_TYPE_DESCRIPTIONS,
  AVAILABLE_CATEGORIES,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_FDG_ROSTER_SLOTS,
} from '@/types/leagueTypes';
import { processTimeLabel, type SettingField, type SettingOption, type SettingSection } from './leagueSettingsSections';

export type KeeperPenalty = 'none' | 'round-cost' | 'round-escalation';
export type PickDeadline = 'per-game' | 'first-game';
export type Tiebreaker = 'none' | 'total-points' | 'most-upsets';
export type BracketPickMode = 'round-by-round' | 'full-bracket';
export type WaiverType = 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings';

export interface CreateLeagueWaivers {
  waiver_process_time: string;
  waiver_period_hours: number;
  waiver_game_lock: boolean;
  waiver_type: WaiverType;
  allow_trades_during_games: boolean;
  faab_budget: number;
}

/** The page's state, as this module needs it. Strings where the page keeps strings. */
export interface CreateLeagueForm {
  /** `visibleLeagueTypes(?type)` -- the playoff funnel shows the three pools only. */
  leagueTypes: LeagueType[];
  leagueType: LeagueType;
  setLeagueType: (t: LeagueType) => void;
  leagueName: string;
  setLeagueName: (v: string) => void;
  teamsCount: string;
  setTeamsCount: (v: string) => void;
  scoringFormat: ScoringFormat;
  setScoringFormat: (v: ScoringFormat) => void;

  draftType: DraftType;
  setDraftType: (v: DraftType) => void;
  draftRounds: string;
  setDraftRounds: (v: string) => void;
  pickTimeLimit: string;
  setPickTimeLimit: (v: string) => void;
  auctionBudget: string;
  setAuctionBudget: (v: string) => void;
  auctionMinBid: string;
  setAuctionMinBid: (v: string) => void;
  auctionNominationTime: string;
  setAuctionNominationTime: (v: string) => void;
  auctionBidTime: string;
  setAuctionBidTime: (v: string) => void;

  leagueStats: LeagueStatSetting[];
  setStatEnabled: (id: string, enabled: boolean) => void;
  setStatPoints: (id: string, points: number) => void;
  selectedCategories: string[];
  toggleCategory: (id: string) => void;
  minGoalieGames: string;
  setMinGoalieGames: (v: string) => void;

  playoffTeams: string;
  /** The page re-derives the bracket length from the size; this takes the size. */
  setPlayoffTeams: (v: string) => void;
  playoffOptions: number[];
  playoffWeeks: string;
  setPlayoffWeeks: (v: string) => void;
  tradeDeadlineWeek: string;
  setTradeDeadlineWeek: (v: string) => void;
  keeperEnabled: boolean;
  setKeeperEnabled: (v: boolean) => void;
  keeperCount: string;
  setKeeperCount: (v: string) => void;
  keeperPenalty: KeeperPenalty;
  setKeeperPenalty: (v: KeeperPenalty) => void;
  dynastyMode: boolean;
  setDynastyMode: (v: boolean) => void;

  waivers: CreateLeagueWaivers;
  setWaivers: (update: (prev: CreateLeagueWaivers) => CreateLeagueWaivers) => void;
  weeklyAddLimit: string;
  setWeeklyAddLimit: (v: string) => void;
  seasonAddLimit: string;
  setSeasonAddLimit: (v: string) => void;

  positionType: 'individual' | 'forward';
  setPositionType: (v: 'individual' | 'forward') => void;
  rosterSlots: Record<string, number>;
  setRosterSlot: (slot: string, count: number) => void;
  /** The rounds-vs-roster warning the page computes, or null. */
  roundsVsRoster: string | null;

  pickemFormat: PickemFormat;
  setPickemFormat: (v: PickemFormat) => void;
  picksPerWeek: string;
  setPicksPerWeek: (v: string) => void;
  survivorLives: string;
  setSurvivorLives: (v: string) => void;
  confidenceMaxPoints: string;
  pickDeadline: PickDeadline;
  setPickDeadline: (v: PickDeadline) => void;
  tiebreaker: Tiebreaker;
  setTiebreaker: (v: Tiebreaker) => void;
  allowRepeatTeams: boolean;
  setAllowRepeatTeams: (v: boolean) => void;
  playoffLockDeadline: string;
  setPlayoffLockDeadline: (v: string) => void;
  bracketPickMode: BracketPickMode;
  setBracketPickMode: (v: BracketPickMode) => void;

  /** The page's own derivations, so the two layouts cannot disagree. */
  isFantasy: boolean;
  showPointValues: boolean;
  showCategories: boolean;
  showMatchupSettings: boolean;
  showDraftSettings: boolean;
  showWaiverSettings: boolean;
}

/* ── option lists ──────────────────────────────────────────────────── */

const opts = (pairs: [string, string, string?][]): SettingOption[] =>
  pairs.map(([value, label, help]) => ({ value, label, help }));

/** The desktop form's per-stat point menus. Every stat includes 0. */
export const STAT_POINT_OPTIONS: Record<string, number[]> = {
  g: [0, 1, 2, 3, 4, 5, 6],
  a: [0, 1, 1.5, 2, 2.5, 3, 4],
  ppp: [0, 0.5, 1, 1.5, 2, 3],
  shg: [0, 1, 1.5, 2, 2.5, 3, 4],
  sog: [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5],
  blk: [0, 0.25, 0.5, 0.75, 1, 1.5],
  hit: [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5],
  pim: [-1, -0.5, -0.25, 0, 0.25, 0.5, 1],
  pm: [-1, -0.5, -0.25, 0, 0.25, 0.5, 1, 1.5],
  w: [0, 2, 3, 4, 5, 6, 8],
  so: [0, 2, 3, 4, 5, 6, 8],
  sv: [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5],
  ga: [-2, -1.5, -1, -0.5, -0.25, 0],
};
const DEFAULT_POINT_OPTIONS = [0, 0.25, 0.5, 1, 2, 3];

export const pointsLabel = (v: number): string => (v === 0 ? '0' : v > 0 ? `+${v}` : String(v));

/** `Off` first, then the stat's menu; the current value is kept if the menu lacks it. */
export function statPointOptions(stat: LeagueStatSetting): SettingOption[] {
  const menu = STAT_POINT_OPTIONS[stat.id] ?? DEFAULT_POINT_OPTIONS;
  const current = Number(stat.points);
  const all = menu.includes(current) ? menu : [...menu, current].sort((a, b) => a - b);
  return [{ value: 'off', label: 'Off', help: 'Not counted' }, ...all.map((v) => ({ value: String(v), label: pointsLabel(v) }))];
}

const DRAFT_ROUNDS = opts([['14', '14 rounds'], ['16', '16 rounds'], ['18', '18 rounds'], ['21', '21 rounds'], ['24', '24 rounds'], ['30', '30 rounds']]);
const PICK_CLOCKS = opts([['30', '30s'], ['60', '60s'], ['90', '90s'], ['120', '120s'], ['180', '3 min'], ['300', '5 min']]);
const NOMINATION_CLOCKS = opts([['15', '15s'], ['30', '30s'], ['45', '45s'], ['60', '60s']]);
const BID_CLOCKS = opts([['10', '10s'], ['15', '15s'], ['20', '20s'], ['30', '30s'], ['45', '45s']]);
const PLAYOFF_WEEKS = opts([['1', '1 week'], ['2', '2 weeks'], ['3', '3 weeks'], ['4', '4 weeks']]);
const TRADE_DEADLINES = opts([['0', 'None'], ['8', 'Week 8'], ['10', 'Week 10'], ['12', 'Week 12'], ['14', 'Week 14'], ['16', 'Week 16']]);
const KEEPER_COUNTS = opts([['0', 'Unlimited', 'Dynasty: the whole roster is kept'], ['1', '1 keeper'], ['2', '2 keepers'], ['3', '3 keepers'], ['5', '5 keepers'], ['8', '8 keepers'], ['10', '10 keepers']]);
const KEEPER_PENALTIES = opts([
  ['none', 'None', 'No round cost: a keeper takes the team’s last-round pick'],
  ['round-cost', 'Round cost', 'Keeping a player costs the round he was drafted in'],
  ['round-escalation', 'Escalation', 'The cost goes up one round each season'],
]);
const PROCESS_TIMES = ['00:00:00', '02:00:00', '03:00:00', '06:00:00', '09:00:00', '12:00:00'];
const WAIVER_PERIODS = opts([['24', '24 hours'], ['48', '48 hours'], ['72', '72 hours']]);
const WAIVER_TYPES = opts([
  ['rolling', 'Join order', 'Rolling. Seeded by join date; the claimant drops to the back'],
  ['reverse_draft_order', 'Reverse draft', 'Rolling. The last first-round pick holds waiver 1'],
  ['reverse_standings', 'Reverse standings', 'Recomputed at every run. The worst record claims first'],
  ['faab', 'FAAB', 'Every team bids from a season budget. The highest bid wins'],
]);
const WEEKLY_ADDS = opts([['0', 'Unlimited'], ['2', '2 a week'], ['3', '3 a week'], ['4', '4 a week'], ['5', '5 a week'], ['6', '6 a week'], ['7', '7 a week'], ['10', '10 a week']]);
const SEASON_ADDS = opts([['0', 'Unlimited'], ['25', '25'], ['50', '50'], ['75', '75'], ['100', '100'], ['150', '150']]);
const GAMES_PER_WEEK = opts([['0', 'All games', 'Pick every game on the schedule each week'], ['5', '5 games'], ['10', '10 games'], ['15', '15 games']]);
const PICK_DEADLINES = opts([
  ['per-game', 'Each game', 'A pick locks when its game starts'],
  ['first-game', 'First game', 'Every pick locks when the first game of the week starts'],
]);
const TIEBREAKERS = opts([
  ['none', 'None'],
  ['total-points', 'Total score', 'Closest combined-score prediction'],
  ['most-upsets', 'Most upsets', 'Most upsets picked correctly'],
]);
const SURVIVOR_LIVES = opts([['1', '1 life', 'Classic: one wrong pick and out'], ['2', '2 lives', 'One mulligan'], ['3', '3 lives', 'Two mulligans']]);
const MIN_GOALIE_GAMES = opts([['0', 'None'], ['2', '2 games'], ['3', '3 games'], ['5', '5 games']]);
const POSITION_FORMATS = opts([
  ['individual', 'C / LW / RW / D / G', 'Individual positions'],
  ['forward', 'F / D / G', 'Forwards together'],
]);
const BRACKET_MODES = opts([
  ['round-by-round', 'Round by round', 'Pick each round as it starts. Forgiving'],
  ['full-bracket', 'Full bracket', 'All 15 series before Game 1 of Round 1. One shot'],
]);

const num = (v: string, fallback: number): number => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
};

/** Ceil(log2 n): the rounds a bracket of n needs. Mirrors the page. */
const playoffRounds = (n: number): number => (n >= 2 ? Math.ceil(Math.log2(n)) : 0);

/* ── the sections ──────────────────────────────────────────────────── */

export function buildCreateLeagueSections(f: CreateLeagueForm): SettingSection[] {
  const sections: SettingSection[] = [];
  const isPlayoffPool =
    f.leagueType === 'playoff-bracket-pickem' ||
    f.leagueType === 'playoff-confidence-pool' ||
    f.leagueType === 'playoff-roster-pool';
  const isPool = !f.isFantasy;

  // ── FORMAT ──
  const format: SettingField[] = [
    {
      kind: 'text',
      key: 'name',
      label: 'League name',
      help: null,
      value: f.leagueName,
      placeholder: f.isFantasy ? 'The Frozen Pond' : 'Office Hockey Pool',
      maxLength: 60,
      onChange: f.setLeagueName,
    },
    {
      kind: 'select',
      key: 'leagueType',
      label: isPlayoffPool ? 'Pool format' : 'League type',
      // The picker carries each type's description; the row needs only the name.
      help: '',
      value: f.leagueType,
      options: f.leagueTypes.map((t) => ({ value: t, label: LEAGUE_TYPE_LABELS[t], help: LEAGUE_TYPE_DESCRIPTIONS[t] })),
      onChange: (v) => f.setLeagueType(v as LeagueType),
    },
    {
      kind: 'number',
      key: 'teams',
      label: isPool ? 'Max participants' : 'Teams',
      help: isPool ? 'Any number from 2 to 100' : 'Any number from 2 to 50',
      value: num(f.teamsCount, isPool ? 20 : 12),
      min: 2,
      max: isPool ? 100 : 50,
      onChange: (n) => f.setTeamsCount(String(n)),
    },
  ];
  if (f.isFantasy) {
    format.push({
      kind: 'select',
      key: 'scoringFormat',
      label: 'Scoring format',
      help: '',
      value: f.scoringFormat,
      options: (Object.keys(SCORING_FORMAT_LABELS) as ScoringFormat[]).map((s) => ({
        value: s,
        label: SCORING_FORMAT_LABELS[s],
        help: SCORING_FORMAT_DESCRIPTIONS[s],
      })),
      onChange: (v) => f.setScoringFormat(v as ScoringFormat),
    });
  }
  const lock: SettingField[] = [];
  if (isPlayoffPool) {
    lock.push({
      kind: 'text',
      key: 'lock',
      label: f.leagueType === 'playoff-roster-pool' ? 'Roster lock' : 'Pick lock',
      help:
        f.leagueType === 'playoff-roster-pool'
          ? 'Rosters lock at this time. Set it to puck drop of Round 1, Game 1'
          : 'Picks lock at this time. Set it to just before the first playoff game',
      value: f.playoffLockDeadline,
      inputType: 'datetime-local',
      onChange: f.setPlayoffLockDeadline,
    });
  }
  if (f.leagueType === 'playoff-bracket-pickem') {
    lock.push({
      kind: 'select',
      key: 'bracketMode',
      label: 'Bracket picks',
      value: f.bracketPickMode,
      options: BRACKET_MODES,
      onChange: (v) => f.setBracketPickMode(v as BracketPickMode),
    });
  }
  const offseason = new Date().getMonth() >= 6 || new Date().getMonth() <= 1;
  sections.push({
    key: 'format',
    label: 'FORMAT',
    groups: [
      { key: 'league', label: 'LEAGUE', fields: format },
      { key: 'lock', label: lock.length ? 'PLAYOFFS' : null, fields: lock },
    ],
    callout:
      isPlayoffPool && offseason
        ? 'The NHL playoffs start in spring. The pre-filled date is a placeholder; set the lock to just before Round 1, Game 1.'
        : null,
    saveable: false,
  });

  // ── POOL ──
  if (f.leagueType === 'pickem' || f.leagueType === 'survivor' || f.leagueType === 'confidence-pool') {
    const pool: SettingField[] = [];
    if (f.leagueType === 'pickem') {
      pool.push({
        kind: 'select',
        key: 'pickemFormat',
        label: 'Pick format',
        value: f.pickemFormat,
        options: opts([
          ['straight-up', 'Straight up', 'Pick the winner. One point a correct pick'],
          ['against-the-spread', 'Against the spread', 'Pick winners against the point spread'],
        ]),
        onChange: (v) => f.setPickemFormat(v as PickemFormat),
      });
    }
    if (f.leagueType === 'pickem' || f.leagueType === 'confidence-pool') {
      pool.push({
        kind: 'select',
        key: 'picksPerWeek',
        label: 'Games a week',
        value: f.picksPerWeek,
        options: GAMES_PER_WEEK,
        onChange: f.setPicksPerWeek,
      });
    }
    if (f.leagueType === 'confidence-pool') {
      pool.push({
        kind: 'info',
        key: 'confidenceMax',
        label: 'Confidence points',
        help: `1 through ${f.confidenceMaxPoints}, each used once a week. Always equal to the games a week`,
        value: `${f.confidenceMaxPoints} max`,
      });
    }
    if (f.leagueType === 'survivor') {
      pool.push(
        {
          kind: 'select',
          key: 'lives',
          label: 'Lives',
          value: f.survivorLives,
          options: SURVIVOR_LIVES,
          onChange: f.setSurvivorLives,
        },
        {
          kind: 'select',
          key: 'repeats',
          label: 'Team repeats',
          value: f.allowRepeatTeams ? 'allow' : 'no-repeat',
          options: opts([
            ['no-repeat', 'No repeats', 'Each team once all season. Classic'],
            ['allow', 'After mid-season', 'Teams can be picked again after mid-season'],
          ]),
          onChange: (v) => f.setAllowRepeatTeams(v === 'allow'),
        },
      );
    }
    pool.push({
      kind: 'select',
      key: 'pickDeadline',
      label: 'Pick deadline',
      value: f.pickDeadline,
      options: PICK_DEADLINES,
      onChange: (v) => f.setPickDeadline(v as PickDeadline),
    });
    if (f.leagueType !== 'survivor') {
      pool.push({
        kind: 'select',
        key: 'tiebreaker',
        label: 'Tiebreaker',
        value: f.tiebreaker,
        options: TIEBREAKERS,
        onChange: (v) => f.setTiebreaker(v as Tiebreaker),
      });
    }
    sections.push({
      key: 'pool',
      label: f.leagueType === 'pickem' ? "PICK'EM" : f.leagueType === 'survivor' ? 'SURVIVOR' : 'CONFIDENCE',
      groups: [{ key: 'pool', label: 'PICKS', fields: pool }],
      saveable: false,
    });
  }

  // ── DRAFT ──
  if (f.showDraftSettings) {
    const isAuction = f.draftType === 'auction';
    const draft: SettingField[] = [
      {
        kind: 'select',
        key: 'draftType',
        label: 'Draft type',
        help: '',
        value: f.draftType,
        options: (Object.keys(DRAFT_TYPE_LABELS) as DraftType[]).map((d) => ({
          value: d,
          label: DRAFT_TYPE_LABELS[d],
          help: DRAFT_TYPE_DESCRIPTIONS[d],
        })),
        onChange: (v) => f.setDraftType(v as DraftType),
      },
      {
        kind: 'select',
        key: 'rounds',
        label: 'Rounds',
        help: f.draftType === 'offline' ? 'Sizes the results grid the commissioner fills in' : null,
        value: f.draftRounds,
        options: DRAFT_ROUNDS,
        onChange: f.setDraftRounds,
      },
    ];
    if (f.draftType === 'snake' || f.draftType === 'linear') {
      draft.push({
        kind: 'select',
        key: 'clock',
        label: 'Pick clock',
        value: f.pickTimeLimit,
        options: PICK_CLOCKS,
        onChange: f.setPickTimeLimit,
      });
    }
    const auction: SettingField[] = isAuction
      ? [
          {
            kind: 'number',
            key: 'budget',
            label: 'Salary budget',
            help: 'Each team spends this across the draft',
            value: num(f.auctionBudget, 200),
            min: 50,
            max: 1000,
            step: 10,
            unit: '$',
            onChange: (n) => f.setAuctionBudget(String(n)),
          },
          {
            kind: 'number',
            key: 'minBid',
            label: 'Minimum bid',
            value: num(f.auctionMinBid, 1),
            min: 0,
            max: 10,
            unit: '$',
            onChange: (n) => f.setAuctionMinBid(String(n)),
          },
          {
            kind: 'select',
            key: 'nomination',
            label: 'Nomination clock',
            help: 'Time to put a player up',
            value: f.auctionNominationTime,
            options: NOMINATION_CLOCKS,
            onChange: f.setAuctionNominationTime,
          },
          {
            kind: 'select',
            key: 'bid',
            label: 'Bid clock',
            help: 'Bidding stays open this long after each bid',
            value: f.auctionBidTime,
            options: BID_CLOCKS,
            onChange: f.setAuctionBidTime,
          },
        ]
      : [];
    sections.push({
      key: 'draft',
      label: 'DRAFT',
      groups: [
        { key: 'draft', label: 'THE DRAFT', fields: draft },
        { key: 'auction', label: auction.length ? 'AUCTION' : null, fields: auction },
      ],
      callout:
        f.draftType === 'offline'
          ? 'Offline: draft however you like, then the commissioner enters the results.'
          : f.roundsVsRoster,
      saveable: false,
    });
  }

  // ── SCORING ──
  if (f.showPointValues) {
    const byCategory = (cat: string): SettingField[] =>
      f.leagueStats
        .filter((s) => s.category === cat)
        .map((s) => ({
          kind: 'select',
          key: `stat:${s.id}`,
          label: s.name,
          help: null,
          value: s.enabled ? String(s.points) : 'off',
          options: statPointOptions(s),
          onChange: (v) => {
            if (v === 'off') {
              f.setStatEnabled(s.id, false);
              return;
            }
            f.setStatEnabled(s.id, true);
            f.setStatPoints(s.id, Number(v));
          },
        }));
    const active = f.leagueStats.filter((s) => s.enabled).length;
    sections.push({
      key: 'scoring',
      label: 'SCORING',
      groups: [
        { key: 'offense', label: 'OFFENSE', fields: byCategory('Offense') },
        { key: 'defense', label: 'DEFENSE', fields: byCategory('Defense') },
        { key: 'goalie', label: 'GOALIE', fields: byCategory('Goalie') },
      ],
      callout: `${active} ${active === 1 ? 'stat counts' : 'stats count'}. A stat set to Off scores nothing.`,
      saveable: false,
    });
  }

  // ── CATEGORIES ──
  if (f.showCategories) {
    const cat = (goalie: boolean): SettingField[] =>
      AVAILABLE_CATEGORIES.filter((c) => c.isGoalie === goalie).map((c) => ({
        kind: 'toggle',
        key: `cat:${c.id}`,
        label: c.name,
        help: c.higherIsBetter ? c.abbreviation : `${c.abbreviation} · lower is better`,
        checked: f.selectedCategories.includes(c.id),
        onChange: () => f.toggleCategory(c.id),
      }));
    const goalieFields = cat(true);
    if (f.scoringFormat === 'roto') {
      goalieFields.push({
        kind: 'select',
        key: 'minGoalieGames',
        label: 'Minimum goalie games',
        help: 'Starts required before GAA and SV% count',
        value: f.minGoalieGames,
        options: MIN_GOALIE_GAMES,
        onChange: f.setMinGoalieGames,
      });
    }
    sections.push({
      key: 'categories',
      label: 'CATEGORIES',
      groups: [
        { key: 'skater', label: 'SKATERS', fields: cat(false) },
        { key: 'goalie', label: 'GOALIES', fields: goalieFields },
      ],
      callout:
        f.scoringFormat === 'roto'
          ? `${f.selectedCategories.length} categories. Teams are ranked in each and earn roto points by rank.`
          : `${f.selectedCategories.length} categories. Each is its own win, loss or tie every week.`,
      saveable: false,
    });
  }

  // ── SEASON ──
  if (f.isFantasy) {
    const season: SettingField[] = [];
    if (f.showMatchupSettings) {
      const teams = num(f.playoffTeams, 6);
      season.push({
        kind: 'select',
        key: 'playoffTeams',
        label: 'Playoff teams',
        help: 'Options fit the number of teams',
        value: f.playoffTeams,
        options: [
          { value: '0', label: 'No playoffs' },
          ...f.playoffOptions.map((n) => ({ value: String(n), label: n === 2 ? '2 · final only' : `${n} teams` })),
        ],
        onChange: f.setPlayoffTeams,
      });
      if (teams > 0) {
        const rounds = playoffRounds(teams);
        season.push({
          kind: 'select',
          key: 'playoffWeeks',
          label: 'Playoff weeks',
          help: `${rounds} ${rounds === 1 ? 'round' : 'rounds'} for ${teams} teams`,
          value: f.playoffWeeks,
          options: PLAYOFF_WEEKS,
          onChange: f.setPlayoffWeeks,
        });
      }
    }
    season.push({
      kind: 'select',
      key: 'tradeDeadline',
      label: 'Trade deadline',
      value: f.tradeDeadlineWeek,
      options: TRADE_DEADLINES,
      onChange: f.setTradeDeadlineWeek,
    });
    const keepers: SettingField[] = [
      {
        kind: 'toggle',
        key: 'keeper',
        label: 'Keeper league',
        help: 'The first draft is full; keepers apply from season two',
        checked: f.keeperEnabled,
        onChange: (on) => {
          f.setKeeperEnabled(on);
          if (!on) f.setDynastyMode(false);
        },
      },
    ];
    if (f.keeperEnabled) {
      keepers.push(
        {
          kind: 'select',
          key: 'keeperCount',
          label: 'Keepers a team',
          value: f.keeperCount,
          options: KEEPER_COUNTS,
          onChange: f.setKeeperCount,
          disabled: f.dynastyMode,
        },
        {
          kind: 'select',
          key: 'keeperPenalty',
          label: 'Keeper cost',
          value: f.keeperPenalty,
          options: KEEPER_PENALTIES,
          onChange: (v) => f.setKeeperPenalty(v as KeeperPenalty),
        },
      );
    }
    keepers.push({
      kind: 'toggle',
      key: 'dynasty',
      label: 'Dynasty',
      help: 'The whole roster is kept; only rookies are drafted each year',
      checked: f.dynastyMode,
      onChange: (on) => {
        f.setDynastyMode(on);
        if (on) {
          f.setKeeperEnabled(true);
          f.setKeeperCount('0');
        }
      },
    });
    sections.push({
      key: 'season',
      label: 'SEASON',
      groups: [
        { key: 'season', label: 'THE SEASON', fields: season },
        { key: 'keepers', label: 'KEEPERS', fields: keepers },
      ],
      saveable: false,
    });
  }

  // ── WAIVERS ──
  if (f.showWaiverSettings) {
    const w = f.waivers;
    const waivers: SettingField[] = [
      {
        kind: 'select',
        key: 'waiverType',
        label: 'Waiver type',
        value: w.waiver_type,
        options: WAIVER_TYPES,
        onChange: (v) => f.setWaivers((p) => ({ ...p, waiver_type: v as WaiverType })),
      },
    ];
    if (w.waiver_type === 'faab') {
      waivers.push({
        kind: 'number',
        key: 'faab',
        label: 'FAAB budget',
        help: 'Each team bids from this all season',
        value: w.faab_budget,
        min: 25,
        max: 500,
        step: 5,
        unit: '$',
        onChange: (n) => f.setWaivers((p) => ({ ...p, faab_budget: n })),
      });
    }
    waivers.push(
      {
        kind: 'select',
        key: 'processTime',
        label: 'Waivers run',
        help: 'Mountain time',
        value: w.waiver_process_time,
        options: PROCESS_TIMES.map((t) => ({ value: t, label: processTimeLabel(t) })),
        onChange: (v) => f.setWaivers((p) => ({ ...p, waiver_process_time: v })),
      },
      {
        kind: 'select',
        key: 'period',
        label: 'Waiver period',
        help: 'How long a dropped player sits on waivers',
        value: String(w.waiver_period_hours),
        options: WAIVER_PERIODS,
        onChange: (v) => f.setWaivers((p) => ({ ...p, waiver_period_hours: parseInt(v, 10) })),
      },
      {
        kind: 'toggle',
        key: 'gameLock',
        label: 'Game lock',
        help: 'A player locks when his game starts',
        checked: w.waiver_game_lock,
        onChange: (on) => f.setWaivers((p) => ({ ...p, waiver_game_lock: on })),
      },
    );
    const trades: SettingField[] = [
      {
        kind: 'toggle',
        key: 'tradesDuringGames',
        label: 'Trades during games',
        checked: w.allow_trades_during_games,
        onChange: (on) => f.setWaivers((p) => ({ ...p, allow_trades_during_games: on })),
      },
      {
        kind: 'select',
        key: 'weeklyAdds',
        label: 'Adds a week',
        value: f.weeklyAddLimit,
        options: WEEKLY_ADDS,
        onChange: f.setWeeklyAddLimit,
      },
      {
        kind: 'select',
        key: 'seasonAdds',
        label: 'Adds a season',
        value: f.seasonAddLimit,
        options: SEASON_ADDS,
        onChange: f.setSeasonAddLimit,
      },
    ];
    sections.push({
      key: 'waivers',
      label: 'WAIVERS',
      groups: [
        { key: 'waivers', label: 'WAIVERS', fields: waivers },
        { key: 'trades', label: 'TRADES & ADDS', fields: trades },
      ],
      saveable: false,
    });
  }

  // ── ROSTER ──
  if (f.isFantasy) {
    const slots = f.positionType === 'forward' ? DEFAULT_FDG_ROSTER_SLOTS : DEFAULT_ROSTER_SLOTS;
    const total = Object.values(f.rosterSlots).reduce((a, b) => a + (b || 0), 0);
    sections.push({
      key: 'roster',
      label: 'ROSTER',
      groups: [
        {
          key: 'format',
          label: 'POSITIONS',
          fields: [
            {
              kind: 'select',
              key: 'positionType',
              label: 'Position format',
              help: 'Changing it resets the slots to the defaults for that format',
              value: f.positionType,
              options: POSITION_FORMATS,
              onChange: (v) => f.setPositionType(v as 'individual' | 'forward'),
            },
          ],
        },
        {
          key: 'slots',
          label: `SLOTS · ${total} TOTAL`,
          fields: slots.map((s) => ({
            kind: 'number',
            key: `slot:${s.slot}`,
            label: s.label,
            help: s.slot,
            value: f.rosterSlots[s.slot] ?? s.count,
            min: 0,
            max: 10,
            onChange: (n) => f.setRosterSlot(s.slot, n),
          })),
        },
      ],
      callout: f.roundsVsRoster,
      saveable: false,
    });
  }

  return sections;
}
