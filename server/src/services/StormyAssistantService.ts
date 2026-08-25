// Stormy assistant service — ported from the DEPLOYED stormy-chat Edge
// Function v33 (chunk 11g.9, 2026-08-24).
//
// Holds the two pieces of Stormy that are NOT prompt text: the spend
// guards, and the verified-player-data lookup that RULE 0 depends on.
//
// ── WHY THE LOOKUP IS LOAD-BEARING ─────────────────────────────────
//
// Comment preserved from the deployed source, because it explains a
// defect that prompt engineering alone could not fix:
//
//   "The whole reason Stormy used to fabricate: the client only ever
//    sent roster-scoped context, so any question about a player the
//    user does not roster arrived with NOTHING attached -- and the
//    model filled the hole from memory. Prompt rules alone could not
//    fix that; there was no data to obey."
//
// So `lookupPlayers` reads candidate names out of the question, fetches
// the real rows, and renders them into a VERIFIED PLAYER DATA block.
// RULE 0 in the system prompt then has something concrete to point at,
// and explicitly names anyone the lookup could NOT find so the model
// says "I don't have their numbers" instead of inventing them.
//
// The repo's own copy of the Edge Function had none of this. Do not
// "simplify" this file by dropping the lookup — that reintroduces
// fabricated stat lines, which is the worst output this product can
// produce.
//
// ── SCHEMA NOTE ────────────────────────────────────────────────────
// Verified against production 2026-08-24:
//   player_directory ....... player_id, full_name, team_abbrev,
//                            position_code, is_goalie, season
//   player_season_stats .... player_id, season, games_played, goals,
//                            primary_assists, secondary_assists, points,
//                            shots_on_goal, hits, blocks, pim, ppp,
//                            wins, saves, save_pct, shutouts,
//                            goals_against, is_goalie
//   player_talent_metrics .. player_id, season, xg_per_60, xg_rating
// NOTE player_directory is keyed (season, player_id) and has NO `id`
// column — see the demo-matchup route for what happens when that is
// got wrong.

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Cost controls (verbatim from deployed v33) ─────────────────────
// HARD CAPS. Stormy stops responding once ANY limit is hit.
export const WEEKLY_MESSAGE_LIMIT = 15;        // per user per rolling 7 days
export const GLOBAL_DAILY_MESSAGE_LIMIT = 500; // all users per 24h (safety net)
export const MONTHLY_TOKEN_BUDGET = 500_000;   // in+out per calendar month — kill switch
export const MAX_RESPONSE_TOKENS = 1536;
export const MAX_CONVERSATION_TURNS = 6;
export const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

// ── Spend guards ───────────────────────────────────────────────────
// All three return `null` on error rather than throwing. That is
// deliberate and preserved from the deployed function: a failed guard
// query must not take the chat down. `null` means "could not check",
// and the caller treats that as allowed.

/** Per-user weekly limit (rolling 7 days). */
export async function checkUserWeeklyLimit(
  svc: SupabaseClient,
  userId: string,
): Promise<{ allowed: boolean; used: number } | null> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await svc
      .from('stormy_chat_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', cutoff);
    if (error) return null;
    const used = count ?? 0;
    return { allowed: used < WEEKLY_MESSAGE_LIMIT, used };
  } catch {
    return null;
  }
}

/** Global daily cap across ALL users. Safety net. */
export async function checkGlobalDailyLimit(
  svc: SupabaseClient,
): Promise<{ allowed: boolean; used: number } | null> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await svc
      .from('stormy_chat_log')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', cutoff);
    if (error) return null;
    const used = count ?? 0;
    return { allowed: used < GLOBAL_DAILY_MESSAGE_LIMIT, used };
  } catch {
    return null;
  }
}

