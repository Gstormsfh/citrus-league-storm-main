/**
 * Playoff Pool Hub — the homepage for a created playoff pool.
 *
 * Shows:
 *  - League name + format label
 *  - All members who have joined (teams)
 *  - Join code for inviting friends
 *  - Lock deadline countdown
 *  - CTA for each member to go submit their picks/roster
 *  - Commissioner controls (if applicable)
 */

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  Trophy, Users, Clock, Copy, Check, Lock, ChevronRight, Crown, Target,
  Mail, MessageSquare, Link as LinkIcon, Eye, Calendar,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { NHL_TEAMS } from '@/types/captracker';
import { ScoringCalculator, type ScoringSettings } from '@/utils/scoringUtils';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

interface Team {
  id: string;
  team_name: string;
  owner_id: string;
  owner_name?: string;
}

interface League {
  id: string;
  name: string;
  commissioner_id: string;
  join_code: string;
  scoring_settings?: ScoringSettings | null;
  settings: {
    leagueType?: string;
    playoffRosterLockedAt?: string;
    playoffRosterSize?: number;
    playoffBracketPointsPerRound?: Record<string, number>;
    playoffConfidenceVariant?: string;
  };
}

// Roster player with full playoff context — used by the Today's Games /
// Team Breakdown card that replaced the standalone today's-games view.
interface RosterPlayerCtx {
  player_id: number;
  full_name: string;
  position: string;
  team_abbrev: string;
  // Cumulative playoff stats
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  hits: number;
  blocks: number;
  pim: number;
  ppp: number;
  shp: number;
  plus_minus: number;
  wins: number;
  saves: number;
  shutouts: number;
  goals_against: number;
  is_goalie: boolean;
  fpts: number;
}

interface PlayoffGameRow {
  game_id: number;
  game_date: string;
  game_time: string | null;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: string;
  period: string | null;
  period_time: string | null;
  series_game_number: number | null;
}

const POOL_TYPE_LABELS: Record<string, string> = {
  'playoff-bracket-pickem': 'Playoff Bracket Challenge',
  'playoff-confidence-pool': 'Playoff Confidence Pool',
  'playoff-roster-pool': 'Playoff Roster Pool',
};

const POOL_TYPE_ROUTES: Record<string, string> = {
  'playoff-bracket-pickem': '/pool/playoff-bracket',
  'playoff-confidence-pool': '/pool/playoff-confidence',
  'playoff-roster-pool': '/pool/playoff-roster',
};

