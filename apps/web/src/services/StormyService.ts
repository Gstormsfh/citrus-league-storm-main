/**
 * StormyService — Client-side service for Citrus Stormy AI assistant.
 *
 * Gathers league / roster / matchup context via API server (3-tier),
 * sends it to the Supabase edge function (which proxies the Claude API),
 * and returns the AI response with usage tracking.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  getFirstWeekStartDate,
  getCurrentWeekNumber,
  getWeekStartDate,
  getWeekEndDate,
  getWeekLabel,
  getScheduleLength,
} from "@/utils/weekCalculator";
import { fetchGamesForTeams } from "@/utils/scheduleMaximizer";
import { getWeeklyProjections } from "@/utils/projectionHelper";

// ── Types ────────────────────────────────────────────────────────

export interface StormyMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StormyContext {
  /** Which page the user is currently on */
  page: string;
  leagueName?: string;
  teamName?: string;
  /** League-specific scoring weights (JSON) */
  scoringSettings?: string;
  /** Compact summary of the user's roster */
  rosterSummary?: string;
  /** Current matchup info */
  matchupSummary?: string;
  /** League standings overview */
  standingsSummary?: string;
  /** Free-text extra context (e.g. specific player data) */
  extra?: string;
}

export interface StormyUsage {
  messagesUsed: number;
  dailyLimit: number;
  inputTokens: number;
  outputTokens: number;
}

export interface StormyResponse {
  response: string;
  usage?: StormyUsage;
  error?: string;
}

// ── Service ──────────────────────────────────────────────────────

class StormyServiceImpl {
  private guestMessageCount = 0;
  private static readonly GUEST_LIMIT = 1;

