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
    if (league?.settings?.leagueType !== 'playoff-roster-pool') return;

    const load = async () => {
      try {
        // 1. My roster picks
        const sb = supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => Promise<{ data: Array<{ player_id: number }> | null }> };
              in: (k: string, v: unknown[]) => Promise<{ data: Array<Record<string, unknown>> | null }>;
              gte: (k: string, v: unknown) => { lte: (k: string, v: unknown) => { eq: (k: string, v: unknown) => { order: (k: string) => Promise<{ data: PlayoffGameRow[] | null }> } } };
            };
          };
        };

        const { data: picksData } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => Promise<{ data: Array<{ player_id: number }> | null }> } } } })
          .from('playoff_roster_picks')
          .select('player_id')
          .eq('league_id', leagueId)
          .eq('user_id', user.id);

        const playerIds = (picksData ?? []).map(p => p.player_id).filter(Boolean);
        if (playerIds.length === 0) {
          setRosterCtx([]);
          return;
        }

        // 2. Player directory (names, positions, current team) + playoff stats in parallel
        const [pdRes, statsRes] = await Promise.all([
          (supabase as unknown as { from: (t: string) => { select: (c: string) => { in: (k: string, v: unknown[]) => Promise<{ data: Array<{ player_id: number; full_name: string; position: string; team_abbrev: string }> | null }> } } })
            .from('player_directory')
            .select('player_id, full_name, position, team_abbrev')
            .in('player_id', playerIds),
          (supabase as unknown as { from: (t: string) => { select: (c: string) => { in: (k: string, v: unknown[]) => Promise<{ data: Array<Record<string, unknown>> | null }> } } })
            .from('player_playoff_stats')
            .select('*')
            .in('player_id', playerIds),
        ]);

        const statsMap = new Map<number, Record<string, unknown>>();
        for (const s of statsRes.data ?? []) {
          statsMap.set(s.player_id as number, s);
        }

        const scorer = new ScoringCalculator(league?.scoring_settings ?? null);
        const ctx: RosterPlayerCtx[] = (pdRes.data ?? []).map(p => {
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

        // 3. Today's playoff games
        const today = new Date().toISOString().slice(0, 10);
        const { data: gamesData } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => { order: (k: string) => Promise<{ data: PlayoffGameRow[] | null }> } } } } })
          .from('nhl_games')
          .select('game_id, game_date, game_time, home_team, away_team, home_score, away_score, status, period, period_time, series_game_number')
          .eq('game_date', today)
          .eq('game_type', 'playoff')
          .order('game_time');
        setTodayGames((gamesData ?? []) as PlayoffGameRow[]);
      } catch (err) {
        logger.warn('Failed to load roster context on Hub', err);
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
    return <><Navbar /><div className="min-h-screen pt-24 flex items-center justify-center text-citrus-charcoal/60">Loading pool...</div></>;
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
      <div className="min-h-screen bg-gradient-to-b from-white to-[#F5F8ED] pt-24 pb-12 px-4">
        <div className="max-w-5xl mx-auto">
          {/* Hero */}
          <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Trophy className="h-6 w-6 text-citrus-orange" />
                <h1 className="text-2xl sm:text-3xl font-varsity font-black uppercase text-citrus-forest tracking-tight">{league.name}</h1>
              </div>
              <div className="flex items-center gap-2 text-sm text-citrus-charcoal/70">
                <Badge variant="outline" className="border-citrus-sage">{poolLabel}</Badge>
                {isCommissioner && <Badge className="bg-citrus-orange/20 text-citrus-orange border-citrus-orange/30"><Crown className="h-3 w-3 mr-1" />Commissioner</Badge>}
              </div>
            </div>
            {lockCountdown && (
              <div className="text-right">
                <div className="text-[10px] font-display uppercase text-citrus-charcoal/60">
                  {lockCountdown.locked ? 'Status' : 'Pick deadline'}
                </div>
                <div className={cn(
                  'text-base font-bold flex items-center gap-1 justify-end',
                  lockCountdown.locked ? 'text-red-500' : 'text-citrus-orange'
                )}>
                  {lockCountdown.locked ? <Lock className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  {lockCountdown.label}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
            {/* Main */}
            <div className="space-y-4">
              {/* Your Picks CTA */}
              <Card className="border-citrus-orange/30 bg-gradient-to-br from-citrus-orange/5 to-citrus-sage/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4 text-citrus-orange" />
                    Your Picks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-citrus-charcoal/70 mb-3">
                    {lockCountdown?.locked
                      ? 'Rosters are locked — check your lineup and watch live scoring.'
                      : leagueType === 'playoff-roster-pool'
                        ? 'Build your roster from players across all 16 playoff teams.'
                        : leagueType === 'playoff-confidence-pool'
                          ? 'Pick winners and assign confidence values to each series.'
                          : 'Pick the winner and # of games for each playoff series.'}
                  </p>
                  <Button asChild className="bg-citrus-orange hover:bg-citrus-orange/90 text-white font-display font-bold">
                    <Link to={`${makePicksRoute}?league=${leagueId}`}>
                      {lockCountdown?.locked ? 'View Picks' : 'Make My Picks'} <ChevronRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Today's Games + Team Breakdown — roster pools only */}
              {leagueType === 'playoff-roster-pool' && rosterCtx.length > 0 && (() => {
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
                  <Card className="border-2 border-citrus-orange/40 bg-gradient-to-br from-citrus-orange/5 to-white shadow-md">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <Calendar className="h-5 w-5 text-citrus-orange" />
                          My Playoff Roster — Live
                        </span>
                        <span className="text-xl font-varsity font-black text-citrus-forest">
                          {totalRosterFpts.toFixed(1)} <span className="text-[10px] font-display text-citrus-charcoal/60">FPTS</span>
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Teams playing today banner */}
                      {todayGames.length > 0 && teamsBreakdown.some(t => t.game) && (
                        <div className="flex flex-wrap gap-2 pb-1 border-b border-citrus-sage/20">
                          <span className="text-[10px] uppercase font-display font-bold text-citrus-charcoal/60 self-center">Playing today:</span>
                          {teamsBreakdown.filter(t => t.game).map(t => (
                            <Badge
                              key={t.team}
                              variant="outline"
                              className={cn(
                                'text-[11px] font-mono flex items-center gap-1',
                                t.game?.status === 'live' && 'border-red-500 bg-red-50 text-red-700',
                                t.game?.status === 'final' && 'border-muted bg-muted/40',
                                t.game?.status === 'scheduled' && 'border-citrus-sage/50',
                              )}
                            >
                              {t.game?.status === 'live' && (
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                                </span>
                              )}
                              {t.team}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Per-team breakdown */}
                      <div className="space-y-3">
                        {teamsBreakdown.map(({ team, players, totalFpts, game }) => (
                          <div key={team} className={cn(
                            'rounded-lg border p-3 transition-colors relative',
                            game?.status === 'live' ? 'border-red-400 bg-red-50/40 ring-1 ring-red-400/20' :
                            game?.status === 'final' ? 'border-citrus-charcoal/20 bg-muted/20' :
                            'border-citrus-sage/20 bg-white'
                          )}>
                            {/* LIVE ribbon — top-right corner badge that pulses */}
                            {game?.status === 'live' && (
                              <div className="absolute -top-2 right-3 flex items-center gap-1 bg-red-600 text-white text-[9px] font-varsity font-black uppercase px-2 py-0.5 rounded-full shadow-md">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                                </span>
                                LIVE
                              </div>
                            )}
                            {/* Team header */}
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-varsity font-black text-citrus-forest text-sm">{team}</span>
                                <span className="text-[10px] text-citrus-charcoal/50">{players.length} player{players.length !== 1 ? 's' : ''}</span>
                              </div>
                              {game ? (
                                <div className="text-[11px] flex items-center gap-2">
                                  <span className={cn(
                                    'font-mono font-semibold',
                                    game.status === 'live' && 'text-red-700',
                                  )}>
                                    {game.away_team} {game.away_score}–{game.home_score} {game.home_team}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'text-[9px] px-1.5 py-0',
                                      game.status === 'live' && 'border-red-600 bg-red-600 text-white animate-pulse',
                                      game.status === 'final' && 'border-muted bg-muted/60',
                                      game.status === 'scheduled' && 'border-citrus-sage/50',
                                    )}
                                  >
                                    {gameStatusLabel(game)}
                                  </Badge>
                                  {game.series_game_number && (
                                    <span className="text-[10px] text-citrus-charcoal/50">G{game.series_game_number}</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[10px] text-citrus-charcoal/40 italic">No game today</span>
                              )}
                              <span className="text-base font-bold text-citrus-forest tabular-nums">{totalFpts.toFixed(1)}</span>
                            </div>
                            {/* Player stats table */}
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-[9px] uppercase font-display text-citrus-charcoal/50 border-b border-citrus-sage/10">
                                    <th className="text-left py-1 font-bold">Player</th>
                                    <th className="text-right py-1 px-1 font-bold">GP</th>
                                    {/* Show goalie-specific columns only if team has a goalie */}
                                    {players.some(p => p.is_goalie) ? (
                                      <>
                                        <th className="text-right py-1 px-1 font-bold">W</th>
                                        <th className="text-right py-1 px-1 font-bold">SV</th>
                                        <th className="text-right py-1 px-1 font-bold hidden sm:table-cell">SO</th>
                                        <th className="text-right py-1 px-1 font-bold hidden sm:table-cell">GA</th>
                                      </>
                                    ) : null}
                                    <th className="text-right py-1 px-1 font-bold">G</th>
                                    <th className="text-right py-1 px-1 font-bold">A</th>
                                    <th className="text-right py-1 px-1 font-bold">PTS</th>
                                    <th className="text-right py-1 px-1 font-bold hidden sm:table-cell">+/-</th>
                                    <th className="text-right py-1 px-1 font-bold hidden sm:table-cell">SOG</th>
                                    <th className="text-right py-1 px-1 font-bold hidden sm:table-cell">HIT</th>
                                    <th className="text-right py-1 px-1 font-bold hidden sm:table-cell">BLK</th>
                                    <th className="text-right py-1 pl-2 font-bold text-citrus-forest">FPTS</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {players.map(p => (
                                    <tr key={p.player_id} className="border-b border-citrus-sage/5 last:border-b-0">
                                      <td className="py-1.5">
                                        <span className="font-medium">{p.full_name}</span>
                                        <span className="text-[9px] text-citrus-charcoal/50 ml-1">{p.position}</span>
                                      </td>
                                      <td className="py-1.5 px-1 text-right tabular-nums">{p.games_played}</td>
                                      {players.some(x => x.is_goalie) ? (
                                        <>
                                          <td className="py-1.5 px-1 text-right tabular-nums">{p.is_goalie ? p.wins : ''}</td>
                                          <td className="py-1.5 px-1 text-right tabular-nums">{p.is_goalie ? p.saves : ''}</td>
                                          <td className="py-1.5 px-1 text-right tabular-nums hidden sm:table-cell">{p.is_goalie ? p.shutouts : ''}</td>
                                          <td className="py-1.5 px-1 text-right tabular-nums hidden sm:table-cell">{p.is_goalie ? p.goals_against : ''}</td>
                                        </>
                                      ) : null}
                                      <td className="py-1.5 px-1 text-right tabular-nums">{p.is_goalie ? '' : p.goals}</td>
                                      <td className="py-1.5 px-1 text-right tabular-nums">{p.is_goalie ? '' : p.assists}</td>
                                      <td className="py-1.5 px-1 text-right tabular-nums font-semibold">{p.is_goalie ? '' : p.points}</td>
                                      <td className={cn(
                                        'py-1.5 px-1 text-right tabular-nums hidden sm:table-cell',
                                        !p.is_goalie && p.plus_minus > 0 && 'text-green-700',
                                        !p.is_goalie && p.plus_minus < 0 && 'text-red-600',
                                      )}>
                                        {p.is_goalie ? '' : (p.plus_minus > 0 ? `+${p.plus_minus}` : p.plus_minus)}
                                      </td>
                                      <td className="py-1.5 px-1 text-right tabular-nums hidden sm:table-cell">{p.is_goalie ? '' : p.shots}</td>
                                      <td className="py-1.5 px-1 text-right tabular-nums hidden sm:table-cell">{p.is_goalie ? '' : p.hits}</td>
                                      <td className="py-1.5 px-1 text-right tabular-nums hidden sm:table-cell">{p.is_goalie ? '' : p.blocks}</td>
                                      <td className="py-1.5 pl-2 text-right tabular-nums font-bold text-citrus-forest">{p.fpts.toFixed(1)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
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
                      <Target className="h-4 w-4 text-citrus-sage" />
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
                            !isFinal && pick && 'border-citrus-sage/30 bg-citrus-sage/5',
                            !pick && 'border-dashed border-fantasy-border/50 bg-muted/20'
                          )}>
                            <span className="text-[9px] font-mono text-citrus-charcoal/50 w-8">{roundName}-{String.fromCharCode(64 + s.bracket_slot)}</span>
                            {pick && pickedInfo ? (
                              <>
                                <div
                                  className="w-7 h-7 rounded flex items-center justify-center text-[9px] font-varsity font-black text-white flex-shrink-0"
                                  style={{ background: pickedInfo.primaryColor }}
                                >
                                  {pickedInfo.abbrev}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold truncate" style={{ color: pickedInfo.primaryColor }}>{pickedInfo.name}</div>
                                  <div className="text-[9px] text-citrus-charcoal/60">
                                    {leagueType === 'playoff-confidence-pool' && pick.confidence_value && `Confidence: ${pick.confidence_value}`}
                                    {leagueType === 'playoff-bracket-pickem' && pick.predicted_games && `in ${pick.predicted_games}`}
                                  </div>
                                </div>
                                {isCorrect && <Check className="h-4 w-4 text-green-500 flex-shrink-0" />}
                                {isFinal && pick.points_earned != null && (
                                  <span className={cn('text-xs font-bold flex-shrink-0', isCorrect ? 'text-green-600' : 'text-citrus-charcoal/40')}>
                                    +{pick.points_earned}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[11px] text-citrus-charcoal/40 italic flex-1">No pick yet</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Members */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4 text-citrus-sage" />
                    Members ({teams.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {teams.length === 0 ? (
                    <p className="text-xs text-citrus-charcoal/60 italic">No members yet — invite friends with the join code →</p>
                  ) : (
                    <div className="space-y-1.5">
                      {teams.map((t) => {
                        const isRosterPool = leagueType === 'playoff-roster-pool';
                        return (
                        <div
                          key={t.id}
                          className={cn(
                            'flex items-center justify-between p-2 rounded border border-citrus-sage/20 bg-white',
                            isRosterPool && 'cursor-pointer hover:border-citrus-orange/40 hover:bg-citrus-orange/5 transition-colors'
                          )}
                          onClick={isRosterPool ? () => navigate(`/pool/playoff-roster?league=${leagueId}&view=${t.owner_id}`) : undefined}
                        >
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-citrus-sage/20 flex items-center justify-center text-xs font-bold text-citrus-forest">
                              {(t.team_name || '?').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-medium">{t.team_name}</div>
                              {t.owner_id === league.commissioner_id && (
                                <div className="text-[10px] text-citrus-orange flex items-center gap-0.5"><Crown className="h-2.5 w-2.5" />Commissioner</div>
                              )}
                              {t.owner_id === user?.id && t.owner_id !== league.commissioner_id && (
                                <div className="text-[10px] text-citrus-sage">You</div>
                              )}
                            </div>
                          </div>
                          {isRosterPool && (
                            <Eye className="h-4 w-4 text-citrus-charcoal/30" />
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Standings — shows all members with current points (0 until games start) */}
              <Card className="border-citrus-sage/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-citrus-orange" />
                    Standings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {teams.length === 0 ? (
                    <p className="text-xs text-citrus-charcoal/60 italic">Invite players to populate standings.</p>
                  ) : (
                    <>
                      <div className="rounded border border-citrus-sage/20 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-citrus-sage/10 border-b border-citrus-sage/20">
                            <tr>
                              <th className="px-2 py-1.5 text-left text-[10px] uppercase font-display font-bold text-citrus-charcoal/60 w-10">#</th>
                              <th className="px-2 py-1.5 text-left text-[10px] uppercase font-display font-bold text-citrus-charcoal/60">Team</th>
                              <th className="px-2 py-1.5 text-right text-[10px] uppercase font-display font-bold text-citrus-charcoal/60">Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teams.map((t, i) => (
                              <tr key={t.id} className={cn("border-b border-citrus-sage/10 last:border-b-0", t.owner_id === user?.id && "bg-citrus-sage/5")}>
                                <td className="px-2 py-1.5 text-xs font-mono text-citrus-charcoal/50">{i + 1}</td>
                                <td className="px-2 py-1.5 text-sm">
                                  <span className="font-medium">{t.team_name}</span>
                                  {t.owner_id === user?.id && <span className="text-[10px] text-citrus-sage ml-1">(You)</span>}
                                </td>
                                <td className="px-2 py-1.5 text-sm text-right font-bold text-citrus-forest">0</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[10px] text-citrus-charcoal/50 mt-2 italic">Rankings update live as playoff games complete.</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-3">
              {/* Invite */}
              <Card className="border-citrus-orange/30 bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Invite Friends</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-[10px] uppercase font-display text-citrus-charcoal/50">Join Code</div>
                  <button
                    onClick={copyJoinCode}
                    className="w-full flex items-center justify-between p-2 rounded border border-citrus-sage/30 bg-citrus-sage/5 hover:bg-citrus-sage/10 transition-colors"
                  >
                    <span className="text-lg font-mono font-bold text-citrus-forest tracking-wider">{league.join_code}</span>
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-citrus-charcoal/50" />}
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
              <Card className="border-citrus-sage/20 bg-citrus-sage/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Pool Rules</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-[11px] text-citrus-charcoal/70 space-y-1 list-disc pl-3">
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
