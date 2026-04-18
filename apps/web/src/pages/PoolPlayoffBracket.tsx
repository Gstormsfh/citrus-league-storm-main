/**
 * Playoff Bracket Pickem pool page.
 * Each user picks the winner + predicted # games for each of the 15 series.
 * Points awarded per round per league's pointsPerRound config (Yahoo default: 2/4/8/16).
 */

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Trophy, Lock, Check, Save, AlertTriangle, ArrowLeft } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { NHL_TEAMS } from '@/types/captracker';
import { supabase } from '@/integrations/supabase/client';

interface Seed {
  team_id: number;
  team_abbrev: string | null;
  conference: string;
  seed: number;
  wins?: number;
  losses?: number;
  ot_losses?: number;
  points?: number;
}
interface Series {
  series_id: string;
  round: number;
  conference: string | null;
  bracket_slot: number;
  high_seed_team_id: number | null;
  low_seed_team_id: number | null;
  high_seed_wins: number;
  low_seed_wins: number;
  series_status: 'pending' | 'active' | 'final';
  winner_team_id: number | null;
}
interface Pick {
  series_slot: number;
  picked_team_id: number;
  predicted_games?: number;
  is_correct?: boolean | null;
  points_earned?: number;
}

const ROUND_NAMES: Record<number, string> = {
  1: 'First Round', 2: 'Second Round', 3: 'Conference Finals', 4: 'Stanley Cup Final',
};

