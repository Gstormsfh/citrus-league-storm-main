/**
 * Playoff Roster Pool — Player Selection Page.
 *
 * Industry-standard "team select" model (like OfficePools):
 * - Users independently pick their roster from all 16 playoff teams
 * - Multiple users CAN pick the same player (no exclusivity)
 * - Roster slots fill visually as you pick
 * - Team pills filter by NHL team, position tabs filter by F/D/G
 * - Live scoring preview using league's ScoringCalculator
 * - Per-team cap enforced visually + server-side
 *
 * Reuses our proven design tokens: fantasy-primary, citrus-sage/orange/forest.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search, Trophy, User, Shield, Star, X, Check, Save, Lock, Users, ArrowLeft,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ScoringCalculator, type ScoringSettings } from '@/utils/scoringUtils';

// ─── Types ─────────────────────────────────────────────────────────────────

interface PoolPlayer {
  id: string;
  full_name: string;
  position: string;
  team: string;
  team_id?: number;
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
  plus_minus?: number;
  xGoals?: number;
  x_goals?: number;
  icetime_seconds?: number;
  wins?: number;
  saves?: number;
  shots_faced?: number;
  shutouts?: number;
  goals_against?: number;
  gaa?: number | string | null;
  save_pct?: number | string | null;
  goals_against_average?: number | string | null;
  save_percentage?: number | string | null;
}

interface RosterSlot {
  position: string;
  label: string;
  player: PoolPlayer | null;
}

interface LeagueConfig {
  id: string;
  name: string;
  scoring_settings: ScoringSettings | null;
  settings: {
    playoffRosterSize?: number;
    positionRequirements?: { F: number; D: number; G: number };
    maxPlayersPerTeam?: number;
    playoffRosterLockedAt?: string;
  };
}

// NHL playoff teams for 2025-26 — will come from API once nhl_playoff_seeds table is populated
const POSITION_TABS = [
  { key: 'All', label: 'All' },
  { key: 'F', label: 'Forwards' },
  { key: 'D', label: 'Defense' },
  { key: 'G', label: 'Goalies' },
];

const normalizePos = (p: string): string => {
  const u = p?.toUpperCase();
  if (u === 'L' || u === 'LW') return 'LW';
  if (u === 'R' || u === 'RW') return 'RW';
  return u || '';
};

const isForward = (pos: string) => ['C', 'LW', 'RW'].includes(normalizePos(pos));

// ─── Component ─────────────────────────────────────────────────────────────

export default function PoolPlayoffRosterEntry() {
  const [params] = useSearchParams();
  const leagueId = params.get('league') || '';
  const { user } = useAuth();
  const { toast } = useToast();

  const [league, setLeague] = useState<LeagueConfig | null>(null);
  const [players, setPlayers] = useState<PoolPlayer[]>([]);
  const [roster, setRoster] = useState<PoolPlayer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [posFilter, setPosFilter] = useState('All');
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [sortBy, setSortBy] = useState<string>('fpts');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [statsModalPlayer, setStatsModalPlayer] = useState<PoolPlayer | null>(null);
  // Selected player for the "click to preview, then confirm" flow.
  // Matches draft room UX — click row → preview card at top → Add/Remove button confirms.
  const [selectedPlayer, setSelectedPlayer] = useState<PoolPlayer | null>(null);

  // Shorten full name for mobile: "Connor McDavid" -> "C. McDavid"
  const shortName = (full: string): string => {
    const parts = full.trim().split(/\s+/);
    if (parts.length < 2) return full;
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  // Defaults
  const rosterSize = league?.settings?.playoffRosterSize ?? 18;
  const posReqs = league?.settings?.positionRequirements ?? { F: 9, D: 6, G: 2 };
  // 0 or undefined = no cap (draft as many Oilers as you want).
  // Commissioner sets this explicitly if they want a restriction.
  const maxPerTeam = league?.settings?.maxPlayersPerTeam ?? 0;
  const hasCap = maxPerTeam > 0;

  // Scoring
  const scorer = useMemo(
    () => new ScoringCalculator(league?.scoring_settings),
    [league?.scoring_settings]
  );

  const calcFpts = useCallback(
    (p: PoolPlayer): number => {
      const isGoalie = normalizePos(p.position) === 'G';
      return scorer.calculatePoints(
        isGoalie
          ? { wins: p.wins || 0, saves: p.saves || 0, shutouts: p.shutouts || 0, goals_against: p.goals_against || 0 }
          : { goals: p.goals, assists: p.assists, shots: p.shots, blocks: p.blocks, hits: p.hits, pim: p.pim, ppp: p.ppp, shp: p.shp, plus_minus: (p as unknown as { plus_minus?: number }).plus_minus || 0 },
        isGoalie
      );
    },
    [scorer]
  );

  // Load data
  useEffect(() => {
    if (!leagueId) return;
    const load = async () => {
      try {
        const session = (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session;
        const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
        const [leagueRes, playersRes, picksRes] = await Promise.all([
          fetch(`/api/leagues/${leagueId}`, { headers }).then(r => r.json()),
          fetch('/api/players?limit=1000', { headers }).then(r => r.json()),
          fetch(`/api/playoff-pools/${leagueId}/picks?type=roster`, { headers }).then(r => r.json()).catch(() => null),
        ]);
        const leagueData = leagueRes.data || leagueRes;
        setLeague(leagueData);
        // API returns { data: [...players] } — extract array safely
        const playerArr = Array.isArray(playersRes.data) ? playersRes.data
          : Array.isArray(playersRes) ? playersRes : [];
        // Filter to ONLY playoff teams so users see a focused pool.
        // Matches the 16 teams in nhl_playoff_seeds for 2025-26.
        const PLAYOFF_TEAMS = new Set(['BUF','BOS','TBL','MTL','CAR','OTT','PIT','PHI','COL','LAK','DAL','MIN','VGK','UTA','EDM','ANA']);
        const playoffOnly = (playerArr as PoolPlayer[]).filter(p => PLAYOFF_TEAMS.has(p.team));
        setPlayers(playoffOnly);
        // Restore existing roster picks — match saved player_ids back to player objects
        if (picksRes && user?.id) {
          const rawPicks = picksRes.data?.picks || picksRes.picks || [];
          const myPicks = (rawPicks as Array<{ player_id: number; user_id: string }>).filter(p => p.user_id === user.id);
          const savedPlayers = myPicks
            .map(pick => playoffOnly.find(p => parseInt(p.id) === pick.player_id))
            .filter((p): p is PoolPlayer => !!p);
          setRoster(savedPlayers);
        }
        // Check lock
        const lockAt = leagueData?.settings?.playoffRosterLockedAt;
        if (lockAt && new Date(lockAt) <= new Date()) setLocked(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, user?.id]);

  // Roster IDs set for O(1) lookup
  const rosterIds = useMemo(() => new Set(roster.map(p => p.id)), [roster]);

  // Per-team counts
  const teamCounts = useMemo(() => {
    const m = new Map<string, number>();
    roster.forEach(p => m.set(p.team, (m.get(p.team) || 0) + 1));
    return m;
  }, [roster]);

  // Position counts
  const posCounts = useMemo(() => {
    const c = { F: 0, D: 0, G: 0 };
    roster.forEach(p => {
      const norm = normalizePos(p.position);
      if (norm === 'G') c.G++;
      else if (norm === 'D') c.D++;
      else c.F++;
    });
    return c;
  }, [roster]);

  // Available teams
  const allTeams = useMemo(() => {
    const s = new Set(players.map(p => p.team));
    return Array.from(s).sort();
  }, [players]);

  // rosterTotal intentionally removed — regular-season totals don't sum
  // into a meaningful "team FPTS" for a playoff pool. Live standings
  // will be based on actual playoff stats instead.

  // Filtered & sorted players
  const filteredPlayers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return players
      .filter(p => {
        if (term && !p.full_name.toLowerCase().includes(term) && !p.team.toLowerCase().includes(term)) return false;
        const norm = normalizePos(p.position);
        if (posFilter === 'F' && !isForward(p.position)) return false;
        if (posFilter === 'D' && norm !== 'D') return false;
        if (posFilter === 'G' && norm !== 'G') return false;
        if (teamFilter && p.team !== teamFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const getVal = (p: PoolPlayer): number => {
          switch (sortBy) {
            case 'name': return 0; // handle separately
            case 'team': return 0; // handle separately
            case 'gp': return p.games_played;
            case 'g_w': return normalizePos(p.position) === 'G' ? (p.wins || 0) : p.goals;
            case 'a_sv': return normalizePos(p.position) === 'G' ? (p.saves || 0) : p.assists;
            case 'pts_so': return normalizePos(p.position) === 'G' ? (p.shutouts || 0) : p.points;
            case 'sog_ga': return normalizePos(p.position) === 'G' ? (p.goals_against || 0) : p.shots;
            case 'hit': return p.hits;
            case 'blk': return p.blocks;
            case 'pm_svpct': {
              if (normalizePos(p.position) === 'G') return (p.save_pct ?? p.save_percentage ?? 0);
              return p.plus_minus ?? 0;
            }
            case 'xg_gaa': {
              if (normalizePos(p.position) === 'G') return (p.gaa ?? p.goals_against_average ?? 0);
              return p.xGoals ?? p.x_goals ?? 0;
            }
            case 'toi': return p.icetime_seconds && p.games_played ? p.icetime_seconds / p.games_played : 0;
            case 'fpts':
            default: return calcFpts(p);
          }
        };
        if (sortBy === 'name') {
          const r = a.full_name.localeCompare(b.full_name);
          return sortDir === 'asc' ? r : -r;
        }
        if (sortBy === 'team') {
          const r = a.team.localeCompare(b.team);
          return sortDir === 'asc' ? r : -r;
        }
        const diff = getVal(b) - getVal(a);
        return sortDir === 'desc' ? diff : -diff;
      });
  }, [players, searchTerm, posFilter, teamFilter, calcFpts, sortBy, sortDir]);

  // Can add this player?
  const canAdd = (p: PoolPlayer): boolean => {
    if (locked || rosterIds.has(p.id) || roster.length >= rosterSize) return false;
    const norm = normalizePos(p.position);
    if (norm === 'G' && posCounts.G >= posReqs.G) return false;
    if (norm === 'D' && posCounts.D >= posReqs.D) return false;
    if (isForward(p.position) && posCounts.F >= posReqs.F) return false;
    if (hasCap && (teamCounts.get(p.team) || 0) >= maxPerTeam) return false;
    return true;
  };

  const addPlayer = (p: PoolPlayer) => {
    if (!canAdd(p)) return;
    setRoster(prev => [...prev, p]);
  };

  const removePlayer = (id: string) => {
    if (locked) return;
    setRoster(prev => prev.filter(p => p.id !== id));
  };

  const saveRoster = async () => {
    if (!leagueId || roster.length === 0) return;
    setSaving(true);
    try {
      const session = (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session;
      const res = await fetch('/api/playoff-pools/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({
          leagueId,
          picks: roster.map((p, i) => ({
            player_id: parseInt(p.id),
            position_slot: normalizePos(p.position) === 'G' ? 'G' : normalizePos(p.position) === 'D' ? 'D' : 'F',
          })),
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast({ title: 'Roster saved!', description: `${roster.length} players locked in.` });
    } catch (err) {
      toast({ title: 'Failed to save', description: String(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <><Navbar /><div className="min-h-screen pt-24 flex items-center justify-center text-citrus-charcoal/60">Loading pool...</div></>;
  }

  return (
    <>
    <Navbar />
    <div className="min-h-screen bg-gradient-to-b from-white to-[#F5F8ED] pb-24 pt-24">
      <div className="max-w-7xl mx-auto px-4 mb-3">
        <Link to={`/pool/playoff-hub?league=${leagueId}`} className="text-sm text-citrus-sage hover:text-citrus-forest inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />Back to Pool Home
        </Link>
      </div>
      {/* Sticky header with roster progress */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-xl border-b border-fantasy-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-lg font-varsity font-black uppercase text-citrus-forest flex items-center gap-2">
                <Trophy className="h-5 w-5 text-citrus-orange" />
                {league?.name || 'Playoff Roster Pool'}
              </h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-citrus-charcoal/70">
                <span className="font-display font-bold text-citrus-forest">{roster.length}/{rosterSize} players</span>
                <span>F: {posCounts.F}/{posReqs.F}</span>
                <span>D: {posCounts.D}/{posReqs.D}</span>
                <span>G: {posCounts.G}/{posReqs.G}</span>
              </div>
            </div>
            <Button
              onClick={saveRoster}
              disabled={saving || locked || roster.length === 0}
              className="bg-citrus-sage hover:bg-citrus-sage/90 text-citrus-forest font-display font-bold"
            >
              {locked ? <><Lock className="h-4 w-4 mr-1" />Locked</> : saving ? 'Saving...' : <><Save className="h-4 w-4 mr-1" />Save Roster</>}
            </Button>
          </div>

          {/* Roster progress bar */}
          <div className="mt-2 h-2 bg-citrus-sage/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-citrus-sage to-citrus-orange rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, (roster.length / rosterSize) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
          {/* ─── LEFT: Player Pool ───────────────────────────────────── */}
          <div className="min-w-0">
            {/* Search + Position tabs */}
            <div className="flex flex-wrap gap-2 mb-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search players or teams..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-9 text-sm bg-[#E8EED9]/50 backdrop-blur-sm border-fantasy-border"
                />
              </div>
              <div className="flex bg-[#E8EED9]/50 rounded-lg border border-fantasy-border p-0.5">
                {POSITION_TABS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setPosFilter(tab.key)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-display font-bold rounded-md transition-colors',
                      posFilter === tab.key
                        ? 'bg-citrus-forest text-white shadow-sm'
                        : 'text-citrus-charcoal/70 hover:text-citrus-forest'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Team filter pills — scrollable */}
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-styled">
              <button
                onClick={() => setTeamFilter(null)}
                className={cn(
                  'flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-display font-bold border transition-colors',
                  !teamFilter
                    ? 'bg-citrus-forest text-white border-citrus-forest'
                    : 'bg-white text-citrus-charcoal/70 border-citrus-sage/30 hover:border-citrus-forest'
                )}
              >
                All Teams
              </button>
              {allTeams.map(team => {
                const count = teamCounts.get(team) || 0;
                const atCap = hasCap && count >= maxPerTeam;
                return (
                  <button
                    key={team}
                    onClick={() => setTeamFilter(teamFilter === team ? null : team)}
                    className={cn(
                      'flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-display font-bold border transition-colors flex items-center gap-1',
                      teamFilter === team
                        ? 'bg-citrus-forest text-white border-citrus-forest'
                        : atCap
                          ? 'bg-red-50 text-red-400 border-red-200'
                          : 'bg-white text-citrus-charcoal/70 border-citrus-sage/30 hover:border-citrus-forest'
                    )}
                  >
                    {team}
                    {count > 0 && (
                      <span className={cn(
                        'w-4 h-4 rounded-full flex items-center justify-center text-[9px]',
                        atCap ? 'bg-red-500 text-white' : 'bg-citrus-sage text-white'
                      )}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected player preview card — appears when user clicks a row. */}
            {selectedPlayer && (() => {
              const onRoster = rosterIds.has(selectedPlayer.id);
              const addable = canAdd(selectedPlayer);
              const norm = normalizePos(selectedPlayer.position);
              const fpts = calcFpts(selectedPlayer);
              return (
                <Card className="mb-3 border-2 border-citrus-orange/40 bg-gradient-to-r from-citrus-orange/5 to-citrus-sage/5 shadow-md">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Badge variant="outline" className={cn(
                          'text-[11px] px-2',
                          norm === 'G' ? 'border-purple-300 text-purple-700' : norm === 'D' ? 'border-blue-300 text-blue-700' : 'border-citrus-sage text-citrus-forest'
                        )}>{norm}</Badge>
                        <div className="min-w-0">
                          <div className="font-display font-bold text-base text-citrus-forest truncate">{selectedPlayer.full_name}</div>
                          <div className="text-[11px] text-citrus-charcoal/60">
                            {selectedPlayer.team} · GP {selectedPlayer.games_played}
                            {norm === 'G'
                              ? ` · ${selectedPlayer.wins || 0}W · ${(() => {
                                  const sp = Number(selectedPlayer.save_pct ?? 0);
                                  return sp > 0 ? `${(sp < 1 ? sp * 100 : sp).toFixed(1)}% SV` : '';
                                })()}`
                              : ` · ${selectedPlayer.goals}G ${selectedPlayer.assists}A ${selectedPlayer.points}PTS`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="text-[10px] uppercase font-display text-citrus-charcoal/50">FPTS</div>
                          <div className="font-varsity text-lg text-green-700 font-black">{fpts.toFixed(1)}</div>
                        </div>
                        <button
                          onClick={() => setStatsModalPlayer(selectedPlayer)}
                          className="px-3 py-2 rounded bg-white border border-citrus-sage/40 text-citrus-forest text-xs font-bold hover:bg-citrus-sage/10 transition-colors"
                        >
                          Details
                        </button>
                        {onRoster ? (
                          <button
                            onClick={() => { removePlayer(selectedPlayer.id); setSelectedPlayer(null); }}
                            className="px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-xs font-display font-bold transition-colors"
                          >
                            Remove from Roster
                          </button>
                        ) : (
                          <button
                            onClick={() => { if (addable) { addPlayer(selectedPlayer); setSelectedPlayer(null); } }}
                            disabled={!addable}
                            className={cn(
                              'px-4 py-2 rounded text-xs font-display font-bold transition-colors',
                              addable
                                ? 'bg-citrus-orange hover:bg-citrus-orange/90 text-white'
                                : 'bg-muted text-citrus-charcoal/50 cursor-not-allowed'
                            )}
                            title={addable ? 'Add to roster' : 'Position full or team cap reached'}
                          >
                            {addable ? 'Add to Roster' : 'Cannot Add'}
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedPlayer(null)}
                          className="p-2 rounded text-citrus-charcoal/50 hover:text-citrus-charcoal hover:bg-muted/30"
                          title="Close preview"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Top sticky horizontal scrollbar (desktop only — mobile doesn't
                need it since the table fits the viewport). */}
            <div
              className="overflow-x-scroll scrollbar-styled mb-1 bg-fantasy-light/40 rounded border border-fantasy-border/40"
              style={{ height: '14px' }}
              onScroll={(e) => {
                const container = e.currentTarget;
                const table = container.parentElement?.querySelector<HTMLDivElement>('[data-roster-table]');
                if (table && table.scrollLeft !== container.scrollLeft) table.scrollLeft = container.scrollLeft;
              }}
            >
              <div id="roster-scroll-helper-inner" style={{ width: '1100px', height: '1px' }} />
            </div>
            {/* Hint text so users know they can scroll */}
            <div className="text-[10px] text-citrus-charcoal/50 mb-2 text-center italic">
              Tip: scroll ↔ to see more stats (xG, TOI, +/-, etc.)
            </div>

            {/* Player table — single scroll container that scrolls BOTH axes.
                overflow-auto = horizontal + vertical scrollbars always visible
                (styled by .scrollbar-styled). max-h bounds vertical so the
                horizontal bar at the bottom stays within the viewport. */}
            <Card className="border-fantasy-border bg-fantasy-surface">
              <div
                data-roster-table
                className="overflow-auto scrollbar-styled"
                style={{ maxHeight: 'calc(100dvh - 16rem)', scrollbarGutter: 'stable' }}
                onScroll={(e) => {
                  // Mirror the scroll to the top helper bar
                  const t = e.currentTarget;
                  const helper = document.getElementById('roster-scroll-helper-inner');
                  if (helper && helper.parentElement) helper.parentElement.scrollLeft = t.scrollLeft;
                }}
              >
                {/* min-width only kicks in at md+ where all columns are visible.
                    On mobile, table naturally shrinks to fit the few visible columns
                    (no dead horizontal space after the player name). */}
                <table className="w-full text-sm border-collapse" style={{ minWidth: '1100px' }}>
                  <thead className="bg-fantasy-light sticky top-0 z-10 border-b border-fantasy-border">
                    <tr>
                      <th className="px-2 py-2 text-left text-xs font-display font-bold text-citrus-forest w-8">#</th>
                      <th className="px-2 py-2 text-left text-xs font-display font-bold text-citrus-forest w-20">Action</th>
                      {(() => {
                        const ind = (col: string) => sortBy === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
                        const cn_sort = 'cursor-pointer select-none hover:text-citrus-orange transition-colors';
                        return (
                          <>
                            <th onClick={() => toggleSort('name')} className={cn('px-2 py-2 text-left text-xs font-display font-bold text-citrus-forest min-w-[140px]', cn_sort)}>Player{ind('name')}</th>
                            <th className="px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest">Pos</th>
                            <th onClick={() => toggleSort('team')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>Team{ind('team')}</th>
                            <th onClick={() => toggleSort('gp')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>GP{ind('gp')}</th>
                            {posFilter === 'G' ? (
                              /* Goalie-specific columns */
                              <>
                                <th onClick={() => toggleSort('g_w')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>W{ind('g_w')}</th>
                                <th onClick={() => toggleSort('a_sv')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>SV{ind('a_sv')}</th>
                                <th onClick={() => toggleSort('pts_so')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>SO{ind('pts_so')}</th>
                                <th onClick={() => toggleSort('sog_ga')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>GA{ind('sog_ga')}</th>
                                <th onClick={() => toggleSort('pm_svpct')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>SV%{ind('pm_svpct')}</th>
                                <th onClick={() => toggleSort('xg_gaa')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-purple-700', cn_sort)}>GAA{ind('xg_gaa')}</th>
                              </>
                            ) : (
                              /* Skater columns — default for All / Forwards / Defense */
                              <>
                                <th onClick={() => toggleSort('g_w')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>G{ind('g_w')}</th>
                                <th onClick={() => toggleSort('a_sv')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>A{ind('a_sv')}</th>
                                <th onClick={() => toggleSort('pts_so')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>PTS{ind('pts_so')}</th>
                                <th onClick={() => toggleSort('sog_ga')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>SOG{ind('sog_ga')}</th>
                                <th onClick={() => toggleSort('hit')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>HIT{ind('hit')}</th>
                                <th onClick={() => toggleSort('blk')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>BLK{ind('blk')}</th>
                                <th onClick={() => toggleSort('pm_svpct')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest', cn_sort)}>+/-{ind('pm_svpct')}</th>
                                <th onClick={() => toggleSort('xg_gaa')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-purple-700', cn_sort)}>xG{ind('xg_gaa')}</th>
                              </>
                            )}
                          </>
                        );
                      })()}
                      <th className="px-2 py-2 text-center text-xs font-display font-bold text-citrus-forest" title="Avg time on ice per game (min:sec)">TOI</th>
                      <th className="px-2 py-2 text-center text-xs font-bold text-green-700 bg-green-50/50">FPTS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.slice(0, 200).map((player, idx) => {
                      const onRoster = rosterIds.has(player.id);
                      const addable = canAdd(player);
                      const fpts = calcFpts(player);
                      const norm = normalizePos(player.position);
                      const teamAtCap = hasCap && (teamCounts.get(player.team) || 0) >= maxPerTeam;
                      return (
                        <tr
                          key={player.id}
                          className={cn(
                            'border-b border-fantasy-border/30 transition-colors cursor-pointer',
                            selectedPlayer?.id === player.id && 'bg-citrus-orange/10 ring-1 ring-citrus-orange/30',
                            onRoster && selectedPlayer?.id !== player.id && 'bg-citrus-sage/10 border-l-2 border-l-citrus-sage',
                            !onRoster && selectedPlayer?.id !== player.id && 'hover:bg-fantasy-light/30',
                            !addable && !onRoster && selectedPlayer?.id !== player.id && 'opacity-50'
                          )}
                          onClick={() => setSelectedPlayer(player)}
                        >
                          <td className="px-2 py-1.5 text-xs font-mono text-citrus-forest/60">{idx + 1}</td>
                          {/* Add / Remove button on the LEFT (discoverable) */}
                          <td className="px-2 py-1.5">
                            {onRoster ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); removePlayer(player.id); }}
                                className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 transition-colors text-[11px] font-bold border border-red-200"
                                title="Remove from roster"
                              >
                                Remove
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); if (addable) addPlayer(player); }}
                                disabled={!addable}
                                className={cn(
                                  'px-2 py-1 rounded transition-colors text-[11px] font-bold border',
                                  addable
                                    ? 'bg-citrus-sage/10 hover:bg-citrus-sage/20 text-citrus-forest border-citrus-sage/40'
                                    : 'bg-muted/30 text-citrus-charcoal/40 border-muted cursor-not-allowed'
                                )}
                                title={addable ? 'Add to roster' : 'Cannot add (position full or team cap)'}
                              >
                                Add
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {onRoster && <Check className="h-3.5 w-3.5 text-citrus-sage flex-shrink-0" />}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setStatsModalPlayer(player); }}
                                className={cn(
                                  'text-sm font-medium truncate text-left hover:text-citrus-orange hover:underline transition-colors',
                                  onRoster && 'text-citrus-forest font-bold'
                                )}
                                title="View player details"
                              >
                                {/* Mobile: "C. McDavid" ; Desktop: "Connor McDavid" */}
                                <span className="sm:hidden">{shortName(player.full_name)}</span>
                                <span className="hidden sm:inline">{player.full_name}</span>
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <Badge variant="outline" className={cn(
                              'text-[10px] px-1.5',
                              norm === 'G' ? 'border-purple-300 text-purple-700' : norm === 'D' ? 'border-blue-300 text-blue-700' : 'border-citrus-sage text-citrus-forest'
                            )}>
                              {norm}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={cn('text-xs font-medium', teamAtCap && !onRoster && 'text-red-400')}>
                              {player.team}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-center text-xs">{player.games_played}</td>
                          {norm === 'G' ? (
                            <>
                              <td className="px-2 py-1.5 text-center text-xs font-semibold">{player.wins || 0}</td>
                              <td className="px-2 py-1.5 text-center text-xs">{player.saves || 0}</td>
                              <td className="px-2 py-1.5 text-center text-xs font-bold">{player.shutouts || 0}</td>
                              <td className="px-2 py-1.5 text-center text-xs">{player.goals_against || 0}</td>
                              {/* HIT+BLK placeholders only when headers are showing (skater/all filter) */}
                              {posFilter !== 'G' && (
                                <td className="px-2 py-1.5 text-center text-xs text-citrus-charcoal/30" colSpan={2}>—</td>
                              )}
                              <td className="px-2 py-1.5 text-center text-xs">
                                {(() => {
                                  // Prefer API value (string or number), fall back to computing from saves/shots_faced
                                  let sp = Number(player.save_pct ?? player.save_percentage ?? 0);
                                  if (!sp && player.saves && player.shots_faced) {
                                    sp = player.saves / player.shots_faced;
                                  }
                                  if (!sp) return '—';
                                  const pct = sp < 1 ? sp * 100 : sp;
                                  return pct.toFixed(1) + '%';
                                })()}
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs text-purple-700">
                                {(() => {
                                  let g = Number(player.gaa ?? player.goals_against_average ?? 0);
                                  // Fallback: GAA = goals_against * 60 / (icetime_seconds / 60) = goals_against * 3600 / icetime_seconds
                                  if (!g && player.goals_against && player.icetime_seconds) {
                                    g = (player.goals_against * 3600) / player.icetime_seconds;
                                  }
                                  return g > 0 ? g.toFixed(2) : '—';
                                })()}
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs">—</td>
                            </>
                          ) : (
                            <>
                              <td className="px-2 py-1.5 text-center text-xs font-semibold">{player.goals}</td>
                              <td className="px-2 py-1.5 text-center text-xs">{player.assists}</td>
                              <td className="px-2 py-1.5 text-center text-xs font-bold">{player.points}</td>
                              <td className="px-2 py-1.5 text-center text-xs">{player.shots}</td>
                              <td className="px-2 py-1.5 text-center text-xs">{player.hits}</td>
                              <td className="px-2 py-1.5 text-center text-xs">{player.blocks}</td>
                              <td className={cn('px-2 py-1.5 text-center text-xs', (player.plus_minus || 0) > 0 && 'text-green-700', (player.plus_minus || 0) < 0 && 'text-red-600')}>
                                {(player.plus_minus ?? 0) > 0 ? '+' : ''}{player.plus_minus ?? 0}
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs text-purple-700 font-semibold">
                                {(() => {
                                  const xg = player.xGoals ?? player.x_goals ?? 0;
                                  return xg > 0 ? xg.toFixed(1) : '—';
                                })()}
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs text-citrus-charcoal/70">
                                {player.icetime_seconds && player.games_played ? (() => {
                                  const totalSec = Math.round(player.icetime_seconds / player.games_played);
                                  const m = Math.floor(totalSec / 60);
                                  const s = totalSec % 60;
                                  return `${m}:${s < 10 ? '0' : ''}${s}`;
                                })() : '—'}
                              </td>
                            </>
                          )}
                          <td className="px-2 py-1.5 text-center text-xs font-bold text-green-700 bg-green-50/20">{fpts.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* ─── RIGHT: Active Roster Builder ────────────────────────── */}
          <div className="lg:sticky lg:top-[110px] lg:self-start space-y-3">
            {/* Roster card */}
            <Card className="border-fantasy-border bg-white shadow-md">
              <CardHeader className="pb-2 px-4">
                <CardTitle className="text-sm font-display font-bold text-citrus-forest flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-citrus-orange" />
                    Your Roster ({roster.length}/{rosterSize})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {/* Forwards */}
                <div>
                  <div className="text-[10px] font-display font-bold uppercase text-citrus-charcoal/50 mb-1">Forwards ({posCounts.F}/{posReqs.F})</div>
                  <div className="space-y-1">
                    {roster.filter(p => isForward(p.position)).map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1 px-2 bg-citrus-sage/5 rounded border border-citrus-sage/20">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="text-[9px] px-1 border-citrus-sage">{normalizePos(p.position)}</Badge>
                          <button
                            type="button"
                            onClick={() => setStatsModalPlayer(p)}
                            className="text-xs font-medium truncate text-left hover:text-citrus-orange hover:underline transition-colors"
                          >
                            <span className="sm:hidden">{shortName(p.full_name)}</span>
                            <span className="hidden sm:inline">{p.full_name}</span>
                          </button>
                          <span className="text-[10px] text-citrus-charcoal/50">{p.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-green-700">{calcFpts(p).toFixed(1)}</span>
                          {!locked && (
                            <button onClick={() => removePlayer(p.id)} className="text-red-300 hover:text-red-500">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, posReqs.F - posCounts.F) }).map((_, i) => (
                      <div key={`empty-f-${i}`} className="flex items-center py-1.5 px-2 rounded border border-dashed border-citrus-sage/20 text-citrus-charcoal/30">
                        <User className="h-3 w-3 mr-2" />
                        <span className="text-[11px] italic">Empty F slot</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Defensemen */}
                <div>
                  <div className="text-[10px] font-display font-bold uppercase text-citrus-charcoal/50 mb-1">Defense ({posCounts.D}/{posReqs.D})</div>
                  <div className="space-y-1">
                    {roster.filter(p => normalizePos(p.position) === 'D').map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1 px-2 bg-blue-50/40 rounded border border-blue-200/30">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="text-[9px] px-1 border-blue-300 text-blue-700">D</Badge>
                          <button
                            type="button"
                            onClick={() => setStatsModalPlayer(p)}
                            className="text-xs font-medium truncate text-left hover:text-citrus-orange hover:underline transition-colors"
                          >
                            <span className="sm:hidden">{shortName(p.full_name)}</span>
                            <span className="hidden sm:inline">{p.full_name}</span>
                          </button>
                          <span className="text-[10px] text-citrus-charcoal/50">{p.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-green-700">{calcFpts(p).toFixed(1)}</span>
                          {!locked && (
                            <button onClick={() => removePlayer(p.id)} className="text-red-300 hover:text-red-500">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, posReqs.D - posCounts.D) }).map((_, i) => (
                      <div key={`empty-d-${i}`} className="flex items-center py-1.5 px-2 rounded border border-dashed border-blue-200/30 text-citrus-charcoal/30">
                        <Shield className="h-3 w-3 mr-2" />
                        <span className="text-[11px] italic">Empty D slot</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Goalies */}
                <div>
                  <div className="text-[10px] font-display font-bold uppercase text-citrus-charcoal/50 mb-1">Goalies ({posCounts.G}/{posReqs.G})</div>
                  <div className="space-y-1">
                    {roster.filter(p => normalizePos(p.position) === 'G').map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1 px-2 bg-purple-50/40 rounded border border-purple-200/30">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="text-[9px] px-1 border-purple-300 text-purple-700">G</Badge>
                          <button
                            type="button"
                            onClick={() => setStatsModalPlayer(p)}
                            className="text-xs font-medium truncate text-left hover:text-citrus-orange hover:underline transition-colors"
                          >
                            <span className="sm:hidden">{shortName(p.full_name)}</span>
                            <span className="hidden sm:inline">{p.full_name}</span>
                          </button>
                          <span className="text-[10px] text-citrus-charcoal/50">{p.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-green-700">{calcFpts(p).toFixed(1)}</span>
                          {!locked && (
                            <button onClick={() => removePlayer(p.id)} className="text-red-300 hover:text-red-500">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, posReqs.G - posCounts.G) }).map((_, i) => (
                      <div key={`empty-g-${i}`} className="flex items-center py-1.5 px-2 rounded border border-dashed border-purple-200/30 text-citrus-charcoal/30">
                        <User className="h-3 w-3 mr-2" />
                        <span className="text-[11px] italic">Empty G slot</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Team breakdown */}
                {roster.length > 0 && (
                  <div className="pt-2 border-t border-fantasy-border">
                    <div className="text-[10px] font-display font-bold uppercase text-citrus-charcoal/50 mb-1.5">Team Breakdown</div>
                    <div className="flex flex-wrap gap-1">
                      {Array.from(teamCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([team, count]) => (
                          <Badge
                            key={team}
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              hasCap && count >= maxPerTeam ? 'border-red-300 text-red-700 bg-red-50' : 'border-citrus-sage/30'
                            )}
                          >
                            {team}: {hasCap ? `${count}/${maxPerTeam}` : count}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick tips */}
            <Card className="border-fantasy-border bg-citrus-sage/5 px-4 py-3">
              <div className="text-[10px] font-display font-bold uppercase text-citrus-charcoal/50 mb-1">How it works</div>
              <ul className="text-[11px] text-citrus-charcoal/70 space-y-0.5 list-disc pl-3">
                <li>Pick {rosterSize} players from playoff teams</li>
                {hasCap && <li>Max {maxPerTeam} players per NHL team</li>}
                {!hasCap && <li>No per-team cap — draft all 18 from one squad if you want</li>}
                <li>Total fantasy points across all playoff games</li>
                <li>Click any player row to add them</li>
                <li>Your FPTS uses your league's custom scoring</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
    {/* Player detail modal — HockeyPlayer shape with nested stats object */}
    <PlayerStatsModal
      player={statsModalPlayer ? (() => {
        const p = statsModalPlayer;
        const isGoalie = normalizePos(p.position) === 'G';
        const toiPerGame = p.icetime_seconds && p.games_played
          ? Math.round(p.icetime_seconds / p.games_played)
          : 0;
        const toiStr = toiPerGame > 0
          ? `${Math.floor(toiPerGame / 60)}:${String(toiPerGame % 60).padStart(2, '0')}`
          : undefined;
        const savePctNum = Number(p.save_pct ?? p.save_percentage ?? 0);
        const gaaNum = Number(p.gaa ?? p.goals_against_average ?? 0);
        return {
          id: p.id,
          name: p.full_name,
          position: p.position,
          number: 0,
          starter: false,
          team: p.team,
          teamAbbreviation: p.team,
          stats: isGoalie ? {
            gamesPlayed: p.games_played,
            wins: p.wins ?? 0,
            saves: p.saves ?? 0,
            shutouts: p.shutouts ?? 0,
            goalsAgainst: p.goals_against ?? 0,
            savePct: savePctNum > 0 ? (savePctNum < 1 ? savePctNum : savePctNum / 100) : undefined,
            gaa: gaaNum > 0 ? gaaNum : undefined,
          } : {
            gamesPlayed: p.games_played,
            goals: p.goals,
            assists: p.assists,
            points: p.points,
            plusMinus: p.plus_minus ?? 0,
            shots: p.shots,
            blockedShots: p.blocks,
            hits: p.hits,
            powerPlayPoints: p.ppp,
            shortHandedPoints: p.shp,
            pim: p.pim,
            toi: toiStr,
            xGoals: Number(p.xGoals ?? p.x_goals ?? 0),
          },
        } as unknown as Parameters<typeof PlayerStatsModal>[0]['player'];
      })() : null}
      isOpen={!!statsModalPlayer}
      onClose={() => setStatsModalPlayer(null)}
    />
    </>
  );
}
