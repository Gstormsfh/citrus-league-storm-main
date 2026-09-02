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

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search, Trophy, User, Shield, Star, X, Check, Save, Lock, Users, ArrowLeft,
  Eye, Calendar, Clock,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { API_BASE_URL } from '@/api/client';
import { cn } from '@/lib/utils';
import { ScoringCalculator, type ScoringSettings } from '@/utils/scoringUtils';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

/* 2026-08-19 visual audit — muted-text correction.
   text-citrus-charcoal is #5C5C5C, a soft charcoal designed for the
   original CREAM theme. At 20-70% opacity on the dark #1A2A20 tiles it
   composites to near-invisible (team codes on this page measured
   1.47:1). Remapped to cream at the alpha that preserves the intended
   hierarchy while clearing 4.5:1 on a dark tile. */


/* 2026-08-19 visual audit: light "glass" surface on a dark page — see
   the surface-correction note in the armchair-gm components. bg-white/50
   composites to mid-grey on #0F1F15, where neither light nor dark text
   reaches 4.5:1. Uses the dark tile family instead. */


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

interface TodayGame {
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

interface PlayoffStat {
  player_id: number;
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  ppp: number;
  shp: number;
  shots: number;
  hits: number;
  blocks: number;
  pim: number;
  plus_minus: number;
  wins: number;
  saves: number;
  shutouts: number;
  goals_against: number;
  is_goalie: boolean;
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
  const viewUserId = params.get('view') || '';
  const { user } = useAuth();
  const { toast } = useToast();

  // Read-only mode: viewing someone else's roster
  const isViewMode = !!viewUserId && viewUserId !== user?.id;

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
  // View mode: name of the roster owner being viewed
  const [viewOwnerName, setViewOwnerName] = useState<string>('');
  // Today's Games
  const [todayGames, setTodayGames] = useState<TodayGame[]>([]);
  // Playoff stats for every rostered player — source of truth for FPTS
  // once playoffs have started. Falls back to 0 before games are played.
  const [playoffStats, setPlayoffStats] = useState<Map<number, PlayoffStat>>(new Map());

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
  const rosterSize = league?.settings?.playoffRosterSize ?? 17;
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

