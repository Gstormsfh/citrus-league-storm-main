/**
 * THE GAME LOG, in the artboard's rows (2026-09-04).
 *
 * The player card's log used to be a stack of cards, one per game, each
 * with its own horizontally-scrolling strip of stat boxes — eight boxes
 * wide on a 361px body, so every card on the phone carried a scrollbar
 * and a manager reading a season scrolled two directions at once. The
 * artboard (1a) is a table: DT · OPP · FPTS · the stat columns · TOI, one
 * 30px row per game, newest first, with an AVG footer, and UPCOMING as
 * three glanceable cards. This module turns the modal's entries into
 * those rows so the modal itself stays declarative.
 *
 * What v1 had that the artboard did not, baked in rather than dropped:
 *
 *   - Every remaining game's projection, not just the next three. The
 *     cards are the glance; the PROJ table under them is the season.
 *   - The likely range. It rides in the tail column where TOI sits on a
 *     played row, because a 4.4–9.4 tells a manager more than a bare
 *     confidence percentage and only one of them fits.
 *   - DNP. A played date with no line is a scratch or an injury, which is
 *     exactly the kind of thing a manager opens the log to find; the row
 *     stays, labelled, rather than vanishing.
 *   - B2B. Derived from the schedule itself — the previous team game was
 *     yesterday — and shown in sage on the card the way the artboard does,
 *     because it is the one schedule note we can state without guessing.
 *
 * Columns are the artboard's six for a skater (G A SOG +/- PPP HIT) and
 * four for a goalie (W SV GA SO); projections carry five (the +/- has no
 * projection) so a 0.42 still has room at 11px mono next to the range.
 * SHP, BLK and PIM are not in the phone table: on a 361px body they cost
 * the legibility of the columns a manager actually scans. The season
 * totals still count them.
 */

export interface GameLogEntry {
  date: string; // YYYY-MM-DD
  dayLabel: string; // e.g. "Sun", "Mon"
  dateLabel: string; // e.g. "Feb 15"
  opponent: string; // e.g. "vs BOS" or "@ NYR"
  gameTime?: string;
  projectedPoints: number;
  projection: Record<string, unknown> | null; // Full projection object (skater or goalie)
  isGoalie: boolean;
  isPast: boolean;
  isToday: boolean;
  computedConfidence: number; // 0.0-1.0, computed fresh on the frontend
  // Actual stats for played games
  actualPoints?: number;
  actualStats?: Record<string, unknown>;
}

export interface LogRow {
  key: string;
  date: string;
  opponent: string;
  points?: number | null;
  pointsLabel?: string;
  cells: (string | number)[];
  toi?: string | null;
  latest?: boolean;
  summary?: boolean;
}

export interface UpcomingCard {
  key: string;
  when: string;
  opponent: string;
  note?: string | null;
  noteTail?: string | null;
}

export const SKATER_LOG_HEADINGS = ['G', 'A', 'SOG', '+/-', 'PPP', 'HIT'];
export const GOALIE_LOG_HEADINGS = ['W', 'SV', 'GA', 'SO'];
export const SKATER_PROJ_HEADINGS = ['G', 'A', 'SOG', 'PPP', 'HIT'];
export const GOALIE_PROJ_HEADINGS = ['W', 'SV', 'GA', 'SV%'];

