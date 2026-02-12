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
  // Track guest usage client-side (edge function handles auth users)
  private guestMessageCount = 0;
  private static readonly GUEST_LIMIT = 5;

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
              "Sign in to keep chatting with Stormy! Guest users get 5 messages per session.",
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
}

export const StormyService = new StormyServiceImpl();