export default function PoolPlayoffHub() {
  const [params] = useSearchParams();
  const leagueId = params.get('league') || '';
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [userPicks, setUserPicks] = useState<Array<{ series_slot: number; picked_team_id: number; predicted_games?: number; confidence_value?: number; points_earned?: number; is_correct?: boolean | null }>>([]);
  const [bracketSeeds, setBracketSeeds] = useState<Array<{ team_id: number; team_abbrev: string | null; seed: number; conference: string }>>([]);
  const [bracketSeries, setBracketSeries] = useState<Array<{ series_id: string; bracket_slot: number; round: number; series_status: string; winner_team_id: number | null; high_seed_team_id: number | null; low_seed_team_id: number | null }>>([]);

  // Roster context for the Today's Games / Team Breakdown card (roster pools only)
  const [rosterCtx, setRosterCtx] = useState<RosterPlayerCtx[]>([]);
  const [todayGames, setTodayGames] = useState<PlayoffGameRow[]>([]);

  useEffect(() => {
    if (!leagueId) return;
    const load = async () => {
      try {
        const session = (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session;
        const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
        const [leagueRes, teamsRes, bracketRes] = await Promise.all([
          fetch(`/api/leagues/${leagueId}`, { headers }).then(r => r.json()).catch(() => null),
          fetch(`/api/leagues/${leagueId}/teams`, { headers }).then(r => r.json()).catch(() => null),
          fetch('/api/nhl-playoffs/bracket?season=2025').then(r => r.json()).catch(() => null),
        ]);
        const leagueData = leagueRes?.data || leagueRes;
        setLeague(leagueData);
        const teamList = teamsRes?.data?.teams || teamsRes?.teams || teamsRes?.data || [];
        setTeams(Array.isArray(teamList) ? teamList : []);

        // Fetch user's picks based on league type
        const lgType = leagueData?.settings?.leagueType;
        const pickType = lgType === 'playoff-bracket-pickem' ? 'bracket'
                      : lgType === 'playoff-confidence-pool' ? 'confidence'
                      : lgType === 'playoff-roster-pool' ? 'roster' : null;
        if (pickType && session?.access_token) {
          const picksRes = await fetch(`/api/playoff-pools/${leagueId}/picks?type=${pickType}`, { headers }).then(r => r.json()).catch(() => null);
          const rawPicks = picksRes?.data?.picks || picksRes?.picks || [];
          const myPicks = Array.isArray(rawPicks) ? rawPicks.filter((p: { user_id: string }) => p.user_id === session.user?.id) : [];
          setUserPicks(myPicks);
        }

        // Parse bracket data for team/series lookups
        const br = bracketRes?.data || bracketRes;
        if (br) {
          setBracketSeeds(br.seeds || []);
          setBracketSeries(br.series || []);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [leagueId]);

  // Load the current user's roster + playoff stats + today's games.
  // Only runs for roster pools where this data is meaningful. Refreshes
  // on a 60s interval so live scores + stats tick forward without a reload.
  useEffect(() => {
    if (!leagueId || !user?.id) return;
    const lgType = league?.settings?.leagueType;
    // Need SOMETHING playoff-specific to load
    if (lgType !== 'playoff-roster-pool' && lgType !== 'playoff-bracket-pickem' && lgType !== 'playoff-confidence-pool') return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const isRosterPool = lgType === 'playoff-roster-pool';

    const load = async () => {
      try {
        // 1. My roster picks (roster pools only) — use the same REST endpoint
        // the Roster page uses (proven to work). Direct supabase.from() was
        // returning empty because the picks RLS path is different per session.
        let playerIds: number[] = [];
        if (isRosterPool) {
          try {
            const session = (await supabase.auth.getSession()).data.session;
            const headers: Record<string, string> = session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {};
            const picksRes = await fetch(`/api/playoff-pools/${leagueId}/picks?type=roster`, { headers })
              .then(r => r.json())
              .catch(() => null);
            const rawPicks = picksRes?.data?.picks || picksRes?.picks || [];
            const myPicks = Array.isArray(rawPicks)
              ? rawPicks.filter((p: { user_id: string }) => p.user_id === user.id)
              : [];
            playerIds = myPicks.map((p: { player_id: number }) => p.player_id).filter(Boolean);
          } catch (err) {
            logger.warn('[Hub] picks fetch failed', err);
          }
        }

        // 2. Today's playoff games (always fetch)
        const today = new Date().toISOString().slice(0, 10);
        const gamesRes = await sb
          .from('nhl_games')
          .select('game_id, game_date, game_time, home_team, away_team, home_score, away_score, status, period, period_time, series_game_number')
          .eq('game_date', today)
          .eq('game_type', 'playoff')
          .order('game_time');
        setTodayGames((gamesRes.data ?? []) as PlayoffGameRow[]);

        if (playerIds.length === 0) {
          setRosterCtx([]);
          return;
        }

        // 3. Fetch players via REST (same as Roster page — PROVEN to work)
        //    and playoff stats via direct supabase (public read access).
        const session = (await supabase.auth.getSession()).data.session;
        const restHeaders: Record<string, string> = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        const [playersRes, statsRes] = await Promise.all([
          fetch('/api/players?limit=1000', { headers: restHeaders })
            .then(r => r.json())
            .catch((): { data?: unknown } => ({ data: [] })),
          sb.from('player_playoff_stats').select('*').in('player_id', playerIds),
        ]);

        if (statsRes.error) logger.warn('[Hub] player_playoff_stats fetch error', statsRes.error);

        const playerArr: Array<{ id: string | number; full_name: string; position: string; team: string }> =
          Array.isArray(playersRes.data) ? playersRes.data
          : Array.isArray(playersRes) ? playersRes : [];
        const pickedPlayers = playerArr
          .filter(p => playerIds.includes(typeof p.id === 'string' ? parseInt(p.id) : p.id))
          .map(p => ({
            player_id: typeof p.id === 'string' ? parseInt(p.id) : p.id,
            full_name: p.full_name,
            position: p.position,
            team_abbrev: p.team,
          }));

        const statsMap = new Map<number, Record<string, unknown>>();
        for (const s of (statsRes.data ?? []) as Array<Record<string, unknown>>) {
          statsMap.set(s.player_id as number, s);
        }

        const scorer = new ScoringCalculator(league?.scoring_settings ?? null);
        const ctx: RosterPlayerCtx[] = pickedPlayers.map(p => {
          const s = statsMap.get(p.player_id) ?? {};
          const num = (k: string) => Number(s[k] ?? 0);
          const isGoalie = !!s.is_goalie || p.position === 'G';
          const fpts = scorer.calculatePoints(
            isGoalie
              ? { wins: num('wins'), saves: num('saves'), shutouts: num('shutouts'), goals_against: num('goals_against') }
              : { goals: num('goals'), assists: num('assists'), shots: num('shots'), blocks: num('blocks'), hits: num('hits'), pim: num('pim'), ppp: num('ppp'), shp: num('shp'), plus_minus: num('plus_minus') },
            isGoalie
          );
          return {
            player_id: p.player_id,
            full_name: p.full_name,
            position: p.position,
            team_abbrev: p.team_abbrev,
            games_played: num('games_played'),
            goals: num('goals'),
            assists: num('assists'),
            points: num('points'),
            shots: num('shots'),
            hits: num('hits'),
            blocks: num('blocks'),
            pim: num('pim'),
            ppp: num('ppp'),
            shp: num('shp'),
            plus_minus: num('plus_minus'),
            wins: num('wins'),
            saves: num('saves'),
            shutouts: num('shutouts'),
            goals_against: num('goals_against'),
            is_goalie: isGoalie,
            fpts,
          };
        });
        setRosterCtx(ctx);
      } catch (err) {
        logger.warn('[Hub] roster context load threw', err);
      }
    };

    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [leagueId, user?.id, league?.settings?.leagueType, league?.scoring_settings]);

  // Group roster players by NHL team for the Team Breakdown card
  const teamsBreakdown = useMemo(() => {
    if (rosterCtx.length === 0) return [];
    const byTeam = new Map<string, RosterPlayerCtx[]>();
    for (const p of rosterCtx) {
      const t = p.team_abbrev || 'Unknown';
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t)!.push(p);
    }
    // Decorate with today's game info if that team is playing
    const byTeamGame = new Map<string, PlayoffGameRow>();
    for (const g of todayGames) {
      byTeamGame.set(g.home_team, g);
      byTeamGame.set(g.away_team, g);
    }
    return [...byTeam.entries()]
      .map(([team, players]) => ({
        team,
        players: [...players].sort((a, b) => b.fpts - a.fpts),
        totalFpts: players.reduce((s, p) => s + p.fpts, 0),
        game: byTeamGame.get(team) ?? null,
      }))
      .sort((a, b) => b.totalFpts - a.totalFpts);
  }, [rosterCtx, todayGames]);

  const totalRosterFpts = useMemo(
    () => rosterCtx.reduce((s, p) => s + p.fpts, 0),
    [rosterCtx],
  );

  // Standings from playoff_pool_standings (real FPTS, not hardcoded 0)
  const [standings, setStandings] = useState<Array<{ user_id: string; total_points: number; current_rank: number }>>([]);

  useEffect(() => {
    if (!leagueId) return;
    const fetchStandings = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from('playoff_pool_standings')
          .select('user_id, total_points, current_rank')
          .eq('league_id', leagueId)
          .order('current_rank');
        setStandings((data ?? []).map((r: { user_id: string; total_points: number | string; current_rank: number }) => ({
          user_id: r.user_id,
          total_points: Number(r.total_points ?? 0),
          current_rank: r.current_rank,
        })));
      } catch { /* non-critical */ }
    };
    fetchStandings();
    const interval = setInterval(fetchStandings, 60_000);
    return () => clearInterval(interval);
  }, [leagueId]);

  const leagueType = league?.settings?.leagueType || 'playoff-bracket-pickem';
  const poolLabel = POOL_TYPE_LABELS[leagueType] || 'Playoff Pool';
  const makePicksRoute = POOL_TYPE_ROUTES[leagueType] || '/pool/playoff-bracket';
  const isCommissioner = user?.id === league?.commissioner_id;

  // Lock deadline
  const lockAt = league?.settings?.playoffRosterLockedAt;
  const lockCountdown = useMemo(() => {
    if (!lockAt) return null;
    const ms = new Date(lockAt).getTime() - Date.now();
    if (ms <= 0) return { locked: true, label: 'Rosters locked' };
    const hours = Math.floor(ms / 3600000);
    const days = Math.floor(hours / 24);
    if (days > 0) return { locked: false, label: `Locks in ${days}d ${hours % 24}h` };
    if (hours > 0) return { locked: false, label: `Locks in ${hours}h` };
    const minutes = Math.floor(ms / 60000);
    return { locked: false, label: `Locks in ${minutes}m` };
  }, [lockAt]);

  const copyJoinCode = () => {
    if (!league?.join_code) return;
    navigator.clipboard.writeText(league.join_code);
    setCopied(true);
    toast({ title: 'Join code copied!', description: 'Send it to your friends to invite them.' });
    setTimeout(() => setCopied(false), 2000);
  };

  // Shareable invite URL.
  // /auth honors ?redirect= so if the invitee is signed out, they go through
  // auth, then come back here and auto-join via the ?code= handler in CreateLeague.
  const joinPath = `/create-league?tab=join&code=${league?.join_code || ''}`;
  const shareUrl = `${window.location.origin}/auth?redirect=${encodeURIComponent(joinPath)}`;

  // Invite template includes BOTH the tappable link AND the raw code as a
  // fallback for mail clients that strip URLs.
  const inviteText = league
    ? `You're invited to join "${league.name}" on Citrus Fantasy Sports!\n\n` +
      `Tap to join: ${shareUrl}\n\n` +
      `Or enter this code manually at citrusfantasysports.com:\n` +
      `${league.join_code}`
    : '';

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl);
    toast({ title: 'Link copied!', description: 'Paste it anywhere to invite friends.' });
  };

  const emailInvite = () => {
    if (!league) return;
    const subject = encodeURIComponent(`Join ${league.name} on Citrus Fantasy Sports`);
    const body = encodeURIComponent(inviteText);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const smsInvite = () => {
    const body = encodeURIComponent(inviteText);
    // iOS requires sms:&body= while Android uses sms:?body=
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const separator = isIOS ? '&' : '?';
    window.location.href = `sms:${separator}body=${body}`;
  };

  if (loading) {
    return <><Navbar /><div className="min-h-screen pt-24 flex items-center justify-center text-white/55">Loading pool...</div></>;
  }

  if (!league) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen pt-24 flex items-center justify-center">
          <Card className="p-6 text-center">
            <p className="text-sm">Pool not found.</p>
            <Button asChild className="mt-3"><Link to="/nhl/playoffs">Back to NHL Playoffs</Link></Button>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-[#0F1F15] text-pastel-cream pt-24 pb-12 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Hero */}
          <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Trophy className="h-6 w-6 text-pastel-orange" aria-hidden="true" />
                <h1 className="text-2xl sm:text-3xl font-calistoga text-pastel-cream tracking-tight">{league.name}</h1>
              </div>
              <div className="flex items-center gap-2 text-sm text-white/70">
                <Badge variant="outline" className="border-pastel-sage/40">{poolLabel}</Badge>
                {isCommissioner && <Badge className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft border-0"><Crown className="h-3 w-3 mr-1" />Commissioner</Badge>}
              </div>
            </div>
            {lockCountdown && (
              <div className="text-right">
                <div className="text-[10px] font-display uppercase text-white/55">
                  {lockCountdown.locked ? 'Status' : 'Pick deadline'}
                </div>
                <div className={cn(
                  'text-base font-bold flex items-center gap-1 justify-end',
                  lockCountdown.locked ? 'text-red-500' : 'text-pastel-orange'
                )}>
                  {lockCountdown.locked ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Clock className="h-4 w-4" aria-hidden="true" />}
                  {lockCountdown.label}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px] gap-4 xl:gap-6">
            {/* Main */}
            <div className="space-y-4">
              {/* Your Picks CTA */}
              <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(255,168,87,0.15)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4 text-pastel-orange" />
                    Your Picks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-white/70 mb-3">
                    {lockCountdown?.locked
                      ? 'Rosters are locked — check your lineup and watch live scoring.'
                      : leagueType === 'playoff-roster-pool'
                        ? 'Build your roster from players across all 16 playoff teams.'
                        : leagueType === 'playoff-confidence-pool'
                          ? 'Pick winners and assign confidence values to each series.'
                          : 'Pick the winner and # of games for each playoff series.'}
                  </p>
                  <Button asChild className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">
                    <Link to={`${makePicksRoute}?league=${leagueId}`}>
                      {lockCountdown?.locked ? 'View Picks' : 'Make My Picks'} <ChevronRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Today's Games — Your Players (same layout as Roster tab) */}
              {leagueType === 'playoff-roster-pool' && (rosterCtx.length > 0 || todayGames.length > 0) && (() => {
                const gameStatusLabel = (g: PlayoffGameRow) => {
                  if (g.status === 'final') return 'Final';
                  if (g.status === 'live') {
                    const per = g.period ? ` ${g.period}` : '';
                    const time = g.period_time ? ` ${g.period_time}` : '';
                    return `Live${per}${time}`;
                  }
                  if (g.game_time) {
                    try {
                      const d = new Date(g.game_time);
                      return d.toLocaleTimeString('en-US', {
                        hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
                      }) + ' ET';
                    } catch { return 'Scheduled'; }
                  }
                  return 'Scheduled';
                };

                // Cross-reference roster with today's games — same logic as Roster tab
                const rosterTeams = new Set(rosterCtx.map(p => p.team_abbrev));
                const gamesWithMyPlayers = todayGames
                  .filter(g => rosterTeams.has(g.home_team) || rosterTeams.has(g.away_team))
                  .map(g => ({
                    ...g,
                    myPlayers: rosterCtx.filter(p => p.team_abbrev === g.home_team || p.team_abbrev === g.away_team),
                  }));

                if (gamesWithMyPlayers.length === 0 && rosterCtx.length === 0) return null;

                return (
                  <Card className="bg-[#1A2A20] border-0 ring-2 ring-pastel-orange/40 rounded-2xl shadow-[0_16px_40px_-12px_rgba(255,168,87,0.2)]">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <Calendar className="h-5 w-5 text-pastel-orange" aria-hidden="true" />
                          Today&apos;s Games — Your Players
                        </span>
                        <span className="text-xl font-calistoga font-black text-pastel-cream">
                          {totalRosterFpts.toFixed(1)} <span className="text-[10px] font-display text-white/55">FPTS</span>
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {gamesWithMyPlayers.map(g => {
                          const isLive = g.status === 'live';
                          const isFinal = g.status === 'final';
                          const hasGameData = isLive || isFinal;
                          const awayInfo = NHL_TEAMS.find(t => t.abbrev === g.away_team);
                          const homeInfo = NHL_TEAMS.find(t => t.abbrev === g.home_team);

                          // Time shown under scoreboard: live period, final marker, or start time
                          const timeLabel = isLive
                            ? `${g.period || ''}${g.period_time ? ` · ${g.period_time}` : ''}`.trim()
                            : isFinal
                            ? 'FINAL'
                            : gameStatusLabel(g);

                          return (
                            <div key={g.game_id} className={cn(
                              'relative rounded-xl border-2 overflow-hidden bg-white transition-all',
                              isLive && 'border-red-400 shadow-[0_0_0_4px_rgba(239,68,68,0.12)]',
                              isFinal && 'border-pastel-sage/40/30',
                              !isLive && !isFinal && 'border-pastel-sage/40/20'
                            )}>
                              {/* Team-colored header with score */}
                              <div className="relative">
                                <div className="grid grid-cols-[1fr_auto_1fr] items-stretch">
                                  <div
                                    className="flex items-center justify-center py-3 px-2 text-white font-calistoga font-black text-xl tracking-tight"
                                    style={{ background: awayInfo?.primaryColor || '#7A9B7A' }}
                                  >
                                    {g.away_team}
                                  </div>
                                  <div className="flex flex-col items-center justify-center py-2 px-3 bg-[#0F1F15] ring-1 ring-white/10 text-pastel-cream min-w-[96px]">
                                    {hasGameData ? (
                                      <div className="flex items-center gap-1 font-mono font-black text-xl tabular-nums">
                                        <span>{g.away_score}</span>
                                        <span className="text-white/50 text-base">–</span>
                                        <span>{g.home_score}</span>
                                      </div>
                                    ) : (
                                      <div className="font-display font-bold text-xs uppercase tracking-wider">VS</div>
                                    )}
                                    <div className={cn(
                                      'text-[10px] font-display uppercase tracking-wider mt-0.5',
                                      isLive ? 'text-red-300' : 'text-white/70'
                                    )}>
                                      {isLive && (
                                        <span className="inline-flex items-center gap-1">
                                          <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
                                          </span>
                                          LIVE
                                        </span>
                                      )}
                                      {!isLive && timeLabel}
                                    </div>
                                  </div>
                                  <div
                                    className="flex items-center justify-center py-3 px-2 text-white font-calistoga font-black text-xl tracking-tight"
                                    style={{ background: homeInfo?.primaryColor || '#7A9B7A' }}
                                  >
                                    {g.home_team}
                                  </div>
                                </div>
                                {/* Live period/clock strip — only during live play */}
                                {isLive && (
                                  <div className="bg-red-50 border-t border-red-200 px-3 py-1 text-center text-[11px] font-display font-bold text-red-700 tabular-nums">
                                    {timeLabel}
                                  </div>
                                )}
                                {/* Series game + tip strip for scheduled/final */}
                                {!isLive && (g.series_game_number || isFinal) && (
                                  <div className="bg-white/5 border-t border-white/10 px-3 py-1 text-center text-[10px] font-display uppercase tracking-wider text-white/70">
                                    {g.series_game_number ? `Game ${g.series_game_number}` : ''}
                                    {g.series_game_number && isFinal ? ' · ' : ''}
                                    {isFinal ? 'Final' : ''}
                                  </div>
                                )}
                              </div>

                              {/* Your players in this game */}
                              <div className="p-3 space-y-1.5">
                                <div className="flex items-center justify-between mb-1 pb-1 border-b border-pastel-sage/40/10">
                                  <span className="text-[10px] uppercase font-display font-bold text-white/70/50 tracking-wider">
                                    Your Players ({g.myPlayers.length})
                                  </span>
                                  {hasGameData && (
                                    <span className="text-[10px] uppercase font-display font-bold text-pastel-cream tabular-nums">
                                      {g.myPlayers.reduce((sum, p) => sum + p.fpts, 0).toFixed(1)} FPTS
                                    </span>
                                  )}
                                </div>
                                {g.myPlayers.map(p => {
                                  const posColor = p.is_goalie
                                    ? 'bg-purple-100 text-purple-800 border-purple-200'
                                    : p.position === 'D'
                                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                                    : 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft border-0';
                                  return (
                                    <div key={p.player_id} className="flex items-center justify-between gap-2 text-xs">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <span className={cn(
                                          'text-[9px] font-display font-black uppercase px-1.5 py-0.5 rounded border tabular-nums w-7 text-center flex-shrink-0',
                                          posColor
                                        )}>{p.position}</span>
                                        <span className="font-medium truncate">{p.full_name}</span>
                                      </div>
                                      {hasGameData ? (
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                          <span className="text-[10px] text-white/55 tabular-nums font-mono">
                                            {p.is_goalie
                                              ? `${p.saves}SV`
                                              : `${p.goals}G ${p.assists}A`}
                                          </span>
                                          <span className="text-sm font-bold text-pastel-cream tabular-nums w-10 text-right">
                                            {p.fpts.toFixed(1)}
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="text-[10px] text-white/70/40 italic flex-shrink-0">Not started</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        {gamesWithMyPlayers.length === 0 && rosterCtx.length > 0 && (
                          <div className="col-span-full text-center text-sm text-white/70/50 italic py-6 border border-dashed border-pastel-sage/40/30 rounded-lg">
                            None of your rostered players have games today. Check back tomorrow!
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Today's Games — bracket + confidence pools (live scores +
                  visual indicator for any series that's in progress today) */}
              {(leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool') && todayGames.length > 0 && (() => {
                const gameStatusLabel = (g: PlayoffGameRow) => {
                  if (g.status === 'final') return 'Final';
                  if (g.status === 'live') {
                    const per = g.period ? ` ${g.period}` : '';
                    const time = g.period_time ? ` ${g.period_time}` : '';
                    return `Live${per}${time}`;
                  }
                  if (g.game_time) {
                    try {
                      const d = new Date(g.game_time);
                      return d.toLocaleTimeString('en-US', {
                        hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
                      }) + ' ET';
                    } catch { return 'Scheduled'; }
                  }
                  return 'Scheduled';
                };
                return (
                  <Card className="bg-[#1A2A20] border-0 ring-2 ring-pastel-orange/40 rounded-2xl shadow-[0_16px_40px_-12px_rgba(255,168,87,0.2)]">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-pastel-orange" aria-hidden="true" />
                        Today&apos;s Playoff Games
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {todayGames.map(g => {
                          const isLive = g.status === 'live';
                          const isFinal = g.status === 'final';
                          // Find my pick for the series containing this game
                          const series = bracketSeries.find(s =>
                            (s.high_seed_team_id && s.low_seed_team_id) &&
                            (([g.home_team, g.away_team]).every(t => {
                              const hi = bracketSeeds.find(x => x.team_id === s.high_seed_team_id);
                              const lo = bracketSeeds.find(x => x.team_id === s.low_seed_team_id);
                              return t === hi?.team_abbrev || t === lo?.team_abbrev;
                            }))
                          );
                          const myPick = series ? userPicks.find(p => p.series_slot === series.bracket_slot) : null;
                          const myPickAbbrev = myPick
                            ? bracketSeeds.find(x => x.team_id === myPick.picked_team_id)?.team_abbrev
                            : null;

                          return (
                            <div key={g.game_id} className={cn(
                              'relative rounded-lg border p-3 transition-colors',
                              isLive ? 'border-red-400 bg-red-50/40 ring-1 ring-red-400/30' :
                              isFinal ? 'ring-1 ring-white/10 bg-white/5' :
                              'ring-1 ring-pastel-sage/30 bg-[#1A2A20]'
                            )}>
                              {isLive && (
                                <div className="absolute -top-2 right-3 flex items-center gap-1 bg-red-600 text-white text-[9px] font-calistoga px-2 py-0.5 rounded-full shadow-md">
                                  <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                                  </span>
                                  LIVE
                                </div>
                              )}
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5 text-sm font-display font-bold text-pastel-cream">
                                  <span className={cn(myPickAbbrev === g.away_team && 'underline decoration-pastel-orange decoration-2 underline-offset-4')}>{g.away_team}</span>
                                  <span className="text-white/70/40">@</span>
                                  <span className={cn(myPickAbbrev === g.home_team && 'underline decoration-pastel-orange decoration-2 underline-offset-4')}>{g.home_team}</span>
                                </div>
                                {g.series_game_number && (
                                  <Badge variant="outline" className="text-[9px] border-pastel-sage/40/40">Game {g.series_game_number}</Badge>
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                <div className={cn(
                                  'text-sm font-mono font-semibold',
                                  isLive && 'text-red-700',
                                  isFinal && 'text-white/70',
                                )}>
                                  {g.away_score}–{g.home_score}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-[9px] px-1.5 py-0',
                                    isLive && 'border-red-600 bg-red-600 text-white animate-pulse',
                                    isFinal && 'ring-1 ring-white/10 bg-white/5',
                                    !isLive && !isFinal && 'border-pastel-sage/40/50',
                                  )}
                                >
                                  {gameStatusLabel(g)}
                                </Badge>
                              </div>
                              {myPickAbbrev && (
                                <div className="mt-2 text-[10px] text-white/55">
                                  <span className="font-display font-semibold">Your pick:</span>{' '}
                                  <span className="font-mono font-bold text-pastel-orange">{myPickAbbrev}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Picks Overview — bracket + confidence pools */}
              {(leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool') && userPicks.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Target className="h-4 w-4 text-pastel-sage-soft" />
                      Your Picks ({userPicks.length}/{bracketSeries.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {bracketSeries.map(s => {
                        const pick = userPicks.find(p => p.series_slot === s.bracket_slot);
                        const high = s.high_seed_team_id ? bracketSeeds.find(seed => seed.team_id === s.high_seed_team_id) : null;
                        const low = s.low_seed_team_id ? bracketSeeds.find(seed => seed.team_id === s.low_seed_team_id) : null;
                        const pickedTeam = pick ? (pick.picked_team_id === s.high_seed_team_id ? high : pick.picked_team_id === s.low_seed_team_id ? low : null) : null;
                        const pickedInfo = pickedTeam ? NHL_TEAMS.find(t => t.abbrev === pickedTeam.team_abbrev) : null;
                        const isFinal = s.series_status === 'final';
                        const isCorrect = isFinal && pick && s.winner_team_id === pick.picked_team_id;
                        const isWrong = isFinal && pick && s.winner_team_id && s.winner_team_id !== pick.picked_team_id;
                        const roundName = s.round === 1 ? 'R1' : s.round === 2 ? 'R2' : s.round === 3 ? 'CF' : 'SCF';
                        return (
                          <div key={s.series_id} className={cn(
                            'flex items-center gap-2 p-2 rounded border',
                            isCorrect && 'border-green-400 bg-green-50/50',
                            isWrong && 'border-red-300 bg-red-50/30',
                            !isFinal && pick && 'ring-1 ring-pastel-sage/30 bg-pastel-sage/8',
                            !pick && 'border-2 border-dashed border-white/15 bg-white/5'
                          )}>
                            <span className="text-[9px] font-mono text-white/70/50 w-8">{roundName}-{String.fromCharCode(64 + s.bracket_slot)}</span>
                            {pick && pickedInfo ? (
                              <>
                                <div
                                  className="w-7 h-7 rounded flex items-center justify-center text-[9px] font-calistoga font-black text-white flex-shrink-0"
                                  style={{ background: pickedInfo.primaryColor }}
                                >
                                  {pickedInfo.abbrev}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold truncate" style={{ color: pickedInfo.primaryColor }}>{pickedInfo.name}</div>
                                  <div className="text-[9px] text-white/55">
                                    {leagueType === 'playoff-confidence-pool' && pick.confidence_value && `Confidence: ${pick.confidence_value}`}
                                    {leagueType === 'playoff-bracket-pickem' && pick.predicted_games && `in ${pick.predicted_games}`}
                                  </div>
                                </div>
                                {isCorrect && <Check className="h-4 w-4 text-green-500 flex-shrink-0" aria-hidden="true" />}
                                {isFinal && pick.points_earned != null && (
                                  <span className={cn('text-xs font-bold flex-shrink-0', isCorrect ? 'text-green-600' : 'text-white/70/40')}>
                                    +{pick.points_earned}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[11px] text-white/70/40 italic flex-1">No pick yet</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Leaderboard — members + live standings in ONE table */}
              <Card className="border-pastel-sage/40/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-pastel-orange" aria-hidden="true" />
                    Leaderboard
                    <span className="text-[10px] text-white/70/50 font-normal ml-auto">
                      {teams.length} {teams.length === 1 ? 'member' : 'members'} · updates every 60s
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {teams.length === 0 ? (
                    <p className="text-xs text-white/55 italic p-4">No members yet — invite friends with the join code →</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-white/5 border-b border-white/10">
                          <tr>
                            <th className="px-3 py-2 text-left text-[10px] uppercase font-display font-bold text-white/55 w-10">#</th>
                            <th className="px-3 py-2 text-left text-[10px] uppercase font-display font-bold text-white/55">Team</th>
                            <th className="px-3 py-2 text-right text-[10px] uppercase font-display font-bold text-white/55">FPTS</th>
                            {leagueType === 'playoff-roster-pool' && (
                              <th className="px-3 py-2 w-10"></th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {teams
                            .map(t => {
                              const s = standings.find(st => st.user_id === t.owner_id);
                              return { ...t, pts: s?.total_points ?? 0, rank: s?.current_rank ?? 999 };
                            })
                            .sort((a, b) => a.rank - b.rank || b.pts - a.pts)
                            .map((t, i) => {
                              const isRosterPool = leagueType === 'playoff-roster-pool';
                              const isMe = t.owner_id === user?.id;
                              const isCommish = t.owner_id === league.commissioner_id;
                              return (
                                <tr
                                  key={t.id}
                                  className={cn(
                                    'border-b border-pastel-sage/40/10 last:border-b-0',
                                    isMe && 'bg-pastel-sage/8 ring-1 ring-pastel-sage/20',
                                    isRosterPool && 'cursor-pointer hover:bg-pastel-orange/10 transition-colors',
                                  )}
                                  onClick={isRosterPool ? () => navigate(`/pool/playoff-roster?league=${leagueId}&view=${t.owner_id}`) : undefined}
                                >
                                  <td className="px-3 py-2 text-xs font-mono text-white/70/50 tabular-nums">
                                    {i === 0 ? <span className="text-pastel-orange text-base">🏆</span> : i + 1}
                                  </td>
                                  <td className="px-3 py-2 text-sm">
                                    <div className="flex items-center gap-2">
                                      <div className="h-7 w-7 rounded-full bg-pastel-sage/20 ring-1 ring-pastel-sage/40 flex items-center justify-center text-xs font-bold text-pastel-sage-soft flex-shrink-0">
                                        {(t.team_name || '?').charAt(0).toUpperCase()}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="font-medium truncate">{t.team_name}</div>
                                        <div className="flex items-center gap-1.5 text-[10px]">
                                          {isCommish && <span className="text-pastel-orange flex items-center gap-0.5"><Crown className="h-2.5 w-2.5" />Commissioner</span>}
                                          {isMe && <span className="text-pastel-sage-soft">You</span>}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-base text-right font-calistoga font-black text-pastel-cream tabular-nums">
                                    {t.pts.toFixed(1)}
                                  </td>
                                  {isRosterPool && (
                                    <td className="px-3 py-2 text-right">
                                      <Eye className="h-4 w-4 text-white/70/30 inline" />
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-3">
              {/* Invite */}
              <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Invite Friends</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-[10px] uppercase font-display text-white/70/50">Join Code</div>
                  <button
                    onClick={copyJoinCode}
                    className="w-full flex items-center justify-between p-2 rounded ring-1 ring-pastel-sage/30 bg-pastel-sage/8 hover:bg-pastel-sage/15 transition-colors"
                  >
                    <span className="text-lg font-mono font-bold text-pastel-cream tracking-wider">{league.join_code}</span>
                    {copied ? <Check className="h-4 w-4 text-green-600" aria-hidden="true" /> : <Copy className="h-4 w-4 text-white/70/50" aria-hidden="true" />}
                  </button>

                  <div className="pt-2 grid grid-cols-1 gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyShareLink}
                      className="w-full justify-start gap-2 text-xs h-8"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      Copy Invite Link
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={emailInvite}
                      className="w-full justify-start gap-2 text-xs h-8"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Send via Email
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={smsInvite}
                      className="w-full justify-start gap-2 text-xs h-8"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Send via Text
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Rules recap */}
              <Card className="ring-1 ring-pastel-sage/30 bg-[#1A2A20] rounded-2xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Pool Rules</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-[11px] text-white/70 space-y-1 list-disc pl-3">
                    {leagueType === 'playoff-roster-pool' && (
                      <>
                        <li>Pick {league.settings?.playoffRosterSize || 17} players from the 16 playoff teams</li>
                        <li>Max 3 players per NHL team</li>
                        <li>Total fantasy points across all playoff games</li>
                        <li>Scoring uses your league's custom point values</li>
                      </>
                    )}
                    {leagueType === 'playoff-bracket-pickem' && (
                      <>
                        <li>Pick the winner of all 15 playoff series</li>
                        <li>Points double each round (2 / 4 / 8 / 16)</li>
                        <li>+1 bonus for correctly predicting number of games</li>
                      </>
                    )}
                    {leagueType === 'playoff-confidence-pool' && (
                      <>
                        <li>Pick series winners + assign confidence 1-15</li>
                        <li>Each confidence value used exactly once</li>
                        <li>Correct pick = you earn that many points</li>
                      </>
                    )}
                    <li>Picks lock {lockAt ? `at ${new Date(lockAt).toLocaleString()}` : 'at puck drop of Round 1 Game 1'}</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