  /**
   * Send a message to Stormy and get an AI-powered response.
   */
  async sendMessage(
    message: string,
    history: StormyMessage[],
    context?: StormyContext,
  ): Promise<StormyResponse> {
    try {
      // Client-side guest throttle (auth calls are acceptable client-side)
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        this.guestMessageCount++;
        if (this.guestMessageCount > StormyServiceImpl.GUEST_LIMIT) {
          return {
            response: "",
            error:
              "Want more from Stormy? Sign up for a free account to get 3 questions per matchup week!",
          };
        }
      }

      const contextString = context
        ? StormyServiceImpl.buildContextString(context)
        : "";

      // Edge function invocation is acceptable client-side
      const { data, error } = await supabase.functions.invoke("stormy-chat", {
        body: {
          message,
          conversationHistory: history.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          context: contextString,
        },
      });

      if (data?.error) {
        return { response: "", error: data.error };
      }

      if (error) {
        throw new Error(error.message || "Failed to reach Stormy");
      }

      return {
        response: data.response ?? "",
        usage: data.usage,
      };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong.";
      return {
        response: "",
        error: msg,
      };
    }
  }

  static buildContextString(ctx: StormyContext): string {
    const lines: string[] = [];

    lines.push(`Page: ${ctx.page}`);
    if (ctx.leagueName) lines.push(`League: ${ctx.leagueName}`);
    if (ctx.teamName) lines.push(`User's team: ${ctx.teamName}`);
    if (ctx.scoringSettings) {
      lines.push(`League scoring: ${ctx.scoringSettings}`);
    }
    if (ctx.rosterSummary) lines.push(`=== YOUR DRAFTED ROSTER ===\n${ctx.rosterSummary}`);
    if (ctx.matchupSummary) lines.push(`=== CURRENT MATCHUP ===\n${ctx.matchupSummary}`);
    if (ctx.standingsSummary) lines.push(`=== STANDINGS ===\n${ctx.standingsSummary}`);
    if (ctx.extra) lines.push(`=== AVAILABLE PLAYERS (Not Yet Drafted) ===\n${ctx.extra}`);

    return lines.join("\n");
  }

  static summarizeRoster(
    roster: Array<{
      name: string;
      position: string;
      team: string;
      points?: number;
      projectedPoints?: number;
    }>,
  ): string {
    if (!roster.length) return "Empty roster";
    return roster
      .map((p) => {
        let line = `${p.position} ${p.name} (${p.team})`;
        if (p.points != null) line += ` ${p.points} pts`;
        if (p.projectedPoints != null) line += ` proj ${p.projectedPoints}`;
        return line;
      })
      .join("\n");
  }

  static summarizeMatchup(matchup: {
    userTeam: string;
    userScore: number;
    opponentTeam: string;
    opponentScore: number;
    weekNumber: number;
    status: string;
  }): string {
    return [
      `Week ${matchup.weekNumber} (${matchup.status})`,
      `${matchup.userTeam}: ${matchup.userScore} pts`,
      `${matchup.opponentTeam}: ${matchup.opponentScore} pts`,
    ].join("\n");
  }

  /**
   * Deep-fetch league context for Stormy via API server (3-tier).
   */
  static async fetchLeagueContext(
    leagueId: string,
    userId: string,
  ): Promise<Partial<StormyContext>> {
    const ctx: Partial<StormyContext> = {};

    try {
      // ── 1. User's team (via API) ─────────────────────────────────
      const { leagueApi } = await import('@/api/leagues');
      const teamsResult = await leagueApi.getTeams(leagueId);
      const allTeams = (teamsResult.data ?? []) as Array<{ id: string; team_name: string; owner_id: string }>;
      const team = allTeams.find(t => t.owner_id === userId);

      if (!team) return ctx;
      ctx.teamName = team.team_name;

      // ── 2. League config + week calculation (via API) ────────────
      const leagueResult = await leagueApi.getLeague(leagueId);
      const leagueRow = leagueResult.data as {
        updated_at?: string; draft_status?: string; scoring_settings?: Record<string, unknown>;
        roster_slots?: Record<string, number>; league_size?: number; roster_size?: number;
      } | null;

      let weekStart: Date | null = null;
      let weekEnd: Date | null = null;
      let currentWeek = 0;
      let weekLabel = "";
      let totalWeeks = 0;

      if (leagueRow?.draft_status === "completed" && leagueRow.updated_at) {
        const draftDate = new Date(leagueRow.updated_at);
        const firstWeekStart = getFirstWeekStartDate(draftDate);
        currentWeek = getCurrentWeekNumber(firstWeekStart);
        weekStart = getWeekStartDate(currentWeek, firstWeekStart);
        weekEnd = getWeekEndDate(currentWeek, firstWeekStart);
        weekLabel = getWeekLabel(currentWeek, firstWeekStart);
        totalWeeks = getScheduleLength(firstWeekStart);
      }

      // ── 3. All roster assignments (via API) ──────────────────────
      const { rosterApi } = await import('@/api/rosters');
      const allRosterResponse = await rosterApi.getLeagueRosters(leagueId);
      const allRosters = (allRosterResponse.data ?? []) as Array<{ team_id: string; player_id: string }>;

      // User's roster IDs
      const userRosterRows = allRosters.filter(r => r.team_id === team.id);
      const playerIds = userRosterRows
        .map(p => {
          const n = parseInt(String(p.player_id));
          return isNaN(n) ? null : n;
        })
        .filter((id): id is number => id !== null && id > 0);

      // All rostered player IDs in the league (for free agent identification)
      const allRosteredIds = new Set(
        allRosters.map(r => parseInt(String(r.player_id))).filter(n => !isNaN(n) && n > 0),
      );

      // ── 4. Find opponent team ID from latest matchup (via API) ───
      const { matchupApi } = await import('@/api/matchups');
      const matchupsResult = await matchupApi.getLeagueMatchups(leagueId);
      const allMatchupsData = (matchupsResult.data ?? []) as Array<{
        week_number: number; team1_id: string; team2_id: string;
        team1_score: number | null; team2_score: number | null; status: string;
      }>;

      // Find user's latest matchup
      const userMatchups = allMatchupsData
        .filter(m => m.team1_id === team.id || m.team2_id === team.id)
        .sort((a, b) => b.week_number - a.week_number);

      let opponentTeamId: string | null = null;
      let opponentName = "Bye";
      let currentMatchup: typeof userMatchups[0] | null = null;

      if (userMatchups.length) {
        currentMatchup = userMatchups[0];
        const isTeam1 = currentMatchup.team1_id === team.id;
        opponentTeamId = isTeam1 ? currentMatchup.team2_id : currentMatchup.team1_id;
        const oppTeam = allTeams.find(t => t.id === opponentTeamId);
        if (oppTeam) opponentName = oppTeam.team_name;
      }

      // ── 5. Opponent roster IDs ───────────────────────────────────
      const opponentPlayerIds = opponentTeamId
        ? allRosters
            .filter(r => r.team_id === opponentTeamId)
            .map(r => parseInt(String(r.player_id)))
            .filter(n => !isNaN(n) && n > 0)
        : [];

      // Combine all player IDs we need
      const allNeededPlayerIds = [...new Set([...playerIds, ...opponentPlayerIds])];

      if (allNeededPlayerIds.length > 0) {
        // ── 6. Fetch player data + lineup via API (parallel) ──────
        const { PlayerService } = await import('@/services/PlayerService');
        const { playerApi } = await import('@/api/players');

        const [playersData, lineupResult, rosProjectionsResult] = await Promise.allSettled([
          PlayerService.getPlayersByIds(allNeededPlayerIds.map(String)),
          rosterApi.getLineup(leagueId, team.id),
          playerApi.getRosProjections(200),
        ]);

        // Build player lookup maps
        const playerMap = new Map(
          (playersData.status === 'fulfilled' ? playersData.value : []).map(p => [Number(p.id), p])
        );

        const lineupData = lineupResult.status === 'fulfilled'
          ? lineupResult.value.data as { starters?: string[]; bench?: string[]; ir?: string[] } | null
          : null;

        const starterIds = new Set(((lineupData?.starters as string[]) ?? []).map(String));
        const irIds = new Set(((lineupData?.ir as string[]) ?? []).map(String));

        // ── 7. Weekly projections + schedule (separate parallel) ───
        let weeklyProjMap = new Map<number, number>();
        const teamGamesCountMap = new Map<string, number>();
        const teamGameDaysMap = new Map<string, string[]>();

        if (weekStart && weekEnd) {
          const uniqueTeams = [...new Set(
            playerIds.map(pid => playerMap.get(pid)?.team).filter((t): t is string => !!t),
          )];

          const [projResult, gamesResult] = await Promise.allSettled([
            getWeeklyProjections(playerIds, weekStart, weekEnd),
            fetchGamesForTeams(uniqueTeams, weekStart, weekEnd),
          ]);

          if (projResult.status === "fulfilled") weeklyProjMap = projResult.value;
          if (gamesResult.status === "fulfilled") {
            const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            for (const [abbrev, games] of gamesResult.value) {
              teamGamesCountMap.set(abbrev, games.length);
              teamGameDaysMap.set(abbrev, games.map(g => dayNames[new Date(g.game_date.split('T')[0] + 'T00:00:00').getDay()]));
            }
          }
        }

        // ── 8. Build enriched roster summary ────────────────────────
        const userPlayers = playerIds.map(pid => playerMap.get(pid)).filter(Boolean);
        if (userPlayers.length) {
          interface RosterLine { sortOrder: number; line: string; }
          const rosterLines: RosterLine[] = userPlayers.map((p) => {
            if (!p) return { sortOrder: 3, line: '' };
            const pid = String(p.id);
            const isStarter = starterIds.has(pid);
            const isIR = irIds.has(pid);
            const status = isStarter ? "START" : isIR ? "IR" : "BENCH";
            const sortOrder = isStarter ? 0 : isIR ? 2 : 1;

            let line = `${status} ${p.position ?? "?"} ${p.full_name} (${p.team ?? "?"})`;

            // Season stats (from NormalizedPlayer via API)
            const isGoalie = p.position === "G";
            if (isGoalie && (p.goalie_gp || 0) > 0) {
              line += ` ${p.goalie_gp}GP ${p.wins}W ${p.saves}SV ${p.goals_against}GA ${p.shutouts}SO`;
              if (p.save_percentage != null) line += ` ${Number(p.save_percentage).toFixed(3)}SV%`;
            } else if (p.games_played > 0) {
              line += ` ${p.games_played}GP ${p.goals}G ${p.assists}A ${p.points}PTS`;
              const ppg = (p.points / p.games_played).toFixed(1);
              line += ` ${ppg}PPG`;
              if ((p.ppp || 0) > 0) line += ` ${p.ppp}PPP`;
              if ((p.shp || 0) > 0) line += ` ${p.shp}SHP`;
              line += ` ${p.shots}SOG ${p.hits}HIT ${p.blocks}BLK ${p.pim}PIM`;
            }

            // Injury status
            if (p.roster_status && p.roster_status !== "ACT") {
              line += ` [${p.roster_status}]`;
            }

            // Weekly schedule
            const gp = teamGamesCountMap.get(p.team ?? "");
            const days = teamGameDaysMap.get(p.team ?? "");
            if (gp != null) {
              line += ` ${gp}GP/wk`;
              if (days?.length) line += `[${days.join(",")}]`;
            }

            // Weekly projection
            const proj = weeklyProjMap.get(Number(p.id));
            if (proj != null) line += ` wkProj:${proj.toFixed(1)}`;

            return { sortOrder, line };
          }).filter(r => r.line);

          rosterLines.sort((a, b) => a.sortOrder - b.sortOrder);
          ctx.rosterSummary = rosterLines.map(r => r.line).join("\n");
        }

        // ── 9. Current matchup + opponent roster summary ───────────
        if (currentMatchup) {
          const isTeam1 = currentMatchup.team1_id === team.id;
          const userScore = isTeam1 ? currentMatchup.team1_score : currentMatchup.team2_score;
          const oppScore = isTeam1 ? currentMatchup.team2_score : currentMatchup.team1_score;

          const matchupLines = [
            `Week ${currentMatchup.week_number} (${currentMatchup.status})`,
            `${team.team_name}: ${userScore} pts`,
            `${opponentName}: ${oppScore} pts`,
          ];

          if (opponentPlayerIds.length > 0) {
            const oppPlayers = opponentPlayerIds.map(pid => playerMap.get(pid)).filter(Boolean);
            if (oppPlayers.length > 0) {
              matchupLines.push(`\nOpponent Roster (${opponentName}):`);
              oppPlayers.forEach(p => {
                if (!p) return;
                let line = `  ${p.position ?? "?"} ${p.full_name} (${p.team ?? "?"})`;
                const isGoalie = p.position === "G";
                if (isGoalie && (p.goalie_gp || 0) > 0) {
                  line += ` ${p.goalie_gp}GP ${p.wins}W`;
                  if (p.save_percentage != null) line += ` ${Number(p.save_percentage).toFixed(3)}SV%`;
                } else if (p.games_played > 0) {
                  line += ` ${p.games_played}GP ${p.points}PTS ${(p.points / p.games_played).toFixed(1)}PPG`;
                }
                matchupLines.push(line);
              });
            }
          }

          ctx.matchupSummary = matchupLines.join("\n");
        }

        // ── 10. League standings ──────────────────────────────────
        const completedMatchups = allMatchupsData.filter(m => m.status === 'completed' || m.status === 'in_progress');
        if (completedMatchups.length > 0 && allTeams.length > 0) {
          const teamStandings: Record<string, { w: number; l: number; pf: number; pa: number }> = {};
          allTeams.forEach(t => { teamStandings[t.id] = { w: 0, l: 0, pf: 0, pa: 0 }; });

          for (const m of completedMatchups) {
            if (!m.team1_id || !m.team2_id) continue;
            const s1 = Number(m.team1_score) || 0;
            const s2 = Number(m.team2_score) || 0;
            if (teamStandings[m.team1_id]) {
              teamStandings[m.team1_id].pf += s1;
              teamStandings[m.team1_id].pa += s2;
              if (s1 > s2) teamStandings[m.team1_id].w++;
              else if (s2 > s1) teamStandings[m.team1_id].l++;
            }
            if (teamStandings[m.team2_id]) {
              teamStandings[m.team2_id].pf += s2;
              teamStandings[m.team2_id].pa += s1;
              if (s2 > s1) teamStandings[m.team2_id].w++;
              else if (s1 > s2) teamStandings[m.team2_id].l++;
            }
          }

          const ranked = allTeams
            .map(t => ({ name: t.team_name, id: t.id, ...teamStandings[t.id] }))
            .sort((a, b) => b.w - a.w || b.pf - a.pf);

          const standingsLines = ranked.map((t, i) => {
            const marker = t.id === team.id ? " ← YOU" : t.id === opponentTeamId ? " ← OPP" : "";
            return `${i + 1}. ${t.name} ${t.w}-${t.l} (PF:${t.pf.toFixed(1)} PA:${t.pa.toFixed(1)})${marker}`;
          });
          ctx.standingsSummary = standingsLines.join("\n");
        }

        // ── 11. Top free agents (via API) ──────────────────────────
        type RosProjectionRow = {
          player_id: number; player_name: string; position: string | null;
          team_abbrev: string | null; total_projected_points: number;
          avg_points_per_game: number; games_remaining: number;
        };

        const rosProjectionsData = rosProjectionsResult.status === 'fulfilled'
          ? (rosProjectionsResult.value.data ?? []) as RosProjectionRow[]
          : [];

        if (rosProjectionsData.length > 0) {
          const freeAgents = rosProjectionsData
            .filter(p => !allRosteredIds.has(p.player_id))
            .slice(0, 8);

          if (freeAgents.length > 0) {
            const faLines = freeAgents.map(p =>
              `${p.position ?? "?"} ${p.player_name} (${p.team_abbrev ?? "?"}) ROS:${Number(p.total_projected_points).toFixed(1)}pts ${Number(p.avg_points_per_game).toFixed(1)}PPG ${p.games_remaining}GR`
            );
            ctx.extra = (ctx.extra ? ctx.extra + "\n\n" : "") + "Top Available Free Agents:\n" + faLines.join("\n");
          }
        }
      }

      // ── 12. League config + week/season summary ─────────────────
      const extraParts: string[] = [];
      if (weekLabel) {
        extraParts.push(`Current: ${weekLabel}`);
        if (totalWeeks > 0) {
          extraParts.push(
            `Regular season: ${totalWeeks} weeks (${currentWeek > totalWeeks ? "playoffs" : `week ${currentWeek} of ${totalWeeks}`})`,
          );
        }
      }
      if (leagueRow?.roster_slots) {
        const slots = leagueRow.roster_slots as Record<string, number>;
        const slotStr = Object.entries(slots).map(([pos, count]) => `${pos}:${count}`).join(" ");
        extraParts.push(`Roster slots: ${slotStr} (${leagueRow.roster_size ?? 21} total)`);
      }
      if (leagueRow?.league_size) {
        extraParts.push(`League size: ${leagueRow.league_size} teams`);
      }
      if (extraParts.length) {
        ctx.extra = extraParts.join("\n") + (ctx.extra ? "\n\n" + ctx.extra : "");
      }
    } catch {
      // Context fetch is non-critical — Stormy still works without it
    }

    return ctx;
  }

  /**
   * Deep-fetch playoff-pool context for Stormy (roster / bracket / confidence).
   *
   * Unlike season-long fantasy, playoff pools have their own picks tables,
   * their own stats table (player_playoff_stats), and the "standings" is
   * a bracket of 15 series. This fetcher builds a context that lets Stormy
   * give INSTANT roster review + injury flags + tips without asking the
   * user for anything.
   */
  static async fetchPlayoffPoolContext(
    leagueId: string,
    userId: string,
    leagueType: 'playoff-roster-pool' | 'playoff-bracket-pickem' | 'playoff-confidence-pool',
  ): Promise<Partial<StormyContext>> {
    const ctx: Partial<StormyContext> = {};
    // Supabase generated types don't cover the playoff tables yet — use a
    // type-relaxed client for these queries so we don't fight TypeScript.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as any;

    type SeriesRow = {
      bracket_slot: number;
      round: number;
      high_seed_team_id: number | null;
      low_seed_team_id: number | null;
      high_seed_wins: number | null;
      low_seed_wins: number | null;
      winner_team_id: number | null;
      games_played: number | null;
      series_status: string | null;
    };
    type TeamRow = { team_id: number; abbreviation: string; name: string };
    type PlayerDirRow = {
      player_id: number;
      full_name: string;
      position: string | null;
      team_abbrev: string | null;
      status: string | null;
    };
    type PlayoffStatRow = {
      player_id: number;
      games_played: number | null;
      goals: number | null;
      assists: number | null;
      points: number | null;
      ppp: number | null;
      shots: number | null;
      hits: number | null;
      blocks: number | null;
      wins: number | null;
      saves: number | null;
      shutouts: number | null;
      goals_against: number | null;
      is_goalie: boolean | null;
    };

    try {
      // ── 0. Seeds + series state (shared across all 3 pool types) ────────
      const [seriesRes, teamsRes] = await Promise.allSettled([
        sb.from('nhl_playoff_series').select('bracket_slot, round, high_seed_team_id, low_seed_team_id, high_seed_wins, low_seed_wins, winner_team_id, games_played, series_status').order('bracket_slot'),
        sb.from('nhl_teams').select('team_id, abbreviation, name'),
      ]);

      const series: SeriesRow[] = seriesRes.status === 'fulfilled' ? ((seriesRes.value.data ?? []) as SeriesRow[]) : [];
      const teams: TeamRow[] = teamsRes.status === 'fulfilled' ? ((teamsRes.value.data ?? []) as TeamRow[]) : [];

      const teamById = new Map<number, { abbreviation: string; name: string }>();
      for (const t of teams) {
        teamById.set(t.team_id, { abbreviation: t.abbreviation, name: t.name });
      }

      // Build a human-readable bracket summary
      if (series.length > 0) {
        const seriesLines: string[] = [];
        const byRound = new Map<number, SeriesRow[]>();
        for (const s of series) {
          if (!byRound.has(s.round)) byRound.set(s.round, []);
          byRound.get(s.round)!.push(s);
        }
        const roundNames: Record<number, string> = { 1: 'Round 1', 2: 'Round 2', 3: 'Conference Finals', 4: 'Stanley Cup Final' };
        for (const [round, roundSeries] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
          seriesLines.push(`\n${roundNames[round] || `Round ${round}`}:`);
          for (const s of roundSeries) {
            const hi = s.high_seed_team_id ? teamById.get(s.high_seed_team_id)?.abbreviation ?? `#${s.high_seed_team_id}` : 'TBD';
            const lo = s.low_seed_team_id ? teamById.get(s.low_seed_team_id)?.abbreviation ?? `#${s.low_seed_team_id}` : 'TBD';
            const score = `${s.high_seed_wins ?? 0}-${s.low_seed_wins ?? 0}`;
            const winner = s.winner_team_id ? ` → ${teamById.get(s.winner_team_id)?.abbreviation ?? ''} wins` : '';
            seriesLines.push(`  [${s.bracket_slot}] ${hi} vs ${lo} (${score}, ${s.series_status || 'pending'}${winner})`);
          }
        }
        ctx.standingsSummary = `NHL PLAYOFF BRACKET (live):${seriesLines.join('\n')}`;
      }

      // ── 1. Type-specific: fetch picks + enrich ──────────────────────────
      if (leagueType === 'playoff-roster-pool') {
        const { data: picksData } = await sb
          .from('playoff_roster_picks')
          .select('player_id, position_slot')
          .eq('league_id', leagueId)
          .eq('user_id', userId);

        const picks = (picksData ?? []) as Array<{ player_id: number; position_slot: string }>;
        const playerIds = picks.map(p => p.player_id).filter(Boolean);

        if (playerIds.length > 0) {
          const [playersRes, statsRes] = await Promise.allSettled([
            sb.from('player_directory').select('player_id, full_name, position, team_abbrev, status').in('player_id', playerIds),
            sb.from('player_playoff_stats').select('*').in('player_id', playerIds),
          ]);

          const players: PlayerDirRow[] = playersRes.status === 'fulfilled' ? ((playersRes.value.data ?? []) as PlayerDirRow[]) : [];
          const stats: PlayoffStatRow[] = statsRes.status === 'fulfilled' ? ((statsRes.value.data ?? []) as PlayoffStatRow[]) : [];

          const playerById = new Map<number, PlayerDirRow>();
          for (const p of players) playerById.set(p.player_id, p);
          const statsById = new Map<number, PlayoffStatRow>();
          for (const s of stats) statsById.set(s.player_id, s);

          // Which playoff teams are still alive?
          const aliveTeamIds = new Set<number>();
          for (const s of series) {
            if (s.series_status === 'pending' || s.series_status === 'in_progress') {
              if (s.high_seed_team_id) aliveTeamIds.add(s.high_seed_team_id);
              if (s.low_seed_team_id) aliveTeamIds.add(s.low_seed_team_id);
            }
            if (s.winner_team_id) aliveTeamIds.add(s.winner_team_id);
          }
          const teamAbbrevAlive = new Set<string>();
          for (const id of aliveTeamIds) {
            const abbrev = teamById.get(id)?.abbreviation;
            if (abbrev) teamAbbrevAlive.add(abbrev);
          }
          // Which have been eliminated?
          const eliminated = new Set<string>();
          for (const s of series) {
            if (s.series_status === 'completed' && s.winner_team_id) {
              const loserId = s.high_seed_team_id === s.winner_team_id ? s.low_seed_team_id : s.high_seed_team_id;
              const abbrev = loserId ? teamById.get(loserId)?.abbreviation : null;
              if (abbrev) eliminated.add(abbrev);
            }
          }

          const rosterLines: string[] = [];
          for (const pick of picks) {
            const p = playerById.get(pick.player_id);
            if (!p) continue;
            const s = statsById.get(pick.player_id);
            const teamAbbrev = p.team_abbrev ?? '?';
            const status = p.status && p.status !== 'ACT' ? ` [${p.status}]` : '';
            const teamState = eliminated.has(teamAbbrev) ? ' ⚠️ELIMINATED' : '';

            let line = `${pick.position_slot} ${p.full_name} (${teamAbbrev})${status}${teamState}`;
            if (s) {
              if (s.is_goalie) {
                line += ` — ${s.games_played ?? 0}GP ${s.wins ?? 0}W ${s.saves ?? 0}SV ${s.shutouts ?? 0}SO ${s.goals_against ?? 0}GA`;
              } else if ((s.games_played ?? 0) > 0) {
                line += ` — ${s.games_played}GP ${s.goals ?? 0}G ${s.assists ?? 0}A ${s.points ?? 0}PTS`;
                const ppg = ((s.points ?? 0) / s.games_played).toFixed(2);
                line += ` (${ppg}PPG) ${s.shots ?? 0}SOG ${s.hits ?? 0}HIT ${s.blocks ?? 0}BLK`;
                if ((s.ppp ?? 0) > 0) line += ` ${s.ppp}PPP`;
              } else {
                line += ` — 0GP (has not played yet)`;
              }
            } else {
              line += ` — no playoff stats yet`;
            }
            rosterLines.push(line);
          }
          ctx.rosterSummary = `YOUR PLAYOFF ROSTER (${picks.length} players) — playoff-only stats:\n` + rosterLines.join('\n');
        } else {
          ctx.rosterSummary = `User has NOT picked their playoff roster yet. Encourage them to build one.`;
        }
      } else if (leagueType === 'playoff-bracket-pickem') {
        const { data: picksData } = await sb
          .from('playoff_bracket_picks')
          .select('series_slot, picked_team_id, predicted_games, is_correct, points_earned')
          .eq('league_id', leagueId)
          .eq('user_id', userId);

        const picks = (picksData ?? []) as Array<{
          series_slot: number;
          picked_team_id: number | null;
          predicted_games: number | null;
          is_correct: boolean | null;
          points_earned: number | null;
        }>;

        if (picks.length > 0) {
          const pickLines: string[] = [];
          for (const p of picks) {
            const s = series.find(x => x.bracket_slot === p.series_slot);
            const pickedAbbrev = p.picked_team_id ? teamById.get(p.picked_team_id)?.abbreviation ?? `#${p.picked_team_id}` : 'TBD';
            let line = `  Series ${p.series_slot}: picked ${pickedAbbrev}`;
            if (p.predicted_games) line += ` in ${p.predicted_games}`;
            if (s && s.series_status === 'completed') {
              const correct = p.is_correct ? '✓' : '✗';
              line += ` [${correct} — ${p.points_earned ?? 0} pts]`;
            }
            pickLines.push(line);
          }
          ctx.rosterSummary = `YOUR BRACKET PICKS:\n${pickLines.join('\n')}`;
        } else {
          ctx.rosterSummary = `User has NOT submitted bracket picks yet.`;
        }
      } else if (leagueType === 'playoff-confidence-pool') {
        const { data: picksData } = await sb
          .from('playoff_confidence_picks')
          .select('series_slot, picked_team_id, confidence_value, is_correct, points_earned')
          .eq('league_id', leagueId)
          .eq('user_id', userId)
          .order('confidence_value', { ascending: false });

        const picks = (picksData ?? []) as Array<{
          series_slot: number;
          picked_team_id: number | null;
          confidence_value: number;
          is_correct: boolean | null;
          points_earned: number | null;
        }>;

        if (picks.length > 0) {
          const pickLines: string[] = [];
          for (const p of picks) {
            const pickedAbbrev = p.picked_team_id ? teamById.get(p.picked_team_id)?.abbreviation ?? `#${p.picked_team_id}` : 'TBD';
            let line = `  Series ${p.series_slot}: ${pickedAbbrev} @ confidence ${p.confidence_value}`;
            if (p.is_correct === true) line += ` ✓ (${p.points_earned ?? 0} pts)`;
            else if (p.is_correct === false) line += ` ✗`;
            pickLines.push(line);
          }
          ctx.rosterSummary = `YOUR CONFIDENCE PICKS (1-${picks.length}):\n${pickLines.join('\n')}`;
        } else {
          ctx.rosterSummary = `User has NOT submitted confidence picks yet.`;
        }
      }

      // Pool-mode hint in extra so Stormy responds appropriately
      const mode = leagueType === 'playoff-roster-pool'
        ? 'PLAYOFF ROSTER POOL — user builds a single playoff roster (players only). Winner = most fantasy points across the playoffs. Ask about MY roster, player swaps, hot playoff performers.'
        : leagueType === 'playoff-bracket-pickem'
        ? 'PLAYOFF BRACKET PICKEM — user picks series winners across all 4 rounds. Winner = most correct picks (with round multipliers).'
        : 'PLAYOFF CONFIDENCE POOL — user assigns confidence values (1-15) to series picks. Winner = highest total from correct picks weighted by confidence.';
      ctx.extra = (ctx.extra ? ctx.extra + '\n\n' : '') + `POOL MODE: ${mode}`;
    } catch {
      // Non-critical — Stormy still works without context
    }
    return ctx;
  }
}

export const StormyService = new StormyServiceImpl();

/** Re-export static methods for direct import. */
export const fetchLeagueContext = StormyServiceImpl.fetchLeagueContext;
export const fetchPlayoffPoolContext = StormyServiceImpl.fetchPlayoffPoolContext;
