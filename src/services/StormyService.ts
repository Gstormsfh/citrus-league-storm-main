/**
 * StormyService — Client-side service for Citrus Stormy AI assistant.
 *
 * Gathers league / roster / matchup context, sends it to the
 * Supabase edge function (which proxies the Claude API), and
 * returns the AI response with usage tracking.
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
  // Demo/guest users: 1 message per session (client-side enforcement)
  // Registered users: 3 per matchup week (server-side enforcement)
  private guestMessageCount = 0;
  private static readonly GUEST_LIMIT = 1;

  /**
   * Send a message to Stormy and get an AI-powered response.
   *
   * @param message        - The user's latest message
   * @param history        - Previous conversation turns
   * @param context        - Optional page / league / roster context
   */
  async sendMessage(
    message: string,
    history: StormyMessage[],
    context?: StormyContext,
  ): Promise<StormyResponse> {
    try {
      // Client-side guest throttle
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

      // Build compact context string
      const contextString = context
        ? StormyServiceImpl.buildContextString(context)
        : "";

      // Call the edge function
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

      // Supabase functions.invoke returns { data, error } where:
      // - On non-2xx responses (429 rate limit, 500 error), BOTH data and error are populated
      // - data contains the parsed JSON body with the user-friendly message
      // - error contains a generic "Edge Function returned a non-2xx status code"
      // Always check data.error FIRST to surface the real message from the edge function
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

  /**
   * Build a compact plaintext context string that gets appended to the
   * system prompt in the edge function.  Keep it small to save tokens.
   */
  static buildContextString(ctx: StormyContext): string {
    const lines: string[] = [];

    lines.push(`Page: ${ctx.page}`);
    if (ctx.leagueName) lines.push(`League: ${ctx.leagueName}`);
    if (ctx.teamName) lines.push(`User's team: ${ctx.teamName}`);
    if (ctx.scoringSettings) {
      lines.push(`League scoring: ${ctx.scoringSettings}`);
    }
    if (ctx.rosterSummary) lines.push(`Roster:\n${ctx.rosterSummary}`);
    if (ctx.matchupSummary) lines.push(`Matchup:\n${ctx.matchupSummary}`);
    if (ctx.standingsSummary) lines.push(`Standings:\n${ctx.standingsSummary}`);
    if (ctx.extra) lines.push(ctx.extra);

    return lines.join("\n");
  }

  /** Format a roster array into a brief text summary for the context. */
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

  /** Format a matchup into a brief summary. */
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
   * Deep-fetch league context for Stormy — the competitive moat.
   * Gathers EVERYTHING a real Assistant GM would need:
   * - Full roster with season stats, injury status, lineup status, schedule, projections
   * - Current matchup + opponent's roster
   * - League standings (all teams W-L-PF-PA)
   * - Top available free agents
   * - League configuration (roster slots, scoring)
   * - Week/season timeline context
   */
  static async fetchLeagueContext(
    leagueId: string,
    userId: string,
  ): Promise<Partial<StormyContext>> {
    const ctx: Partial<StormyContext> = {};

    try {
      // ── 1. User's team ───────────────────────────────────────────
      const { data: team } = await supabase
        .from("teams")
        .select("id, team_name")
        .eq("league_id", leagueId)
        .eq("owner_id", userId)
        .maybeSingle();

      if (!team) return ctx;
      ctx.teamName = team.team_name;

      // ── 2. League config + week calculation ──────────────────────
      const { data: leagueRow } = await supabase
        .from("leagues")
        .select("updated_at, draft_status, scoring_settings, roster_slots, league_size, roster_size")
        .eq("id", leagueId)
        .maybeSingle();

      let weekStart: Date | null = null;
      let weekEnd: Date | null = null;
      let currentWeek = 0;
      let weekLabel = "";
      let totalWeeks = 0;

      if (leagueRow?.draft_status === "completed") {
        const draftDate = new Date(leagueRow.updated_at);
        const firstWeekStart = getFirstWeekStartDate(draftDate);
        currentWeek = getCurrentWeekNumber(firstWeekStart);
        weekStart = getWeekStartDate(currentWeek, firstWeekStart);
        weekEnd = getWeekEndDate(currentWeek, firstWeekStart);
        weekLabel = getWeekLabel(currentWeek, firstWeekStart);
        totalWeeks = getScheduleLength(
          firstWeekStart,
          new Date().getFullYear(),
        );
      }

      // ── 3. All teams in league + all roster assignments (parallel) ──
      const [allTeamsResult, allRosterResult] = await Promise.all([
        supabase.from("teams").select("id, team_name").eq("league_id", leagueId),
        supabase.from("roster_assignments").select("player_id, team_id").eq("league_id", leagueId),
      ]);
      const allTeams = allTeamsResult.data ?? [];
      const allRosters = allRosterResult.data ?? [];

      // User's roster IDs
      const userRosterRows = allRosters.filter(r => r.team_id === team.id);
      const playerIds = userRosterRows
        .map((p: { player_id: string }) => {
          const n = parseInt(String(p.player_id));
          return isNaN(n) ? null : n;
        })
        .filter((id): id is number => id !== null && id > 0);

      // All rostered player IDs in the league (for free agent identification)
      const allRosteredIds = new Set(
        allRosters.map(r => parseInt(String(r.player_id))).filter(n => !isNaN(n) && n > 0),
      );

      // ── 4. Find opponent team ID from latest matchup ─────────────
      const { data: matchups } = await supabase
        .from("matchups")
        .select("week_number, team1_id, team2_id, team1_score, team2_score, status")
        .eq("league_id", leagueId)
        .or(`team1_id.eq.${team.id},team2_id.eq.${team.id}`)
        .order("week_number", { ascending: false })
        .limit(1);

      let opponentTeamId: string | null = null;
      let opponentName = "Bye";
      let currentMatchup: typeof matchups extends (infer T)[] ? T : never = null as any;

      if (matchups?.length) {
        currentMatchup = matchups[0];
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

      // Combine all player IDs we need directory info for
      const allNeededPlayerIds = [...new Set([...playerIds, ...opponentPlayerIds])];

      if (allNeededPlayerIds.length > 0) {
        // ── 6. Parallel batch queries for ALL needed data ──────────
        type DirRow = {
          player_id: number;
          full_name: string;
          position_code: string | null;
          team_abbrev: string | null;
        };
        type SeasonStatRow = {
          player_id: number;
          games_played: number;
          nhl_goals: number;
          nhl_assists: number;
          nhl_points: number;
          nhl_shots_on_goal: number;
          nhl_hits: number;
          nhl_blocks: number;
          nhl_pim: number;
          nhl_ppp: number;
          nhl_shp: number;
          goalie_gp: number;
          nhl_wins: number;
          nhl_saves: number;
          nhl_goals_against: number;
          nhl_shutouts: number;
          nhl_save_pct: number | null;
        };
        type TalentRow = {
          player_id: number;
          roster_status: string | null;
          is_ir_eligible: boolean | null;
          vopa_score: number | null;
        };

        const parallelQueries = [
          // 6a. Player directory (names/positions)
          supabase
            .from("player_directory")
            .select("player_id, full_name, position_code, team_abbrev")
            .in("player_id", allNeededPlayerIds)
            .eq("season", 2025),
          // 6b. User lineup status
          supabase
            .from("team_lineups")
            .select("starters, bench, ir")
            .eq("team_id", team.id)
            .eq("league_id", leagueId)
            .maybeSingle(),
          // 6c. Season stats for all needed players
          supabase
            .from("player_season_stats")
            .select("player_id, games_played, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, goalie_gp, nhl_wins, nhl_saves, nhl_goals_against, nhl_shutouts, nhl_save_pct")
            .in("player_id", allNeededPlayerIds)
            .eq("season", 2025),
          // 6d. Injury/talent status for roster players
          supabase
            .from("player_talent_metrics")
            .select("player_id, roster_status, is_ir_eligible, vopa_score")
            .in("player_id", playerIds)
            .eq("season", 2025),
          // 6e. All matchups for standings calculation
          supabase
            .from("matchups")
            .select("week_number, team1_id, team2_id, team1_score, team2_score, status")
            .eq("league_id", leagueId)
            .in("status", ["completed", "in_progress"]),
          // 6f. Top free agents (ROS projections, top 10 unrostered)
          supabase
            .from("player_ros_projections")
            .select("player_id, player_name, position, team_abbrev, total_projected_points, avg_points_per_game, games_remaining")
            .eq("season", 2025)
            .gt("total_projected_points", 0)
            .gt("games_remaining", 0)
            .order("total_projected_points", { ascending: false })
            .limit(200),  // Fetch more to filter out rostered ones
        ];

        // Also get weekly projections + schedule if week exists
        if (weekStart && weekEnd) {
          parallelQueries.push(
            // 6g. Weekly projections
            supabase.rpc("get_weekly_projections" as any, {
              p_player_ids: playerIds,
              p_start_date: weekStart.toISOString().split("T")[0],
              p_end_date: weekEnd.toISOString().split("T")[0],
            }).then(() => null as any).catch(() => null),
          );
        }

        const results = await Promise.allSettled(parallelQueries);

        const dirData = results[0].status === "fulfilled" ? ((results[0].value as any)?.data ?? []) as DirRow[] : [];
        const lineupData = results[1].status === "fulfilled" ? (results[1].value as any)?.data : null;
        const seasonStatsData = results[2].status === "fulfilled" ? ((results[2].value as any)?.data ?? []) as SeasonStatRow[] : [];
        const talentData = results[3].status === "fulfilled" ? ((results[3].value as any)?.data ?? []) as TalentRow[] : [];
        const allMatchupsData = results[4].status === "fulfilled" ? ((results[4].value as any)?.data ?? []) : [];
        const rosProjectionsData = results[5].status === "fulfilled" ? ((results[5].value as any)?.data ?? []) : [];

        // Build lookup maps
        const dirMap = new Map(dirData.map(p => [p.player_id, p]));
        const statsMap = new Map(seasonStatsData.map(s => [s.player_id, s]));
        const talentMap = new Map(talentData.map(t => [t.player_id, t]));

        const starterIds = new Set(((lineupData?.starters as string[]) ?? []).map(String));
        const irIds = new Set(((lineupData?.ir as string[]) ?? []).map(String));

        // ── 7. Weekly projections + schedule (separate parallel) ───
        let weeklyProjMap = new Map<number, number>();
        const teamGamesCountMap = new Map<string, number>();
        const teamGameDaysMap = new Map<string, string[]>();

        if (weekStart && weekEnd) {
          const uniqueTeams = [...new Set(
            dirData.filter(p => playerIds.includes(p.player_id)).map(p => p.team_abbrev).filter((t): t is string => !!t),
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
              teamGameDaysMap.set(abbrev, games.map(g => dayNames[new Date(g.game_date).getDay()]));
            }
          }
        }

        // ── 8. Build enriched roster summary (with season stats + injury) ──
        const userPlayers = dirData.filter(p => playerIds.includes(p.player_id));
        if (userPlayers.length) {
          interface RosterLine { sortOrder: number; line: string; }
          const rosterLines: RosterLine[] = userPlayers.map((p) => {
            const pid = String(p.player_id);
            const isStarter = starterIds.has(pid);
            const isIR = irIds.has(pid);
            const status = isStarter ? "START" : isIR ? "IR" : "BENCH";
            const sortOrder = isStarter ? 0 : isIR ? 2 : 1;

            let line = `${status} ${p.position_code ?? "?"} ${p.full_name} (${p.team_abbrev ?? "?"})`;

            // Season stats
            const ss = statsMap.get(p.player_id);
            if (ss) {
              const isGoalie = (p.position_code === "G");
              if (isGoalie && ss.goalie_gp > 0) {
                line += ` ${ss.goalie_gp}GP ${ss.nhl_wins}W ${ss.nhl_saves}SV ${ss.nhl_goals_against}GA ${ss.nhl_shutouts}SO`;
                if (ss.nhl_save_pct != null) line += ` ${Number(ss.nhl_save_pct).toFixed(3)}SV%`;
              } else if (ss.games_played > 0) {
                line += ` ${ss.games_played}GP ${ss.nhl_goals}G ${ss.nhl_assists}A ${ss.nhl_points}PTS`;
                const ppg = (ss.nhl_points / ss.games_played).toFixed(1);
                line += ` ${ppg}PPG`;
                if (ss.nhl_ppp > 0) line += ` ${ss.nhl_ppp}PPP`;
              }
            }

            // Injury status
            const talent = talentMap.get(p.player_id);
            if (talent?.roster_status && talent.roster_status !== "ACT") {
              line += ` [${talent.roster_status}]`;
            }

            // Weekly schedule
            const gp = teamGamesCountMap.get(p.team_abbrev ?? "");
            const days = teamGameDaysMap.get(p.team_abbrev ?? "");
            if (gp != null) {
              line += ` ${gp}GP/wk`;
              if (days?.length) line += `[${days.join(",")}]`;
            }

            // Weekly projection
            const proj = weeklyProjMap.get(p.player_id);
            if (proj != null) line += ` wkProj:${proj.toFixed(1)}`;

            return { sortOrder, line };
          });

          rosterLines.sort((a, b) => a.sortOrder - b.sortOrder);
          ctx.rosterSummary = rosterLines.map(r => r.line).join("\n");
        }

        // ── 9. Current matchup + opponent roster summary ───────────
        if (currentMatchup) {
          const isTeam1 = currentMatchup.team1_id === team.id;
          const userScore = isTeam1 ? currentMatchup.team1_score : currentMatchup.team2_score;
          const oppScore = isTeam1 ? currentMatchup.team2_score : currentMatchup.team1_score;

          let matchupLines = [
            `Week ${currentMatchup.week_number} (${currentMatchup.status})`,
            `${team.team_name}: ${userScore} pts`,
            `${opponentName}: ${oppScore} pts`,
          ];

          // Opponent's roster
          if (opponentPlayerIds.length > 0) {
            const oppPlayers = dirData.filter(p => opponentPlayerIds.includes(p.player_id));
            if (oppPlayers.length > 0) {
              matchupLines.push(`\nOpponent Roster (${opponentName}):`);
              oppPlayers.forEach(p => {
                const ss = statsMap.get(p.player_id);
                let line = `  ${p.position_code ?? "?"} ${p.full_name} (${p.team_abbrev ?? "?"})`;
                if (ss) {
                  const isGoalie = (p.position_code === "G");
                  if (isGoalie && ss.goalie_gp > 0) {
                    line += ` ${ss.goalie_gp}GP ${ss.nhl_wins}W`;
                    if (ss.nhl_save_pct != null) line += ` ${Number(ss.nhl_save_pct).toFixed(3)}SV%`;
                  } else if (ss.games_played > 0) {
                    line += ` ${ss.games_played}GP ${ss.nhl_points}PTS ${(ss.nhl_points / ss.games_played).toFixed(1)}PPG`;
                  }
                }
                matchupLines.push(line);
              });
            }
          }

          ctx.matchupSummary = matchupLines.join("\n");
        }

        // ── 10. League standings ──────────────────────────────────
        if (allMatchupsData.length > 0 && allTeams.length > 0) {
          const teamStandings: Record<string, { w: number; l: number; pf: number; pa: number }> = {};
          allTeams.forEach(t => { teamStandings[t.id] = { w: 0, l: 0, pf: 0, pa: 0 }; });

          for (const m of allMatchupsData) {
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

          // Sort by wins desc, then PF desc
          const ranked = allTeams
            .map(t => ({ name: t.team_name, id: t.id, ...teamStandings[t.id] }))
            .sort((a, b) => b.w - a.w || b.pf - a.pf);

          const standingsLines = ranked.map((t, i) => {
            const marker = t.id === team.id ? " ← YOU" : t.id === opponentTeamId ? " ← OPP" : "";
            return `${i + 1}. ${t.name} ${t.w}-${t.l} (PF:${t.pf.toFixed(1)} PA:${t.pa.toFixed(1)})${marker}`;
          });
          ctx.standingsSummary = standingsLines.join("\n");
        }

        // ── 11. Top free agents ──────────────────────────────────
        type RosProjectionRow = {
          player_id: number;
          player_name: string;
          position: string | null;
          team_abbrev: string | null;
          total_projected_points: number;
          avg_points_per_game: number;
          games_remaining: number;
        };

        if (rosProjectionsData.length > 0) {
          const freeAgents = (rosProjectionsData as RosProjectionRow[])
            .filter((p: RosProjectionRow) => !allRosteredIds.has(p.player_id))
            .slice(0, 8);  // Top 8 unrostered

          if (freeAgents.length > 0) {
            const faLines = freeAgents.map((p: RosProjectionRow) =>
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
}

export const StormyService = new StormyServiceImpl();

/** Re-export static method for direct import. */
export const fetchLeagueContext = StormyServiceImpl.fetchLeagueContext;