  // FPTS from SEASON stats (used by the player pool selection table only,
  // so commissioners/users can still compare season performance when picking).
  const calcSeasonFpts = useCallback(
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

  // FPTS from PLAYOFF stats — this is what counts for the roster's score.
  // Returns 0 before a player has any playoff games. Used everywhere on the
  // roster display (your own roster AND when viewing someone else's).
  const calcPlayoffFpts = useCallback(
    (p: PoolPlayer): number => {
      const pid = parseInt(p.id);
      const st = playoffStats.get(pid);
      if (!st || !st.games_played) return 0;
      const isGoalie = normalizePos(p.position) === 'G' || st.is_goalie;
      return scorer.calculatePoints(
        isGoalie
          ? {
              wins: st.wins || 0,
              saves: st.saves || 0,
              shutouts: st.shutouts || 0,
              goals_against: st.goals_against || 0,
            }
          : {
              goals: st.goals || 0,
              assists: st.assists || 0,
              shots: st.shots || 0,
              blocks: st.blocks || 0,
              hits: st.hits || 0,
              pim: st.pim || 0,
              ppp: st.ppp || 0,
              shp: st.shp || 0,
              plus_minus: st.plus_minus || 0,
            },
        isGoalie
      );
    },
    [scorer, playoffStats]
  );

  // Keep calcFpts as the alias used in the roster card — points at playoff now.
  const calcFpts = calcPlayoffFpts;

  // Load data
  useEffect(() => {
    if (!leagueId) return;
    const targetUserId = viewUserId || user?.id;
    const load = async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
        const [leagueRes, playersRes, picksRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/leagues/${leagueId}`, { headers }).then(r => r.json()),
          fetch(`${API_BASE_URL}/api/players?limit=1000`, { headers }).then(r => r.json()),
          fetch(`${API_BASE_URL}/api/playoff-pools/${leagueId}/picks?type=roster`, { headers }).then(r => r.json()).catch(() => null),
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
        // Restore roster picks — either the current user's or the viewed user's
        if (picksRes && targetUserId) {
          const rawPicks = picksRes.data?.picks || picksRes.picks || [];
          const targetPicks = (rawPicks as Array<{ player_id: number; user_id: string }>).filter(p => p.user_id === targetUserId);
          const savedPlayers = targetPicks
            .map(pick => playoffOnly.find(p => parseInt(p.id) === pick.player_id))
            .filter((p): p is PoolPlayer => !!p);
          setRoster(savedPlayers);
        }
        // In view mode, fetch the owner's team name (preferred) or profile name
        if (isViewMode && viewUserId) {
          try {
            const { data: team } = await (supabase as any)
              .from('teams')
              .select('team_name')
              .eq('league_id', leagueId)
              .eq('owner_id', viewUserId)
              .single();
            if (team?.team_name) {
              setViewOwnerName(team.team_name);
            } else {
              const { data: profile } = await (supabase as any)
                .from('profiles')
                .select('username, first_name, last_name')
                .eq('id', viewUserId)
                .single();
              if (profile) {
                const name = profile.username || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Unknown';
                setViewOwnerName(name);
              }
            }
          } catch {
            logger.warn('Failed to fetch viewed user display name');
          }
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
  }, [leagueId, user?.id, viewUserId]);

  // Fetch playoff stats for every player on the current roster.
  // Refreshes every 60s so live-game updates flow through to FPTS.
  useEffect(() => {
    const fetchPlayoffStats = async () => {
      if (roster.length === 0) return;
      const playerIds = roster.map(p => parseInt(p.id)).filter(n => !isNaN(n) && n > 0);
      if (playerIds.length === 0) return;
      try {
        const { data, error } = await (supabase as any)
          .from('player_playoff_stats')
          .select('*')
          .in('player_id', playerIds);
        if (error) {
          logger.warn('Playoff stats fetch failed', error);
          return;
        }
        const map = new Map<number, PlayoffStat>();
        for (const row of (data ?? []) as PlayoffStat[]) {
          map.set(row.player_id, row);
        }
        setPlayoffStats(map);
      } catch (err) {
        logger.warn('Playoff stats fetch exception', err);
      }
    };
    fetchPlayoffStats();
    const interval = setInterval(fetchPlayoffStats, 60_000);
    return () => clearInterval(interval);
  }, [roster]);

  // Fetch today's playoff games
  useEffect(() => {
    const fetchTodayGames = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const { data, error } = await (supabase as any)
          .from('nhl_games')
          .select('game_id, game_date, game_time, home_team, away_team, home_score, away_score, status, period, period_time, series_game_number')
          .eq('game_date', today)
          .eq('game_type', 'playoff')
          .order('game_time', { ascending: true });
        if (error) {
          logger.error('Failed to fetch today games:', error);
          return;
        }
        setTodayGames((data as TodayGame[]) || []);
      } catch (err) {
        logger.error('Error fetching today games:', err);
      }
    };
    fetchTodayGames();
    // Refresh every 60s for live score updates
    const interval = setInterval(fetchTodayGames, 60000);
    return () => clearInterval(interval);
  }, []);

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
            default: return calcSeasonFpts(p);
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
  }, [players, searchTerm, posFilter, teamFilter, calcSeasonFpts, sortBy, sortDir]);

  // Can add this player?
  const canAdd = (p: PoolPlayer): boolean => {
    if (isViewMode || locked || rosterIds.has(p.id) || roster.length >= rosterSize) return false;
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
      const res = await fetch(`${API_BASE_URL}/api/playoff-pools/roster`, {
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

  // Autosave: debounce roster changes by 1.5s, then persist to DB.
  // Skips the initial mount load (when roster is restored from DB) via a
  // flag ref so we don't immediately re-save what we just fetched.
  const initialLoadDone = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!initialLoadDone.current) {
      if (!loading && roster.length > 0) initialLoadDone.current = true;
      return;
    }
    if (isViewMode || locked || saving || roster.length === 0 || !leagueId) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const session = (await (await import('@/integrations/supabase/client')).supabase.auth.getSession()).data.session;
        const res = await fetch(`${API_BASE_URL}/api/playoff-pools/roster`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({
            leagueId,
            picks: roster.map(p => ({
              player_id: parseInt(p.id),
              position_slot: normalizePos(p.position) === 'G' ? 'G' : normalizePos(p.position) === 'D' ? 'D' : 'F',
            })),
          }),
        });
        if (res.ok) {
          setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }
      } catch { /* silent — user can still manually save */ }
      finally { setSaving(false); }
    }, 1500);

    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, locked, leagueId]);

  // Cross-reference roster players with today's games
  const todayGamesWithPlayers = useMemo(() => {
    if (todayGames.length === 0 || roster.length === 0) return [];
    const rosterTeams = new Set(roster.map(p => p.team));
    return todayGames
      .filter(g => rosterTeams.has(g.home_team) || rosterTeams.has(g.away_team))
      .map(g => ({
        ...g,
        myPlayers: roster.filter(p => p.team === g.home_team || p.team === g.away_team),
      }));
  }, [todayGames, roster]);

  // Format game time to ET display
  const formatGameTime = (gameTime: string | null): string => {
    if (!gameTime) return 'TBD';
    try {
      const d = new Date(gameTime);
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
    } catch {
      return 'TBD';
    }
  };

  const gameStatusLabel = (g: TodayGame): string => {
    if (g.status === 'final') return 'Final';
    if (g.status === 'live') {
      const parts = [g.period];
      if (g.period_time) parts.push(g.period_time);
      return parts.filter(Boolean).join(' ');
    }
    return formatGameTime(g.game_time);
  };

  if (loading) {
    return <><Navbar /><div className="min-h-screen pt-24 flex items-center justify-center text-pastel-cream/70">Loading pool...</div></>;
  }

  return (
    <>
    <Navbar />
    <div className="min-h-screen bg-gradient-to-b from-white to-[#F5F8ED] pb-24 pt-24">
      <div className="max-w-7xl mx-auto px-4 mb-3">
        <Link to={`/pool/playoff-hub?league=${leagueId}`} className="text-sm text-citrus-sage hover:text-pastel-cream inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />{isViewMode ? 'Back to Hub' : 'Back to Pool Home'}
        </Link>
      </div>

      {/* View mode banner */}
      {isViewMode && (
        <div className="max-w-7xl mx-auto px-4 mb-3">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-citrus-orange/10 border border-citrus-orange/30">
            <Eye className="h-5 w-5 text-citrus-orange flex-shrink-0" />
            <div>
              <div className="text-sm font-display font-bold text-pastel-cream">
                Viewing {viewOwnerName || 'Teammate'}&apos;s Roster
              </div>
              <div className="text-[11px] text-pastel-cream/70">Read-only — you cannot modify this roster.</div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky header with roster progress */}
      <div className="sticky top-0 z-30 bg-pastel-surface backdrop-blur-xl border-b border-white/10 shadow-sm pt-safe">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-lg font-varsity font-black uppercase text-pastel-cream flex items-center gap-2">
                <Trophy className="h-5 w-5 text-citrus-orange" aria-hidden="true" />
                {isViewMode ? `${viewOwnerName || 'Teammate'}'s Roster` : (league?.name || 'Playoff Roster Pool')}
              </h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-pastel-cream/75">
                <span className="font-display font-bold text-pastel-cream">{roster.length}/{rosterSize} players</span>
                <span>F: {posCounts.F}/{posReqs.F}</span>
                <span>D: {posCounts.D}/{posReqs.D}</span>
                <span>G: {posCounts.G}/{posReqs.G}</span>
                {!isViewMode && lastSaved && <span className="text-citrus-sage italic">Saved {lastSaved}</span>}
              </div>
            </div>
            {!isViewMode && (
              <Button
                onClick={saveRoster}
                disabled={saving || locked || roster.length < rosterSize}
                className="bg-citrus-sage hover:bg-citrus-sage/90 text-pastel-forest font-display font-bold"
              >
                {locked ? <><Lock className="h-4 w-4 mr-1" />Locked</> : saving ? 'Saving...' : <><Save className="h-4 w-4 mr-1" />Save Roster</>}
              </Button>
            )}
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
        {/* ─── TODAY'S GAMES (restored — shown on both Hub AND roster page) ─── */}
        {todayGamesWithPlayers.length > 0 && (
          <Card className="mb-4 border-2 border-citrus-orange/40 bg-gradient-to-br from-citrus-orange/5 to-white shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-citrus-orange" />
                Today&apos;s Games — {isViewMode ? `${viewOwnerName || 'Their'} Players` : 'Your Players'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {todayGamesWithPlayers.map(g => {
                  const statusText = gameStatusLabel(g);
                  const isLive = g.status === 'live';
                  const isFinal = g.status === 'final';
                  return (
                    <div key={g.game_id} className={cn(
                      'relative rounded-lg border p-3',
                      isLive ? 'border-red-400 bg-red-950/30 ring-1 ring-red-400/30' :
                      isFinal ? 'border-citrus-charcoal/20 bg-muted/20' :
                      'border-citrus-sage/30 bg-white/5'
                    )}>
                      {isLive && (
                        <div className="absolute -top-2 right-3 flex items-center gap-1 bg-red-600 text-white text-[9px] font-varsity font-black uppercase px-2 py-0.5 rounded-full shadow-md">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                          </span>
                          LIVE
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 text-sm font-display font-bold text-pastel-cream">
                          <span>{g.away_team}</span>
                          <span className="text-pastel-cream/60">@</span>
                          <span>{g.home_team}</span>
                        </div>
                        {g.series_game_number && (
                          <Badge variant="outline" className="text-[9px] border-citrus-sage/40">Game {g.series_game_number}</Badge>
                        )}
                      </div>
                      <div className={cn(
                        'text-xs font-display mb-2 flex items-center gap-1.5',
                        isLive ? 'text-red-400 font-bold' : isFinal ? 'text-pastel-cream/70' : 'text-pastel-cream/65'
                      )}>
                        <Clock className="h-3 w-3" />
                        {(isLive || isFinal) ? (
                          <span>{g.away_score} - {g.home_score} · {statusText}</span>
                        ) : (
                          <span>{statusText}</span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {g.myPlayers.map(p => {
                          const ps = playoffStats.get(parseInt(p.id));
                          return (
                            <div key={p.id} className="flex items-center justify-between text-[11px]">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Badge variant="outline" className={cn(
                                  'text-[8px] px-1 py-0',
                                  normalizePos(p.position) === 'G' ? 'border-purple-400/50 text-purple-400' : normalizePos(p.position) === 'D' ? 'border-blue-400/50 text-blue-400' : 'border-citrus-sage text-pastel-cream'
                                )}>{normalizePos(p.position)}</Badge>
                                <span className="font-medium truncate">{shortName(p.full_name)}</span>
                              </div>
                              {ps && normalizePos(p.position) !== 'G' && (
                                <span className="text-pastel-cream/75 flex-shrink-0 ml-1 tabular-nums">{ps.goals ?? 0}G {ps.assists ?? 0}A {calcPlayoffFpts(p).toFixed(1)}pts</span>
                              )}
                              {ps && normalizePos(p.position) === 'G' && (
                                <span className="text-pastel-cream/75 flex-shrink-0 ml-1 tabular-nums">{ps.saves ?? 0}SV {calcPlayoffFpts(p).toFixed(1)}pts</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── VIEW MODE: full-width playoff stats breakdown ─────────── */}
        {isViewMode && (() => {
          const totalFpts = roster.reduce((sum, p) => sum + calcPlayoffFpts(p), 0);
          const totalGP = roster.reduce((sum, p) => sum + (playoffStats.get(parseInt(p.id))?.games_played ?? 0), 0);
          const totalG = roster.reduce((sum, p) => {
            const s = playoffStats.get(parseInt(p.id));
            return sum + (s && !s.is_goalie ? (s.goals ?? 0) : 0);
          }, 0);
          const totalA = roster.reduce((sum, p) => {
            const s = playoffStats.get(parseInt(p.id));
            return sum + (s && !s.is_goalie ? (s.assists ?? 0) : 0);
          }, 0);

          type Row = { player: PoolPlayer; stat: PlayoffStat | null; fpts: number };
          const rowsByGroup: { title: string; rows: Row[] }[] = [
            { title: `Forwards (${posCounts.F}/${posReqs.F})`, rows: roster.filter(p => isForward(p.position)).map(p => ({ player: p, stat: playoffStats.get(parseInt(p.id)) ?? null, fpts: calcPlayoffFpts(p) })) },
            { title: `Defense (${posCounts.D}/${posReqs.D})`, rows: roster.filter(p => normalizePos(p.position) === 'D').map(p => ({ player: p, stat: playoffStats.get(parseInt(p.id)) ?? null, fpts: calcPlayoffFpts(p) })) },
            { title: `Goalies (${posCounts.G}/${posReqs.G})`, rows: roster.filter(p => normalizePos(p.position) === 'G').map(p => ({ player: p, stat: playoffStats.get(parseInt(p.id)) ?? null, fpts: calcPlayoffFpts(p) })) },
          ];

          return (
            <div className="space-y-4 mb-6">
              {/* Total points banner */}
              <Card className="border-2 border-citrus-orange/40 bg-gradient-to-r from-citrus-orange/10 via-citrus-sage/10 to-white shadow-md">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-[10px] uppercase font-display font-bold text-pastel-cream/70 tracking-wide">Total Playoff FPTS</div>
                      <div className="text-4xl font-varsity font-black text-pastel-cream leading-none">{totalFpts.toFixed(1)}</div>
                      <div className="text-xs text-pastel-cream/70 mt-1">
                        Across {roster.length} players · {totalG}G · {totalA}A · {totalGP} player-games played
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs border-citrus-sage/40">
                      <Eye className="h-3 w-3 mr-1" /> Read-only view
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Grouped stat tables by position */}
              {rowsByGroup.map(group => (
                <Card key={group.title} className="border-white/10 bg-white/5 shadow-sm">
                  <CardHeader className="pb-2 px-4">
                    <CardTitle className="text-xs font-display font-bold uppercase text-pastel-cream/75 tracking-wide">
                      {group.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 pb-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-citrus-sage/20 text-[10px] uppercase font-display text-pastel-cream/65">
                            <th className="text-left py-2 px-4 font-bold">Player</th>
                            <th className="text-left py-2 px-2 font-bold">Team</th>
                            <th className="text-right py-2 px-2 font-bold">GP</th>
                            {group.title.startsWith('Goalies') ? (
                              <>
                                <th className="text-right py-2 px-2 font-bold">W</th>
                                <th className="text-right py-2 px-2 font-bold">SV</th>
                                <th className="text-right py-2 px-2 font-bold">SO</th>
                                <th className="text-right py-2 px-2 font-bold">GA</th>
                              </>
                            ) : (
                              <>
                                <th className="text-right py-2 px-2 font-bold">G</th>
                                <th className="text-right py-2 px-2 font-bold">A</th>
                                <th className="text-right py-2 px-2 font-bold">PTS</th>
                                <th className="text-right py-2 px-2 font-bold hidden sm:table-cell">+/-</th>
                                <th className="text-right py-2 px-2 font-bold">SOG</th>
                                <th className="text-right py-2 px-2 font-bold hidden sm:table-cell">HIT</th>
                                <th className="text-right py-2 px-2 font-bold hidden sm:table-cell">BLK</th>
                              </>
                            )}
                            <th className="text-right py-2 px-4 font-bold text-pastel-cream">FPTS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.length === 0 ? (
                            <tr><td colSpan={9} className="text-center text-pastel-cream/60 italic py-4">No players picked at this position.</td></tr>
                          ) : group.rows.map(r => {
                            const s = r.stat;
                            const isG = group.title.startsWith('Goalies');
                            return (
                              <tr key={r.player.id} className="border-b border-citrus-sage/10 hover:bg-citrus-sage/5">
                                <td className="py-2 px-4">
                                  <button
                                    type="button"
                                    onClick={() => setStatsModalPlayer(r.player)}
                                    className="font-medium text-left hover:text-citrus-orange hover:underline transition-colors"
                                  >
                                    <span className="sm:hidden">{shortName(r.player.full_name)}</span>
                                    <span className="hidden sm:inline">{r.player.full_name}</span>
                                  </button>
                                </td>
                                <td className="py-2 px-2 text-pastel-cream/75">{r.player.team}</td>
                                <td className="py-2 px-2 text-right tabular-nums">{s?.games_played ?? 0}</td>
                                {isG ? (
                                  <>
                                    <td className="py-2 px-2 text-right tabular-nums">{s?.wins ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums">{s?.saves ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums">{s?.shutouts ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums">{s?.goals_against ?? 0}</td>
                                  </>
                                ) : (
                                  <>
                                    <td className="py-2 px-2 text-right tabular-nums">{s?.goals ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums">{s?.assists ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums font-semibold">{s?.points ?? 0}</td>
                                    <td className={cn(
                                      'py-2 px-2 text-right tabular-nums hidden sm:table-cell',
                                      (s?.plus_minus ?? 0) > 0 && 'text-green-400 font-semibold',
                                      (s?.plus_minus ?? 0) < 0 && 'text-red-400 font-semibold',
                                    )}>
                                      {s ? (s.plus_minus > 0 ? `+${s.plus_minus}` : s.plus_minus) : 0}
                                    </td>
                                    <td className="py-2 px-2 text-right tabular-nums">{s?.shots ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums hidden sm:table-cell">{s?.hits ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums hidden sm:table-cell">{s?.blocks ?? 0}</td>
                                  </>
                                )}
                                <td className="py-2 px-4 text-right tabular-nums font-bold text-pastel-cream">{r.fpts.toFixed(1)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          );
        })()}

        <div className={cn(
          'grid grid-cols-1 gap-4',
          !isViewMode && 'lg:grid-cols-[1fr_340px]'
        )}>
          {/* ─── LEFT: Player Pool (hidden in view mode) ──────────────── */}
          {!isViewMode && <div className="min-w-0">
            {/* Search + Position tabs */}
            <div className="flex flex-wrap gap-2 mb-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search players or teams..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-9 text-sm bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55"
                />
              </div>
              <div className="flex bg-white/5 rounded-lg border border-white/10 p-0.5">
                {POSITION_TABS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setPosFilter(tab.key)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-display font-bold rounded-md transition-colors',
                      posFilter === tab.key
                        ? 'bg-pastel-orange text-[#581E00] shadow-sm'
                        : 'text-pastel-cream/75 hover:text-pastel-cream'
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
                    : 'bg-white/5 text-pastel-cream/75 border-citrus-sage/30 hover:border-citrus-sage'
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
                          ? 'bg-red-950/30 text-red-400 border-red-400/40'
                          : 'bg-white/5 text-pastel-cream/75 border-citrus-sage/30 hover:border-citrus-sage'
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
              const fpts = calcSeasonFpts(selectedPlayer);
              return (
                <Card className="mb-3 border-2 border-citrus-orange/40 bg-gradient-to-r from-citrus-orange/5 to-citrus-sage/5 shadow-md relative">
                  <CardContent className="p-3">
                    {/* Close X — absolute corner so it never fights for space */}
                    <button
                      onClick={() => setSelectedPlayer(null)}
                      className="absolute top-1.5 right-1.5 p-1 rounded text-pastel-cream/60 hover:text-pastel-cream/85 hover:bg-muted/30"
                      title="Close preview"
                    >
                      <X className="h-4 w-4" />
                    </button>

                    {/* Row 1: Pos + Name + Meta */}
                    <div className="flex items-center gap-2 pr-6 mb-2">
                      <Badge variant="outline" className={cn(
                        'text-[11px] px-2 flex-shrink-0',
                        norm === 'G' ? 'border-purple-400/50 text-purple-400' : norm === 'D' ? 'border-blue-400/50 text-blue-400' : 'border-citrus-sage text-pastel-cream'
                      )}>{norm}</Badge>
                      <div className="min-w-0 flex-1">
                        <div className="font-display font-bold text-base text-pastel-cream truncate">{selectedPlayer.full_name}</div>
                        <div className="text-[11px] text-pastel-cream/70 truncate">
                          {selectedPlayer.team} · GP {selectedPlayer.games_played}
                          {norm === 'G'
                            ? ` · ${selectedPlayer.wins || 0}W${(() => {
                                const sp = Number(selectedPlayer.save_pct ?? 0);
                                return sp > 0 ? ` · ${(sp < 1 ? sp * 100 : sp).toFixed(1)}% SV` : '';
                              })()}`
                            : ` · ${selectedPlayer.goals}G ${selectedPlayer.assists}A ${selectedPlayer.points}PTS`}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[9px] uppercase font-display text-pastel-cream/65 leading-none">FPTS</div>
                        <div className="font-varsity text-lg text-green-400 font-black leading-tight">{fpts.toFixed(1)}</div>
                      </div>
                    </div>

                    {/* Row 2: Action buttons — full width, easy to tap on mobile */}
                    <div className="flex items-stretch gap-2">
                      <button
                        onClick={() => setStatsModalPlayer(selectedPlayer)}
                        className="flex-1 sm:flex-initial px-3 py-2 rounded bg-white/5 border border-citrus-sage/40 text-pastel-cream text-xs font-bold hover:bg-citrus-sage/10 transition-colors"
                      >
                        Details
                      </button>
                      {onRoster ? (
                        <button
                          onClick={() => { removePlayer(selectedPlayer.id); setSelectedPlayer(null); }}
                          className="flex-1 sm:flex-initial px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-xs font-display font-bold transition-colors"
                        >
                          Remove from Roster
                        </button>
                      ) : (
                        <button
                          onClick={() => { if (addable) { addPlayer(selectedPlayer); setSelectedPlayer(null); } }}
                          disabled={!addable}
                          className={cn(
                            'flex-1 sm:flex-initial px-4 py-2 rounded text-xs font-display font-bold transition-colors',
                            addable
                              ? 'bg-citrus-orange hover:bg-citrus-orange/90 text-white'
                              : 'bg-muted text-pastel-cream/65 cursor-not-allowed'
                          )}
                          title={addable ? 'Add to roster' : 'Position full or team cap reached'}
                        >
                          {addable ? 'Add to Roster' : 'Cannot Add'}
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Top sticky horizontal scrollbar (desktop only — mobile doesn't
                need it since the table fits the viewport). */}
            <div
              className="overflow-x-scroll scrollbar-styled mb-1 bg-fantasy-light/40 rounded border border-white/40"
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
            <div className="text-[10px] text-pastel-cream/65 mb-2 text-center italic">
              Tip: scroll ↔ to see more stats (xG, TOI, +/-, etc.)
            </div>

            {/* Player table — single scroll container that scrolls BOTH axes.
                overflow-auto = horizontal + vertical scrollbars always visible
                (styled by .scrollbar-styled). max-h bounds vertical so the
                horizontal bar at the bottom stays within the viewport. */}
            <Card className="border-white/10 bg-fantasy-surface">
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
                  <thead className="bg-fantasy-light sticky top-0 z-10 border-b border-white/10">
                    <tr>
                      <th className="px-2 py-2 text-left text-xs font-display font-bold text-pastel-cream w-8">#</th>
                      <th className="px-2 py-2 text-left text-xs font-display font-bold text-pastel-cream w-20">Action</th>
                      {(() => {
                        const ind = (col: string) => sortBy === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
                        const cn_sort = 'cursor-pointer select-none hover:text-citrus-orange transition-colors';
                        return (
                          <>
                            <th onClick={() => toggleSort('name')} className={cn('px-2 py-2 text-left text-xs font-display font-bold text-pastel-cream min-w-[140px]', cn_sort)}>Player{ind('name')}</th>
                            <th className="px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream">Pos</th>
                            <th onClick={() => toggleSort('team')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>Team{ind('team')}</th>
                            <th onClick={() => toggleSort('gp')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>GP{ind('gp')}</th>
                            {posFilter === 'G' ? (
                              /* Goalie-specific columns */
                              <>
                                <th onClick={() => toggleSort('g_w')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>W{ind('g_w')}</th>
                                <th onClick={() => toggleSort('a_sv')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>SV{ind('a_sv')}</th>
                                <th onClick={() => toggleSort('pts_so')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>SO{ind('pts_so')}</th>
                                <th onClick={() => toggleSort('sog_ga')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>GA{ind('sog_ga')}</th>
                                <th onClick={() => toggleSort('pm_svpct')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>SV%{ind('pm_svpct')}</th>
                                <th onClick={() => toggleSort('xg_gaa')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-purple-400', cn_sort)}>GAA{ind('xg_gaa')}</th>
                              </>
                            ) : (
                              /* Skater columns — default for All / Forwards / Defense */
                              <>
                                <th onClick={() => toggleSort('g_w')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>G{ind('g_w')}</th>
                                <th onClick={() => toggleSort('a_sv')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>A{ind('a_sv')}</th>
                                <th onClick={() => toggleSort('pts_so')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>PTS{ind('pts_so')}</th>
                                <th onClick={() => toggleSort('sog_ga')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>SOG{ind('sog_ga')}</th>
                                <th onClick={() => toggleSort('hit')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>HIT{ind('hit')}</th>
                                <th onClick={() => toggleSort('blk')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>BLK{ind('blk')}</th>
                                <th onClick={() => toggleSort('pm_svpct')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream', cn_sort)}>+/-{ind('pm_svpct')}</th>
                                <th onClick={() => toggleSort('xg_gaa')} className={cn('px-2 py-2 text-center text-xs font-display font-bold text-purple-400', cn_sort)}>xG{ind('xg_gaa')}</th>
                              </>
                            )}
                          </>
                        );
                      })()}
                      <th className="px-2 py-2 text-center text-xs font-display font-bold text-pastel-cream" title="Avg time on ice per game (min:sec)">TOI</th>
                      <th className="px-2 py-2 text-center text-xs font-bold text-green-400 bg-green-950/30">FPTS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.slice(0, 200).map((player, idx) => {
                      const onRoster = rosterIds.has(player.id);
                      const addable = canAdd(player);
                      const fpts = calcSeasonFpts(player);
                      const norm = normalizePos(player.position);
                      const teamAtCap = hasCap && (teamCounts.get(player.team) || 0) >= maxPerTeam;
                      return (
                        <tr
                          key={player.id}
                          className={cn(
                            'border-b border-white/30 transition-colors cursor-pointer',
                            selectedPlayer?.id === player.id && 'bg-citrus-orange/10 ring-1 ring-citrus-orange/30',
                            onRoster && selectedPlayer?.id !== player.id && 'bg-citrus-sage/10 border-l-2 border-l-citrus-sage',
                            !onRoster && selectedPlayer?.id !== player.id && 'hover:bg-fantasy-light/30',
                            !addable && !onRoster && selectedPlayer?.id !== player.id && 'opacity-50'
                          )}
                          onClick={() => setSelectedPlayer(player)}
                        >
                          <td className="px-2 py-1.5 text-xs font-mono text-pastel-cream/60">{idx + 1}</td>
                          {/* Add / Remove button on the LEFT (discoverable) */}
                          <td className="px-2 py-1.5">
                            {onRoster ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); removePlayer(player.id); }}
                                className="px-2 py-1 rounded bg-red-950/30 hover:bg-red-950/50 text-red-400 hover:text-red-300 transition-colors text-[11px] font-bold border border-red-400/40"
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
                                    ? 'bg-citrus-sage/10 hover:bg-citrus-sage/20 text-pastel-cream border-citrus-sage/40'
                                    : 'bg-muted/30 text-pastel-cream/60 border-muted cursor-not-allowed'
                                )}
                                title={addable ? 'Add to roster' : 'Cannot add (position full or team cap)'}
                              >
                                Add
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {onRoster && <Check className="h-3.5 w-3.5 text-citrus-sage flex-shrink-0" aria-hidden="true" />}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setStatsModalPlayer(player); }}
                                className={cn(
                                  'text-sm font-medium truncate text-left hover:text-citrus-orange hover:underline transition-colors',
                                  onRoster && 'text-pastel-cream font-bold'
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
                              norm === 'G' ? 'border-purple-400/50 text-purple-400' : norm === 'D' ? 'border-blue-400/50 text-blue-400' : 'border-citrus-sage text-pastel-cream'
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
                                <td className="px-2 py-1.5 text-center text-xs text-pastel-cream/60" colSpan={2}>—</td>
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
                              <td className="px-2 py-1.5 text-center text-xs text-purple-400">
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
                              <td className={cn('px-2 py-1.5 text-center text-xs', (player.plus_minus || 0) > 0 && 'text-green-400', (player.plus_minus || 0) < 0 && 'text-red-400')}>
                                {(player.plus_minus ?? 0) > 0 ? '+' : ''}{player.plus_minus ?? 0}
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs text-purple-400 font-semibold">
                                {(() => {
                                  const xg = player.xGoals ?? player.x_goals ?? 0;
                                  return xg > 0 ? xg.toFixed(1) : '—';
                                })()}
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream/75">
                                {player.icetime_seconds && player.games_played ? (() => {
                                  const totalSec = Math.round(player.icetime_seconds / player.games_played);
                                  const m = Math.floor(totalSec / 60);
                                  const s = totalSec % 60;
                                  return `${m}:${s < 10 ? '0' : ''}${s}`;
                                })() : '—'}
                              </td>
                            </>
                          )}
                          <td className="px-2 py-1.5 text-center text-xs font-bold text-green-400 bg-green-950/20">{fpts.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>}

          {/* ─── RIGHT: Roster Panel (read-only in view mode) ────────── */}
          <div className={cn(
            'space-y-3',
            !isViewMode && 'lg:sticky lg:top-[110px] lg:self-start'
          )}>
            {/* Roster card */}
            <Card className="border-white/10 bg-white/5 shadow-md">
              <CardHeader className="pb-2 px-4">
                <CardTitle className="text-sm font-display font-bold text-pastel-cream flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    {isViewMode ? <Eye className="h-4 w-4 text-citrus-orange" /> : <Users className="h-4 w-4 text-citrus-orange" />}
                    {isViewMode ? `${viewOwnerName || 'Teammate'}'s Roster` : 'Your Roster'} ({roster.length}/{rosterSize})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {/* Forwards */}
                <div>
                  <div className="text-[10px] font-display font-bold uppercase text-pastel-cream/65 mb-1">Forwards ({posCounts.F}/{posReqs.F})</div>
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
                          <span className="text-[10px] text-pastel-cream/65">{p.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-green-400">{calcFpts(p).toFixed(1)}</span>
                          {!locked && !isViewMode && (
                            <button onClick={() => removePlayer(p.id)} className="text-red-300 hover:text-red-500">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, posReqs.F - posCounts.F) }).map((_, i) => (
                      <div key={`empty-f-${i}`} className="flex items-center py-1.5 px-2 rounded border border-dashed border-citrus-sage/20 text-pastel-cream/60">
                        <User className="h-3 w-3 mr-2" />
                        <span className="text-[11px] italic">Empty F slot</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Defensemen */}
                <div>
                  <div className="text-[10px] font-display font-bold uppercase text-pastel-cream/65 mb-1">Defense ({posCounts.D}/{posReqs.D})</div>
                  <div className="space-y-1">
                    {roster.filter(p => normalizePos(p.position) === 'D').map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1 px-2 bg-blue-950/20 rounded border border-blue-400/20">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="text-[9px] px-1 border-blue-400/50 text-blue-400">D</Badge>
                          <button
                            type="button"
                            onClick={() => setStatsModalPlayer(p)}
                            className="text-xs font-medium truncate text-left hover:text-citrus-orange hover:underline transition-colors"
                          >
                            <span className="sm:hidden">{shortName(p.full_name)}</span>
                            <span className="hidden sm:inline">{p.full_name}</span>
                          </button>
                          <span className="text-[10px] text-pastel-cream/65">{p.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-green-400">{calcFpts(p).toFixed(1)}</span>
                          {!locked && !isViewMode && (
                            <button onClick={() => removePlayer(p.id)} className="text-red-300 hover:text-red-500">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, posReqs.D - posCounts.D) }).map((_, i) => (
                      <div key={`empty-d-${i}`} className="flex items-center py-1.5 px-2 rounded border border-dashed border-blue-400/20 text-pastel-cream/60">
                        <Shield className="h-3 w-3 mr-2" />
                        <span className="text-[11px] italic">Empty D slot</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Goalies */}
                <div>
                  <div className="text-[10px] font-display font-bold uppercase text-pastel-cream/65 mb-1">Goalies ({posCounts.G}/{posReqs.G})</div>
                  <div className="space-y-1">
                    {roster.filter(p => normalizePos(p.position) === 'G').map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1 px-2 bg-purple-950/20 rounded border border-purple-400/20">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="text-[9px] px-1 border-purple-400/50 text-purple-400">G</Badge>
                          <button
                            type="button"
                            onClick={() => setStatsModalPlayer(p)}
                            className="text-xs font-medium truncate text-left hover:text-citrus-orange hover:underline transition-colors"
                          >
                            <span className="sm:hidden">{shortName(p.full_name)}</span>
                            <span className="hidden sm:inline">{p.full_name}</span>
                          </button>
                          <span className="text-[10px] text-pastel-cream/65">{p.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-green-400">{calcFpts(p).toFixed(1)}</span>
                          {!locked && !isViewMode && (
                            <button onClick={() => removePlayer(p.id)} className="text-red-300 hover:text-red-500">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, posReqs.G - posCounts.G) }).map((_, i) => (
                      <div key={`empty-g-${i}`} className="flex items-center py-1.5 px-2 rounded border border-dashed border-purple-400/20 text-pastel-cream/60">
                        <User className="h-3 w-3 mr-2" />
                        <span className="text-[11px] italic">Empty G slot</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Team breakdown */}
                {roster.length > 0 && (
                  <div className="pt-2 border-t border-white/10">
                    <div className="text-[10px] font-display font-bold uppercase text-pastel-cream/65 mb-1.5">Team Breakdown</div>
                    <div className="flex flex-wrap gap-1">
                      {Array.from(teamCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([team, count]) => (
                          <Badge
                            key={team}
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              hasCap && count >= maxPerTeam ? 'border-red-400/50 text-red-400 bg-red-950/30' : 'border-citrus-sage/30'
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

            {/* Quick tips (own roster) or Back to Hub (view mode) */}
            {isViewMode ? (
              <Button asChild variant="outline" className="w-full border-citrus-sage/40 text-pastel-cream font-display">
                <Link to={`/pool/playoff-hub?league=${leagueId}`}>
                  <ArrowLeft className="h-4 w-4 mr-1" />Back to Hub
                </Link>
              </Button>
            ) : (
              <Card className="border-white/10 bg-citrus-sage/5 px-4 py-3">
                <div className="text-[10px] font-display font-bold uppercase text-pastel-cream/65 mb-1">How it works</div>
                <ul className="text-[11px] text-pastel-cream/75 space-y-0.5 list-disc pl-3">
                  <li>Pick {rosterSize} players from playoff teams</li>
                  {hasCap && <li>Max {maxPerTeam} players per NHL team</li>}
                  {!hasCap && <li>No per-team cap — stack any team if you want</li>}
                  <li>Total fantasy points across all playoff games</li>
                  <li>Click any player row to add them</li>
                  <li>Your FPTS uses your league's custom scoring</li>
                </ul>
              </Card>
            )}
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
