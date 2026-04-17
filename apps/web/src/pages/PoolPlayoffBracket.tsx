/**
 * Playoff Bracket Pickem pool page.
 * Each user picks the winner + predicted # games for each of the 15 series.
 * Points awarded per round per league's pointsPerRound config (Yahoo default: 2/4/8/16).
 */

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trophy, Lock, Check, Save, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface Seed {
  team_id: number;
  team_abbrev: string | null;
  conference: string;
  seed: number;
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

  useEffect(() => {
    if (!leagueId || !user) return;
    const load = async () => {
      try {
        const [bracketRes, picksRes] = await Promise.all([
          fetch('/api/nhl-playoffs/bracket?season=2025'),
          fetch(`/api/playoff-pools/${leagueId}/picks?type=bracket`, {
            headers: { Authorization: `Bearer ${(await import('@/integrations/supabase/client')).supabase.auth.getSession ? (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session?.access_token || '' : ''}` },
          }),
        ]);
        const bracket = await bracketRes.json();
        const picksData = await picksRes.json();
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
    <div className="min-h-screen bg-gradient-to-b from-white to-[#F5F8ED] py-6 px-4">
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
                    const myPick = picks.get(s.bracket_slot);
                    const locked = s.series_status !== 'pending';
                    return (
                      <div key={s.series_id} className={cn('border rounded-lg p-3 space-y-2', locked && 'opacity-75 bg-muted/30')}>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-display text-citrus-charcoal/60">Series {s.bracket_slot}</span>
                          {locked && <Badge className="bg-muted text-[9px]"><Lock className="h-3 w-3 mr-1" />Locked</Badge>}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => high && handlePick(s.bracket_slot, high.team_id)}
                            disabled={!high || locked}
                            className={cn(
                              'p-2 rounded border text-left transition-colors',
                              myPick?.picked_team_id === high?.team_id ? 'border-citrus-sage bg-citrus-sage/10 font-bold' : 'border-citrus-border hover:border-citrus-sage',
                              !high && 'opacity-40',
                            )}
                          >
                            <div className="text-[10px] text-citrus-charcoal/60">#{high?.seed || '-'}</div>
                            <div className="text-sm">{high?.team_abbrev || 'TBD'}</div>
                            {myPick?.picked_team_id === high?.team_id && <Check className="h-3 w-3 inline text-citrus-sage" />}
                          </button>
                          <button
                            onClick={() => low && handlePick(s.bracket_slot, low.team_id)}
                            disabled={!low || locked}
                            className={cn(
                              'p-2 rounded border text-left transition-colors',
                              myPick?.picked_team_id === low?.team_id ? 'border-citrus-sage bg-citrus-sage/10 font-bold' : 'border-citrus-border hover:border-citrus-sage',
                              !low && 'opacity-40',
                            )}
                          >
                            <div className="text-[10px] text-citrus-charcoal/60">#{low?.seed || '-'}</div>
                            <div className="text-sm">{low?.team_abbrev || 'TBD'}</div>
                            {myPick?.picked_team_id === low?.team_id && <Check className="h-3 w-3 inline text-citrus-sage" />}
                          </button>
                        </div>
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
  );
}