/** `2026-10-01` → `10/1`. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

/** Seconds → `mm:ss`; nothing for a row with no ice time recorded. */
export function toiLabel(seconds: unknown): string | null {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
/** `1.25` → `1.3`, `0.5` → `.5`, `-0.5` → `-.5` — the artboard's AVG row. */
const avgLabel = (v: number, plusMinus = false) => {
  const fixed = Math.abs(v).toFixed(1).replace(/^0\./, '.');
  const sign = v < 0 ? '-' : plusMinus && v > 0 ? '+' : '';
  return `${sign}${fixed}`;
};

/** Played games, newest first, with the AVG footer. */
export function playedRows(entries: GameLogEntry[], isGoalie: boolean): LogRow[] {
  const played = entries.filter((e) => e.isPast).slice().reverse();
  if (played.length === 0) return [];
  const rows: LogRow[] = [];
  const sums = isGoalie ? [0, 0, 0, 0] : [0, 0, 0, 0, 0, 0];
  let pointsSum = 0;
  let toiSum = 0;
  let gp = 0;
  let latestMarked = false;

  for (const e of played) {
    const s = e.actualStats;
    if (!s) {
      rows.push({
        key: e.date,
        date: shortDate(e.date),
        opponent: e.opponent,
        points: null,
        pointsLabel: 'DNP',
        cells: (isGoalie ? GOALIE_LOG_HEADINGS : SKATER_LOG_HEADINGS).map(() => '–'),
        toi: null,
      });
      continue;
    }
    const cells: (string | number)[] = isGoalie
      ? [num(s.wins), num(s.saves), num(s.goals_against), num(s.shutouts)]
      : [num(s.goals), num(s.assists), num(s.shots_on_goal), signed(num(s.plus_minus)), num(s.ppp), num(s.hits)];
    const raw = isGoalie
      ? [num(s.wins), num(s.saves), num(s.goals_against), num(s.shutouts)]
      : [num(s.goals), num(s.assists), num(s.shots_on_goal), num(s.plus_minus), num(s.ppp), num(s.hits)];
    raw.forEach((v, i) => (sums[i] += v));
    pointsSum += e.actualPoints ?? 0;
    toiSum += num(s.toi_seconds);
    gp += 1;
    rows.push({
      key: e.date,
      date: shortDate(e.date),
      opponent: e.opponent,
      points: e.actualPoints ?? 0,
      cells,
      toi: toiLabel(s.toi_seconds),
      ...(latestMarked ? {} : { latest: true }),
    });
    latestMarked = true;
  }

  if (gp > 0) {
    rows.push({
      key: 'avg',
      date: 'AVG',
      opponent: `${gp} GP`,
      points: pointsSum / gp,
      cells: sums.map((v, i) => avgLabel(v / gp, !isGoalie && i === 3)),
      toi: toiSum > 0 ? toiLabel(toiSum / gp) : null,
      summary: true,
    });
  }
  return rows;
}

const fixed = (v: unknown, digits: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v != null ? n.toFixed(digits) : '–';
};

/**
 * THE LIKELY RANGE (2026-09-05). `likely_low`/`likely_high` are NULL on
 * every 2026 row of player_projected_stats; the 50% interval and the
 * standard deviation are populated on all of them. So: the stored range
 * when it exists, else the interquartile band, else mean ± 0.67σ (the same
 * band for a normal), else nothing. A range that is not a range (low ≥
 * high) is not shown.
 */
export function likelyRange(
  p: Record<string, unknown>,
  projectedPoints: number,
): string | null {
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return v != null && Number.isFinite(n) ? n : null;
  };
  let low = num(p.likely_low);
  let high = num(p.likely_high);
  if (low == null || high == null) {
    low = num(p.projection_ci_50_lower);
    high = num(p.projection_ci_50_upper);
  }
  if (low == null || high == null) {
    const sd = num(p.projection_std_dev);
    const mean = num(p.projection_mean) ?? num(p.total_projected_points) ?? projectedPoints;
    if (sd != null && sd > 0 && mean != null) {
      low = Math.max(0, mean - 0.674 * sd);
      high = mean + 0.674 * sd;
    }
  }
  if (low == null || high == null || high <= low) return null;
  return `${Math.max(0, low).toFixed(1)}–${high.toFixed(1)}`;
}

/** Remaining games in order, projection columns, likely range in the tail. */
export function upcomingRows(entries: GameLogEntry[], isGoalie: boolean): LogRow[] {
  return entries
    .filter((e) => !e.isPast)
    .map((e) => {
      const p = e.projection;
      const cells: (string | number)[] = !p
        ? (isGoalie ? GOALIE_PROJ_HEADINGS : SKATER_PROJ_HEADINGS).map(() => '–')
        : isGoalie
          ? [
              fixed(p.projected_wins, 2),
              fixed(p.projected_saves, 0),
              fixed(p.projected_goals_against, 1),
              p.projected_save_pct != null ? Number(p.projected_save_pct).toFixed(3).replace(/^0\./, '.') : '–',
            ]
          : [
              fixed(p.projected_goals, 2),
              fixed(p.projected_assists, 2),
              fixed(p.projected_sog, 1),
              fixed(p.projected_ppp, 2),
              fixed(p.projected_hits, 1),
            ];
      const range = p ? likelyRange(p, e.projectedPoints) : null;
      return {
        key: e.date,
        date: shortDate(e.date),
        opponent: e.opponent,
        points: e.projectedPoints > 0 ? e.projectedPoints : null,
        cells,
        toi: range,
        ...(e.isToday ? { latest: true } : {}),
      };
    });
}

/** The next three games as the artboard's cards; B2B read off the schedule. */
export function upcomingCards(entries: GameLogEntry[]): UpcomingCard[] {
  const dates = new Set(entries.map((e) => e.date));
  const dayBefore = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d - 1));
    return t.toISOString().slice(0, 10);
  };
  return entries
    .filter((e) => !e.isPast)
    .slice(0, 3)
    .map((e) => {
      const b2b = dates.has(dayBefore(e.date));
      return {
        key: e.date,
        when: e.isToday ? 'TODAY' : `${e.dayLabel.toUpperCase()} ${shortDate(e.date)}`,
        opponent: e.opponent,
        note: null,
        noteTail: b2b ? 'B2B' : null,
      };
    });
}
