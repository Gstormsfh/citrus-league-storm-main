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
  parent_slot_a?: number | null;
  parent_slot_b?: number | null;
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

  // League settings relevant to bracket pick UI
  const [pickMode, setPickMode] = useState<'round-by-round' | 'full-bracket'>('round-by-round');
  const [lockDeadline, setLockDeadline] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    const fetchLeagueSettings = async () => {
      try {
        const session = (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session;
        const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
        const res = await fetch(`/api/leagues/${leagueId}`, { headers }).then(r => r.json()).catch(() => null);
        const lg = res?.data || res;
        const settings = lg?.settings || {};
        setPickMode(settings.playoffBracketPickMode === 'full-bracket' ? 'full-bracket' : 'round-by-round');
        setLockDeadline(settings.playoffRosterLockedAt || null);
      } catch { /* non-critical */ }
    };
    fetchLeagueSettings();
  }, [leagueId]);

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

  // Global lock for full-bracket mode: once the lockDeadline has passed,
  // NO picks can be changed regardless of series status.
  const isGloballyLocked = useMemo(() => {
    if (pickMode !== 'full-bracket' || !lockDeadline) return false;
    return new Date(lockDeadline).getTime() <= Date.now();
  }, [pickMode, lockDeadline]);

  const handlePick = (slot: number, teamId: number) => {
    const s = series.find(x => x.bracket_slot === slot);
    if (!s) return;

    // Full-bracket: nothing is locked before the global deadline — users
    // can pick any series including ones already finalized. Industry
    // standard for bracket pools (Yahoo, ESPN, CBS use deadline-only
    // locking). After the deadline, everything is locked.
    if (pickMode === 'full-bracket') {
      if (isGloballyLocked) return;
    } else {
      // Round-by-round: legacy behavior — only pick when series is 'pending'
      if (s.series_status !== 'pending') return;
    }

    const next = new Map(picks);
    const existing = next.get(slot);
    next.set(slot, { ...(existing || {}), series_slot: slot, picked_team_id: teamId });

    // Full-bracket cascade: if the user CHANGES their R1 pick, clear any
    // downstream picks that depended on the team they just swapped out.
    // Otherwise a user could have "picked CAR in R1" then "picked OTT in
    // R2" which is nonsensical.
    if (pickMode === 'full-bracket') {
      const childSlots = series.filter(x => x.parent_slot_a === slot || x.parent_slot_b === slot);
      for (const child of childSlots) {
        const childPick = next.get(child.bracket_slot);
        // The child's available teams are whoever the user picked in
        // parent_slot_a + parent_slot_b. If the child's pick is now
        // invalid (the team they picked was just swapped OUT of the
        // parent), clear the child and everything downstream.
        if (childPick) {
          const parentA = next.get(child.parent_slot_a!);
          const parentB = next.get(child.parent_slot_b!);
          const validTeams = [parentA?.picked_team_id, parentB?.picked_team_id].filter(Boolean);
          if (!validTeams.includes(childPick.picked_team_id)) {
            // Recursively clear this and all its descendants
            const clearChain = (fromSlot: number) => {
              next.delete(fromSlot);
              series.filter(x => x.parent_slot_a === fromSlot || x.parent_slot_b === fromSlot)
                .forEach(descendant => clearChain(descendant.bracket_slot));
            };
            clearChain(child.bracket_slot);
          }
        }
      }
    }

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

  if (loading) return <div className="min-h-screen flex items-center justify-center text-white/55">Loading...</div>;

  return (
    <>
    <Navbar />
    <div className="min-h-screen bg-pastel-surface text-pastel-cream py-6 px-4 pt-24">
      <div className="max-w-6xl mx-auto mb-3">
        <Link to={`/pool/playoff-hub?league=${leagueId}`} className="text-sm text-pastel-sage-soft hover:text-pastel-cream inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />Back to Pool Home
        </Link>
      </div>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="h-6 w-6 text-pastel-orange" />
              <h1 className="text-xl sm:text-2xl font-calistoga text-pastel-cream">Bracket Challenge</h1>
              {pickMode === 'full-bracket' && (
                <Badge className={cn(
                  'text-[10px] font-display font-bold',
                  isGloballyLocked ? 'bg-white/5 ring-1 ring-white/10 text-white/55' : 'bg-pastel-orange text-pastel-surface'
                )}>
                  {isGloballyLocked ? <><Lock className="h-3 w-3 mr-1" />BRACKET LOCKED</> : 'FULL BRACKET MODE'}
                </Badge>
              )}
            </div>
            <p className="text-xs text-white/70 mt-1">
              {pickMode === 'full-bracket'
                ? isGloballyLocked
                  ? 'Your picks are locked. Track how your bracket survives each round.'
                  : `Pick ALL 15 series — including the Stanley Cup champion — before the deadline. R2+ matchups fill in based on your R1 picks. Points double each round (2 → 4 → 8 → 16).`
                : 'Pick winners & game counts. Points double each round (2 → 4 → 8 → 16).'}
            </p>
            {pickMode === 'full-bracket' && !isGloballyLocked && (
              <div className="mt-2 text-[11px] font-display text-white/70">
                <span className="font-bold">Picks made:</span> {picks.size} / 15
                {picks.size < 15 && <span className="text-pastel-orange ml-2">· {15 - picks.size} remaining</span>}
              </div>
            )}
          </div>
          {dirty && (
            <Button onClick={savePicks} disabled={saving} className="bg-pastel-sage text-pastel-surface hover:bg-pastel-sage-soft font-bold shadow-[0_4px_12px_-4px_rgba(166,211,160,0.4)]">
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
                    // In full-bracket mode, R2+ matchups show the teams the
                    // USER picked in the parent slots (their projected bracket
                    // flowing forward). In round-by-round mode, only show the
                    // real matchup once the API fills it in.
                    let high: Seed | null = s.high_seed_team_id ? teamById.get(s.high_seed_team_id) ?? null : null;
                    let low: Seed | null = s.low_seed_team_id ? teamById.get(s.low_seed_team_id) ?? null : null;
                    if (pickMode === 'full-bracket' && s.round > 1 && (!high || !low)) {
                      const parentAPick = s.parent_slot_a ? picks.get(s.parent_slot_a) : null;
                      const parentBPick = s.parent_slot_b ? picks.get(s.parent_slot_b) : null;
                      if (!high && parentAPick) high = teamById.get(parentAPick.picked_team_id) ?? null;
                      if (!low && parentBPick) low = teamById.get(parentBPick.picked_team_id) ?? null;
                    }
                    const highInfo = high ? NHL_TEAMS.find(t => t.abbrev === high.team_abbrev) : null;
                    const lowInfo = low ? NHL_TEAMS.find(t => t.abbrev === low.team_abbrev) : null;
                    const myPick = picks.get(s.bracket_slot);
                    // Lock semantics differ by mode:
                    //   round-by-round: series locks once it starts (status !== 'pending')
                    //   full-bracket:   only the global deadline locks; finalized
                    //                   series remain pickable until then
                    const locked = pickMode === 'full-bracket'
                      ? isGloballyLocked
                      : s.series_status !== 'pending';
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
                            picked ? 'ring-2 ring-pastel-sage/60 bg-pastel-sage/10 shadow-[0_4px_12px_-4px_rgba(166,211,160,0.3)]' : 'ring-1 ring-white/10 bg-white/5 hover:ring-pastel-sage/40',
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
                              className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-calistoga font-black text-white flex-shrink-0 shadow-sm"
                              style={info ? { background: info.primaryColor } : { background: '#6b7280' }}
                            >
                              {team?.team_abbrev || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-mono text-white/55">#{team?.seed || '-'}</span>
                                <span className="text-sm font-display font-bold truncate" style={info ? { color: info.primaryColor } : undefined}>
                                  {info?.name || team?.team_abbrev || 'TBD'}
                                </span>
                              </div>
                              <div className="text-[10px] text-white/55 truncate">
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
                              <div className={cn('font-calistoga text-xl flex-shrink-0', wins >= 4 ? 'text-pastel-cream font-black' : 'text-white/70')}>
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
                      <div key={s.series_id} className={cn('rounded-xl p-3 space-y-2 bg-white/5 ring-1 ring-white/10 relative',
                          gameIsLive && 'bg-red-400/10 ring-1 ring-red-400/30',
                          locked && s.series_status === 'final' && 'ring-1 ring-pastel-sage/30 bg-pastel-sage/8',
                      )}>
                        {/* LIVE ribbon — only when a game is ACTUALLY in progress */}
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
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] uppercase font-display font-bold text-white/55">Series {String.fromCharCode(64 + s.bracket_slot)}</span>
                            {s.conference && (
                              <Badge variant="outline" className={cn('text-[9px] px-1 py-0', s.conference === 'Eastern' ? 'border-blue-300 text-blue-700' : 'border-orange-300 text-orange-700')}>
                                {s.conference === 'Eastern' ? 'EAST' : 'WEST'}
                              </Badge>
                            )}
                          </div>
                          {s.series_status === 'final' && <Badge className="bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft border-0 text-[9px] font-jbmono uppercase tracking-[0.18em] font-bold">Series Final</Badge>}
                          {isActive && !gameIsLive && <Badge className="text-[9px] bg-pastel-orange/15 ring-1 ring-pastel-orange/40 text-pastel-orange-soft border-0 font-jbmono tabular-nums">{s.high_seed_wins}-{s.low_seed_wins}</Badge>}
                          {!isActive && !locked && <Badge variant="outline" className="text-[9px]">PENDING</Badge>}
                        </div>
                        {/* Live game score overlay */}
                        {seriesGame && (seriesGame.status === 'live' || seriesGame.status === 'final') && (
                          <div className={cn(
                            'flex items-center justify-between px-3 py-1.5 rounded-lg text-sm',
                            gameIsLive ? 'bg-red-400/20 ring-1 ring-red-400/40' : 'bg-pastel-sage/10 ring-1 ring-pastel-sage/30'
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
                          <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/55 pt-1 border-t border-fantasy-border/40">
                            <span className="font-mono">Season H2H:</span>
                            <span className="font-semibold" style={highInfo ? { color: highInfo.primaryColor } : undefined}>
                              {high?.team_abbrev} {h2hMap[s.bracket_slot].high_wins}
                            </span>
                            <span className="text-white/40">—</span>
                            <span className="font-semibold" style={lowInfo ? { color: lowInfo.primaryColor } : undefined}>
                              {h2hMap[s.bracket_slot].low_wins} {low?.team_abbrev}
                            </span>
                            <span className="text-white/40">({h2hMap[s.bracket_slot].games} games)</span>
                          </div>
                        )}
                        {myPick?.picked_team_id && !locked && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-white/55">In:</span>
                            {[4, 5, 6, 7].map(g => (
                              <button
                                key={g}
                                onClick={() => handleGames(s.bracket_slot, g)}
                                className={cn(
                                  'px-2 py-0.5 rounded border text-[11px] transition-colors',
                                  myPick.predicted_games === g ? 'ring-2 ring-pastel-orange/60 bg-pastel-orange/15 text-pastel-orange-soft font-bold' : 'ring-1 ring-white/10 bg-white/5 text-white/55 hover:ring-pastel-orange/40 hover:text-pastel-cream',
                                )}
                              >
                                {g}
                              </button>
                            ))}
                            <span className="text-[10px] text-white/50 ml-1">+1 if correct</span>
                          </div>
                        )}
                        {/* Pick summary: always visible when a pick exists */}
                        {myPick?.picked_team_id && (locked || myPick.predicted_games) && (
                          <div className="flex items-center justify-between text-xs pt-1 border-t border-fantasy-border/30">
                            <div className="flex items-center gap-1.5 text-white/70">
                              <Check className="h-3 w-3 text-pastel-sage-soft" />
                              <span className="font-display font-semibold">
                                {(() => {
                                  const pickedSeed = teamById.get(myPick.picked_team_id);
                                  const pickedInfo = pickedSeed ? NHL_TEAMS.find(t => t.abbrev === pickedSeed.team_abbrev) : null;
                                  return pickedInfo?.name || pickedSeed?.team_abbrev || 'TBD';
                                })()}
                                {myPick.predicted_games ? ` in ${myPick.predicted_games}` : ''}
                              </span>
                            </div>
                            {locked && myPick.points_earned != null && (
                              <span className={cn('font-bold', (myPick.points_earned ?? 0) > 0 ? 'text-pastel-sage-soft' : 'text-white/55')}>
                                {myPick.points_earned ?? 0} pts
                              </span>
                            )}
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
            <p className="text-white/55 text-sm">Bracket not yet set. Picks open once seeds are finalized.</p>
          </Card>
        )}
      </div>
    </div>
    </>
  );
}
