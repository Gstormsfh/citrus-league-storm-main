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

      // When edge function returns non-2xx, supabase sets error but data
      // may still contain the JSON body with a user-friendly message.
      if (error) {
        if (data?.error) {
          return { response: "", error: data.error };
        }
        throw new Error(error.message || "Failed to reach Stormy");
      }

      if (data?.error) {
        return { response: "", error: data.error };
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
   * Lightweight fetch of league context for Stormy.
   * Gathers weekly view (schedule maximizer, weekly projections, lineup
   * status) plus matchup data in a handful of small Supabase queries.
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

      // ── 2. League → current matchup week dates ───────────────────
      const { data: leagueRow } = await supabase
        .from("leagues")
        .select("updated_at, draft_status, scoring_settings")
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

      // ── 3. Roster player IDs (roster_assignments — source of truth) ─
      const { data: rosterRows } = await supabase
        .from("roster_assignments")
        .select("player_id")
        .eq("league_id", leagueId)
        .eq("team_id", team.id);

      const playerIds = (rosterRows ?? [])
        .map((p: { player_id: string }) => {
          const n = parseInt(String(p.player_id));
          return isNaN(n) ? null : n;
        })
        .filter((id): id is number => id !== null && id > 0);

      if (playerIds.length > 0) {
        // ── 4. Player directory + lineup status (parallel) ─────────
        type DirRow = {
          player_id: number;
          full_name: string;
          position_code: string | null;
          team_abbrev: string | null;
        };
        const [dirResult, lineupResult] = await Promise.all([
          supabase
            .from("player_directory")
            .select("player_id, full_name, position_code, team_abbrev")
            .in("player_id", playerIds)
            .eq("season", 2025),
          supabase
            .from("team_lineups")
            .select("starters, bench, ir")
            .eq("team_id", team.id)
            .eq("league_id", leagueId)
            .maybeSingle(),
        ]);

        const players = (dirResult.data ?? []) as DirRow[];
        const lineup = lineupResult.data;

        const starterIds = new Set(
          ((lineup?.starters as string[]) ?? []).map(String),
        );
        const irIds = new Set(
          ((lineup?.ir as string[]) ?? []).map(String),
        );

        // ── 5. Weekly projections + schedule (parallel, optional) ──
        let weeklyProjMap = new Map<number, number>();
        const teamGamesCountMap = new Map<string, number>();
        const teamGameDaysMap = new Map<string, string[]>();

        if (weekStart && weekEnd) {
          const uniqueTeams = [
            ...new Set(
              players
                .map((p) => p.team_abbrev)
                .filter((t): t is string => !!t),
            ),
          ];

          const [projResult, gamesResult] = await Promise.allSettled([
            getWeeklyProjections(playerIds, weekStart, weekEnd),
            fetchGamesForTeams(uniqueTeams, weekStart, weekEnd),
          ]);

          if (projResult.status === "fulfilled") {
            weeklyProjMap = projResult.value;
          }
          if (gamesResult.status === "fulfilled") {
            const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            for (const [abbrev, games] of gamesResult.value) {
              teamGamesCountMap.set(abbrev, games.length);
              teamGameDaysMap.set(
                abbrev,
                games.map((g) => dayNames[new Date(g.game_date).getDay()]),
              );
            }
          }
        }

        // ── 6. Build enriched roster summary ──────────────────────
        if (players.length) {
          interface RosterLine {
            sortOrder: number;
            line: string;
          }
          const rosterLines: RosterLine[] = players.map((p) => {
            const pid = String(p.player_id);
            const isStarter = starterIds.has(pid);
            const isIR = irIds.has(pid);
            const status = isStarter ? "START" : isIR ? "IR" : "BENCH";
            const sortOrder = isStarter ? 0 : isIR ? 2 : 1;

            let line = `${status} ${p.position_code ?? "?"} ${p.full_name} (${p.team_abbrev ?? "?"})`;

            const gp = teamGamesCountMap.get(p.team_abbrev ?? "");
            const days = teamGameDaysMap.get(p.team_abbrev ?? "");
            if (gp != null) {
              line += ` ${gp}GP`;
              if (days?.length) line += `[${days.join(",")}]`;
            }

            const proj = weeklyProjMap.get(p.player_id);
            if (proj != null) line += ` proj ${proj.toFixed(1)}`;

            return { sortOrder, line };
          });

          rosterLines.sort((a, b) => a.sortOrder - b.sortOrder);
          ctx.rosterSummary = rosterLines.map((r) => r.line).join("\n");
        }
      }

      // ── 7. Current matchup ─────────────────────────────────────
      const { data: matchups } = await supabase
        .from("matchups")
        .select(
          "week_number, team1_id, team2_id, team1_score, team2_score, status",
        )
        .eq("league_id", leagueId)
        .or(`team1_id.eq.${team.id},team2_id.eq.${team.id}`)
        .order("week_number", { ascending: false })
        .limit(1);

      if (matchups?.length) {
        const m = matchups[0];
        const isTeam1 = m.team1_id === team.id;
        const opponentId = isTeam1 ? m.team2_id : m.team1_id;

        let opponentName = "Bye";
        if (opponentId) {
          const { data: opp } = await supabase
            .from("teams")
            .select("team_name")
            .eq("id", opponentId)
            .maybeSingle();
          if (opp) opponentName = opp.team_name;
        }

        ctx.matchupSummary = StormyServiceImpl.summarizeMatchup({
          userTeam: team.team_name,
          userScore: isTeam1 ? m.team1_score : m.team2_score,
          opponentTeam: opponentName,
          opponentScore: isTeam1 ? m.team2_score : m.team1_score,
          weekNumber: m.week_number,
          status: m.status,
        });
      }

      // ── 8. Week summary (extra) ────────────────────────────────
      if (weekLabel) {
        const parts = [`Current: ${weekLabel}`];
        if (totalWeeks > 0) {
          parts.push(
            `Regular season: ${totalWeeks} weeks (${currentWeek > totalWeeks ? "playoffs" : `week ${currentWeek} of ${totalWeeks}`})`,
          );
        }
        ctx.extra = parts.join("\n");
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
