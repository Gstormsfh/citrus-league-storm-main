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
}

export const StormyService = new StormyServiceImpl();

/** Re-export static method for direct import. */
export const fetchLeagueContext = StormyServiceImpl.fetchLeagueContext;
