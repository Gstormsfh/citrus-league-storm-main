/**
 * StormyService — Client-side service for Citrus Stormy AI assistant.
 *
 * Gathers league / roster / matchup context via API server (3-tier),
 * sends it to POST /api/stormy/chat (which owns the Claude call, the
 * spend guards and the RULE 0 verified-player lookup), and returns the
 * AI response with usage tracking.
 *
 * Chunk 11g.9 (2026-08-24): repointed off `supabase.functions.invoke
 * ("stormy-chat")`. Stormy is server-side now — there is no edge
 * function behind this any more.
 */

import { userMessage } from '@/lib/userMessage';
import { supabase } from "@/integrations/supabase/client";
import { apiClient, ApiError } from "@/api/client";
import {
  getFirstWeekStartDate,
  getCurrentWeekNumber,
  getWeekStartDate,
  getWeekEndDate,
  getWeekLabel,
  getScheduleLength,
  clampToSeasonStart,
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

// ── Context-line tokens ─────────────────────────────────────────
//
// Everything the methods below build is model input. Two rules apply to
// every token:
//
//   1. The separator is a space, the label is `name:value`, and nothing
//      carries an em dash. aiVoiceGuard.test.ts scans this file, and a
//      model mirrors the punctuation of its context.
//   2. A token is written only when the number behind it is real. A
//      missing token tells the model the figure does not exist for that
//      player; a zero would read as a measurement.
//
// The prompt (server/src/lib/stormy/systemPrompt.ts, "What Data You
// Have") documents each token by its literal shape and the prompt test
// pins those shapes, so change both or neither.

/** goalie_gsax_primary: the regressed value plus the sample behind it. */
interface GsaxSampleRow {
  goalie_id: number;
  regressed_gsax: number | null;
  total_shots_faced: number | null;
  total_xga: number | null;
  total_ga: number | null;
}

/** player_ros_projections as /api/players/ros-projections returns it. */
interface RosProjectionRow {
  player_id: number;
  player_name: string;
  position: string | null;
  team_abbrev: string | null;
  total_projected_points: number;
  avg_points_per_game: number;
  games_remaining: number;
}

/** `+8.6` / `-4.8`: a signed number the way the GSAx token always was. */
const signed = (n: number, digits = 1): string => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;

// ── Service ──────────────────────────────────────────────────────

class StormyServiceImpl {

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
        // GUEST (2026-09-04 TestFlight audit). This used to let the FIRST
        // guest message through to the API and only refuse the second. That
        // first one could never have worked: the route sits behind
        // authMiddleware (server/src/routes/stormy.ts:76), so a request
        // carrying no bearer token comes back 401, and the ApiError branch
        // below hands the SERVER's own wording straight to the chat bubble
        // as Stormy's reply. StormyChatBubble is mounted at the App root
        // (App.tsx:291) with no auth gate, so the pulsing mascot button is
        // on the landing and sign-in screens: the very first thing a
        // signed-out tester could get out of Stormy was the raw
        // authorization-header complaint.
        //
        // There is no guest tier behind this to fall back to, so answer in
        // Stormy's own voice and stop here. The count is 15, the server's
        // WEEKLY_MESSAGE_LIMIT (services/StormyAssistantService.ts); the
        // copy said 3, which was never any limit the server enforced.
        return {
          response: "",
          error:
            "Want more from Stormy? Sign up for a free account to get 15 questions per matchup week!",
        };
      }

      const contextString = context
        ? StormyServiceImpl.buildContextString(context)
        : "";

      // Server route owns the Claude call, the three spend guards and
      // the RULE 0 verified-player lookup. Rate-limit rejections come
      // back as HTTP 429 with a user-facing message, so surface that
      // message rather than a generic failure — the copy ("you've used
      // your N questions this week") IS the product behaviour.
      let envelope: { data?: { response?: string; usage?: unknown } };
      try {
        envelope = await apiClient.post(
          "/api/stormy/chat",
          {
            message,
            conversationHistory: history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            context: contextString,
          },
          // TIMEOUT AND RETRIES (2026-09-04 TestFlight audit). apiClient
          // defaults to a 15s timeout (api/client.ts:54) and retries an
          // AbortError twice with backoff (client.ts:266-283). The server
          // allows Claude 60s (routes/stormy.ts:99) for up to 1536 output
          // tokens (MAX_RESPONSE_TOKENS), so a full-length answer outlives
          // the client's own patience. Every time it did, the client fired
          // the SAME question two more times: three Claude calls billed,
          // three stormy_chat_log rows, three of the user's 15 weekly
          // questions spent on one ask, roughly 48s of "Stormy is
          // thinking", and a failure message at the end of it. Wait past
          // the server's ceiling instead, and never re-ask.
          { timeoutMs: 70_000, retries: 0 },
        );
      } catch (err) {
        if (err instanceof ApiError) {
          const serverMessage =
            (err.data as { error?: { message?: string } } | undefined)?.error?.message ??
            err.message;
          return { response: "", error: serverMessage };
        }
        throw err;
      }

      return {
        response: envelope?.data?.response ?? "",
        usage: envelope?.data?.usage as StormyResponse["usage"],
      };
    } catch (err: unknown) {
      const msg =
        userMessage(err, "Stormy could not answer that one. Try again in a moment.");
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

  // ── Token helpers (pure, so the shapes can be pinned by a test) ──
  //
  // ADDED 2026-09-03 (voice rewrite 2). The founder: "he needs to be more
  // organic like an assistant GM would, backed with stats." An assistant
  // GM argues from comparisons, and the context carried the rate (xG/60)
  // but not the pair it comes from (goals against expected), the ice
  // time behind it, the ROS number for a rostered player (only free
  // agents had one), or the sample behind a goalie's GSAx. Every field
  // below was already on an object this method held; none of this adds
  // a request.

  /** ` xG:21.4 G-xG:+8.6`, or nothing when Citrus has no xG for him. */
  static xgPair(goals: number, xGoals: number | null | undefined): string {
    if (xGoals == null || !(xGoals > 0)) return '';
    return ` xG:${xGoals.toFixed(1)} G-xG:${signed(goals - xGoals)}`;
  }

  /** ` TOI/GP:18.4`, minutes a night from NHL.com ice time. */
  static toiPerGame(icetimeSeconds: number | null | undefined, gamesPlayed: number): string {
    if (!icetimeSeconds || !(icetimeSeconds > 0) || !(gamesPlayed > 0)) return '';
    return ` TOI/GP:${(icetimeSeconds / 60 / gamesPlayed).toFixed(1)}`;
  }

  /**
   * ` GSAx:+8.2[primary shots:1204 xGA:92.4 GA:84]`. The bracket is the
   * sample the regressed number was shrunk from, and it is written only
   * when the row carries all three parts; a bare ` GSAx:+8.2` otherwise,
   * which is the shape this file always wrote.
   */
  static gsaxToken(row: GsaxSampleRow | undefined): string {
    if (!row || row.regressed_gsax == null) return '';
    let token = ` GSAx:${signed(Number(row.regressed_gsax))}`;
    if (row.total_shots_faced != null && row.total_xga != null && row.total_ga != null) {
      token += `[primary shots:${row.total_shots_faced} xGA:${Number(row.total_xga).toFixed(1)} GA:${row.total_ga}]`;
    }
    return token;
  }

  /** ` ROS:412.5pts 61GR`, the same shape the free-agent list uses. */
  static rosToken(row: RosProjectionRow | undefined): string {
    if (!row || row.total_projected_points == null) return '';
    return ` ROS:${Number(row.total_projected_points).toFixed(1)}pts ${row.games_remaining}GR`;
  }

  /** `Gap: you lead by 15.0`, or null until both sides have a score. */
  static scoreGapLine(
    userScore: number | null | undefined,
    oppScore: number | null | undefined,
  ): string | null {
    if (userScore == null || oppScore == null) return null;
    const gap = Number(userScore) - Number(oppScore);
    if (!Number.isFinite(gap)) return null;
    if (gap === 0) return 'Gap: level';
    return gap > 0 ? `Gap: you lead by ${gap.toFixed(1)}` : `Gap: you trail by ${(-gap).toFixed(1)}`;
  }

  /**
   * `Projected this week: your starters 84.2, your bench 22.1, their whole
   * roster 91.0 (their lineup is not visible)`. The opponent's figure is
   * every player they own, because their lineup is never fetched; the
   * label says so in the line itself so the model cannot read it as a
   * lineup total.
   */
  static weeklyProjectionLine(starters: number, bench: number, opponent: number | null): string {
    let line = `Projected this week: your starters ${starters.toFixed(1)}, your bench ${bench.toFixed(1)}`;
    if (opponent != null) line += `, their whole roster ${opponent.toFixed(1)} (their lineup is not visible)`;
    return line;
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
        const firstWeekStart = clampToSeasonStart(getFirstWeekStartDate(draftDate)); // WEEK-MATH FIX 2026-08-22: align with schedule generation
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

        // ── Advanced metrics: xG/60 + xG rating (skaters), GSAx (goalies) ─
        // These exist in the DB but were never flowing to Stormy. Querying
        // them in parallel with the main player fetch keeps the latency cost
        // close to zero. Best-effort — failures here don't block context.
         
        const sb = supabase as unknown as any;
        const talentPromise = (async () => {
          try {
            const { data } = await sb
              .from('player_talent_metrics')
              .select('player_id, xg_per_60, xg_rating')
              .in('player_id', allNeededPlayerIds);
            return (data ?? []) as Array<{ player_id: number; xg_per_60: number | null; xg_rating: string | null }>;
          } catch { return []; }
        })();
        const gsaxPromise = (async () => {
          try {
            // The sample columns ride on the same request: xGA against GA is
            // the expected-versus-actual pair for a goalie, and the regressed
            // number alone hides how much shrinkage is in it.
            const { data } = await sb
              .from('goalie_gsax_primary')
              .select('goalie_id, regressed_gsax, total_shots_faced, total_xga, total_ga')
              .in('goalie_id', allNeededPlayerIds);
            return (data ?? []) as GsaxSampleRow[];
          } catch { return []; }
        })();

        const [playersData, lineupResult, rosProjectionsResult, talentRows, gsaxRows] = await Promise.allSettled([
          PlayerService.getPlayersByIds(allNeededPlayerIds.map(String)),
          rosterApi.getLineup(leagueId, team.id),
          playerApi.getRosProjections(200),
          talentPromise,
          gsaxPromise,
        ]);

        // Build player lookup maps
        const playerMap = new Map(
          (playersData.status === 'fulfilled' ? playersData.value : []).map(p => [Number(p.id), p])
        );
        const talentByPid = new Map<number, { xg_per_60: number | null; xg_rating: string | null }>();
        if (talentRows.status === 'fulfilled') {
          for (const r of talentRows.value) talentByPid.set(r.player_id, { xg_per_60: r.xg_per_60, xg_rating: r.xg_rating });
        }
        const gsaxByPid = new Map<number, GsaxSampleRow>();
        if (gsaxRows.status === 'fulfilled') {
          for (const r of gsaxRows.value) {
            if (r.regressed_gsax != null) gsaxByPid.set(r.goalie_id, r);
          }
        }

        // ROS projections, keyed by player. The same rows feed the free-agent
        // list in step 11; keyed here as well so a roster line carries its
        // own ROS number and Stormy can put a free agent's ROS next to the
        // ROS of the player he would replace. Same request as before.
        const rosProjectionsData = rosProjectionsResult.status === 'fulfilled'
          ? (rosProjectionsResult.value.data ?? []) as RosProjectionRow[]
          : [];
        const rosByPid = new Map<number, RosProjectionRow>();
        for (const r of rosProjectionsData) rosByPid.set(r.player_id, r);

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
          // Both sides of the matchup, in the same two requests. Stormy is
          // asked "how is my week looking" and the answer is a projection
          // against the opponent's, so the opponent's players and teams go
          // in the same id list rather than a second round trip.
          const uniqueTeams = [...new Set(
            allNeededPlayerIds.map(pid => playerMap.get(pid)?.team).filter((t): t is string => !!t),
          )];

          const [projResult, gamesResult] = await Promise.allSettled([
            getWeeklyProjections(allNeededPlayerIds, weekStart, weekEnd),
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
              // GSAx (regressed goals saved above expected), Bayesian-shrunk
              // measure of true goaltending value against an average NHL
              // goalie, with the primary-shot sample it was shrunk from.
              line += StormyServiceImpl.gsaxToken(gsaxByPid.get(Number(p.id)));
            } else if (p.games_played > 0) {
              line += ` ${p.games_played}GP ${p.goals}G ${p.assists}A ${p.points}PTS`;
              const ppg = (p.points / p.games_played).toFixed(1);
              line += ` ${ppg}PPG`;
              if ((p.ppp || 0) > 0) line += ` ${p.ppp}PPP`;
              if ((p.shp || 0) > 0) line += ` ${p.shp}SHP`;
              line += ` ${p.shots}SOG ${p.hits}HIT ${p.blocks}BLK ${p.pim}PIM`;
              // Goals against Citrus expected goals, and minutes a night. The
              // pair is what "running hot" and "due" are measured from; the
              // rate below is the same xG divided by this ice time.
              line += StormyServiceImpl.xgPair(p.goals, p.xGoals);
              line += StormyServiceImpl.toiPerGame(p.icetime_seconds, p.games_played);
              // xG/60 + tier rating, the shot-quality signal. A 0.95 PPG player
              // with xG/60 of 1.4 (Elite) is hot but sustainable; a 1.1 PPG
              // player with xG/60 of 0.5 (Below Avg) is regression-prone.
              const t = talentByPid.get(Number(p.id));
              if (t?.xg_per_60 != null) {
                line += ` xG/60:${Number(t.xg_per_60).toFixed(2)}`;
                if (t.xg_rating) line += `[${t.xg_rating}]`;
              }
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

            // Weekly projection, then the ROS projection in the free-agent
            // list's shape so the two can be compared line to line.
            const proj = weeklyProjMap.get(Number(p.id));
            if (proj != null) line += ` wkProj:${proj.toFixed(1)}`;
            line += StormyServiceImpl.rosToken(rosByPid.get(Number(p.id)));

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

          // The gap, precomputed so the model quotes it rather than
          // subtracting, and this week's projection on both sides.
          const gapLine = StormyServiceImpl.scoreGapLine(userScore, oppScore);
          if (gapLine) matchupLines.push(gapLine);
          if (weeklyProjMap.size > 0) {
            let starters = 0;
            let bench = 0;
            let opponent = 0;
            let opponentHasProjection = false;
            for (const pid of playerIds) {
              const proj = weeklyProjMap.get(pid);
              if (proj == null) continue;
              const key = String(pid);
              if (starterIds.has(key)) starters += proj;
              else if (!irIds.has(key)) bench += proj;
            }
            for (const pid of opponentPlayerIds) {
              const proj = weeklyProjMap.get(pid);
              if (proj == null) continue;
              opponent += proj;
              opponentHasProjection = true;
            }
            matchupLines.push(
              StormyServiceImpl.weeklyProjectionLine(starters, bench, opponentHasProjection ? opponent : null),
            );
          }

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
                  line += StormyServiceImpl.gsaxToken(gsaxByPid.get(Number(p.id)));
                } else if (p.games_played > 0) {
                  line += ` ${p.games_played}GP ${p.goals}G ${p.points}PTS ${(p.points / p.games_played).toFixed(1)}PPG`;
                  line += StormyServiceImpl.xgPair(p.goals, p.xGoals);
                  const t = talentByPid.get(Number(p.id));
                  if (t?.xg_per_60 != null) {
                    line += ` xG/60:${Number(t.xg_per_60).toFixed(2)}`;
                    if (t.xg_rating) line += `[${t.xg_rating}]`;
                  }
                }
                // The same injury, schedule and projection tokens as his own
                // lines carry, so a start/sit can be argued against the man
                // across the ice and not just against the bench.
                if (p.roster_status && p.roster_status !== "ACT") line += ` [${p.roster_status}]`;
                const oppGames = teamGamesCountMap.get(p.team ?? "");
                if (oppGames != null) line += ` ${oppGames}GP/wk`;
                const oppProj = weeklyProjMap.get(Number(p.id));
                if (oppProj != null) line += ` wkProj:${oppProj.toFixed(1)}`;
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
        // rosProjectionsData was parsed next to the player maps above.
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
    // player_directory's columns are position_code and team_abbrev. It has no
    // `position` and no `status`; this type asked for both from 2026-04-18
    // until 2026-09-03, PostgREST rejected the select, allSettled swallowed
    // it, and Stormy saw zero players from this lookup for five months.
    // Roster status lives on player_talent_metrics.roster_status (NULL on
    // every row today; see docs/data/PIPELINE_INVENTORY_2026-09-03.md 3A).
    type PlayerDirRow = {
      player_id: number;
      full_name: string;
      position_code: string | null;
      team_abbrev: string | null;
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
      // Tightness annotation per series — Stormy uses this to flag risk in
      // bracket/confidence picks and to weight team longevity in roster pools.
      const seriesTightness = (s: SeriesRow): { label: string; alive: boolean; needed: number } => {
        const hi = s.high_seed_wins ?? 0;
        const lo = s.low_seed_wins ?? 0;
        const total = hi + lo;
        if (s.series_status === 'completed') {
          return { label: 'final', alive: false, needed: 0 };
        }
        const gap = Math.abs(hi - lo);
        const leader = hi > lo ? 'high' : lo > hi ? 'low' : 'tied';
        const needed = 4 - Math.max(hi, lo); // wins still needed by leader to clinch
        if (total === 0) return { label: 'not started', alive: true, needed };
        if (gap >= 3) return { label: `dominant ${hi}-${lo}`, alive: true, needed };
        if (gap === 2) return { label: `${leader === 'tied' ? '' : leader + ' '}leading ${hi}-${lo}`.trim(), alive: true, needed };
        // gap is 0 or 1 — tight
        return { label: `TIGHT ${hi}-${lo}`, alive: true, needed };
      };
      const tightnessBySlot = new Map<number, ReturnType<typeof seriesTightness>>();
      for (const s of series) tightnessBySlot.set(s.bracket_slot, seriesTightness(s));

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
            sb.from('player_directory').select('player_id, full_name, position_code, team_abbrev').in('player_id', playerIds),
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
          // Track per-position counts + cumulative scoring inputs for the
          // roster summary. Stormy uses these to flag underweight positions
          // and frame "are you on track?" type questions with real numbers.
          const slotCounts: Record<string, number> = {};
          let totalGP = 0;
          let totalGoals = 0;
          let totalAssists = 0;
          let totalPoints = 0;
          let aliveCount = 0;
          let eliminatedCount = 0;

          for (const pick of picks) {
            const p = playerById.get(pick.player_id);
            if (!p) continue;
            const s = statsById.get(pick.player_id);
            const teamAbbrev = p.team_abbrev ?? '?';
            // No status column on player_directory; roster_status is on
            // player_talent_metrics and is NULL on every row until the nightly
            // rebuild stops deleting it. Print nothing rather than a guess.
            const status = '';
            const isElim = eliminated.has(teamAbbrev);
            const teamState = isElim ? ' ⚠️ELIMINATED' : (teamAbbrevAlive.has(teamAbbrev) ? ' ✓ALIVE' : '');
            if (isElim) eliminatedCount++;
            else if (teamAbbrevAlive.has(teamAbbrev)) aliveCount++;
            slotCounts[pick.position_slot] = (slotCounts[pick.position_slot] ?? 0) + 1;

            // SEPARATOR IS `|`, NOT AN EM DASH (2026-09-02 voice pass).
            // Everything this method builds is model input. A model mirrors
            // the punctuation of its context, so 40 lines of
            // `Name (TOR, C) - 12GP 8PTS` written with em dashes teaches
            // Stormy to answer in em dashes, and the system prompt then has
            // to argue with its own context window. The prompt bans the
            // character outright (see server/src/lib/stormy/systemPrompt.ts
            // section 2); the context has to hold up its end.
            let line = `${pick.position_slot} ${p.full_name} (${teamAbbrev})${status}${teamState}`;
            if (s) {
              if (s.is_goalie) {
                line += ` | ${s.games_played ?? 0}GP ${s.wins ?? 0}W ${s.saves ?? 0}SV ${s.shutouts ?? 0}SO ${s.goals_against ?? 0}GA`;
              } else if ((s.games_played ?? 0) > 0) {
                line += ` | ${s.games_played}GP ${s.goals ?? 0}G ${s.assists ?? 0}A ${s.points ?? 0}PTS`;
                const ppg = ((s.points ?? 0) / s.games_played).toFixed(2);
                line += ` (${ppg}PPG) ${s.shots ?? 0}SOG ${s.hits ?? 0}HIT ${s.blocks ?? 0}BLK`;
                if ((s.ppp ?? 0) > 0) line += ` ${s.ppp}PPP`;
                totalGP += s.games_played ?? 0;
                totalGoals += s.goals ?? 0;
                totalAssists += s.assists ?? 0;
                totalPoints += s.points ?? 0;
              } else {
                line += ` | 0GP (has not played yet)`;
              }
            } else {
              line += ` | no playoff stats yet`;
            }
            rosterLines.push(line);
          }

          // Per-position balance + roster totals header
          const balanceParts = Object.entries(slotCounts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([slot, n]) => `${n}${slot}`);
          const balance = balanceParts.join('/');
          const headerStats = `${picks.length} players (${balance}) · ${aliveCount} alive · ${eliminatedCount} eliminated · totals so far: ${totalPoints}PTS (${totalGoals}G ${totalAssists}A across ${totalGP} skater GP)`;

          ctx.rosterSummary = `YOUR PLAYOFF ROSTER | ${headerStats}\n` + rosterLines.join('\n');

          // ── Top unrostered playoff scorers on still-alive teams ─────────
          // Roster pools LOCK the roster at draft time — no add/drops, no
          // waivers. So this list isn't for "swap X for Y" advice (the
          // user can't); it's for context: "here are the top hot scorers
          // you didn't draft, this is the production currently beating you."
          // Useful for "how am I doing" analysis and for next-year draft
          // prep. The system prompt enforces this framing.
          try {
            const { data: topData } = await sb
              .from('player_playoff_stats')
              .select('player_id, games_played, goals, assists, points, ppp, shots, hits, blocks, is_goalie, team_abbrev')
              .gt('games_played', 1)
              .order('points', { ascending: false })
              .limit(80);
            const topRows = (topData ?? []) as Array<PlayoffStatRow & { team_abbrev: string | null }>;

            // Filter: not already rostered, alive team only.
            const ownedIds = new Set(picks.map(pk => pk.player_id));
            const candidates = topRows.filter(r => {
              if (ownedIds.has(r.player_id)) return false;
              const ta = r.team_abbrev ?? '';
              return teamAbbrevAlive.has(ta);
            });
            // Re-rank by PPG (a 4-game player at 1.5 PPG is more interesting
            // than an 8-game player at 0.8 PPG, even if total points look similar).
            const ranked = candidates
              .map(r => ({ row: r, ppg: (r.points ?? 0) / Math.max(1, r.games_played ?? 1) }))
              .sort((a, b) => b.ppg - a.ppg)
              .slice(0, 10);

            if (ranked.length > 0) {
              const namesRes = await sb
                .from('player_directory')
                .select('player_id, full_name, position_code')
                .in('player_id', ranked.map(x => x.row.player_id));
              const dir = (namesRes.data ?? []) as Array<{ player_id: number; full_name: string; position_code: string | null }>;
              const dirById = new Map<number, { full_name: string; position: string | null }>();
              for (const d of dir) dirById.set(d.player_id, { full_name: d.full_name, position: d.position_code });

              const hotLines = ranked.map(({ row, ppg }) => {
                const meta = dirById.get(row.player_id);
                const nm = meta?.full_name ?? `Player ${row.player_id}`;
                const pos = meta?.position ?? '?';
                const ta = row.team_abbrev ?? '?';
                if (row.is_goalie) {
                  return `  ${nm} (${ta}, G) | ${row.games_played}GP ${row.wins ?? 0}W ${row.saves ?? 0}SV ${row.shutouts ?? 0}SO`;
                }
                return `  ${nm} (${ta}, ${pos}) | ${row.games_played}GP ${row.points ?? 0}PTS (${ppg.toFixed(2)}PPG) ${row.shots ?? 0}SOG ${row.hits ?? 0}HIT ${row.blocks ?? 0}BLK`;
              });
              ctx.extra = (ctx.extra ? ctx.extra + '\n\n' : '') +
                `TOP UNROSTERED PLAYOFF SCORERS (alive teams, sorted by PPG, min 2 GP):\n${hotLines.join('\n')}`;
            }
          } catch {
            // Hot-scorers list is best-effort — failure here doesn't block the rest.
          }
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
              line += ` [${correct} | ${p.points_earned ?? 0} pts]`;
            } else if (s) {
              // Active or pending — annotate live tightness so Stormy can flag at-risk picks.
              const t = tightnessBySlot.get(p.series_slot);
              if (t) {
                // If user's pick is currently TRAILING, flag it explicitly.
                const userPickIsHigh = p.picked_team_id === s.high_seed_team_id;
                const hi = s.high_seed_wins ?? 0;
                const lo = s.low_seed_wins ?? 0;
                let riskTag = `[${t.label}]`;
                if (t.label !== 'final' && t.label !== 'not started') {
                  const userTrailing = userPickIsHigh ? hi < lo : lo < hi;
                  if (userTrailing) riskTag = `[⚠️ AT RISK | ${t.label}]`;
                }
                line += ` ${riskTag}`;
              }
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
          // Confidence values are 1..N — N is the count of picks (typically 15).
          // Anything in the top third of the range is "high confidence" and
          // therefore expensive if it busts.
          const highConfThreshold = Math.ceil(picks.length * 0.66);
          const pickLines: string[] = [];
          for (const p of picks) {
            const s = series.find(x => x.bracket_slot === p.series_slot);
            const pickedAbbrev = p.picked_team_id ? teamById.get(p.picked_team_id)?.abbreviation ?? `#${p.picked_team_id}` : 'TBD';
            let line = `  Series ${p.series_slot}: ${pickedAbbrev} @ confidence ${p.confidence_value}`;
            if (p.is_correct === true) {
              line += ` ✓ (${p.points_earned ?? 0} pts)`;
            } else if (p.is_correct === false) {
              line += ` ✗`;
            } else if (s) {
              const t = tightnessBySlot.get(p.series_slot);
              if (t) {
                const userPickIsHigh = p.picked_team_id === s.high_seed_team_id;
                const hi = s.high_seed_wins ?? 0;
                const lo = s.low_seed_wins ?? 0;
                const userTrailing = userPickIsHigh ? hi < lo : lo < hi;
                const isHighConf = p.confidence_value >= highConfThreshold;
                if (t.label !== 'final' && t.label !== 'not started' && userTrailing && isHighConf) {
                  line += ` [🚨 HIGH-CONF AT RISK | ${t.label}]`;
                } else if (t.label.startsWith('TIGHT') && isHighConf) {
                  line += ` [⚠️ HIGH-CONF in tight series | ${t.label}]`;
                } else if (t.label !== 'final' && t.label !== 'not started') {
                  line += ` [${t.label}]`;
                }
              }
            }
            pickLines.push(line);
          }
          ctx.rosterSummary = `YOUR CONFIDENCE PICKS (sorted high→low, total ${picks.length}):\n${pickLines.join('\n')}`;
        } else {
          ctx.rosterSummary = `User has NOT submitted confidence picks yet.`;
        }
      }

      // Pool-mode hint in extra so Stormy responds appropriately
      const mode = leagueType === 'playoff-roster-pool'
        ? 'PLAYOFF ROSTER POOL. User drafted a single locked playoff roster at the start. NO add/drops, NO waivers, NO trades: they keep their drafted roster the entire playoffs. Eliminated players stay on roster but score zero from here. Ask about MY roster, hot playoff performers (as missed-draft context, NOT as pickups), and matchup analysis.'
        : leagueType === 'playoff-bracket-pickem'
        ? 'PLAYOFF BRACKET PICKEM. User picks series winners across all 4 rounds. Winner = most correct picks (with round multipliers).'
        : 'PLAYOFF CONFIDENCE POOL. User assigns confidence values (1-15) to series picks. Winner = highest total from correct picks weighted by confidence.';
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
