/**
 * StormyService — Client-side service for Citrus Stormy AI assistant.
 *
 * Gathers league / roster / matchup context, sends it to the
 * Supabase edge function (which proxies the Claude API), and
 * returns the AI response with usage tracking.
 */

import { supabase } from "@/integrations/supabase/client";

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

      if (error) {
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
   * Runs a handful of small Supabase queries to populate roster,
   * matchup, and team context without pulling the full player dataset.
   */
  static async fetchLeagueContext(
    leagueId: string,
    userId: string,
  ): Promise<Partial<StormyContext>> {
    const ctx: Partial<StormyContext> = {};

    try {
      // 1. Get user's team
      const { data: team } = await supabase
        .from("teams")
        .select("id, team_name")
        .eq("league_id", leagueId)
        .eq("owner_id", userId)
        .maybeSingle();

      if (!team) return ctx;
      ctx.teamName = team.team_name;

      // 2. Get roster player IDs from draft picks
      const { data: picks } = await supabase
        .from("draft_picks")
        .select("player_id")
        .eq("league_id", leagueId)
        .eq("team_id", team.id)
        .is("deleted_at", null);

      const playerIds = (picks ?? [])
        .map((p: { player_id: string }) => {
          const n = parseInt(String(p.player_id));
          return isNaN(n) ? null : n;
        })
        .filter((id): id is number => id !== null && id > 0);

      if (playerIds.length > 0) {
        // 3. Get player directory info (names, positions, teams)
        const { data: players } = await supabase
          .from("player_directory")
          .select("player_id, full_name, position_code, team_abbrev")
          .in("player_id", playerIds)
          .eq("season", 2025);

        // 4. Try to get today's projections (non-critical)
        const today = new Date().toISOString().split("T")[0];
        let projMap = new Map<number, number>();
        try {
          const { data: projections } = await supabase.rpc(
            "get_daily_projections",
            { p_player_ids: playerIds, p_target_date: today },
          );
          if (projections) {
            for (const p of projections) {
              if (p.player_id && p.total_projected_points != null) {
                projMap.set(Number(p.player_id), p.total_projected_points);
              }
            }
          }
        } catch {
          // Projections are optional — no-op
        }

        if (players?.length) {
          ctx.rosterSummary = StormyServiceImpl.summarizeRoster(
            players.map((p: { player_id: number; full_name: string; position_code: string | null; team_abbrev: string | null }) => ({
              name: p.full_name,
              position: p.position_code ?? "?",
              team: p.team_abbrev ?? "?",
              projectedPoints: projMap.get(p.player_id),
            })),
          );
        }
      }

      // 5. Get current/latest matchup
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
    } catch {
      // Context fetch is non-critical — Stormy still works without it
    }

    return ctx;
  }
}

export const StormyService = new StormyServiceImpl();

/** Re-export static method for direct import. */
export const fetchLeagueContext = StormyServiceImpl.fetchLeagueContext;
