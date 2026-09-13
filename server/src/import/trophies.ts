/**
 * The record book. A pure function from season tables to trophy rows.
 *
 * Two rules decide everything here:
 *   1. Provenance. A champion the source stated is `imported`. A biggest
 *      blowout Citrus derived is `computed`. The UI shows which. A computed
 *      record rendered as an imported fact is the worst shippable error in
 *      this feature.
 *   2. Category leagues never get points-league records. `highest_week` is
 *      meaningless when the weekly result is 6-3-1. They get the hockey-native
 *      set instead: sweeps, narrowest category wins, perfect weeks, category
 *      dominance.
 *
 * A season the source says is still being played (is_finished = false) gets
 * no standings honours and is not a drought year; the games already played
 * still count toward head-to-head, streaks and weekly records because they
 * happened.
 */

export type TrophySource = 'imported' | 'computed' | 'manual';

export interface SeasonRow { season: number; scoring_type: string | null; champion_member_id: string | null; runner_up_member_id: string | null; regular_winner_id: string | null; is_verified_by_bracket: boolean | null; is_finished?: boolean | null }
export interface TeamRow { season: number; member_id: string; team_name: string | null; rank: number | null; wins: number | null; losses: number | null; ties: number | null; points_for: number | null; points_against: number | null; made_playoffs: boolean | null; playoff_finish: number | null; playoff_seed: number | null }
export interface MatchupRow { season: number; week: number; home_member_id: string; away_member_id: string | null; home_score: number | null; away_score: number | null; home_cat_wins: number | null; home_cat_losses: number | null; home_cat_ties: number | null; category_results: Array<{ statKey: string; winner: 'home' | 'away' | 'tie' | null }> | null; is_playoff: boolean; is_consolation: boolean; is_championship: boolean; winner_member_id: string | null; is_tie: boolean }

export interface TrophyInput { seasons: SeasonRow[]; teams: TeamRow[]; matchups: MatchupRow[] }

export interface TrophyRow {
  season: number | null;
  member_id: string | null;
  trophy_key: string;
  rank: number | null;
  value: number | null;
  detail: Record<string, unknown>;
  source: TrophySource;
}

const POINTS_TYPES = new Set(['points', 'h2h_points']);
const CATEGORY_TYPES = new Set(['h2h_categories', 'h2h_one_win']);

function isPointsSeason(t: string | null | undefined): boolean { return POINTS_TYPES.has(t ?? ''); }
function isCategorySeason(t: string | null | undefined): boolean { return CATEGORY_TYPES.has(t ?? ''); }

