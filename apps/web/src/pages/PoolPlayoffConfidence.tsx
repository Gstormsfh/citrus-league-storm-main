/**
 * Playoff Confidence Pool page.
 *
 * Industry standard: assign confidence values (1-N, each used once)
 * to playoff series winners. Higher confidence = more points if correct.
 *
 * Cumulative mode: 15 values (1-15) across all 4 rounds, each used once.
 * Per-round mode: 1-8 in R1, 1-4 in R2, 1-2 in CF, 1 in SCF.
 */

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Trophy, Lock, Save, AlertTriangle, ChevronDown, ChevronUp, Check, ArrowLeft } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { StormyLoading } from '@/components/citrus2';
import { NHL_TEAMS } from '@/types/captracker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Seed {
  team_id: number;
  team_abbrev: string | null;
  seed: number;
  conference: string;
  wins?: number | null;
  losses?: number | null;
  ot_losses?: number | null;
  points?: number | null;
  row_wins?: number | null;
}

interface Series {
  series_id: string;
  round: number;
  bracket_slot: number;
  conference: string | null;
  high_seed_team_id: number | null;
  low_seed_team_id: number | null;
  series_status: 'pending' | 'active' | 'final';
  winner_team_id: number | null;
  high_seed_wins: number;
  low_seed_wins: number;
}

interface ConfPick {
  series_slot: number;
  picked_team_id: number;
  confidence_value: number;
}

const ROUND_NAMES: Record<number, string> = {
  1: 'First Round', 2: 'Second Round', 3: 'Conference Finals', 4: 'Stanley Cup Final',
};

