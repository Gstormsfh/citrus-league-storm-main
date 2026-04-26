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
import { NHL_TEAMS } from '@/types/captracker';

interface Seed {
  team_id: number;
  team_abbrev: string | null;
  conference: string;
  division: string;
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

interface LiveGame {
  game_id: number;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: string;
}

export default function NHLPlayoffBracket() {
  const [season] = useState<number>(2025);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<{ oldest_refresh: string | null } | null>(null);
  const [h2hMap, setH2hMap] = useState<Record<number, { high_wins: number; low_wins: number; games: number }>>({});
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [bracketRes, metaRes, h2hRes] = await Promise.all([
          fetch(`/api/nhl-playoffs/bracket?season=${season}`),
          fetch('/api/nhl-playoffs/meta'),
          fetch(`/api/nhl-playoffs/h2h?season=${season}`).catch(() => null),
        ]);
        const bracket = await bracketRes.json();
        const metaData = await metaRes.json();
        const h2hData = h2hRes ? await h2hRes.json().catch(() => null) : null;
        setSeeds(bracket.data?.seeds || bracket.seeds || []);
        setSeries(bracket.data?.series || bracket.series || []);
        setMeta(metaData.data || metaData);
        if (h2hData?.data?.h2h) setH2hMap(h2hData.data.h2h);
        else if (h2hData?.h2h) setH2hMap(h2hData.h2h);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [season]);

  // Live games refresh on a tighter cadence — drives the LIVE badge
  useEffect(() => {
    const fetchLive = async () => {
      try {
        const res = await fetch(`/api/nhl-playoffs/live-games?season=${season}`);
        const json = await res.json();
        setLiveGames(json.data?.games || json.games || []);
      } catch { /* non-critical */ }
    };
    fetchLive();
    const interval = setInterval(fetchLive, 30_000);
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
        </div>

        {/* CTA banner */}
        <Card className="mb-6 p-4 bg-citrus-sage/10 border-citrus-sage/30 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display font-bold text-citrus-forest text-base">Pick your bracket. Build your roster. Win your pool.</h2>
            <p className="text-xs text-citrus-charcoal/70 mt-1">Free playoff pools with fully customizable scoring.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild className="bg-citrus-orange hover:bg-citrus-orange/90 text-white font-display font-bold">
              <Link to="/create-league?type=playoff">Create Pool</Link>
            </Button>
            <Button asChild variant="outline" className="border-citrus-sage text-citrus-forest font-display font-bold">
              <Link to="/create-league?tab=join">Join Pool</Link>
            </Button>
          </div>
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
                    const highInfo = high ? NHL_TEAMS.find(t => t.abbrev === high.team_abbrev) : null;
                    const lowInfo = low ? NHL_TEAMS.find(t => t.abbrev === low.team_abbrev) : null;
                    const isFinal = s.series_status === 'final';
                    const gameIsLive = !!liveGames.find(g =>
                      (g.home_team === high?.team_abbrev && g.away_team === low?.team_abbrev) ||
                      (g.home_team === low?.team_abbrev && g.away_team === high?.team_abbrev)
                    );
                    const h2h = h2hMap[s.bracket_slot];

                    const renderTeamRow = (team: Seed | null, info: typeof NHL_TEAMS[0] | null, wins: number) => {
                      const isWinner = isFinal && team && s.winner_team_id === team.team_id;
                      return (
                        <div className={cn(
                          'relative flex items-center gap-2 py-1.5 px-2 rounded overflow-hidden',
                          isWinner && 'font-bold',
                        )}
                        style={isWinner && info ? { background: `linear-gradient(90deg, ${info.primaryColor}15, transparent)` } : undefined}
                        >
                          {info && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: info.primaryColor }} />}
                          {team ? (
                            <>
                              <div
                                className="w-8 h-8 rounded flex items-center justify-center text-[9px] font-varsity font-black text-white flex-shrink-0"
                                style={info ? { background: info.primaryColor } : { background: '#6b7280' }}
                              >
                                {team.team_abbrev}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] font-mono text-citrus-charcoal/60">#{team.seed}</span>
                                  <span className="text-xs font-display font-bold truncate" style={info ? { color: info.primaryColor } : undefined}>
                                    {info?.name || team.team_abbrev}
                                  </span>
                                </div>
                                {team.wins != null && (
                                  <div className="text-[9px] text-citrus-charcoal/60 truncate">
                                    {team.wins}-{team.losses}-{team.ot_losses} · {team.points}pts
                                  </div>
                                )}
                              </div>
                              <span className={cn('font-varsity text-lg flex-shrink-0', wins >= 4 ? 'text-citrus-forest font-black' : 'text-citrus-charcoal/70')}>
                                {wins}
                              </span>
                            </>
                          ) : (
                            <span className="text-citrus-charcoal/40 italic text-xs">TBD</span>
                          )}
                        </div>
                      );
                    };

                    return (
                      <Card key={s.series_id} className={cn(
                        'p-3 border-2 transition-colors',
                        isFinal && 'border-citrus-orange bg-orange-50/50',
                        gameIsLive && 'border-red-300 bg-red-50/30',
                        !isFinal && !gameIsLive && 'border-citrus-sage/30',
                      )}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-display uppercase text-citrus-charcoal/60">Series {String.fromCharCode(64 + s.bracket_slot)}</span>
                            {s.conference && (
                              <Badge variant="outline" className={cn('text-[9px] px-1 py-0', s.conference === 'Eastern' ? 'border-blue-300 text-blue-700' : 'border-orange-300 text-orange-700')}>
                                {s.conference === 'Eastern' ? 'EAST' : 'WEST'}
                              </Badge>
                            )}
                          </div>
                          {gameIsLive && <Badge className="bg-red-500 text-white text-[9px] px-1.5 py-0 animate-pulse">LIVE</Badge>}
                          {isFinal && <Badge className="bg-citrus-sage text-white text-[9px] px-1.5 py-0">FINAL</Badge>}
                        </div>
                        {renderTeamRow(high, highInfo, s.high_seed_wins)}
                        <div className="h-1" />
                        {renderTeamRow(low, lowInfo, s.low_seed_wins)}
                        {/* Season H2H */}
                        {h2h && h2h.games > 0 && high && low && (
                          <div className="mt-2 pt-1.5 border-t border-fantasy-border/40 flex items-center justify-center gap-1 text-[10px] text-citrus-charcoal/60">
                            <span className="font-mono text-[9px] uppercase">H2H</span>
                            <span className="font-semibold" style={highInfo ? { color: highInfo.primaryColor } : undefined}>
                              {high.team_abbrev} {h2h.high_wins}
                            </span>
                            <span className="text-citrus-charcoal/40">—</span>
                            <span className="font-semibold" style={lowInfo ? { color: lowInfo.primaryColor } : undefined}>
                              {h2h.low_wins} {low.team_abbrev}
                            </span>
                          </div>
                        )}
                        {s.games_played > 0 && (
                          <div className="text-[10px] text-citrus-charcoal/60 mt-1 text-center">
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
