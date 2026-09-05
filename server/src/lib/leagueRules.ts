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
  /**
   * POSITION-MATCH FIX (2026-08-23, found live on prod during launch QA):
   * this validator checked that SLOTS were legal for the league but never
   * that the PLAYER fits the slot — a direct API call could start a goalie
   * at slot-C-1 and McDavid in net, and the save returned 200. When the
   * caller provides eligible positions per player id, position-mismatched
   * assignments now REJECT the save. Omitted entries (directory gaps) and
   * an omitted map entirely fail OPEN — eligibility enforcement must never
   * block saves because a lookup hiccuped.
   */
  eligibleById?: Record<string, string[]>,
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

    // POSITION-MATCH FIX (2026-08-23): the player must actually play the
    // slot's position. UTIL accepts any skater (never a goalie); an 'F'
    // slot (forward-family leagues) accepts C/LW/RW.
    const eligible = eligibleById?.[playerId];
    if (eligible && eligible.length > 0) {
      const isGoalieOnly = eligible.every((e) => e === 'G');
      if (pos === 'UTIL') {
        if (isGoalieOnly) {
          return {
            ok: false,
            strip,
            error: `A goalie cannot fill a UTIL slot (${slotId}).`,
          };
        }
      } else if (pos === 'F') {
        if (!eligible.some((e) => e === 'C' || e === 'LW' || e === 'RW' || e === 'F')) {
          return {
            ok: false,
            strip,
            error: `A ${eligible.join('/')} player cannot fill forward slot ${slotId}.`,
          };
        }
      } else if (!eligible.includes(pos)) {
        return {
          ok: false,
          strip,
          error: `A ${eligible.join('/')} player cannot fill ${slotId}.`,
        };
      }
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
 * IR ELIGIBILITY (2026-09-03, WORLD_CLASS_READINESS.md §1 gap B).
 *
 * `validateSlotAssignments` caps `ir-slot-N` at the league's count and never
 * asked whether the player is hurt. And the cap only ever saw slot ids: the
 * `ir` LIST the snapshot writer stores is unbounded, so a direct API call could
 * park a healthy player, or six of them, on IR and free the roster spots.
 * Yahoo refuses the placement outright: only a player the NHL lists IR or LTIR
 * may enter an IR slot. The roster page has gated its IR slots on
 * `is_ir_eligible` since the column arrived (migration 20260103151931); this
 * makes the server the gate.
 *
 * Two deliberate softenings, both Yahoo's own behaviour:
 *   - a player placed while injured who has since been activated is
 *     TOLERATED. Yahoo flags that roster and blocks ADDS until it is fixed; it
 *     does not refuse every lineup change in between, and neither do we. The
 *     service hands us who is on IR on record; anyone in that set is not a
 *     new placement and is not re-checked.
 *   - lookup gaps fail OPEN, exactly like `eligibleById`: no map, or no entry
 *     for the player, means "the read did not answer", never "he is healthy".
 *     The service writes an entry for EVERY id it was asked about when the
 *     read succeeds, so an absent entry can only be a gap.
 */
export interface IrPlacementCheck {
  /** Every player the save puts on IR: the `ir` list plus any `ir-slot-N` assignment. */
  irPlayerIds: string[];
  /**
   * player id -> the NHL lists him IR/LTIR (player_talent_metrics.is_ir_eligible,
   * the flag the roster page gates on). Absent map or entry = lookup gap.
   */
  irEligibleById?: Record<string, boolean>;
  /** Players on IR in the lineup on record; not new placements, not re-checked. */
  alreadyOnIr?: ReadonlySet<string>;
  /** Names for the refusal, keyed by player id. */
  nameOf?: Record<string, string>;
}

export interface IrPlacementResult {
  ok: boolean;
  error?: string;
}

export function validateIrPlacements(check: IrPlacementCheck, config: RosterSlotConfig): IrPlacementResult {
  const ids = [...new Set(check.irPlayerIds)];
  const fresh = ids.filter((id) => !check.alreadyOnIr?.has(id));
  if (fresh.length === 0) return { ok: true };

  const nameOf = (id: string): string => check.nameOf?.[id]?.trim() || 'That player';

  for (const id of fresh) {
    if (check.irEligibleById?.[id] === false) {
      return {
        ok: false,
        error: `${nameOf(id)} isn't listed IR or LTIR, so an IR slot can't hold him. Bench him, or move a player with official IR/LTIR status there.`,
      };
    }
  }

  if (config.irCount <= 0) {
    return { ok: false, error: `This league has no IR slots, so ${nameOf(fresh[0])} can't go there. Bench him instead.` };
  }
  if (ids.length > config.irCount) {
    return {
      ok: false,
      error: `This league has ${config.irCount} IR slot${config.irCount === 1 ? '' : 's'} and ${ids.length} players are headed there. Bench one first.`,
    };
  }
  return { ok: true };
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

/**
 * The first NHL team in a trade whose game has started (2026-09-05). The
 * `allow_trades_during_games` toggle was stored and never read; when it is
 * OFF, a trade that moves a player whose team is on the ice waits until the
 * games are over, the way Yahoo holds it. Same fail-open rule as the
 * waiver lock: an unknown team or an empty schedule locks nothing.
 */
export function lockedTeamForTrade(
  teamAbbrevs: ReadonlyArray<string | null | undefined>,
  games: GameRow[],
  nowMs: number,
): string | null {
  const seen = new Set<string>();
  for (const abbrev of teamAbbrevs) {
    if (!abbrev || seen.has(abbrev)) continue;
    seen.add(abbrev);
    if (evaluateGameLock(games, abbrev, nowMs)) return abbrev;
  }
  return null;
}
