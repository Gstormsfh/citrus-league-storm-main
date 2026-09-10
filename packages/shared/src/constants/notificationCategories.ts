/**
 * WHAT THE APP IS ALLOWED TO INTERRUPT YOU FOR (2026-09-09).
 *
 * Until now the app had exactly one push — "You're on the clock" — behind one
 * boolean (`profiles.push_notifications`). This file is the vocabulary for
 * the rest of them, stated ONCE and imported by both sides: the server decides
 * whether to send by these keys, the settings screen and the setup step draw
 * these labels, and neither can drift from the other.
 *
 * THE DEFAULTS ARE THE WHOLE DESIGN. The fastest way to lose a fantasy app's
 * notifications is to send too many in week one: a manager who kills them at
 * the OS level never comes back, and takes the on-the-clock nudge — the one
 * that actually costs them a pick — with them. So a category defaults ON only
 * if a manager would be annoyed to have MISSED it. `draft_pick` is the clear
 * no: 12 managers × 180 picks is 180 interruptions in two hours, and the
 * person who wants it can turn it on in setup.
 *
 * `presetsOf` is what the setup step offers, because "pick from three" is a
 * decision a person will actually make and "twelve switches" is one they will
 * skip.
 */

export type NotificationCategory =
  | 'draft_turn'
  | 'draft_start'
  | 'draft_pick'
  | 'trade_offer'
  | 'trade_result'
  | 'trade_league'
  | 'roster_own'
  | 'roster_league'
  | 'waiver_result'
  | 'chat_mention'
  | 'chat_all'
  | 'matchup'
  | 'league_admin';

export interface NotificationCategoryDef {
  key: NotificationCategory;
  /** Settings-row label. */
  label: string;
  /** The rule, under the label. Says what arrives, not what the feature is. */
  help: string;
  /** Grouping for the settings screen. */
  group: 'Draft' | 'Trades' | 'Roster' | 'League' | 'Matchup';
  /** On unless a manager says otherwise. See the header note. */
  defaultOn: boolean;
}

export const NOTIFICATION_CATEGORIES: readonly NotificationCategoryDef[] = [
  {
    key: 'draft_turn',
    label: "You're on the clock",
    help: 'Your pick is up. This is the one that costs you a player if you miss it.',
    group: 'Draft',
    defaultOn: true,
  },
  {
    key: 'draft_start',
    label: 'Draft starting',
    help: 'Your league’s draft is about to begin.',
    group: 'Draft',
    defaultOn: true,
  },
  {
    key: 'draft_pick',
    label: 'Every pick made',
    help: 'Someone in your league picks. Loud by design: a 12-team draft is 180 of these.',
    group: 'Draft',
    defaultOn: false,
  },
  {
    key: 'trade_offer',
    label: 'Trade offered to you',
    help: 'Another manager sends you an offer.',
    group: 'Trades',
    defaultOn: true,
  },
  {
    key: 'trade_result',
    label: 'Your trade resolved',
    help: 'An offer you sent or received is accepted, rejected, countered or vetoed.',
    group: 'Trades',
    defaultOn: true,
  },
  {
    key: 'trade_league',
    label: 'Trades in your league',
    help: 'Any trade between two other teams goes through.',
    group: 'Trades',
    defaultOn: true,
  },
  {
    key: 'roster_own',
    label: 'Your roster changes',
    help: 'A player is added to or dropped from your team.',
    group: 'Roster',
    defaultOn: true,
  },
  {
    key: 'waiver_result',
    label: 'Your waiver claims',
    help: 'A claim you submitted is won or lost when waivers run.',
    group: 'Roster',
    defaultOn: true,
  },
  {
    key: 'roster_league',
    label: 'Roster moves in your league',
    help: 'Any manager adds or drops a player.',
    group: 'Roster',
    defaultOn: true,
  },
  {
    key: 'chat_mention',
    label: 'You’re mentioned in chat',
    help: 'Someone puts your name in league chat.',
    group: 'League',
    defaultOn: true,
  },
  {
    key: 'chat_all',
    label: 'All league chat',
    help: 'Every message in your league chat, not only the ones aimed at you.',
    group: 'League',
    defaultOn: true,
  },
  {
    key: 'league_admin',
    label: 'League settings changed',
    help: 'Your commissioner changes a rule, or the league schedule moves.',
    group: 'League',
    defaultOn: true,
  },
  {
    key: 'matchup',
    label: 'Matchup start and final',
    help: 'Your week opens, and the result when it closes.',
    group: 'Matchup',
    defaultOn: true,
  },
] as const;

const BY_KEY = new Map(NOTIFICATION_CATEGORIES.map((c) => [c.key, c]));

export function isNotificationCategory(value: string): value is NotificationCategory {
  return BY_KEY.has(value as NotificationCategory);
}

/**
 * A manager's stored overrides, as `profiles.push_categories` holds them:
 * ONLY the keys they changed. An absent key means "whatever the default is",
 * so shipping a new category does not require backfilling every row, and
 * changing a default actually reaches the managers who never touched it.
 */
export type NotificationPreferences = Partial<Record<NotificationCategory, boolean>>;

/** Is this category on for a manager with these overrides? */
export function isCategoryEnabled(
  category: NotificationCategory,
  prefs: NotificationPreferences | null | undefined,
): boolean {
  const override = prefs?.[category];
  if (typeof override === 'boolean') return override;
  return BY_KEY.get(category)?.defaultOn ?? false;
}

/** Every category resolved to on/off — what the settings screen draws. */
export function resolvePreferences(
  prefs: NotificationPreferences | null | undefined,
): Record<NotificationCategory, boolean> {
  const out = {} as Record<NotificationCategory, boolean>;
  for (const c of NOTIFICATION_CATEGORIES) out[c.key] = isCategoryEnabled(c.key, prefs);
  return out;
}

export type NotificationPresetKey = 'everything' | 'balanced' | 'essential';

export interface NotificationPreset {
  key: NotificationPresetKey;
  label: string;
  help: string;
  /** Explicit for every category, so a preset is never ambiguous. */
  values: Record<NotificationCategory, boolean>;
}

const all = (on: boolean): Record<NotificationCategory, boolean> => {
  const out = {} as Record<NotificationCategory, boolean>;
  for (const c of NOTIFICATION_CATEGORIES) out[c.key] = on;
  return out;
};

/**
 * The three the setup step offers. `balanced` is the default set — every
 * category at its own default — so choosing it is the same as skipping the
 * step, which is what makes the step safe to skip.
 */
export const NOTIFICATION_PRESETS: readonly NotificationPreset[] = [
  {
    key: 'everything',
    label: 'Everything',
    help: 'Every pick, every message, every move in your league.',
    values: all(true),
  },
  {
    key: 'balanced',
    label: 'The usual',
    help: 'Your turn, your trades, your roster, and league chat. No pick-by-pick.',
    values: resolvePreferences(null),
  },
  {
    key: 'essential',
    label: 'Only what costs me',
    help: 'Your draft pick, trades offered to you, and your waivers. Nothing else.',
    values: {
      ...all(false),
      draft_turn: true,
      draft_start: true,
      trade_offer: true,
      trade_result: true,
      waiver_result: true,
    },
  },
] as const;