export default function PoolPlayoffBracket() {
  const [params] = useSearchParams();
  const leagueId = params.get('league') || '';
  const { user } = useAuth();
  const { toast } = useToast();

  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [picks, setPicks] = useState<Map<number, Pick>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [h2hMap, setH2hMap] = useState<Record<number, { high_wins: number; low_wins: number; games: number }>>({});
  const [liveGames, setLiveGames] = useState<Array<{
    game_id: number; home_team: string; away_team: string;
    home_score: number; away_score: number; status: string;
    period: string | null; period_time: string | null;
    series_game_number: number | null;
  }>>([]);

  // Fetch today's playoff games for live score overlay (refreshes every 30s)
  useEffect(() => {
    const fetchLive = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from('nhl_games')
          .select('game_id, home_team, away_team, home_score, away_score, status, period, period_time, series_game_number')
          .eq('game_date', today)
          .eq('game_type', 'playoff');
        setLiveGames(data ?? []);
      } catch { /* non-critical */ }
    };
    fetchLive();
    const interval = setInterval(fetchLive, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!leagueId || !user) return;
    const load = async () => {
      try {
        const [bracketRes, picksRes, h2hRes] = await Promise.all([
          fetch('/api/nhl-playoffs/bracket?season=2025'),
          fetch(`/api/playoff-pools/${leagueId}/picks?type=bracket`, {
            headers: { Authorization: `Bearer ${(await import('@/integrations/supabase/client')).supabase.auth.getSession ? (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session?.access_token || '' : ''}` },
          }),
          fetch('/api/nhl-playoffs/h2h?season=2025').catch(() => null),
        ]);
        const bracket = await bracketRes.json();
        const picksData = await picksRes.json();
        const h2hData = h2hRes ? await h2hRes.json().catch(() => null) : null;
        if (h2hData?.data?.h2h) setH2hMap(h2hData.data.h2h);
        else if (h2hData?.h2h) setH2hMap(h2hData.h2h);
        setSeeds(bracket.data?.seeds || bracket.seeds || []);
        setSeries(bracket.data?.series || bracket.series || []);
        const myPicks = (picksData.data?.picks || picksData.picks || []).filter((p: Pick & { user_id: string }) => p.user_id === user.id);
        const m = new Map<number, Pick>();
        myPicks.forEach((p: Pick) => m.set(p.series_slot, p));
        setPicks(m);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [leagueId, user]);

  const teamById = useMemo(() => new Map(seeds.map(s => [s.team_id, s])), [seeds]);
  const seriesByRound = useMemo(() => {
    const m: Record<number, Series[]> = { 1: [], 2: [], 3: [], 4: [] };
    series.forEach(s => m[s.round]?.push(s));
    return m;
  }, [series]);

  const handlePick = (slot: number, teamId: number) => {
    const s = series.find(x => x.bracket_slot === slot);
    if (!s || s.series_status !== 'pending') return;
    const next = new Map(picks);
    const existing = next.get(slot);
    next.set(slot, { ...(existing || {}), series_slot: slot, picked_team_id: teamId });
    setPicks(next);
    setDirty(true);
  };

  const handleGames = (slot: number, games: number) => {
    const next = new Map(picks);
    const existing = next.get(slot);
    if (!existing) return;
    next.set(slot, { ...existing, predicted_games: games });
    setPicks(next);
    setDirty(true);
  };

  const savePicks = async () => {
    if (!leagueId || picks.size === 0) return;
    setSaving(true);
    try {
      const session = (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session;
      const res = await fetch('/api/playoff-pools/bracket-pickem/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ leagueId, picks: Array.from(picks.values()) }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast({ title: 'Picks saved', description: `${picks.size} series picks updated.` });
      setDirty(false);
    } catch (err) {
      toast({ title: 'Failed to save picks', description: String(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-citrus-charcoal/60">Loading...</div>;

  return (
    <>
    <Navbar />
    <div className="min-h-screen bg-gradient-to-b from-white to-[#F5F8ED] py-6 px-4 pt-24">
      <div className="max-w-6xl mx-auto mb-3">
        <Link to={`/pool/playoff-hub?league=${leagueId}`} className="text-sm text-citrus-sage hover:text-citrus-forest inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />Back to Pool Home
        </Link>
      </div>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="h-6 w-6 text-citrus-orange" />
              <h1 className="text-xl sm:text-2xl font-varsity font-black uppercase text-citrus-forest">Bracket Challenge</h1>
            </div>
            <p className="text-xs text-citrus-charcoal/70 mt-1">
              Pick winners & game counts. Points double each round (2 → 4 → 8 → 16).
            </p>
          </div>
          {dirty && (
            <Button onClick={savePicks} disabled={saving} className="bg-citrus-sage hover:bg-citrus-sage/90 text-citrus-forest font-display font-bold">
              <Save className="h-4 w-4 mr-2" />{saving ? 'Saving...' : 'Save Picks'}
            </Button>
          )}
        </div>

        {/* Series picks by round */}
        <div className="space-y-5">
          {[1, 2, 3, 4].map(round => {
            const rs = seriesByRound[round] || [];
            if (rs.length === 0) return null;
            const pointsForRound = round === 4 ? 16 : round === 3 ? 8 : round === 2 ? 4 : 2;
            return (
              <Card key={round}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    {ROUND_NAMES[round]}
                    <Badge variant="outline" className="text-[10px]">{pointsForRound} pts each</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {rs.map(s => {
                    const high = s.high_seed_team_id ? teamById.get(s.high_seed_team_id) : null;
                    const low = s.low_seed_team_id ? teamById.get(s.low_seed_team_id) : null;
                    const highInfo = high ? NHL_TEAMS.find(t => t.abbrev === high.team_abbrev) : null;
                    const lowInfo = low ? NHL_TEAMS.find(t => t.abbrev === low.team_abbrev) : null;
                    const myPick = picks.get(s.bracket_slot);
                    const locked = s.series_status !== 'pending';
                    const isActive = s.series_status === 'active';

                    const renderTeamCard = (team: Seed | null, info: typeof NHL_TEAMS[0] | null, isTop: boolean) => {
                      const picked = myPick?.picked_team_id === team?.team_id;
                      const wins = team?.team_id === s.high_seed_team_id ? s.high_seed_wins : s.low_seed_wins;
                      return (
                        <button
                          onClick={() => team && handlePick(s.bracket_slot, team.team_id)}
                          disabled={!team || locked}
                          className={cn(
                            'relative overflow-hidden rounded-lg border-2 p-2.5 text-left transition-all',
                            picked ? 'border-citrus-sage shadow-md ring-1 ring-citrus-sage' : 'border-fantasy-border hover:border-citrus-sage/70',
                            !team && 'opacity-40',
                          )}
                          style={picked && info ? { background: `linear-gradient(135deg, ${info.primaryColor}12, ${info.secondaryColor}08)` } : undefined}
                        >
                          {/* Color bar on left */}
                          {info && (
                            <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: info.primaryColor }} />
                          )}
                          <div className="flex items-center gap-2.5 pl-1.5">
                            {/* Team abbrev badge in team's primary color */}
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-varsity font-black text-white flex-shrink-0 shadow-sm"
                              style={info ? { background: info.primaryColor } : { background: '#6b7280' }}
                            >
                              {team?.team_abbrev || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-mono text-citrus-charcoal/60">#{team?.seed || '-'}</span>
                                <span className="text-sm font-display font-bold truncate" style={info ? { color: info.primaryColor } : undefined}>
                                  {info?.name || team?.team_abbrev || 'TBD'}
                                </span>
                              </div>
                              <div className="text-[10px] text-citrus-charcoal/60 truncate">
                                {team && team.wins !== undefined && team.wins !== null
                                  ? `${team.wins}-${team.losses}-${team.ot_losses} · ${team.points} pts`
                                  : (info?.fullName || '')}
                              </div>
                            </div>
                            {picked && (
                              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={info ? { background: info.primaryColor } : { background: '#7A9B7A' }}>
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            )}
                            {(isActive || locked) && wins !== undefined && (
                              <div className={cn('font-varsity text-xl flex-shrink-0', wins >= 4 ? 'text-citrus-forest font-black' : 'text-citrus-charcoal/70')}>
                                {wins}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    };

                    // Find today's live game for this series
                    const seriesGame = liveGames.find(g =>
                      (g.home_team === high?.team_abbrev && g.away_team === low?.team_abbrev) ||
                      (g.home_team === low?.team_abbrev && g.away_team === high?.team_abbrev)
                    );
                    const gameIsLive = seriesGame && seriesGame.status === 'live';
                    const gameIsFinal = seriesGame && seriesGame.status === 'final';

                    return (
                      <div key={s.series_id} className={cn('border-2 rounded-xl p-3 space-y-2 bg-white relative',
                          (isActive || gameIsLive) && 'border-red-400 bg-red-50/20 ring-1 ring-red-400/20',
                          locked && s.series_status === 'final' && 'border-citrus-sage/40 bg-citrus-sage/5',
                          !locked && !isActive && !gameIsLive && 'border-fantasy-border',
                      )}>
                        {/* LIVE ribbon */}
                        {(isActive || gameIsLive) && (
                          <div className="absolute -top-2 right-3 flex items-center gap-1 bg-red-600 text-white text-[9px] font-varsity font-black uppercase px-2 py-0.5 rounded-full shadow-md">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                            </span>
                            LIVE
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] uppercase font-display font-bold text-citrus-charcoal/60">Series {String.fromCharCode(64 + s.bracket_slot)}</span>
                            {s.conference && (
                              <Badge variant="outline" className={cn('text-[9px] px-1 py-0', s.conference === 'Eastern' ? 'border-blue-300 text-blue-700' : 'border-orange-300 text-orange-700')}>
                                {s.conference === 'Eastern' ? 'EAST' : 'WEST'}
                              </Badge>
                            )}
                          </div>
                          {!isActive && !gameIsLive && s.series_status === 'final' && <Badge className="bg-citrus-sage text-white text-[9px]">FINAL</Badge>}
                          {!isActive && !gameIsLive && !locked && <Badge variant="outline" className="text-[9px]">PENDING</Badge>}
                        </div>
                        {/* Live game score overlay */}
                        {seriesGame && (seriesGame.status === 'live' || seriesGame.status === 'final') && (
                          <div className={cn(
                            'flex items-center justify-between px-3 py-1.5 rounded-lg text-sm',
                            gameIsLive ? 'bg-red-100/80 border border-red-300' : 'bg-citrus-sage/10 border border-citrus-sage/20'
                          )}>
                            <span className="font-mono font-bold">{seriesGame.away_team} {seriesGame.away_score}</span>
                            <span className={cn('text-[10px] font-display', gameIsLive && 'text-red-700 font-bold animate-pulse')}>
                              {gameIsLive ? `${seriesGame.period || ''} ${seriesGame.period_time || ''}`.trim() : 'Final'}
                            </span>
                            <span className="font-mono font-bold">{seriesGame.home_score} {seriesGame.home_team}</span>
                            {seriesGame.series_game_number && (
                              <Badge variant="outline" className="text-[8px] ml-1">G{seriesGame.series_game_number}</Badge>
                            )}
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-2">
                          {renderTeamCard(high, highInfo, true)}
                          {renderTeamCard(low, lowInfo, false)}
                        </div>
                        {/* Season H2H record */}
                        {h2hMap[s.bracket_slot] && h2hMap[s.bracket_slot].games > 0 && (
                          <div className="flex items-center justify-center gap-1.5 text-[10px] text-citrus-charcoal/60 pt-1 border-t border-fantasy-border/40">
                            <span className="font-mono">Season H2H:</span>
                            <span className="font-semibold" style={highInfo ? { color: highInfo.primaryColor } : undefined}>
                              {high?.team_abbrev} {h2hMap[s.bracket_slot].high_wins}
                            </span>
                            <span className="text-citrus-charcoal/40">—</span>
                            <span className="font-semibold" style={lowInfo ? { color: lowInfo.primaryColor } : undefined}>
                              {h2hMap[s.bracket_slot].low_wins} {low?.team_abbrev}
                            </span>
                            <span className="text-citrus-charcoal/40">({h2hMap[s.bracket_slot].games} games)</span>
                          </div>
                        )}
                        {myPick?.picked_team_id && !locked && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-citrus-charcoal/60">In:</span>
                            {[4, 5, 6, 7].map(g => (
                              <button
                                key={g}
                                onClick={() => handleGames(s.bracket_slot, g)}
                                className={cn(
                                  'px-2 py-0.5 rounded border text-[11px] transition-colors',
                                  myPick.predicted_games === g ? 'border-citrus-orange bg-citrus-orange/10 font-bold' : 'border-citrus-border hover:border-citrus-orange',
                                )}
                              >
                                {g}
                              </button>
                            ))}
                            <span className="text-[10px] text-citrus-charcoal/50 ml-1">+1 if correct</span>
                          </div>
                        )}
                        {locked && myPick?.points_earned != null && (
                          <div className="text-xs text-right">
                            <span className={cn('font-bold', (myPick.points_earned ?? 0) > 0 ? 'text-citrus-sage' : 'text-citrus-charcoal/50')}>
                              {myPick.points_earned ?? 0} pts
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {series.length === 0 && (
          <Card className="p-8 text-center">
            <AlertTriangle className="h-8 w-8 text-citrus-charcoal/30 mx-auto mb-2" />
            <p className="text-citrus-charcoal/60 text-sm">Bracket not yet set. Picks open once seeds are finalized.</p>
          </Card>
        )}
      </div>
    </div>
    </>
  );
}
