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
import { StormyLoading } from '@/components/citrus2';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ScoringCalculator, type ScoringSettings } from '@/utils/scoringUtils';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { getTodayMST } from '@/utils/timezoneUtils';

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
        // Step 1 — fetch league + picks first. The picks list tells us
        // whether THIS league has already drafted (any user has saved picks).
        // We use that signal to decide whether to apply the alive-teams
        // filter to the player pool. Already-drafted leagues keep the full
        // pool so users still see all their roster players (including ones
        // on now-eliminated teams).
        const [leagueRes, picksRes] = await Promise.all([
          fetch(`/api/leagues/${leagueId}`, { headers }).then(r => r.json()),
          fetch(`/api/playoff-pools/${leagueId}/picks?type=roster`, { headers }).then(r => r.json()).catch(() => null),
        ]);
        const leagueData = leagueRes.data || leagueRes;
        setLeague(leagueData);

        // Has anyone in this league drafted yet? If yes → existing league,
        // don't shrink the pool. If no → fresh pool, apply alive-teams filter
        // so new pools mid-playoffs only show teams still in contention.
        const allPicks = (picksRes?.data?.picks || picksRes?.picks || []) as Array<{ player_id: number; user_id: string }>;
        const leagueHasDrafted = allPicks.length > 0;

        // Step 2 — fetch players with the appropriate filter.
        const playersUrl = leagueHasDrafted
          ? '/api/players?limit=1000'
          : '/api/players?limit=1000&aliveTeamsOnly=true';
        const playersRes = await fetch(playersUrl, { headers }).then(r => r.json());

        // API returns { data: [...players] } — extract array safely
        const playerArr = Array.isArray(playersRes.data) ? playersRes.data
          : Array.isArray(playersRes) ? playersRes : [];
        const draftablePlayers = playerArr as PoolPlayer[];
        setPlayers(draftablePlayers);
        // Restore roster picks — either the current user's or the viewed user's.
        // We look up the saved picks against ALL players (not just currently
        // draftable) by falling back to the player ID on the server response —
        // a previously-drafted player on a now-eliminated team must still
        // appear on the user's roster (they keep what they drafted).
        if (allPicks.length > 0 && targetUserId) {
          const targetPicks = allPicks.filter(p => p.user_id === targetUserId);

          // First pass: find picks already in the alive-team draftable list.
          const draftableById = new Map(draftablePlayers.map(p => [parseInt(p.id), p]));
          const aliveTeamPicks = targetPicks
            .map(pk => draftableById.get(pk.player_id))
            .filter((p): p is PoolPlayer => !!p);

          // Second pass: any picks NOT in the draftable list are on
          // eliminated teams — fetch those players directly so they still
          // appear on the user's roster (rule: you keep what you drafted,
          // even if the team got knocked out).
          const missingIds = targetPicks
            .map(pk => pk.player_id)
            .filter(id => !draftableById.has(id));
          let eliminatedTeamPicks: PoolPlayer[] = [];
          if (missingIds.length > 0) {
            try {
              const eliminatedRes = await fetch(
                `/api/players/by-ids?ids=${missingIds.join(',')}`,
                { headers }
              ).then(r => r.json());
              const arr = Array.isArray(eliminatedRes.data) ? eliminatedRes.data
                : Array.isArray(eliminatedRes) ? eliminatedRes : [];
              eliminatedTeamPicks = arr as PoolPlayer[];
            } catch {
              // Best-effort — if this lookup fails, those picks just won't
              // show. Rare path, not worth blocking the UI.
            }
          }

          // Preserve original draft order using the targetPicks index so the
          // roster table renders the way the user built it.
          const allPickedById = new Map<number, PoolPlayer>();
          for (const p of [...aliveTeamPicks, ...eliminatedTeamPicks]) {
            allPickedById.set(parseInt(p.id), p);
          }
          const savedPlayers = targetPicks
            .map(pk => allPickedById.get(pk.player_id))
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
        const today = getTodayMST();
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
        const res = await fetch('/api/playoff-pools/roster', {
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
    return <><Navbar /><div className="min-h-screen pt-24 flex items-center justify-center bg-pastel-surface"><StormyLoading message="Loading pool..." /></div></>;
  }

  return (
    <>
    <Navbar />
    <div className="min-h-screen bg-pastel-surface pb-24 pt-24">
      <div className="max-w-7xl mx-auto px-4 mb-3">
        <Link to={`/pool/playoff-hub?league=${leagueId}`} className="text-sm text-pastel-sage-soft hover:text-pastel-cream inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />{isViewMode ? 'Back to Hub' : 'Back to Pool Home'}
        </Link>
      </div>

      {/* View mode banner */}
      {isViewMode && (
        <div className="max-w-7xl mx-auto px-4 mb-3">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-pastel-orange/10 ring-1 ring-pastel-orange/30">
            <Eye className="h-5 w-5 text-pastel-orange flex-shrink-0" />
            <div>
              <div className="text-sm font-bold text-pastel-cream">
                Viewing {viewOwnerName || 'Teammate'}&apos;s Roster
              </div>
              <div className="text-[11px] text-white/55">Read-only — you cannot modify this roster.</div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky header with roster progress */}
      <div className="sticky top-0 z-30 bg-pastel-surface-tile ring-1 ring-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-lg font-calistoga text-pastel-cream flex items-center gap-2">
                <Trophy className="h-5 w-5 text-pastel-orange" />
                {isViewMode ? `${viewOwnerName || 'Teammate'}'s Roster` : (league?.name || 'Playoff Roster Pool')}
              </h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-white/70">
                <span className="font-bold text-pastel-cream">{roster.length}/{rosterSize} players</span>
                <span>F: {posCounts.F}/{posReqs.F}</span>
                <span>D: {posCounts.D}/{posReqs.D}</span>
                <span>G: {posCounts.G}/{posReqs.G}</span>
                {!isViewMode && lastSaved && <span className="text-pastel-sage-soft italic">Saved {lastSaved}</span>}
              </div>
            </div>
            {!isViewMode && (
              <Button
                onClick={saveRoster}
                disabled={saving || locked || roster.length < rosterSize}
                className="bg-pastel-sage text-pastel-surface hover:bg-pastel-sage-soft font-bold"
              >
                {locked ? <><Lock className="h-4 w-4 mr-1" />Locked</> : saving ? 'Saving...' : <><Save className="h-4 w-4 mr-1" />Save Roster</>}
              </Button>
            )}
          </div>

          {/* Roster progress bar */}
          <div className="mt-2 h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-pastel-sage to-pastel-orange rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, (roster.length / rosterSize) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-4">
        {/* ─── TODAY'S GAMES (restored — shown on both Hub AND roster page) ─── */}
        {todayGamesWithPlayers.length > 0 && (
          <Card className="mb-4 bg-pastel-surface-tile ring-1 ring-pastel-orange/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-pastel-cream">
                <Calendar className="h-4 w-4 text-pastel-orange" />
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
                      'relative rounded-lg p-3 bg-pastel-surface ring-1',
                      isLive ? 'bg-red-400/10 ring-red-400/30' :
                      isFinal ? 'ring-pastel-sage/30' :
                      'ring-white/10'
                    )}>
                      {isLive && (
                        <div className="absolute -top-2 right-3 flex items-center gap-1 bg-red-500 text-white text-[9px] font-calistoga uppercase tracking-wider px-2 py-0.5 rounded-full">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                          </span>
                          LIVE
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 text-sm font-bold text-pastel-cream">
                          <span>{g.away_team}</span>
                          <span className="text-white/40">@</span>
                          <span>{g.home_team}</span>
                        </div>
                        {g.series_game_number && (
                          <Badge className="text-[9px] px-1 py-0 bg-white/5 ring-1 ring-white/10 text-white/55 border-0 font-jbmono uppercase tracking-wider">Game {g.series_game_number}</Badge>
                        )}
                      </div>
                      <div className={cn(
                        'text-xs mb-2 flex items-center gap-1.5',
                        isLive ? 'text-red-300 font-bold' : isFinal ? 'text-white/55' : 'text-white/45'
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
                                <Badge className={cn(
                                  'text-[8px] px-1 py-0 border-0 font-bold',
                                  normalizePos(p.position) === 'G' ? 'bg-pastel-butter/15 ring-1 ring-pastel-butter/40 text-pastel-butter' :
                                  normalizePos(p.position) === 'D' ? 'bg-pastel-orange/15 ring-1 ring-pastel-orange/40 text-pastel-orange-soft' :
                                  'bg-pastel-sage/15 ring-1 ring-pastel-sage/40 text-pastel-sage-soft'
                                )}>{normalizePos(p.position)}</Badge>
                                <span className="font-medium truncate text-pastel-cream">{shortName(p.full_name)}</span>
                              </div>
                              {ps && normalizePos(p.position) !== 'G' && (
                                <span className="text-white/70 flex-shrink-0 ml-1 tabular-nums">{ps.goals ?? 0}G {ps.assists ?? 0}A {calcPlayoffFpts(p).toFixed(1)}pts</span>
                              )}
                              {ps && normalizePos(p.position) === 'G' && (
                                <span className="text-white/70 flex-shrink-0 ml-1 tabular-nums">{ps.saves ?? 0}SV {calcPlayoffFpts(p).toFixed(1)}pts</span>
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
              <Card className="bg-pastel-surface-tile ring-1 ring-pastel-orange/30">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-[10px] uppercase font-jbmono font-bold text-pastel-orange-soft tracking-wider">Total Playoff FPTS</div>
                      <div className="text-4xl font-calistoga text-pastel-cream leading-none">{totalFpts.toFixed(1)}</div>
                      <div className="text-xs text-white/55 mt-1">
                        Across {roster.length} players · {totalG}G · {totalA}A · {totalGP} player-games played
                      </div>
                    </div>
                    <Badge className="text-xs bg-white/5 ring-1 ring-white/10 text-white/55 border-0 font-jbmono uppercase tracking-wider">
                      <Eye className="h-3 w-3 mr-1" /> Read-only view
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Grouped stat tables by position */}
              {rowsByGroup.map(group => (
                <Card key={group.title}>
                  <CardHeader className="pb-2 px-4">
                    <CardTitle className="text-xs font-jbmono font-bold uppercase text-white/55 tracking-wider">
                      {group.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 pb-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/10 text-[10px] uppercase font-jbmono text-white/45">
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
                            <th className="text-right py-2 px-4 font-bold text-pastel-sage-soft bg-pastel-sage/10">FPTS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.length === 0 ? (
                            <tr><td colSpan={9} className="text-center text-white/45 italic py-4">No players picked at this position.</td></tr>
                          ) : group.rows.map(r => {
                            const s = r.stat;
                            const isG = group.title.startsWith('Goalies');
                            return (
                              <tr key={r.player.id} className="border-b border-white/10 hover:bg-white/5">
                                <td className="py-2 px-4">
                                  <button
                                    type="button"
                                    onClick={() => setStatsModalPlayer(r.player)}
                                    className="font-medium text-left text-pastel-cream hover:text-pastel-orange hover:underline transition-colors"
                                  >
                                    <span className="sm:hidden">{shortName(r.player.full_name)}</span>
                                    <span className="hidden sm:inline">{r.player.full_name}</span>
                                  </button>
                                </td>
                                <td className="py-2 px-2 text-white/70">{r.player.team}</td>
                                <td className="py-2 px-2 text-right tabular-nums text-pastel-cream">{s?.games_played ?? 0}</td>
                                {isG ? (
                                  <>
                                    <td className="py-2 px-2 text-right tabular-nums text-pastel-cream">{s?.wins ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums text-pastel-cream">{s?.saves ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums text-pastel-cream">{s?.shutouts ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums text-pastel-cream">{s?.goals_against ?? 0}</td>
                                  </>
                                ) : (
                                  <>
                                    <td className="py-2 px-2 text-right tabular-nums text-pastel-cream">{s?.goals ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums text-pastel-cream">{s?.assists ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums font-semibold text-pastel-cream">{s?.points ?? 0}</td>
                                    <td className={cn(
                                      'py-2 px-2 text-right tabular-nums hidden sm:table-cell',
                                      (s?.plus_minus ?? 0) > 0 ? 'text-pastel-sage-soft font-semibold' :
                                      (s?.plus_minus ?? 0) < 0 ? 'text-red-300 font-semibold' :
                                      'text-pastel-cream',
                                    )}>
                                      {s ? (s.plus_minus > 0 ? `+${s.plus_minus}` : s.plus_minus) : 0}
                                    </td>
                                    <td className="py-2 px-2 text-right tabular-nums text-pastel-cream">{s?.shots ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums hidden sm:table-cell text-pastel-cream">{s?.hits ?? 0}</td>
                                    <td className="py-2 px-2 text-right tabular-nums hidden sm:table-cell text-pastel-cream">{s?.blocks ?? 0}</td>
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
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-white/40" />
                <Input
                  placeholder="Search players or teams..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <div className="flex bg-pastel-surface rounded-lg ring-1 ring-white/10 p-0.5">
                {POSITION_TABS.map(tab => {
                  const active = posFilter === tab.key;
                  const activeClass =
                    tab.key === 'All' ? 'bg-pastel-cream text-pastel-surface' :
                    tab.key === 'F' ? 'bg-pastel-sage text-pastel-surface' :
                    tab.key === 'D' ? 'bg-pastel-orange text-pastel-surface' :
                    'bg-pastel-butter text-pastel-surface';
                  const inactiveClass =
                    tab.key === 'All' ? 'text-white/55 hover:text-pastel-cream' :
                    tab.key === 'F' ? 'text-pastel-sage-soft hover:text-pastel-cream' :
                    tab.key === 'D' ? 'text-pastel-orange-soft hover:text-pastel-cream' :
                    'text-pastel-butter hover:text-pastel-cream';
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setPosFilter(tab.key)}
                      className={cn(
                        'px-3 py-1.5 text-xs font-bold rounded-md transition-colors',
                        active ? activeClass : inactiveClass
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Team filter pills — scrollable */}
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-styled">
              <button
                onClick={() => setTeamFilter(null)}
                className={cn(
                  'flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-bold border-0 ring-1 transition-colors',
                  !teamFilter
                    ? 'bg-pastel-cream text-pastel-surface ring-pastel-cream'
                    : 'bg-white/5 text-white/70 ring-white/10 hover:ring-pastel-cream/40'
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
                      'flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-bold border-0 ring-1 transition-colors flex items-center gap-1',
                      teamFilter === team
                        ? 'bg-pastel-cream text-pastel-surface ring-pastel-cream'
                        : atCap
                          ? 'bg-red-400/10 text-red-300 ring-red-400/30'
                          : 'bg-white/5 text-white/70 ring-white/10 hover:ring-pastel-cream/40'
                    )}
                  >
                    {team}
                    {count > 0 && (
                      <span className={cn(
                        'w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold',
                        atCap ? 'bg-red-500 text-white' : 'bg-pastel-sage text-pastel-surface'
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
                <Card className="mb-3 bg-pastel-surface-tile ring-1 ring-pastel-orange/40 relative">
                  <CardContent className="p-3">
                    {/* Close X — absolute corner so it never fights for space */}
                    <button
                      onClick={() => setSelectedPlayer(null)}
                      className="absolute top-1.5 right-1.5 p-1 rounded text-white/40 hover:text-pastel-cream hover:bg-white/5"
                      title="Close preview"
                    >
                      <X className="h-4 w-4" />
                    </button>

                    {/* Row 1: Pos + Name + Meta */}
                    <div className="flex items-center gap-2 pr-6 mb-2">
                      <Badge className={cn(
                        'text-[11px] px-2 flex-shrink-0 border-0 font-bold',
                        norm === 'G' ? 'bg-pastel-butter/15 ring-1 ring-pastel-butter/40 text-pastel-butter' :
                        norm === 'D' ? 'bg-pastel-orange/15 ring-1 ring-pastel-orange/40 text-pastel-orange-soft' :
                        'bg-pastel-sage/15 ring-1 ring-pastel-sage/40 text-pastel-sage-soft'
                      )}>{norm}</Badge>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-base text-pastel-cream truncate">{selectedPlayer.full_name}</div>
                        <div className="text-[11px] text-white/55 truncate">
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
                        <div className="text-[9px] uppercase font-jbmono text-white/45 tracking-wider leading-none">FPTS</div>
                        <div className="font-calistoga text-lg text-pastel-sage-soft leading-tight">{fpts.toFixed(1)}</div>
                      </div>
                    </div>

                    {/* Row 2: Action buttons — full width, easy to tap on mobile */}
                    <div className="flex items-stretch gap-2">
                      <button
                        onClick={() => setStatsModalPlayer(selectedPlayer)}
                        className="flex-1 sm:flex-initial px-3 py-2 rounded bg-white/5 ring-1 ring-white/10 text-pastel-cream text-xs font-bold hover:bg-white/10 transition-colors"
                      >
                        Details
                      </button>
                      {onRoster ? (
                        <button
                          onClick={() => { removePlayer(selectedPlayer.id); setSelectedPlayer(null); }}
                          className="flex-1 sm:flex-initial px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-xs font-bold transition-colors"
                        >
                          Remove from Roster
                        </button>
                      ) : (
                        <button
                          onClick={() => { if (addable) { addPlayer(selectedPlayer); setSelectedPlayer(null); } }}
                          disabled={!addable}
                          className={cn(
                            'flex-1 sm:flex-initial px-4 py-2 rounded text-xs font-bold transition-colors',
                            addable
                              ? 'bg-pastel-orange hover:bg-pastel-orange-soft text-pastel-surface'
                              : 'bg-white/5 ring-1 ring-white/10 text-white/30 cursor-not-allowed'
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
              className="overflow-x-scroll scrollbar-styled mb-1 bg-white/5 rounded ring-1 ring-white/10"
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
            <div className="text-[10px] text-white/45 mb-2 text-center italic">
              Tip: scroll ↔ to see more stats (xG, TOI, +/-, etc.)
            </div>

            {/* Player table — single scroll container that scrolls BOTH axes.
                overflow-auto = horizontal + vertical scrollbars always visible
                (styled by .scrollbar-styled). max-h bounds vertical so the
                horizontal bar at the bottom stays within the viewport. */}
            <Card>
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
                  <thead className="bg-pastel-surface-tile sticky top-0 z-10 border-b border-white/10">
                    <tr>
                      <th className="px-2 py-2 text-left text-xs font-bold text-pastel-cream w-8">#</th>
                      <th className="px-2 py-2 text-left text-xs font-bold text-pastel-cream w-20">Action</th>
                      {(() => {
                        const ind = (col: string) => sortBy === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
                        const cn_sort = 'cursor-pointer select-none hover:text-pastel-orange transition-colors';
                        return (
                          <>
                            <th onClick={() => toggleSort('name')} className={cn('px-2 py-2 text-left text-xs font-bold text-pastel-cream min-w-[140px]', cn_sort)}>Player{ind('name')}</th>
                            <th className="px-2 py-2 text-center text-xs font-bold text-pastel-cream">Pos</th>
                            <th onClick={() => toggleSort('team')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>Team{ind('team')}</th>
                            <th onClick={() => toggleSort('gp')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>GP{ind('gp')}</th>
                            {posFilter === 'G' ? (
                              /* Goalie-specific columns */
                              <>
                                <th onClick={() => toggleSort('g_w')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>W{ind('g_w')}</th>
                                <th onClick={() => toggleSort('a_sv')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>SV{ind('a_sv')}</th>
                                <th onClick={() => toggleSort('pts_so')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>SO{ind('pts_so')}</th>
                                <th onClick={() => toggleSort('sog_ga')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>GA{ind('sog_ga')}</th>
                                <th onClick={() => toggleSort('pm_svpct')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>SV%{ind('pm_svpct')}</th>
                                <th onClick={() => toggleSort('xg_gaa')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-butter bg-pastel-butter/10', cn_sort)}>GAA{ind('xg_gaa')}</th>
                              </>
                            ) : (
                              /* Skater columns — default for All / Forwards / Defense */
                              <>
                                <th onClick={() => toggleSort('g_w')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>G{ind('g_w')}</th>
                                <th onClick={() => toggleSort('a_sv')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>A{ind('a_sv')}</th>
                                <th onClick={() => toggleSort('pts_so')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>PTS{ind('pts_so')}</th>
                                <th onClick={() => toggleSort('sog_ga')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>SOG{ind('sog_ga')}</th>
                                <th onClick={() => toggleSort('hit')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>HIT{ind('hit')}</th>
                                <th onClick={() => toggleSort('blk')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>BLK{ind('blk')}</th>
                                <th onClick={() => toggleSort('pm_svpct')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-cream', cn_sort)}>+/-{ind('pm_svpct')}</th>
                                <th onClick={() => toggleSort('xg_gaa')} className={cn('px-2 py-2 text-center text-xs font-bold text-pastel-butter bg-pastel-butter/10', cn_sort)}>xG{ind('xg_gaa')}</th>
                              </>
                            )}
                          </>
                        );
                      })()}
                      <th className="px-2 py-2 text-center text-xs font-bold text-pastel-cream" title="Avg time on ice per game (min:sec)">TOI</th>
                      <th className="px-2 py-2 text-center text-xs font-bold text-pastel-sage-soft bg-pastel-sage/10">FPTS</th>
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
                            'border-b border-white/10 transition-colors cursor-pointer',
                            selectedPlayer?.id === player.id && 'bg-pastel-orange/10 ring-1 ring-pastel-orange/30',
                            onRoster && selectedPlayer?.id !== player.id && 'border-l-2 border-l-pastel-sage',
                            !onRoster && selectedPlayer?.id !== player.id && 'hover:bg-white/5',
                            !addable && !onRoster && selectedPlayer?.id !== player.id && 'opacity-50'
                          )}
                          onClick={() => setSelectedPlayer(player)}
                        >
                          <td className="px-2 py-1.5 text-xs font-mono text-white/55">{idx + 1}</td>
                          {/* Add / Remove button on the LEFT (discoverable) */}
                          <td className="px-2 py-1.5">
                            {onRoster ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); removePlayer(player.id); }}
                                className="px-2 py-1 rounded bg-red-400/10 hover:bg-red-400/20 text-red-300 hover:text-red-200 transition-colors text-[11px] font-bold ring-1 ring-red-400/30 border-0"
                                title="Remove from roster"
                              >
                                Remove
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); if (addable) addPlayer(player); }}
                                disabled={!addable}
                                className={cn(
                                  'px-2 py-1 rounded transition-colors text-[11px] font-bold border-0 ring-1',
                                  addable
                                    ? 'bg-pastel-orange/15 hover:bg-pastel-orange/25 text-pastel-orange-soft ring-pastel-orange/40'
                                    : 'bg-white/5 text-white/30 ring-white/10 cursor-not-allowed'
                                )}
                                title={addable ? 'Add to roster' : 'Cannot add (position full or team cap)'}
                              >
                                Add
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {onRoster && <Check className="h-3.5 w-3.5 text-pastel-sage flex-shrink-0" />}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setStatsModalPlayer(player); }}
                                className={cn(
                                  'text-sm font-semibold truncate text-left text-pastel-cream hover:text-pastel-orange hover:underline transition-colors',
                                  onRoster && 'font-bold'
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
                            <Badge className={cn(
                              'text-[10px] px-1.5 border-0 font-bold',
                              norm === 'G' ? 'bg-pastel-butter/15 ring-1 ring-pastel-butter/40 text-pastel-butter' :
                              norm === 'D' ? 'bg-pastel-orange/15 ring-1 ring-pastel-orange/40 text-pastel-orange-soft' :
                              'bg-pastel-sage/15 ring-1 ring-pastel-sage/40 text-pastel-sage-soft'
                            )}>
                              {norm}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={cn('text-xs font-medium text-pastel-cream', teamAtCap && !onRoster && 'text-red-300')}>
                              {player.team}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">{player.games_played}</td>
                          {norm === 'G' ? (
                            <>
                              <td className="px-2 py-1.5 text-center text-xs font-semibold text-pastel-cream">{player.wins || 0}</td>
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">{player.saves || 0}</td>
                              <td className="px-2 py-1.5 text-center text-xs font-bold text-pastel-cream">{player.shutouts || 0}</td>
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">{player.goals_against || 0}</td>
                              {/* HIT+BLK placeholders only when headers are showing (skater/all filter) */}
                              {posFilter !== 'G' && (
                                <td className="px-2 py-1.5 text-center text-xs text-white/30" colSpan={2}>—</td>
                              )}
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">
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
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">
                                {(() => {
                                  let g = Number(player.gaa ?? player.goals_against_average ?? 0);
                                  // Fallback: GAA = goals_against * 60 / (icetime_seconds / 60) = goals_against * 3600 / icetime_seconds
                                  if (!g && player.goals_against && player.icetime_seconds) {
                                    g = (player.goals_against * 3600) / player.icetime_seconds;
                                  }
                                  return g > 0 ? g.toFixed(2) : '—';
                                })()}
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">—</td>
                            </>
                          ) : (
                            <>
                              <td className="px-2 py-1.5 text-center text-xs font-semibold text-pastel-cream">{player.goals}</td>
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">{player.assists}</td>
                              <td className="px-2 py-1.5 text-center text-xs font-bold text-pastel-cream">{player.points}</td>
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">{player.shots}</td>
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">{player.hits}</td>
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream">{player.blocks}</td>
                              <td className={cn(
                                'px-2 py-1.5 text-center text-xs',
                                (player.plus_minus || 0) > 0 ? 'text-pastel-sage-soft' :
                                (player.plus_minus || 0) < 0 ? 'text-red-300' :
                                'text-pastel-cream'
                              )}>
                                {(player.plus_minus ?? 0) > 0 ? '+' : ''}{player.plus_minus ?? 0}
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs text-pastel-cream font-semibold">
                                {(() => {
                                  const xg = player.xGoals ?? player.x_goals ?? 0;
                                  return xg > 0 ? xg.toFixed(1) : '—';
                                })()}
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs text-white/70">
                                {player.icetime_seconds && player.games_played ? (() => {
                                  const totalSec = Math.round(player.icetime_seconds / player.games_played);
                                  const m = Math.floor(totalSec / 60);
                                  const s = totalSec % 60;
                                  return `${m}:${s < 10 ? '0' : ''}${s}`;
                                })() : '—'}
                              </td>
                            </>
                          )}
                          <td className="px-2 py-1.5 text-center text-xs font-bold text-pastel-cream">{fpts.toFixed(1)}</td>
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
            <Card>
              <CardHeader className="pb-2 px-4">
                <CardTitle className="text-sm font-bold text-pastel-cream flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    {isViewMode ? <Eye className="h-4 w-4 text-pastel-orange" /> : <Users className="h-4 w-4 text-pastel-orange" />}
                    {isViewMode ? `${viewOwnerName || 'Teammate'}'s Roster` : 'Your Roster'} ({roster.length}/{rosterSize})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {/* Forwards */}
                <div>
                  <div className="text-[10px] font-jbmono font-bold uppercase tracking-wider text-white/55 mb-1">Forwards ({posCounts.F}/{posReqs.F})</div>
                  <div className="space-y-1">
                    {roster.filter(p => isForward(p.position)).map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1 px-2 bg-white/5 ring-1 ring-white/10 border-l-2 border-l-pastel-sage rounded">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge className="text-[9px] px-1 border-0 font-bold bg-pastel-sage/15 ring-1 ring-pastel-sage/40 text-pastel-sage-soft">{normalizePos(p.position)}</Badge>
                          <button
                            type="button"
                            onClick={() => setStatsModalPlayer(p)}
                            className="text-xs font-semibold truncate text-left text-pastel-cream hover:text-pastel-orange hover:underline transition-colors"
                          >
                            <span className="sm:hidden">{shortName(p.full_name)}</span>
                            <span className="hidden sm:inline">{p.full_name}</span>
                          </button>
                          <span className="text-[10px] text-white/55">{p.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-pastel-sage-soft">{calcFpts(p).toFixed(1)}</span>
                          {!locked && !isViewMode && (
                            <button onClick={() => removePlayer(p.id)} className="text-red-300 hover:text-red-200">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, posReqs.F - posCounts.F) }).map((_, i) => (
                      <div key={`empty-f-${i}`} className="flex items-center py-1.5 px-2 rounded border border-dashed border-white/15 text-white/30">
                        <User className="h-3 w-3 mr-2" />
                        <span className="text-[11px] italic">Empty F slot</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Defensemen */}
                <div>
                  <div className="text-[10px] font-jbmono font-bold uppercase tracking-wider text-white/55 mb-1">Defense ({posCounts.D}/{posReqs.D})</div>
                  <div className="space-y-1">
                    {roster.filter(p => normalizePos(p.position) === 'D').map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1 px-2 bg-white/5 ring-1 ring-white/10 border-l-2 border-l-pastel-orange rounded">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge className="text-[9px] px-1 border-0 font-bold bg-pastel-orange/15 ring-1 ring-pastel-orange/40 text-pastel-orange-soft">D</Badge>
                          <button
                            type="button"
                            onClick={() => setStatsModalPlayer(p)}
                            className="text-xs font-semibold truncate text-left text-pastel-cream hover:text-pastel-orange hover:underline transition-colors"
                          >
                            <span className="sm:hidden">{shortName(p.full_name)}</span>
                            <span className="hidden sm:inline">{p.full_name}</span>
                          </button>
                          <span className="text-[10px] text-white/55">{p.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-pastel-sage-soft">{calcFpts(p).toFixed(1)}</span>
                          {!locked && !isViewMode && (
                            <button onClick={() => removePlayer(p.id)} className="text-red-300 hover:text-red-200">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, posReqs.D - posCounts.D) }).map((_, i) => (
                      <div key={`empty-d-${i}`} className="flex items-center py-1.5 px-2 rounded border border-dashed border-white/15 text-white/30">
                        <Shield className="h-3 w-3 mr-2" />
                        <span className="text-[11px] italic">Empty D slot</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Goalies */}
                <div>
                  <div className="text-[10px] font-jbmono font-bold uppercase tracking-wider text-white/55 mb-1">Goalies ({posCounts.G}/{posReqs.G})</div>
                  <div className="space-y-1">
                    {roster.filter(p => normalizePos(p.position) === 'G').map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1 px-2 bg-white/5 ring-1 ring-white/10 border-l-2 border-l-pastel-butter rounded">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge className="text-[9px] px-1 border-0 font-bold bg-pastel-butter/15 ring-1 ring-pastel-butter/40 text-pastel-butter">G</Badge>
                          <button
                            type="button"
                            onClick={() => setStatsModalPlayer(p)}
                            className="text-xs font-semibold truncate text-left text-pastel-cream hover:text-pastel-orange hover:underline transition-colors"
                          >
                            <span className="sm:hidden">{shortName(p.full_name)}</span>
                            <span className="hidden sm:inline">{p.full_name}</span>
                          </button>
                          <span className="text-[10px] text-white/55">{p.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-pastel-sage-soft">{calcFpts(p).toFixed(1)}</span>
                          {!locked && !isViewMode && (
                            <button onClick={() => removePlayer(p.id)} className="text-red-300 hover:text-red-200">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, posReqs.G - posCounts.G) }).map((_, i) => (
                      <div key={`empty-g-${i}`} className="flex items-center py-1.5 px-2 rounded border border-dashed border-white/15 text-white/30">
                        <User className="h-3 w-3 mr-2" />
                        <span className="text-[11px] italic">Empty G slot</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Team breakdown */}
                {roster.length > 0 && (
                  <div className="pt-2 border-t border-white/10">
                    <div className="text-[10px] font-jbmono font-bold uppercase tracking-wider text-white/55 mb-1.5">Team Breakdown</div>
                    <div className="flex flex-wrap gap-1">
                      {Array.from(teamCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([team, count]) => (
                          <Badge
                            key={team}
                            className={cn(
                              'text-[10px] border-0 font-bold',
                              hasCap && count >= maxPerTeam
                                ? 'bg-red-400/10 ring-1 ring-red-400/30 text-red-300'
                                : 'bg-white/5 ring-1 ring-white/10 text-white/70'
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
              <Button asChild className="w-full bg-white/5 ring-1 ring-white/10 text-pastel-cream hover:bg-white/10 border-0">
                <Link to={`/pool/playoff-hub?league=${leagueId}`}>
                  <ArrowLeft className="h-4 w-4 mr-1" />Back to Hub
                </Link>
              </Button>
            ) : (
              <Card className="ring-1 ring-pastel-sage/30 px-4 py-3">
                <div className="text-[10px] font-jbmono font-bold uppercase tracking-wider text-white/55 mb-1">How it works</div>
                <ul className="text-[11px] text-white/70 space-y-0.5 list-disc pl-3">
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