export default function PoolPlayoffConfidence() {
  const [params] = useSearchParams();
  const leagueId = params.get('league') || '';
  const { user } = useAuth();
  const { toast } = useToast();

  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [picks, setPicks] = useState<Map<number, ConfPick>>(new Map());
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

  // Total series = available confidence values (cumulative: 1-N)
  const totalSeries = series.length;

  useEffect(() => {
    if (!leagueId || !user) return;
    const load = async () => {
      try {
        const [bracketRes, picksRes, h2hRes] = await Promise.all([
          fetch('/api/nhl-playoffs/bracket?season=2025').then(r => r.json()),
          fetch(`/api/playoff-pools/${leagueId}/picks?type=confidence`, {
            headers: { Authorization: `Bearer ${(await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session?.access_token || ''}` },
          }).then(r => r.json()),
          fetch('/api/nhl-playoffs/h2h?season=2025').then(r => r.json()).catch(() => null),
        ]);
        setSeeds(bracketRes.data?.seeds || bracketRes.seeds || []);
        setSeries(bracketRes.data?.series || bracketRes.series || []);
        if (h2hRes?.data?.h2h) setH2hMap(h2hRes.data.h2h);
        else if (h2hRes?.h2h) setH2hMap(h2hRes.h2h);
        const myPicks = (picksRes.data?.picks || picksRes.picks || []).filter((p: ConfPick & { user_id: string }) => p.user_id === user.id);
        const m = new Map<number, ConfPick>();
        myPicks.forEach((p: ConfPick) => m.set(p.series_slot, p));
        setPicks(m);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [leagueId, user]);

  const teamById = useMemo(() => new Map(seeds.map(s => [s.team_id, s])), [seeds]);

  // Available confidence values (ones not yet assigned)
  const usedValues = useMemo(() => new Set(Array.from(picks.values()).map(p => p.confidence_value)), [picks]);
  const availableValues = useMemo(() => {
    const all = Array.from({ length: totalSeries }, (_, i) => i + 1);
    return all.filter(v => !usedValues.has(v)).sort((a, b) => b - a);
  }, [totalSeries, usedValues]);

  const setPickTeam = (slot: number, teamId: number) => {
    const s = series.find(x => x.bracket_slot === slot);
    if (!s || s.series_status !== 'pending') return;
    const next = new Map(picks);
    const existing = next.get(slot);
    next.set(slot, { series_slot: slot, picked_team_id: teamId, confidence_value: existing?.confidence_value || 0 });
    setPicks(next);
    setDirty(true);
  };

  const setPickConfidence = (slot: number, value: number) => {
    const next = new Map(picks);
    const existing = next.get(slot);
    if (!existing) return;
    // Remove the old value from any other pick that had it
    next.forEach((p, k) => {
      if (k !== slot && p.confidence_value === value) {
        next.set(k, { ...p, confidence_value: 0 });
      }
    });
    next.set(slot, { ...existing, confidence_value: value });
    setPicks(next);
    setDirty(true);
  };

  const savePicks = async () => {
    const validPicks = Array.from(picks.values()).filter(p => p.picked_team_id && p.confidence_value > 0);
    if (validPicks.length === 0) {
      toast({ title: 'No complete picks', description: 'Pick a winner AND assign confidence for at least one series.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const session = (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session;
      const res = await fetch('/api/playoff-pools/confidence/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ leagueId, picks: validPicks }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast({ title: 'Confidence picks saved!', description: `${validPicks.length} picks with confidence values.` });
      setDirty(false);
    } catch (err) {
      toast({ title: 'Failed to save', description: String(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const totalConfidence = useMemo(() => Array.from(picks.values()).reduce((s, p) => s + (p.confidence_value || 0), 0), [picks]);

  if (loading) return <><Navbar /><div className="min-h-screen pt-24 flex items-center justify-center bg-pastel-surface"><StormyLoading message="Loading pool..." /></div></>;

  return (
    <>
    <Navbar />
    <div className="min-h-screen bg-pastel-surface text-pastel-cream py-6 px-4 pt-24">
      <div className="max-w-5xl mx-auto mb-3">
        <Link to={`/pool/playoff-hub?league=${leagueId}`} className="text-sm text-pastel-sage-soft hover:text-pastel-cream inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />Back to Pool Home
        </Link>
      </div>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-calistoga text-pastel-cream flex items-center gap-2">
              <Trophy className="h-6 w-6 text-pastel-orange" />
              Confidence Pool
            </h1>
            <p className="text-xs text-white/70 mt-1">
              Pick series winners. Assign confidence 1-{totalSeries} (each value used once). Higher = more risk, more reward.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] text-white/55 uppercase font-display">Total confidence</div>
              <div className="text-lg font-bold text-pastel-orange">{totalConfidence}</div>
            </div>
            {dirty && (
              <Button onClick={savePicks} disabled={saving} className="bg-pastel-sage text-pastel-surface hover:bg-pastel-sage-soft font-bold shadow-[0_4px_12px_-4px_rgba(166,211,160,0.4)]">
                <Save className="h-4 w-4 mr-1" />{saving ? 'Saving...' : 'Save'}
              </Button>
            )}
          </div>
        </div>

        {/* Available confidence bank */}
        {availableValues.length > 0 && (
          <Card className="mb-4 bg-pastel-surface-tile border-0 ring-1 ring-pastel-orange/30 rounded-2xl p-3 shadow-[0_8px_24px_-12px_rgba(255,168,87,0.2)]">
            <div className="text-[10px] font-display font-bold uppercase text-white/50 mb-2">Available Confidence Points</div>
            <div className="flex flex-wrap gap-1.5">
              {availableValues.map(v => (
                <div key={v} className="w-8 h-8 rounded-full bg-pastel-orange/15 ring-1 ring-pastel-orange/40 flex items-center justify-center text-xs font-bold text-pastel-orange-soft shadow-[0_4px_12px_-4px_rgba(255,168,87,0.3)]">
                  {v}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Series by round */}
        <div className="space-y-5">
          {[1, 2, 3, 4].map(round => {
            const roundSeries = (series.filter(s => s.round === round)).sort((a, b) => a.bracket_slot - b.bracket_slot);
            if (roundSeries.length === 0) return null;
            return (
              <Card key={round}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-display">{ROUND_NAMES[round]}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {roundSeries.map(s => {
                    const high = s.high_seed_team_id ? teamById.get(s.high_seed_team_id) : null;
                    const low = s.low_seed_team_id ? teamById.get(s.low_seed_team_id) : null;
                    const pick = picks.get(s.bracket_slot);
                    const locked = s.series_status !== 'pending';
                    const isCorrect = locked && pick && s.winner_team_id === pick.picked_team_id;
                    const isWrong = locked && pick && s.winner_team_id && s.winner_team_id !== pick.picked_team_id;

                    // Live game detection — overlay score on the series card
                    const seriesGame = liveGames.find(g =>
                      (g.home_team === high?.team_abbrev && g.away_team === low?.team_abbrev) ||
                      (g.home_team === low?.team_abbrev && g.away_team === high?.team_abbrev)
                    );
                    const gameIsLive = seriesGame && seriesGame.status === 'live';
                    const gameIsFinal = seriesGame && seriesGame.status === 'final';

                    return (
                      <div key={s.series_id} className={cn(
                        'rounded-lg p-3 space-y-2 transition-colors relative bg-white/5 ring-1 ring-white/10',
                        gameIsLive && 'bg-red-400/10 ring-1 ring-red-400/30',
                        isCorrect && 'bg-pastel-sage/15 ring-1 ring-pastel-sage/40',
                        isWrong && 'bg-red-400/10 ring-1 ring-red-400/40',
                        locked && !isCorrect && !isWrong && !gameIsLive && 'opacity-70',
                      )}>
                        {gameIsLive && (
                          <div className="absolute -top-2 right-3 flex items-center gap-1 bg-red-600 text-white text-[9px] font-calistoga px-2 py-0.5 rounded-full shadow-md">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                            </span>
                            LIVE
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-display text-white/55">Series {s.bracket_slot}</span>
                          {locked && <Badge className="bg-white/5 ring-1 ring-white/10 text-white/55 border-0 text-[9px] font-jbmono uppercase tracking-[0.18em] font-bold"><Lock className="h-3 w-3 mr-1" />Locked</Badge>}
                          {isCorrect && <Badge className="bg-green-500 text-white text-[9px]"><Check className="h-3 w-3 mr-1" />+{pick.confidence_value}</Badge>}
                        </div>

                        {/* Live game score overlay */}
                        {seriesGame && (gameIsLive || gameIsFinal) && (
                          <div className={cn(
                            'flex items-center justify-between px-2 py-1 rounded text-xs',
                            gameIsLive ? 'bg-red-400/20 ring-1 ring-red-400/40' : 'bg-pastel-sage/10 ring-1 ring-pastel-sage/30'
                          )}>
                            <span className="font-mono font-bold">{seriesGame.away_team} {seriesGame.away_score}</span>
                            <span className={cn('text-[10px]', gameIsLive && 'text-red-700 font-bold animate-pulse')}>
                              {gameIsLive ? `${seriesGame.period || ''} ${seriesGame.period_time || ''}`.trim() : 'Final'}
                            </span>
                            <span className="font-mono font-bold">{seriesGame.home_score} {seriesGame.home_team}</span>
                          </div>
                        )}

                        {/* Team picks — rich cards with logos + colors */}
                        <div className="grid grid-cols-1 gap-2">
                          {[{ team: high, id: s.high_seed_team_id }, { team: low, id: s.low_seed_team_id }].map(({ team, id }) => {
                            const info = team ? NHL_TEAMS.find(t => t.abbrev === team.team_abbrev) : null;
                            const picked = pick?.picked_team_id === id;
                            return (
                              <button
                                key={id || 'tbd'}
                                onClick={() => id && setPickTeam(s.bracket_slot, id)}
                                disabled={!id || locked}
                                className={cn(
                                  'relative overflow-hidden rounded-lg p-2.5 text-left transition-all',
                                  'bg-pastel-surface ring-1 ring-white/10',
                                  'focus-visible:ring-2 focus-visible:ring-pastel-orange/40 focus-visible:outline-none',
                                  picked && 'ring-2 ring-pastel-orange/50',
                                  !picked && !locked && 'hover:ring-pastel-orange/30',
                                  !id && 'opacity-40',
                                  locked && !picked && 'opacity-50 cursor-not-allowed',
                                )}
                              >
                                {info && <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: info.primaryColor }} />}
                                <div className="flex items-center gap-2.5 pl-2">
                                  <div
                                    className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-calistoga font-black text-white flex-shrink-0 shadow-sm"
                                    style={info ? { background: info.primaryColor } : { background: '#6b7280' }}
                                  >
                                    {team?.team_abbrev || '?'}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] font-mono text-white/55">#{team?.seed || '-'}</span>
                                      <span className="text-sm font-display font-bold truncate text-pastel-cream">
                                        {info?.name || team?.team_abbrev || 'TBD'}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-white/55 truncate">
                                      {team && team.wins != null
                                        ? `${team.wins}-${team.losses}-${team.ot_losses} · ${team.points} pts`
                                        : (info?.fullName || '')}
                                    </div>
                                  </div>
                                  {picked && (
                                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={info ? { background: info.primaryColor } : { background: '#7A9B7A' }}>
                                      <Check className="w-3 h-3 text-white" />
                                    </div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Season H2H record */}
                        {h2hMap[s.bracket_slot] && h2hMap[s.bracket_slot].games > 0 && high && low && (
                          <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/55 pt-1 border-t border-white/10">
                            <span className="font-mono">Season H2H:</span>
                            <span className="font-semibold text-pastel-cream">
                              {high.team_abbrev} {h2hMap[s.bracket_slot].high_wins}
                            </span>
                            <span className="text-white/40">—</span>
                            <span className="font-semibold text-pastel-cream">
                              {h2hMap[s.bracket_slot].low_wins} {low.team_abbrev}
                            </span>
                            <span className="text-white/40">({h2hMap[s.bracket_slot].games} games)</span>
                          </div>
                        )}

                        {/* Confidence selector */}
                        {pick?.picked_team_id && !locked && (
                          <div>
                            <div className="text-[10px] font-display text-white/50 mb-1">Confidence:</div>
                            <div className="flex flex-wrap gap-1">
                              {Array.from({ length: totalSeries }, (_, i) => i + 1).map(v => {
                                const isUsedElsewhere = usedValues.has(v) && pick.confidence_value !== v;
                                const isSelected = pick.confidence_value === v;
                                return (
                                  <button
                                    key={v}
                                    onClick={() => setPickConfidence(s.bracket_slot, v)}
                                    disabled={isUsedElsewhere}
                                    className={cn(
                                      'w-7 h-7 rounded-full text-[11px] font-bold transition-all border',
                                      isSelected
                                        ? 'bg-pastel-orange text-pastel-surface ring-2 ring-pastel-orange/60 scale-110 shadow-[0_4px_12px_-4px_rgba(255,168,87,0.5)]'
                                        : isUsedElsewhere
                                          ? 'bg-white/5 ring-1 ring-white/10 text-white/30 cursor-not-allowed'
                                          : 'bg-white/5 ring-1 ring-white/10 text-white/55 hover:ring-pastel-orange/40 hover:text-pastel-cream'
                                    )}
                                  >
                                    {v}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {pick?.confidence_value && pick.confidence_value > 0 && locked && (
                          <div className="text-xs text-right font-bold text-white/55">
                            Confidence: {pick.confidence_value}
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
            <AlertTriangle className="h-8 w-8 text-white/30 mx-auto mb-2" />
            <p className="text-white/55 text-sm">Bracket not yet set. Picks open once playoff seeds are finalized.</p>
          </Card>
        )}

        {/* How it works */}
        <Card className="mt-6 bg-pastel-surface-tile border-0 ring-1 ring-pastel-sage/30 rounded-2xl px-4 py-3 shadow-[0_8px_24px_-12px_rgba(166,211,160,0.15)]">
          <div className="text-[10px] font-display font-bold uppercase text-white/50 mb-1">How Confidence Pools Work</div>
          <ul className="text-[11px] text-white/70 space-y-0.5 list-disc pl-3">
            <li>Pick the winner of each playoff series</li>
            <li>Assign a confidence value (1-{totalSeries}) to each pick — each value used exactly once</li>
            <li>If your pick is correct, you earn that many points</li>
            <li>Higher confidence = more points if right, but more risk</li>
            <li>Most total points at the end of the playoffs wins</li>
          </ul>
        </Card>
      </div>
    </div>
    </>
  );
}
