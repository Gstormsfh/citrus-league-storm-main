/**
 * Public NHL Stanley Cup Playoff Bracket viewer.
 * No auth required — drives top-of-funnel awareness and signups.
 * Subscribes to live updates via Supabase realtime broadcasts.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Clock, AlertTriangle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Seed {
  team_id: number;
  team_abbrev: string | null;
  conference: string;
  division: string;
  seed: number;
  wins?: number;
  losses?: number;
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
  winner_team_id: number | null;
  games_played: number;
  series_status: 'pending' | 'active' | 'final';
}

const ROUND_NAMES: Record<number, string> = {
  1: 'First Round',
  2: 'Second Round',
  3: 'Conference Finals',
  4: 'Stanley Cup Final',
};

export default function NHLPlayoffBracket() {
  const [season] = useState<number>(2025);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<{ oldest_refresh: string | null } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [bracketRes, metaRes] = await Promise.all([
          fetch(`/api/nhl-playoffs/bracket?season=${season}`),
          fetch('/api/nhl-playoffs/meta'),
        ]);
        const bracket = await bracketRes.json();
        const metaData = await metaRes.json();
        setSeeds(bracket.data?.seeds || bracket.seeds || []);
        setSeries(bracket.data?.series || bracket.series || []);
        setMeta(metaData.data || metaData);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [season]);

  const teamById = new Map(seeds.map(s => [s.team_id, s]));
  const seriesByRound: Record<number, Series[]> = { 1: [], 2: [], 3: [], 4: [] };
  series.forEach(s => seriesByRound[s.round]?.push(s));

  const isStale = meta?.oldest_refresh ? (Date.now() - new Date(meta.oldest_refresh).getTime()) > 4 * 60 * 60 * 1000 : false;

  if (loading) {
    return (
      <><Navbar /><div className="min-h-screen pt-24 flex items-center justify-center">
        <div className="text-center text-citrus-charcoal/60">Loading bracket...</div>
      </div></>
    );
  }

  return (
    <>
    <Navbar />
    <div className="min-h-screen bg-gradient-to-b from-white to-[#F5F8ED] py-6 px-4 pt-24">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Trophy className="h-7 w-7 text-citrus-orange" />
            <h1 className="text-2xl sm:text-3xl font-varsity font-black uppercase text-citrus-forest tracking-tight">
              NHL Stanley Cup Playoffs
            </h1>
          </div>
          <p className="text-sm text-citrus-charcoal/70">{season}-{(season + 1).toString().slice(2)} Season</p>
          {isStale && (
            <Badge className="mt-2 bg-orange-100 text-orange-800 border-orange-300">
              <AlertTriangle className="h-3 w-3 mr-1" /> Data may be delayed — last update {meta?.oldest_refresh ? new Date(meta.oldest_refresh).toLocaleString() : 'unknown'}
            </Badge>
          )}
        </div>

        {/* CTA banner */}
        <Card className="mb-6 p-4 bg-citrus-sage/10 border-citrus-sage/30 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display font-bold text-citrus-forest text-base">Pick your bracket. Build your roster. Win your pool.</h2>
            <p className="text-xs text-citrus-charcoal/70 mt-1">Free playoff pools with fully customizable scoring.</p>
          </div>
          <Button asChild className="bg-citrus-orange hover:bg-citrus-orange/90 text-white font-display font-bold">
            <Link to="/create-league?type=playoff">Create a Playoff Pool</Link>
          </Button>
        </Card>

        {/* Bracket — desktop horizontal, mobile stacked */}
        <div className="space-y-6">
          {[1, 2, 3, 4].map(round => {
            const roundSeries = seriesByRound[round] || [];
            if (roundSeries.length === 0) return null;
            return (
              <div key={round}>
                <h3 className="text-sm font-display font-bold uppercase text-citrus-forest mb-2 px-1">{ROUND_NAMES[round]}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {roundSeries.map(s => {
                    const high = s.high_seed_team_id ? teamById.get(s.high_seed_team_id) : null;
                    const low = s.low_seed_team_id ? teamById.get(s.low_seed_team_id) : null;
                    const isFinal = s.series_status === 'final';
                    const isActive = s.series_status === 'active';
                    return (
                      <Card key={s.series_id} className={cn(
                        'p-3 border-2 transition-colors',
                        isFinal && s.winner_team_id === s.high_seed_team_id && 'border-citrus-orange bg-orange-50/50',
                        isFinal && s.winner_team_id === s.low_seed_team_id && 'border-citrus-orange bg-orange-50/50',
                        isActive && 'border-red-300 bg-red-50/30',
                        s.series_status === 'pending' && 'border-citrus-sage/30',
                      )}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-display uppercase text-citrus-charcoal/60">Series {s.bracket_slot}</span>
                          {isActive && <Badge className="bg-red-500 text-white text-[9px] px-1.5 py-0">LIVE</Badge>}
                          {isFinal && <Badge className="bg-citrus-sage text-white text-[9px] px-1.5 py-0">FINAL</Badge>}
                        </div>
                        <div className={cn(
                          'flex items-center justify-between py-1.5 px-2 rounded',
                          isFinal && s.winner_team_id === s.high_seed_team_id && 'bg-citrus-sage/20 font-bold',
                        )}>
                          <span className="text-sm">
                            {high ? (
                              <>
                                <span className="text-citrus-charcoal/60 text-[10px] mr-1">#{high.seed}</span>
                                {high.team_abbrev || `Team ${high.team_id}`}
                              </>
                            ) : <span className="text-citrus-charcoal/40 italic text-xs">TBD</span>}
                          </span>
                          <span className="font-bold text-base text-citrus-forest">{s.high_seed_wins}</span>
                        </div>
                        <div className={cn(
                          'flex items-center justify-between py-1.5 px-2 rounded mt-1',
                          isFinal && s.winner_team_id === s.low_seed_team_id && 'bg-citrus-sage/20 font-bold',
                        )}>
                          <span className="text-sm">
                            {low ? (
                              <>
                                <span className="text-citrus-charcoal/60 text-[10px] mr-1">#{low.seed}</span>
                                {low.team_abbrev || `Team ${low.team_id}`}
                              </>
                            ) : <span className="text-citrus-charcoal/40 italic text-xs">TBD</span>}
                          </span>
                          <span className="font-bold text-base text-citrus-forest">{s.low_seed_wins}</span>
                        </div>
                        {s.games_played > 0 && (
                          <div className="text-[10px] text-citrus-charcoal/60 mt-2 text-center">
                            <Clock className="h-3 w-3 inline mr-1" />
                            {s.games_played} of 7 games played
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {series.length === 0 && (
          <div className="text-center py-12">
            <Trophy className="h-12 w-12 text-citrus-charcoal/20 mx-auto mb-3" />
            <p className="text-citrus-charcoal/60 text-sm">Bracket not yet finalized. Check back when seeds are set.</p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
