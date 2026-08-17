/**
 * SETTINGS-ENFORCEMENT (2026-08-16) — pure league-rule resolvers.
 *
 * The dynamic-settings audit found one repeating defect: the client and
 * the database honor commissioner settings, while the API middle layer
 * enforces hardcoded literals (lineup slots 2-2-2-4-2, regex cap of 8,
 * UTIL:1) or reads keys nothing writes (trade_deadline vs
 * tradeDeadlineWeek, weekly_add_limit vs weeklyAddLimit).
 *
 * Every rule here is a PURE function over plain data so the enforcement
 * logic is unit-testable without a Supabase mock in sight. Services do
 * the fetching; this module does the deciding.
 */

export interface RosterSlotConfig {
  /** starter slots per position, e.g. { C:2, LW:2, RW:2, D:4, G:2 } or { F:6, D:4, G:2 } */
  slots: Record<string, number>;
  utilCount: number;
  irCount: number;
}

const DEFAULT_INDIVIDUAL: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 4, G: 2 };
const DEFAULT_FORWARD: Record<string, number> = { F: 6, D: 4, G: 2 };

/**
 * Resolve the league's starting-lineup shape from settings jsonb.
 * `settings.rosterSlots` is the commissioner's config (written by
 * CreateLeague and the settings page); positionType picks the F-combined
 * vs individual-position family. Absent config → the historical
 * defaults, so legacy leagues behave exactly as before.
 */