export function computeTrophies(input: TrophyInput): TrophyRow[] {
  const out: TrophyRow[] = [];
  const seasons = [...input.seasons].sort((a, b) => a.season - b.season);
  if (seasons.length === 0) return out;
  const typeBySeason = new Map(seasons.map((s) => [s.season, s.scoring_type]));
  const teamsBySeason = new Map<number, TeamRow[]>();
  for (const t of input.teams) {
    const arr = teamsBySeason.get(t.season) ?? [];
    arr.push(t);
    teamsBySeason.set(t.season, arr);
  }

  // ---- per season, from standings (imported) ------------------------------
  const titles = new Map<string, number[]>();
  const finishedSeasons = seasons.filter((s) => s.is_finished !== false);
  for (const s of finishedSeasons) {
    const teams = teamsBySeason.get(s.season) ?? [];
    const champ = s.champion_member_id ?? teams.find((t) => t.playoff_finish === 1)?.member_id ?? teams.find((t) => t.rank === 1)?.member_id ?? null;
    const runner = s.runner_up_member_id ?? teams.find((t) => t.playoff_finish === 2)?.member_id ?? teams.find((t) => t.rank === 2)?.member_id ?? null;
    const third = teams.find((t) => t.rank === 3)?.member_id ?? null;
    const regular = s.regular_winner_id ?? teams.find((t) => t.playoff_seed === 1)?.member_id ?? null;
    if (champ) {
      out.push({ season: s.season, member_id: champ, trophy_key: 'champion', rank: 1, value: null, detail: { verified_by_bracket: s.is_verified_by_bracket ?? null, team_name: teamName(teams, champ) }, source: 'imported' });
      titles.set(champ, [...(titles.get(champ) ?? []), s.season]);
    }
    if (runner) out.push({ season: s.season, member_id: runner, trophy_key: 'runner_up', rank: 2, value: null, detail: { team_name: teamName(teams, runner) }, source: 'imported' });
    if (third) out.push({ season: s.season, member_id: third, trophy_key: 'third', rank: 3, value: null, detail: { team_name: teamName(teams, third) }, source: 'imported' });
    if (regular) out.push({ season: s.season, member_id: regular, trophy_key: 'regular_season_title', rank: 1, value: null, detail: { team_name: teamName(teams, regular) }, source: 'imported' });
    for (const t of teams) {
      if (t.made_playoffs) out.push({ season: s.season, member_id: t.member_id, trophy_key: 'playoff_appearance', rank: t.playoff_seed, value: null, detail: { seed: t.playoff_seed }, source: 'imported' });
    }
    const ranked = teams.filter((t) => t.rank != null);
    if (ranked.length >= 4) {
      const last = ranked.reduce((a, b) => ((b.rank ?? 0) > (a.rank ?? 0) ? b : a));
      out.push({ season: s.season, member_id: last.member_id, trophy_key: 'toilet_bowl', rank: last.rank, value: null, detail: { team_name: last.team_name }, source: 'imported' });
    }
    // Comeback: a champion seeded 3rd or worse.
    if (champ) {
      const seed = teams.find((t) => t.member_id === champ)?.playoff_seed ?? null;
      if (seed != null && seed >= 3) out.push({ season: s.season, member_id: champ, trophy_key: 'comeback_seed', rank: null, value: seed, detail: { seed }, source: 'computed' });
    }
  }

  // ---- all time, from standings (computed) -------------------------------
  const members = new Set<string>();
  for (const t of input.teams) members.add(t.member_id);
  const firstSeason = seasons[0].season;
  // Drought counts through the last finished season; a season in play cannot be a lost year yet.
  const lastSeason = finishedSeasons.length ? finishedSeasons[finishedSeasons.length - 1].season : null;

  let maxTitles = 0;
  for (const [, ss] of titles) maxTitles = Math.max(maxTitles, ss.length);
  if (maxTitles > 0) {
    for (const [m, ss] of titles) {
      if (ss.length === maxTitles) out.push({ season: null, member_id: m, trophy_key: 'most_championships', rank: 1, value: ss.length, detail: { seasons: ss }, source: 'computed' });
    }
  }

  for (const m of members) {
    const rows = input.teams.filter((t) => t.member_id === m);
    const played = rows.map((r) => r.season);
    const tenure = new Set(played).size;
    out.push({ season: null, member_id: m, trophy_key: 'tenure', rank: null, value: tenure, detail: { first_season: Math.min(...played), last_season: Math.max(...played) }, source: 'computed' });
    if (played.includes(firstSeason)) {
      out.push({ season: null, member_id: m, trophy_key: 'founding_member', rank: null, value: firstSeason, detail: { since: firstSeason }, source: 'computed' });
    }
    const w = sum(rows.map((r) => r.wins)); const l = sum(rows.map((r) => r.losses)); const t = sum(rows.map((r) => r.ties));
    const g = w + l + t;
    if (g > 0) out.push({ season: null, member_id: m, trophy_key: 'all_time_win_pct', rank: null, value: round3((w + 0.5 * t) / g), detail: { wins: w, losses: l, ties: t }, source: 'computed' });
    const mine = titles.get(m) ?? [];
    const lastTitle = mine.length ? Math.max(...mine) : null;
    if (lastSeason != null) {
      const drought = lastTitle == null ? lastSeason - Math.min(...played) + 1 : lastSeason - lastTitle;
      if (drought > 0) out.push({ season: null, member_id: m, trophy_key: 'championship_drought', rank: null, value: drought, detail: { last_title: lastTitle, through: lastSeason }, source: 'computed' });
    }
  }

  // ---- from matchups (computed) -------------------------------------------
  const counted = input.matchups.filter((m) => m.away_member_id && !m.is_consolation);
  const chrono = [...counted].sort((a, b) => a.season - b.season || a.week - b.week);

  // Lifetime head-to-head, ordered pairs.
  const h2h = new Map<string, { w: number; l: number; t: number }>();
  const key = (a: string, b: string) => `${a}|${b}`;
  const bump = (a: string, b: string, r: 'w' | 'l' | 't') => { const k = key(a, b); const c = h2h.get(k) ?? { w: 0, l: 0, t: 0 }; c[r] += 1; h2h.set(k, c); };
  for (const m of counted) {
    const a = m.home_member_id, b = m.away_member_id!;
    if (m.is_tie || m.winner_member_id == null) { bump(a, b, 't'); bump(b, a, 't'); }
    else if (m.winner_member_id === a) { bump(a, b, 'w'); bump(b, a, 'l'); }
    else { bump(b, a, 'w'); bump(a, b, 'l'); }
  }
  const perMember = new Map<string, Array<{ opp: string; w: number; l: number; t: number }>>();
  for (const [k, c] of h2h) {
    const [a, b] = k.split('|');
    out.push({ season: null, member_id: a, trophy_key: 'lifetime_h2h', rank: null, value: c.w, detail: { opponent_member_id: b, wins: c.w, losses: c.l, ties: c.t }, source: 'computed' });
    perMember.set(a, [...(perMember.get(a) ?? []), { opp: b, ...c }]);
  }
  for (const [m, opps] of perMember) {
    const played = opps.filter((o) => o.w + o.l + o.t >= 3);
    if (!played.length) continue;
    const pct = (o: { w: number; l: number; t: number }) => (o.w + 0.5 * o.t) / (o.w + o.l + o.t);
    const worst = played.reduce((x, y) => (pct(y) < pct(x) ? y : x));
    const best = played.reduce((x, y) => (pct(y) > pct(x) ? y : x));
    if (pct(worst) < 0.5) out.push({ season: null, member_id: m, trophy_key: 'toughest_opponent', rank: null, value: round3(pct(worst)), detail: { opponent_member_id: worst.opp, wins: worst.w, losses: worst.l, ties: worst.t }, source: 'computed' });
    if (pct(best) > 0.5) out.push({ season: null, member_id: m, trophy_key: 'favourite_victim', rank: null, value: round3(pct(best)), detail: { opponent_member_id: best.opp, wins: best.w, losses: best.l, ties: best.t }, source: 'computed' });
  }

  // Streaks, across seasons, in order.
  const streak = new Map<string, { cur: 'w' | 'l' | null; n: number; bestW: number; bestWAt: number | null; bestL: number; bestLAt: number | null }>();
  const st = (m: string) => streak.get(m) ?? (streak.set(m, { cur: null, n: 0, bestW: 0, bestWAt: null, bestL: 0, bestLAt: null }), streak.get(m)!);
  const feed = (m: string, r: 'w' | 'l' | 't', season: number) => {
    const s = st(m);
    if (r === 't') { s.cur = null; s.n = 0; return; }
    if (s.cur === r) s.n += 1; else { s.cur = r; s.n = 1; }
    if (r === 'w' && s.n > s.bestW) { s.bestW = s.n; s.bestWAt = season; }
    if (r === 'l' && s.n > s.bestL) { s.bestL = s.n; s.bestLAt = season; }
  };
  for (const m of chrono) {
    const a = m.home_member_id, b = m.away_member_id!;
    if (m.is_tie || m.winner_member_id == null) { feed(a, 't', m.season); feed(b, 't', m.season); }
    else if (m.winner_member_id === a) { feed(a, 'w', m.season); feed(b, 'l', m.season); }
    else { feed(b, 'w', m.season); feed(a, 'l', m.season); }
  }
  for (const [m, s] of streak) {
    if (s.bestW >= 3) out.push({ season: null, member_id: m, trophy_key: 'longest_win_streak', rank: null, value: s.bestW, detail: { ended_season: s.bestWAt }, source: 'computed' });
    if (s.bestL >= 3) out.push({ season: null, member_id: m, trophy_key: 'longest_losing_streak', rank: null, value: s.bestL, detail: { ended_season: s.bestLAt }, source: 'computed' });
  }

  // Points-league records: only over seasons that were points leagues.
  const pointsGames = counted.filter((m) => isPointsSeason(typeBySeason.get(m.season)) && m.home_score != null && m.away_score != null);
  if (pointsGames.length) {
    let hi: { v: number; m: MatchupRow; who: string } | null = null;
    let lo: { v: number; m: MatchupRow; who: string } | null = null;
    let blow: { v: number; m: MatchupRow; who: string } | null = null;
    let close: { v: number; m: MatchupRow; who: string } | null = null;
    for (const m of pointsGames) {
      const hs = m.home_score!, as = m.away_score!;
      for (const [who, v] of [[m.home_member_id, hs], [m.away_member_id!, as]] as Array<[string, number]>) {
        if (!hi || v > hi.v) hi = { v, m, who };
        if (!lo || v < lo.v) lo = { v, m, who };
      }
      const margin = Math.abs(hs - as);
      const winner = hs > as ? m.home_member_id : as > hs ? m.away_member_id! : null;
      if (winner) {
        if (!blow || margin > blow.v) blow = { v: margin, m, who: winner };
        if (margin > 0 && (!close || margin < close.v)) close = { v: margin, m, who: winner };
      }
    }
    const d = (r: { m: MatchupRow; who: string }) => ({ season: r.m.season, week: r.m.week, opponent_member_id: r.who === r.m.home_member_id ? r.m.away_member_id : r.m.home_member_id, home_score: r.m.home_score, away_score: r.m.away_score, is_playoff: r.m.is_playoff });
    if (hi) out.push({ season: null, member_id: hi.who, trophy_key: 'highest_week', rank: 1, value: hi.v, detail: d(hi), source: 'computed' });
    if (lo) out.push({ season: null, member_id: lo.who, trophy_key: 'lowest_week', rank: 1, value: lo.v, detail: d(lo), source: 'computed' });
    if (blow) out.push({ season: null, member_id: blow.who, trophy_key: 'biggest_blowout', rank: 1, value: blow.v, detail: d(blow), source: 'computed' });
    if (close) out.push({ season: null, member_id: close.who, trophy_key: 'closest_game', rank: 1, value: close.v, detail: d(close), source: 'computed' });
  }

  // Category-league records: the hockey-native set.
  const catGames = counted.filter((m) => isCategorySeason(typeBySeason.get(m.season)) && m.home_cat_wins != null && m.home_cat_losses != null);
  if (catGames.length) {
    let sweep: { v: number; m: MatchupRow; who: string; line: string } | null = null;
    let narrow: { v: number; m: MatchupRow; who: string; line: string } | null = null;
    const perfect: TrophyRow[] = [];
    const dominance = new Map<string, Map<string, number>>(); // statKey -> member -> weekly wins
    for (const m of catGames) {
      const hw = m.home_cat_wins!, hl = m.home_cat_losses!, ht = m.home_cat_ties ?? 0;
      const total = hw + hl + ht;
      const sides: Array<[string, number, number, number]> = [[m.home_member_id, hw, hl, ht], [m.away_member_id!, hl, hw, ht]];
      for (const [who, w, l, t] of sides) {
        const margin = w - l;
        const line = `${w}-${l}-${t}`;
        if (margin > 0) {
          if (!sweep || margin > sweep.v) sweep = { v: margin, m, who, line };
          if (!narrow || margin < narrow.v) narrow = { v: margin, m, who, line };
          if (l === 0 && t === 0 && total > 0) perfect.push({ season: m.season, member_id: who, trophy_key: 'perfect_week', rank: null, value: w, detail: { week: m.week, line }, source: 'computed' });
        }
      }
      for (const c of m.category_results ?? []) {
        if (c.winner !== 'home' && c.winner !== 'away') continue;
        const who = c.winner === 'home' ? m.home_member_id : m.away_member_id!;
        const inner = dominance.get(c.statKey) ?? new Map<string, number>();
        inner.set(who, (inner.get(who) ?? 0) + 1);
        dominance.set(c.statKey, inner);
      }
    }
    const d = (r: { m: MatchupRow; who: string; line: string }) => ({ season: r.m.season, week: r.m.week, line: r.line, opponent_member_id: r.who === r.m.home_member_id ? r.m.away_member_id : r.m.home_member_id });
    if (sweep) out.push({ season: null, member_id: sweep.who, trophy_key: 'category_sweep', rank: 1, value: sweep.v, detail: d(sweep), source: 'computed' });
    if (narrow) out.push({ season: null, member_id: narrow.who, trophy_key: 'narrowest_category_win', rank: 1, value: narrow.v, detail: d(narrow), source: 'computed' });
    out.push(...perfect);
    for (const [statKey, inner] of dominance) {
      let best: [string, number] | null = null;
      for (const [who, n] of inner) if (!best || n > best[1]) best = [who, n];
      if (best) out.push({ season: null, member_id: best[0], trophy_key: 'category_dominance', rank: 1, value: best[1], detail: { stat_key: statKey, weekly_wins: best[1] }, source: 'computed' });
    }
  }

  return out;
}

function teamName(teams: TeamRow[], member: string): string | null {
  return teams.find((t) => t.member_id === member)?.team_name ?? null;
}
function sum(xs: Array<number | null | undefined>): number { return xs.reduce<number>((a, b) => a + (b ?? 0), 0); }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