/** Monthly token budget — the absolute kill switch. */
export async function checkMonthlyTokenBudget(
  svc: SupabaseClient,
): Promise<{ allowed: boolean; totalTokens: number } | null> {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { data, error } = await svc
      .from('stormy_chat_log')
      .select('tokens_used')
      .gte('created_at', monthStart);
    if (error) return null;
    const totalTokens = ((data ?? []) as Array<{ tokens_used: number | null }>).reduce(
      (sum, row) => sum + (row.tokens_used || 0),
      0,
    );
    return { allowed: totalTokens < MONTHLY_TOKEN_BUDGET, totalTokens };
  } catch {
    return null;
  }
}

/** Usage log. Never throws — logging must not fail a delivered answer. */
export async function logStormyUsage(
  svc: SupabaseClient,
  userId: string,
  tokensUsed: number,
  preview: string,
): Promise<void> {
  try {
    await svc.from('stormy_chat_log').insert({
      user_id: userId,
      tokens_used: tokensUsed,
      message_preview: preview.substring(0, 200),
    });
  } catch {
    /* non-critical */
  }
}

// ── Player lookup ──────────────────────────────────────────────────

const NAME_STOPWORDS = new Set([
  'The','This','That','These','Those','Should','Would','Could','Shall','Might',
  'What','Who','Whom','Which','When','Where','Why','How','Take','Give','Start',
  'Sit','Trade','Drop','Pick','Add','Keep','Best','Better','Worse','Good','Bad',
  'Week','Team','Teams','League','Player','Players','Points','Goals','Assists',
  'Shots','Blocks','Hits','Fantasy','Hockey','Draft','Roster','Lineup','Bench',
  'And','But','For','With','From','About','Versus','Vs','Or','Is','Are','Was',
  'Were','Do','Does','Did','Can','Will','Yes','No','Please','Thanks','Thank',
  'Hey','Hi','Hello','Okay','Stormy','Citrus','NHL','GM','My','Me','Your','You',
  'His','Her','Their','Our','One','Two','Three','Next','Last','Season','Year',
  'Game','Games','Night','Tonight','Today','Tomorrow','Now','Also','Just',
]);