export function resolveSlotConfig(settings: Record<string, unknown> | null | undefined): RosterSlotConfig {
  const s = (settings ?? {}) as Record<string, unknown>;
  const forward = s.positionType === 'forward';
  const cfg = (s.rosterSlots ?? {}) as Record<string, unknown>;

  const num = (v: unknown, dflt: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : dflt;

  const base = forward ? DEFAULT_FORWARD : DEFAULT_INDIVIDUAL;
  const slots: Record<string, number> = {};
  for (const pos of Object.keys(base)) {
    slots[pos] = num(cfg[pos], base[pos]);
  }
  return {
    slots,
    utilCount: num(cfg.UTIL, 1),
    irCount: num(cfg.IR, 3),
  };
}

export interface SlotValidationResult {
  ok: boolean;
  error?: string;
  /** slot ids that are malformed and should be stripped (legacy-tolerant) */
  strip: string[];
}

/**
 * Validate a lineup's slot assignments against the LEAGUE's configuration.
 *
 * Replaces the hardcoded `/^slot-(C|LW|RW|D|G|F)-[1-8]$|^slot-UTIL$|…/`
 * which (a) allowed 8 of any position regardless of league config —
 * enforcement theater — and (b) rejected `slot-UTIL-2`, silently
 * stripping the second UTIL starter in the app's own default config.
 *
 * Behaviour contract, chosen deliberately:
 *  - Malformed slot ids → STRIP (matches historical tolerance; legacy
 *    clients keep working).
 *  - Position counts EXCEEDING the league config → REJECT the save with
 *    a plain-language error. This is the security hole (8 centers in a
 *    2-C league via direct API) and must fail loudly, not quietly.
 */
export function validateSlotAssignments(
  assignments: Record<string, string>,
  config: RosterSlotConfig,
): SlotValidationResult {
  const strip: string[] = [];
  const counts: Record<string, number> = {};

  for (const [playerId, slotId] of Object.entries(assignments)) {
    const starter = /^slot-([A-Z]+)(?:-(\d+))?$/.exec(slotId);
    const ir = /^ir-slot-(\d+)$/.exec(slotId);

    if (ir) {
      const idx = Number(ir[1]);
      if (idx < 1 || idx > config.irCount) strip.push(playerId);
      continue;
    }
    if (!starter) {
      strip.push(playerId);
      continue;
    }

    const pos = starter[1];
    const idx = starter[2] === undefined ? 1 : Number(starter[2]);
    const cap = pos === 'UTIL' ? config.utilCount : config.slots[pos];

    if (cap === undefined) {
      // Position not part of this league's family (e.g. slot-C in a
      // forward-type league) — malformed for THIS league.
      strip.push(playerId);
      continue;
    }
    if (idx < 1 || idx > cap) {
      return {
        ok: false,
        strip,
        error: `Slot ${slotId} exceeds this league's limit of ${cap} ${pos} starter${cap === 1 ? '' : 's'}.`,
      };
    }
    counts[pos] = (counts[pos] ?? 0) + 1;
    if (counts[pos] > cap) {
      return {
        ok: false,
        strip,
        error: `Too many ${pos} starters: this league allows ${cap}.`,
      };
    }
  }
  return { ok: true, strip };
}

/**
 * Add-limit resolution. The reader historically looked only at
 * `weekly_add_limit`/`season_add_limit`; CreateLeague has always written
 * `weeklyAddLimit`/`seasonAddLimit`. Accept both spellings — existing
 * leagues already carry the camelCase keys in jsonb, so fixing the
 * writer alone would leave every existing league unenforced.
 * 0 or absent = unlimited (CreateLeague writes `|| 0` for "no limit").
 */
export function resolveAddLimits(settings: Record<string, unknown> | null | undefined): {
  weeklyLimit: number | null;
  seasonLimit: number | null;
} {
  const s = (settings ?? {}) as Record<string, unknown>;
  const pick = (a: unknown, b: unknown): number | null => {
    const v = typeof a === 'number' ? a : typeof b === 'number' ? b : 0;
    return v > 0 ? v : null;
  };
  return {
    weeklyLimit: pick(s.weekly_add_limit, s.weeklyAddLimit),
    seasonLimit: pick(s.season_add_limit, s.seasonAddLimit),
  };
}

/**
 * Trade-deadline check. The server historically enforced
 * `settings.trade_deadline` (a date nothing writes); CreateLeague writes
 * `settings.tradeDeadlineWeek` (a matchup week number). Enforce BOTH:
 * the date form for any league that has it, the week form against the
 * league's current matchup week. currentWeek === null means the season
 * schedule isn't resolvable — fail OPEN (a deadline must never block
 * trades because a lookup hiccuped).
 */
export function isPastTradeDeadline(
  settings: Record<string, unknown> | null | undefined,
  now: Date,
  currentWeek: number | null,
): boolean {
  const s = (settings ?? {}) as Record<string, unknown>;
  if (typeof s.trade_deadline === 'string' && s.trade_deadline) {
    const d = new Date(s.trade_deadline);
    if (!Number.isNaN(d.getTime()) && now > d) return true;
  }
  const week = s.tradeDeadlineWeek;
  if (typeof week === 'number' && week > 0 && currentWeek !== null && currentWeek > week) {
    return true;
  }
  return false;
}

export interface GameRow {
  status?: string | null;
  game_date?: string | null;
  game_time?: string | null;
  home_team?: string | null;
  away_team?: string | null;
}

/**
 * Game-lock evaluation over today's schedule rows for the player's NHL
 * team. Locked when a game involving the team has visibly started
 * (status says so) or its listed start time has passed. Unknown or
 * missing data fails OPEN — a lock must never block adds because the
 * schedule feed hiccuped; the industry behaviour being replicated is
 * Yahoo's "players lock at game time".
 */
export function evaluateGameLock(games: GameRow[], teamAbbrev: string, nowMs: number): boolean {
  const STARTED = new Set(['live', 'in_progress', 'in progress', 'crit', 'final', 'completed', 'off']);
  for (const g of games) {
    if (g.home_team !== teamAbbrev && g.away_team !== teamAbbrev) continue;
    const status = (g.status ?? '').toLowerCase();
    if (STARTED.has(status)) return true;
    if (g.game_date && g.game_time) {
      const start = Date.parse(`${g.game_date}T${g.game_time}`);
      if (!Number.isNaN(start) && nowMs >= start) return true;
    }
  }
  return false;
}
