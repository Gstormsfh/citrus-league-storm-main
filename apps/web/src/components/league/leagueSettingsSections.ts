/**
 * THE LEAGUE SETTINGS, AS DATA (2026-09-04).
 *
 * The commissioner dialog on LeagueDashboard is nine tabs of hand-written
 * form: a Label, a Select or an Input or a Switch, a help paragraph, forty
 * times over. The Press Box settings screen (artboard 1a) is a different
 * shape — every row shows its current value, in orange, on the right, and
 * the rule under the label — and rather than hand-write it a second time
 * this module states each setting ONCE as a field: what it is called,
 * what it means, what it is set to, what it may be set to, and what
 * changing it does. `LeagueSettingsPhone` renders the fields; the desktop
 * dialog is untouched and keeps its own markup.
 *
 * The fields read and write the dashboard's own state objects, so the two
 * screens can never disagree about a value, and the save path is the
 * dashboard's own `handleSaveSettings`, keyed on the same section key.
 *
 * Every help line is a rule stated where the setting is, because these are
 * the rules twelve people argue about in March. Nothing here invents a
 * figure: the callout says who is notified (the teams we can count) and
 * when a change lands only where that is known.
 */
import { AVAILABLE_CATEGORIES, DEFAULT_ROSTER_SLOTS } from '@/types/leagueTypes';
import type { ScoringRules } from './useScoringRules';

export interface SettingOption {
  value: string;
  /** Short — it sits in a 12px mono column on the right of a 393px row. */
  label: string;
  /** The rule this option sets; becomes the row's help line when chosen. */
  help?: string;
}

export type SettingField =
  | {
      kind: 'select';
      key: string;
      label: string;
      help?: string | null;
      value: string;
      options: SettingOption[];
      onChange: (value: string) => void;
      disabled?: boolean;
    }
  | {
      kind: 'number';
      key: string;
      label: string;
      help?: string | null;
      value: number;
      min: number;
      max: number;
      step?: number;
      /** `s`, `$`. Shown after the figure. */
      unit?: string;
      onChange: (value: number) => void;
      disabled?: boolean;
    }
  | {
      kind: 'toggle';
      key: string;
      label: string;
      help?: string | null;
      checked: boolean;
      onChange: (checked: boolean) => void;
    }
  | {
      kind: 'action';
      key: string;
      label: string;
      help?: string | null;
      actionLabel: string;
      busy?: boolean;
      onPress: () => void;
    }
  | {
      kind: 'info';
      key: string;
      label: string;
      help?: string | null;
      value: string;
    }
  | {
      /** A name or a date: typed in place, no picker. (Create League.) */
      kind: 'text';
      key: string;
      label: string;
      help?: string | null;
      value: string;
      placeholder?: string;
      inputType?: 'text' | 'datetime-local';
      maxLength?: number;
      onChange: (value: string) => void;
    };

export interface SettingGroup {
  key: string;
  label?: string | null;
  fields: SettingField[];
}

export interface SettingSection {
  key: string;
  /** Chip label, uppercase. */
  label: string;
  groups: SettingGroup[];
  /** The callout under the groups. */
  callout?: string | null;
  /** A section with nothing to save (rosters), or locked (the draft is done). */
  saveable: boolean;
  /** A section with its own save path (scoring) rather than the dashboard's. */
  onSave?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
}

/* ── the dashboard's state, as this module needs it ────────────────── */

export interface WaiverState {
  waiver_process_time: string;
  waiver_period_hours: number;
  waiver_game_lock: boolean;
  waiver_type: 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings';
  allow_trades_during_games: boolean;
  weeklyAddLimit: number;
  seasonAddLimit: number;
  faabBudget: number;
}
export interface DraftState {
  draft_rounds: number;
  pickTimeLimit: number;
}
export interface TradeState {
  trade_review_type: 'none' | 'commissioner' | 'league_vote';
  trade_review_period_hours: number;
  trade_veto_threshold: number;
}
export interface KeeperState {
  keeperEnabled: boolean;
  keeperCount: number;
  keeperPenalty: 'none' | 'round-cost' | 'round-escalation';
  dynastyMode: boolean;
}
export interface PlayoffState {
  playoffTeams: number;
  playoffWeeks: number;
}