/** Pull plausible player names out of a free-text question. */
export function candidateNames(message: string): string[] {
  const out = new Set<string>();
  // Two or three capitalised words in a row -> a full name.
  const full = message.match(/\b\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){1,2}\b/gu) ?? [];
  for (const m of full) out.add(m.trim());
  // A lone capitalised word -> possibly a surname. Stopwords filter the
  // noise; anything that is not a real player simply returns no rows.
  const single = message.match(/\b\p{Lu}[\p{L}'’-]{3,}\b/gu) ?? [];
  for (const m of single) if (!NAME_STOPWORDS.has(m)) out.add(m.trim());
  return [...out].slice(0, 8);
}

/**
 * Look the named players up and render a block of REAL numbers.
 * Returns '' when the message names nobody recognisable.
 *
 * Never throws: a lookup failure must not break the chat, it just
 * means RULE 0's "I don't have their numbers" arm engages instead.
 */
export async function lookupPlayers(
  svc: SupabaseClient,
  message: string,
): Promise<string> {
  const names = candidateNames(message);
  if (!names.length) return '';

  try {
    // Strip characters that would break PostgREST's or() grammar.
    const filter = names
      .map((n) => n.replace(/[(),*%]/g, '').trim())
      .filter((n) => n.length >= 3)
      .map((n) => `full_name.ilike.%${n}%`)
      .join(',');
    if (!filter) return '';

    const { data: dir, error: dirErr } = await svc
      .from('player_directory')
      .select('player_id, full_name, team_abbrev, position_code, is_goalie, season')
      .or(filter)
      .limit(40);

    if (dirErr || !dir || !dir.length) {
      return `\n\n### VERIFIED PLAYER DATA\nNo database match for: ${names.join(', ')}. You do NOT have stats for them (see RULE 0).\n`;
    }

    // Keep one directory entry per player — the table is keyed
    // (season, player_id) and carries a row for the upcoming season
    // too, which has no stats attached. Prefer the newest for identity.
    const byId = new Map<number, Record<string, unknown>>();
    for (const r of dir as Array<Record<string, unknown>>) {
      const id = r.player_id as number;
      const prev = byId.get(id);
      if (!prev || (r.season as number) > (prev.season as number)) byId.set(id, r);
    }
    const ids = [...byId.keys()].slice(0, 12);
    if (!ids.length) return '';

    const { data: stats } = await svc
      .from('player_season_stats')
      .select('player_id, season, games_played, goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks, pim, ppp, wins, saves, save_pct, shutouts, goals_against, is_goalie')
      .in('player_id', ids)
      .order('season', { ascending: false });

    const { data: talent } = await svc
      .from('player_talent_metrics')
      .select('player_id, season, xg_per_60, xg_rating')
      .in('player_id', ids)
      .order('season', { ascending: false });

    // Newest season that actually has games played.
    const statById = new Map<number, Record<string, unknown>>();
    for (const r of (stats ?? []) as Array<Record<string, unknown>>) {
      const id = r.player_id as number;
      if (!statById.has(id) && (r.games_played as number | null)) statById.set(id, r);
    }
    const talentById = new Map<number, Record<string, unknown>>();
    for (const r of (talent ?? []) as Array<Record<string, unknown>>) {
      const id = r.player_id as number;
      if (!talentById.has(id)) talentById.set(id, r);
    }

    const lines: string[] = [];
    const noStats: string[] = [];
    let statSeason: number | null = null;

    for (const id of ids) {
      const d = byId.get(id)!;
      const st = statById.get(id);
      const tl = talentById.get(id);

      // Identity string: "Name (TEAM, POS)" degrading gracefully when
      // either team or position is absent.
      const team = d.team_abbrev as string | null;
      const pos = d.position_code as string | null;
      let who = String(d.full_name);
      if (team && pos) who += ` (${team}, ${pos})`;
      else if (team) who += ` (${team})`;
      else if (pos) who += ` (${pos})`;

      if (!st) {
        noStats.push(String(d.full_name));
        continue;
      }
      statSeason = statSeason ?? (st.season as number);

      const gp = st.games_played as number;
      if (st.is_goalie || d.is_goalie) {
        const sv = st.save_pct as number | null;
        lines.push(
          `- ${who} — ${gp} GP, ${st.wins ?? 0} W, ${st.saves ?? 0} SV, ` +
          `${sv != null ? 'SV% ' + Number(sv).toFixed(3) : 'SV% n/a'}, ` +
          `${st.shutouts ?? 0} SO, ${st.goals_against ?? 0} GA`,
        );
      } else {
        const ast = Number(st.primary_assists ?? 0) + Number(st.secondary_assists ?? 0);
        const pts = st.points as number | null;
        const ppg = pts != null && gp ? (Number(pts) / gp).toFixed(2) : 'n/a';
        const xg = tl?.xg_per_60 != null
          ? `, xG/60 ${Number(tl.xg_per_60).toFixed(2)}${tl.xg_rating ? ' [' + tl.xg_rating + ']' : ''}`
          : '';
        lines.push(
          `- ${who} — ${gp} GP, ${st.goals ?? 0} G, ${ast} A, ${pts ?? 0} PTS, ` +
          `${ppg} PPG, ${st.shots_on_goal ?? 0} SOG, ${st.hits ?? 0} HIT, ` +
          `${st.blocks ?? 0} BLK, ${st.ppp ?? 0} PPP${xg}`,
        );
      }
    }

    if (!lines.length && !noStats.length) return '';

    const label = statSeason ? `${statSeason}-${String(statSeason + 1).slice(2)}` : 'most recent';
    let block = `\n\n### VERIFIED PLAYER DATA — from the Citrus database. These numbers are REAL. Use them exactly.\nSeason ${label} (COMPLETED — see SEASON STATUS above; there is no rest-of-season)\n`;
    if (lines.length) block += lines.join('\n') + '\n';
    if (noStats.length) {
      block += `\nNO STATS ON FILE for: ${noStats.join(', ')}. You do NOT have their numbers — say so rather than estimating (RULE 0).\n`;
    }
    return block;
  } catch {
    return ''; // never break the chat over a lookup
  }
}