type Set<T> = (update: (prev: T) => T) => void;

export interface LeagueSettingsInput {
  draftCompleted: boolean;
  teamCount: number;
  isCategoryLeague: boolean;
  waiver: WaiverState;
  setWaiver: Set<WaiverState>;
  draft: DraftState;
  setDraft: Set<DraftState>;
  trade: TradeState;
  setTrade: Set<TradeState>;
  keeper: KeeperState;
  setKeeper: Set<KeeperState>;
  categories: string[];
  setCategories: Set<string[]>;
  rosterSlots: Record<string, number>;
  setRosterSlots: Set<Record<string, number>>;
  playoff: PlayoffState;
  setPlayoff: Set<PlayoffState>;
  /** Commissioner tools on the waivers tab. */
  processWaivers: { onPress: () => void; busy: boolean };
  syncRosters: { onPress: () => void; busy: boolean };
  /** Team name → rostered count, for the ROSTERS section. */
  rosters: { name: string; count: number | null }[];
  rostersLoading: boolean;
  /** The scoring catalog and its edits, from useScoringRules. */
  scoring: ScoringRules;
}

/* ── labels ────────────────────────────────────────────────────────── */

/** `02:00:00` → `2:00 AM`. */
export function processTimeLabel(time: string): string {
  const h = Number(time.split(':')[0]);
  if (!Number.isFinite(h)) return time;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:00 ${suffix}`;
}

const PROCESS_TIMES = ['00:00:00', '02:00:00', '03:00:00', '06:00:00', '09:00:00', '12:00:00'];

const WAIVER_TYPES: SettingOption[] = [
  { value: 'rolling', label: 'Join order', help: 'Rolling. Seeded by join date; the claimant drops to the back' },
  { value: 'reverse_draft_order', label: 'Reverse draft', help: 'Rolling. The last first-round pick holds waiver 1; the claimant drops to the back' },
  { value: 'reverse_standings', label: 'Reverse standings', help: 'Recomputed at every run. The worst record claims first' },
  { value: 'faab', label: 'FAAB', help: 'Every team bids from a season budget. The highest bid wins' },
];

const unlimited = (n: number, per: string) => (n === 0 ? 'Unlimited' : `${n} ${per}`);

/** The current option's label, for the row. */
export function optionLabel(options: SettingOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/* ── the sections ──────────────────────────────────────────────────── */

export function buildLeagueSettingsSections(input: LeagueSettingsInput): SettingSection[] {
  const { waiver, setWaiver, draft, setDraft, trade, setTrade, keeper, setKeeper } = input;
  const notify = `Saving notifies all ${input.teamCount} managers`;

  const waivers: SettingSection = {
    key: 'waivers',
    label: 'WAIVERS',
    saveable: true,
    callout: `${notify}. Waiver changes take effect at the next run (daily, ${processTimeLabel(waiver.waiver_process_time)} MT).`,
    groups: [
      {
        key: 'processing',
        label: 'PROCESSING',
        fields: [
          {
            kind: 'select',
            key: 'waiver_type',
            label: 'Waiver type',
            value: waiver.waiver_type,
            options: WAIVER_TYPES,
            onChange: (v) => setWaiver((p) => ({ ...p, waiver_type: v as WaiverState['waiver_type'] })),
          },
          ...(waiver.waiver_type === 'faab'
            ? [
                {
                  kind: 'number' as const,
                  key: 'faabBudget',
                  label: 'FAAB budget',
                  help: 'Season bidding budget per team. Teams that have already bid keep the budget they started with',
                  value: waiver.faabBudget,
                  min: 1,
                  max: 100000,
                  step: 10,
                  unit: '$',
                  onChange: (n: number) => setWaiver((p) => ({ ...p, faabBudget: n })),
                },
              ]
            : []),
          {
            kind: 'select',
            key: 'waiver_process_time',
            label: 'Process time',
            help: 'Daily, Mountain Time',
            value: waiver.waiver_process_time,
            options: PROCESS_TIMES.map((t) => ({ value: t, label: processTimeLabel(t) })),
            onChange: (v) => setWaiver((p) => ({ ...p, waiver_process_time: v })),
          },
          {
            kind: 'select',
            key: 'waiver_period_hours',
            label: 'Waiver period',
            help: 'How long dropped players sit on waivers',
            value: String(waiver.waiver_period_hours),
            options: [24, 48, 72].map((h) => ({ value: String(h), label: `${h} hours` })),
            onChange: (v) => setWaiver((p) => ({ ...p, waiver_period_hours: parseInt(v, 10) })),
          },
        ],
      },
      {
        key: 'limits',
        label: 'LIMITS',
        fields: [
          {
            kind: 'select',
            key: 'weeklyAddLimit',
            label: 'Max adds per week',
            help: 'Free-agent pickups per team each week. Resets Monday',
            value: String(waiver.weeklyAddLimit ?? 0),
            options: [0, 2, 3, 4, 5, 6, 7, 10].map((n) => ({ value: String(n), label: unlimited(n, 'per week') })),
            onChange: (v) => setWaiver((p) => ({ ...p, weeklyAddLimit: parseInt(v, 10) })),
          },
          {
            kind: 'select',
            key: 'seasonAddLimit',
            label: 'Max adds per season',
            help: 'Free-agent pickups per team for the whole season',
            value: String(waiver.seasonAddLimit ?? 0),
            options: [0, 25, 50, 75, 100, 150].map((n) => ({ value: String(n), label: unlimited(n, 'per season') })),
            onChange: (v) => setWaiver((p) => ({ ...p, seasonAddLimit: parseInt(v, 10) })),
          },
          {
            kind: 'toggle',
            key: 'waiver_game_lock',
            label: 'Game lock',
            help: 'Players lock at puck drop',
            checked: waiver.waiver_game_lock,
            onChange: (c) => setWaiver((p) => ({ ...p, waiver_game_lock: c })),
          },
        ],
      },
      {
        key: 'trades-during-games',
        label: 'TRADES DURING GAMES',
        fields: [
          {
            kind: 'toggle',
            key: 'allow_trades_during_games',
            label: 'Allow trades during games',
            help: 'Locked players can still be dealt',
            checked: waiver.allow_trades_during_games,
            onChange: (c) => setWaiver((p) => ({ ...p, allow_trades_during_games: c })),
          },
        ],
      },
      {
        key: 'tools',
        label: 'COMMISSIONER TOOLS',
        fields: [
          {
            kind: 'action',
            key: 'process-waivers',
            label: 'Process waivers now',
            help: 'Runs every pending claim without waiting for the daily run',
            actionLabel: input.processWaivers.busy ? 'RUNNING…' : 'RUN',
            busy: input.processWaivers.busy,
            onPress: input.processWaivers.onPress,
          },
          {
            kind: 'action',
            key: 'sync-rosters',
            label: 'Sync rosters from draft',
            help: 'Rebuilds every roster from the completed draft results',
            actionLabel: input.syncRosters.busy ? 'SYNCING…' : 'SYNC',
            busy: input.syncRosters.busy,
            onPress: input.syncRosters.onPress,
          },
        ],
      },
    ],
  };

  const scoringField = (stat: ScoringRules['catalog'][number]): SettingField => {
    const value = Number(input.scoring.valueOf(stat));
    return {
      kind: 'number',
      key: `score-${stat.stat_key}`,
      label: stat.display_name,
      help: value === 0 ? 'Off' : stat.is_core ? null : 'New this season',
      value: Number.isFinite(value) ? value : 0,
      min: -20,
      max: 20,
      step: 0.1,
      onChange: (n) => input.scoring.setEdit(stat.stat_key, String(n)),
    };
  };
  const scoring: SettingSection = {
    key: 'scoring',
    label: 'SCORING',
    saveable: true,
    onSave: () => void input.scoring.save(),
    saving: input.scoring.saving,
    saveDisabled: input.scoring.changed.length === 0 || input.scoring.invalid,
    callout: input.scoring.loading
      ? 'Loading the scoring catalog…'
      : input.scoring.catalog.length === 0
        ? 'This league has not set its scoring yet.'
        : `${notify}. Points per stat; 0 turns a category off. New scores apply from the next scoring run.`,
    groups: [
      { key: 'skaters', label: 'SKATERS', fields: input.scoring.skaters.map(scoringField) },
      { key: 'goalies', label: 'GOALIES', fields: input.scoring.goalies.map(scoringField) },
    ],
  };

  const skaterCats = AVAILABLE_CATEGORIES.filter((c) => !c.isGoalie);
  const goalieCats = AVAILABLE_CATEGORIES.filter((c) => c.isGoalie);
  const categoryField = (c: (typeof AVAILABLE_CATEGORIES)[number]): SettingField => ({
    kind: 'toggle',
    key: `cat-${c.id}`,
    label: c.abbreviation,
    help: c.name,
    checked: input.categories.includes(c.id),
    onChange: (on) =>
      input.setCategories((prev) => (on ? [...prev.filter((id) => id !== c.id), c.id] : prev.filter((id) => id !== c.id))),
  });
  const categories: SettingSection = {
    key: 'categories',
    label: 'CATEGORIES',
    saveable: true,
    callout: `${notify}. Standings recompute from these categories at the next run.${
      input.categories.length === 0 ? ' Nothing chosen means the default set.' : ''
    }`,
    groups: [
      { key: 'skaters', label: 'SKATERS', fields: skaterCats.map(categoryField) },
      { key: 'goalies', label: 'GOALIES', fields: goalieCats.map(categoryField) },
    ],
  };

  const draftSection: SettingSection = {
    key: 'draft',
    label: 'DRAFT',
    saveable: !input.draftCompleted,
    callout: input.draftCompleted ? 'The draft is complete. Rounds and the clock cannot change now.' : notify + '.',
    groups: [
      {
        key: 'draft',
        label: 'THE DRAFT',
        fields: [
          {
            kind: 'number',
            key: 'draft_rounds',
            label: 'Rounds',
            help: 'One pick per team per round',
            value: draft.draft_rounds,
            min: 1,
            max: 30,
            onChange: (n) => setDraft((p) => ({ ...p, draft_rounds: n })),
            disabled: input.draftCompleted,
          },
          {
            kind: 'number',
            key: 'pickTimeLimit',
            label: 'Pick clock',
            help: 'Seconds on the clock for each pick',
            value: draft.pickTimeLimit,
            min: 15,
            max: 600,
            step: 15,
            unit: 's',
            onChange: (n) => setDraft((p) => ({ ...p, pickTimeLimit: n })),
            disabled: input.draftCompleted,
          },
        ],
      },
    ],
  };

  const REVIEW: SettingOption[] = [
    { value: 'none', label: 'Instant', help: 'Trades go through the moment they are accepted' },
    { value: 'commissioner', label: 'Commissioner', help: 'You approve every trade before it goes through' },
    { value: 'league_vote', label: 'League vote', help: 'Managers vote during the review window' },
  ];
  const trades: SettingSection = {
    key: 'trades',
    label: 'TRADES',
    saveable: true,
    callout: `${notify}.`,
    groups: [
      {
        key: 'review',
        label: 'REVIEW',
        fields: [
          {
            kind: 'select',
            key: 'trade_review_type',
            label: 'Trade review',
            value: trade.trade_review_type,
            options: REVIEW,
            onChange: (v) => setTrade((p) => ({ ...p, trade_review_type: v as TradeState['trade_review_type'] })),
          },
          ...(trade.trade_review_type === 'league_vote'
            ? ([
                {
                  kind: 'select',
                  key: 'trade_review_period_hours',
                  label: 'Review window',
                  help: 'How long managers have to vote',
                  value: String(trade.trade_review_period_hours),
                  options: [24, 48, 72].map((h) => ({ value: String(h), label: `${h} hours` })),
                  onChange: (v: string) => setTrade((p) => ({ ...p, trade_review_period_hours: parseInt(v, 10) })),
                },
                {
                  kind: 'select',
                  key: 'trade_veto_threshold',
                  label: 'Veto threshold',
                  help:
                    input.teamCount > 0
                      ? `${Math.ceil(trade.trade_veto_threshold * input.teamCount)} of ${input.teamCount} votes to veto`
                      : 'Share of managers needed to veto',
                  value: String(trade.trade_veto_threshold),
                  options: [
                    { value: '0.25', label: '25%' },
                    { value: '0.5', label: '50%' },
                    { value: '0.67', label: '67%' },
                    { value: '0.75', label: '75%' },
                  ],
                  onChange: (v: string) => setTrade((p) => ({ ...p, trade_veto_threshold: parseFloat(v) })),
                },
              ] as SettingField[])
            : []),
        ],
      },
    ],
  };
  const keepers: SettingSection = {
    key: 'keeper',
    label: 'KEEPERS',
    saveable: true,
    callout: `${notify}. Keepers carry into next season's draft; managers name them from the Keepers panel and you lock them before the draft.`,
    groups: [
      {
        key: 'keepers',
        label: 'BETWEEN SEASONS',
        fields: [
          {
            kind: 'toggle',
            key: 'keeperEnabled',
            label: 'Keeper league',
            help: 'Teams keep a set number of players between seasons',
            checked: keeper.keeperEnabled,
            onChange: (c) => setKeeper((p) => ({ ...p, keeperEnabled: c, ...(c ? {} : { dynastyMode: false }) })),
          },
          ...(keeper.keeperEnabled && !keeper.dynastyMode
            ? ([
                {
                  kind: 'select',
                  key: 'keeperCount',
                  label: 'Keepers per team',
                  value: String(keeper.keeperCount || 3),
                  options: [1, 2, 3, 5, 8, 10].map((n) => ({ value: String(n), label: `${n}` })),
                  onChange: (v: string) => setKeeper((p) => ({ ...p, keeperCount: parseInt(v, 10) || 0 })),
                },
                {
                  kind: 'select',
                  key: 'keeperPenalty',
                  label: 'Keeper cost',
                  value: keeper.keeperPenalty,
                  options: [
                    { value: 'none', label: 'Free', help: 'Keepers cost nothing in the draft' },
                    { value: 'round-cost', label: 'Round cost', help: 'A keeper costs the round he was drafted in' },
                    { value: 'round-escalation', label: 'Escalating', help: 'One round earlier each year he is kept' },
                  ],
                  onChange: (v: string) => setKeeper((p) => ({ ...p, keeperPenalty: v as KeeperState['keeperPenalty'] })),
                },
              ] as SettingField[])
            : []),
          {
            kind: 'toggle',
            key: 'dynastyMode',
            label: 'Dynasty mode',
            help: keeper.dynastyMode ? 'Every rostered player is kept between seasons' : 'The whole roster carries over. Unlimited keepers',
            checked: keeper.dynastyMode,
            onChange: (c) => setKeeper((p) => ({ ...p, dynastyMode: c, ...(c ? { keeperEnabled: true } : {}) })),
          },
        ],
      },
    ],
  };

  const rosterSlots: SettingSection = {
    key: 'rosterslots',
    label: 'ROSTER SLOTS',
    saveable: !input.draftCompleted,
    callout: input.draftCompleted
      ? 'Roster slots are locked once the draft is complete.'
      : `${notify}. Slots set before the draft shape every roster in it.`,
    groups: [
      {
        key: 'slots',
        label: 'SLOTS',
        fields: DEFAULT_ROSTER_SLOTS.map((s) => ({
          kind: 'number' as const,
          key: `slot-${s.slot}`,
          label: s.label,
          help: s.slot,
          value: input.rosterSlots[s.slot] ?? s.count,
          min: 0,
          max: 10,
          onChange: (n: number) => input.setRosterSlots((p) => ({ ...p, [s.slot]: n })),
          disabled: input.draftCompleted,
        })),
      },
    ],
  };

  const PLAYOFF_TEAMS: SettingOption[] = [
    { value: '0', label: 'None', help: 'The champion is the regular-season leader' },
    { value: '4', label: '4 teams', help: 'Semifinals, then the final. Two rounds' },
    { value: '6', label: '6 teams', help: 'Wild card, semifinals, final. Top two seeds skip the wild card' },
    { value: '8', label: '8 teams', help: 'Quarterfinals, semifinals, final. Three rounds' },
  ];
  const BRACKETS: Record<number, string[]> = {
    4: ['Semifinals: #1 vs #4, #2 vs #3', 'Final: The semifinal winners, for the title'],
    6: [
      'Wild card: #3 vs #6, #4 vs #5',
      'Semifinals: #1 and #2 meet the wild-card winners',
      'Final: The semifinal winners, for the title',
    ],
    8: [
      'Quarterfinals: #1 vs #8, #4 vs #5, #2 vs #7, #3 vs #6',
      'Semifinals: The quarterfinal winners',
      'Final: The semifinal winners, for the title',
    ],
  };
  const playoffs: SettingSection = {
    key: 'playoffs',
    label: 'PLAYOFFS',
    saveable: true,
    callout: `${notify}. The regular season shortens to fit the bracket.`,
    groups: [
      {
        key: 'bracket',
        label: 'BRACKET',
        fields: [
          {
            kind: 'select',
            key: 'playoffTeams',
            label: 'Playoff teams',
            value: String(input.playoff.playoffTeams),
            options: PLAYOFF_TEAMS,
            onChange: (v) => input.setPlayoff((p) => ({ ...p, playoffTeams: parseInt(v, 10) })),
          },
          ...(input.playoff.playoffTeams > 0
            ? ([
                {
                  kind: 'select',
                  key: 'playoffWeeks',
                  label: 'Playoff weeks',
                  help: 'Weeks reserved for the bracket',
                  value: String(input.playoff.playoffWeeks),
                  options: [2, 3, 4].map((n) => ({ value: String(n), label: `${n} weeks` })),
                  onChange: (v: string) => input.setPlayoff((p) => ({ ...p, playoffWeeks: parseInt(v, 10) })),
                },
              ] as SettingField[])
            : []),
        ],
      },
      ...(BRACKETS[input.playoff.playoffTeams]
        ? [
            {
              key: 'preview',
              label: 'HOW IT PLAYS',
              fields: BRACKETS[input.playoff.playoffTeams].map((line, i) => {
                const [round, detail] = line.split(': ');
                return { kind: 'info' as const, key: `round-${i}`, label: round, help: detail, value: `RD ${i + 1}` };
              }),
            },
          ]
        : []),
    ],
  };

  const rosters: SettingSection = {
    key: 'rosters',
    label: 'ROSTERS',
    saveable: false,
    callout: null,
    groups: [
      {
        key: 'teams',
        label: input.rostersLoading ? 'LOADING…' : `${input.rosters.length} TEAMS`,
        fields: input.rosters.map((t, i) => ({
          kind: 'info' as const,
          key: `team-${i}`,
          label: t.name,
          value: t.count == null ? '–' : `${t.count} players`,
        })),
      },
    ],
  };

  return [
    waivers,
    input.isCategoryLeague ? categories : scoring,
    draftSection,
    trades,
    keepers,
    rosterSlots,
    playoffs,
    rosters,
  ];
}
