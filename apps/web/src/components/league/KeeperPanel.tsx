// Keeper / Dynasty panel (2026-08-24 launch build).
//
// Rendered on LeagueDashboard when league settings.keeperEnabled is on.
// This is the DESIGNATION surface whose absence gated the CreateLeague
// keeper/dynasty toggles ("no screen lets a manager designate a keeper
// yet"): managers pick which of their rostered players to keep for next
// season's draft, and the commissioner locks all designations when the
// league is ready. The entire server stack already exists —
// keeper_designations table, designate/release/validate/lock routes
// (server/src/routes/keepers.ts), and the validate/lock/draft-cost RPCs
// — this panel is the missing client.
//
// Season model (documented for launch): a league's FIRST draft is a
// full draft — there are no prior rosters to keep. Keepers designated
// here apply to the NEXT season's draft; the commissioner locks them
// before that draft. Dynasty mode = unlimited keepers (whole roster).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Crown, Lock, Loader2, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { KeeperService, type KeeperDesignation } from '@/services/KeeperService';
import { PlayerService, type Player } from '@/services/PlayerService';
import { rosterApi } from '@/api/rosters';
import { logger } from '@/utils/logger';

interface KeeperPanelProps {
  leagueId: string;
  myTeamId: string | null;
  teams: Array<{ id: string; team_name: string }>;
  isCommissioner: boolean;
  /** 0 with dynasty off means "not configured"; dynasty = unlimited. */
  keeperCount: number;
  dynastyMode: boolean;
}

interface RosterRow {
  playerId: string;
  name: string;
  position: string;
  nhlTeam: string;
}

/**
 * Keepers designated now apply to the NEXT season's draft. NHL season
 * label runs July→June: in Aug 2026 the current season is 2026–27, so
 * keeper designations target the 2027 draft.
 */
function upcomingKeeperSeasonYear(now = new Date()): number {
  const currentSeasonStart =
    now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return currentSeasonStart + 1;
}

export function KeeperPanel({
  leagueId,
  myTeamId,
  teams,
  isCommissioner,
  keeperCount,
  dynastyMode,
}: KeeperPanelProps) {
  const { toast } = useToast();
  const seasonYear = useMemo(() => upcomingKeeperSeasonYear(), []);
  const maxKeepers = dynastyMode ? Infinity : keeperCount > 0 ? keeperCount : 0;

  const [loading, setLoading] = useState(true);
  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [designations, setDesignations] = useState<KeeperDesignation[]>([]);
  const [playerNames, setPlayerNames] = useState<Map<string, string>>(new Map());

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.team_name);
    return m;
  }, [teams]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { keepers } = await KeeperService.getLeagueKeepers(leagueId, seasonYear);
      setDesignations(keepers);

      // Player names for every designated player (all teams).
      const keeperIds = [...new Set(keepers.map((k) => String(k.player_id)))];

      let rosterRows: RosterRow[] = [];
      let rosterIds: string[] = [];
      if (myTeamId) {
        const response = await rosterApi.getTeamRoster(leagueId, myTeamId);
        const raw = ((response as { data?: unknown }).data ?? response) as Array<{
          player_id: number | string;
        }>;
        rosterIds = Array.isArray(raw) ? raw.map((r) => String(r.player_id)) : [];
      }

      const allIds = [...new Set([...keeperIds, ...rosterIds])];
      if (allIds.length > 0) {
        const players = await PlayerService.getPlayersByIds(allIds);
        const nameMap = new Map<string, string>();
        const byId = new Map<string, Player>();
        for (const p of players) {
          nameMap.set(String(p.id), p.full_name);
          byId.set(String(p.id), p);
        }
        setPlayerNames(nameMap);
        rosterRows = rosterIds.map((id) => {
          const p = byId.get(id);
          return {
            playerId: id,
            name: p?.full_name ?? `#${id}`,
            position: p?.position ?? '',
            nhlTeam: p?.team ?? '',
          };
        });
      }
      setRoster(rosterRows);
    } catch (err) {
      logger.error('[KeeperPanel] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [leagueId, myTeamId, seasonYear]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const myDesignations = useMemo(
    () => designations.filter((d) => d.team_id === myTeamId),
    [designations, myTeamId],
  );
  const myKeptPlayerIds = useMemo(
    () => new Set(myDesignations.map((d) => String(d.player_id))),
    [myDesignations],
  );
  const anyLocked = designations.some((d) => d.status === 'locked');
  const atLimit = myDesignations.length >= maxKeepers;

  const handleKeep = async (playerId: string) => {
    if (!myTeamId || busyPlayerId) return;
    setBusyPlayerId(playerId);
    try {
      const result = await KeeperService.designateKeeper(
        leagueId,
        myTeamId,
        playerId,
        seasonYear,
      );
      if (!result.success) {
        toast({
          title: 'Could not designate keeper',
          description: result.error ?? 'Please try again.',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: `${playerNames.get(playerId) ?? 'Player'} designated as a keeper.` });
      await reload();
    } finally {
      setBusyPlayerId(null);
    }
  };

  const handleRelease = async (designation: KeeperDesignation) => {
    if (!myTeamId || busyPlayerId) return;
    const pid = String(designation.player_id);
    setBusyPlayerId(pid);
    try {
      const result = await KeeperService.releaseKeeper(designation.id, myTeamId);
      if (!result.success) {
        toast({
          title: 'Could not release keeper',
          description: result.error ?? 'Please try again.',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: `${playerNames.get(pid) ?? 'Player'} released.` });
      await reload();
    } finally {
      setBusyPlayerId(null);
    }
  };

  const handleLock = async () => {
    if (locking) return;
    if (
      !window.confirm(
        `Lock ALL keeper designations for the ${seasonYear}–${(seasonYear + 1) % 100} draft? ` +
          'Locked keepers can no longer be changed by managers.',
      )
    ) {
      return;
    }
    setLocking(true);
    try {
      const { results, error } = await KeeperService.lockKeepersForSeason(
        leagueId,
        seasonYear,
      );
      if (error) {
        toast({ title: 'Lock failed', description: error, variant: 'destructive' });
        return;
      }
      const total = results.reduce((sum, r) => sum + r.keepersLocked, 0);
      toast({
        title: 'Keepers locked',
        description: `${total} keeper(s) locked across ${results.length} team(s). League members have been notified.`,
      });
      await reload();
    } finally {
      setLocking(false);
    }
  };

  const limitLabel = dynastyMode
    ? 'Dynasty — entire roster carries over'
    : `${myDesignations.length} of ${maxKeepers} keeper${maxKeepers === 1 ? '' : 's'} used`;

  return (
    <Card
      className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] mb-8"
      data-testid="keeper-panel"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
          <Crown className="h-5 w-5 text-amber-400" aria-hidden="true" />
          {dynastyMode ? 'Dynasty Keepers' : 'Keepers'}
          <Badge variant="outline" className="ml-1 text-[10px] border-white/20 text-white/70">
            {seasonYear}–{(seasonYear + 1) % 100} draft
          </Badge>
          {anyLocked && (
            <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border-0">
              <Lock className="h-3 w-3 mr-1" aria-hidden="true" /> Locked
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-white/55">
          {dynastyMode
            ? 'Dynasty league: rosters carry over between seasons. Designations below track who each team is keeping into next season.'
            : 'Choose which players your team keeps into next season. This season’s draft is a full draft; keepers come off the board in next season’s.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-white/55">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading keepers…
          </div>
        ) : (
          <>
            {/* My team designation controls */}
            {myTeamId !== null && roster.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-pastel-cream">Your roster</span>
                  <span className="text-xs text-white/55">{limitLabel}</span>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-xl ring-1 ring-white/10 divide-y divide-white/5">
                  {roster.map((row) => {
                    const kept = myKeptPlayerIds.has(row.playerId);
                    const designation = myDesignations.find(
                      (d) => String(d.player_id) === row.playerId,
                    );
                    const isLockedRow = designation?.status === 'locked';
                    return (
                      <div
                        key={row.playerId}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                        data-testid={`keeper-row-${row.playerId}`}
                      >
                        <span className="flex-1 truncate">
                          <span className="font-medium text-pastel-cream">{row.name}</span>
                          <span className="text-white/55 ml-2 text-xs">
                            {row.position}
                            {row.nhlTeam ? ` · ${row.nhlTeam}` : ''}
                          </span>
                        </span>
                        {kept ? (
                          <>
                            <Badge className="bg-amber-500/20 text-amber-300 border-0 text-[10px]">
                              {isLockedRow ? 'Locked' : 'Keeper'}
                            </Badge>
                            {!isLockedRow && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-white/70"
                                disabled={busyPlayerId !== null}
                                onClick={() => designation && handleRelease(designation)}
                              >
                                {busyPlayerId === row.playerId ? (
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                ) : (
                                  'Release'
                                )}
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-3 text-xs"
                            disabled={busyPlayerId !== null || atLimit || anyLocked}
                            onClick={() => handleKeep(row.playerId)}
                            data-testid={`keeper-keep-${row.playerId}`}
                          >
                            {busyPlayerId === row.playerId ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : (
                              'Keep'
                            )}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {atLimit && !dynastyMode && !anyLocked && (
                  <p className="text-xs text-white/55 mt-2">
                    Keeper limit reached — release a player to keep someone else.
                  </p>
                )}
              </div>
            )}
            {myTeamId !== null && roster.length === 0 && (
              <p className="text-sm text-white/55">
                Your roster is empty — keepers become available once your team has players
                (after the draft).
              </p>
            )}

            {/* League-wide designations */}
            <div>
              <div className="text-sm font-semibold text-pastel-cream mb-2">
                League keepers
              </div>
              {designations.length === 0 ? (
                <p className="text-sm text-white/55">No keepers designated yet.</p>
              ) : (
                <div className="rounded-xl ring-1 ring-white/10 divide-y divide-white/5">
                  {teams
                    .filter((t) => designations.some((d) => d.team_id === t.id))
                    .map((t) => (
                      <div key={t.id} className="px-3 py-2">
                        <div className="text-xs font-semibold text-white/70 mb-1">
                          {teamNameById.get(t.id) ?? t.team_name}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {designations
                            .filter((d) => d.team_id === t.id)
                            .map((d) => (
                              <Badge
                                key={d.id}
                                variant="outline"
                                className="text-[11px] border-white/15 text-pastel-cream"
                              >
                                {playerNames.get(String(d.player_id)) ?? `#${d.player_id}`}
                                {d.status === 'locked' && (
                                  <Lock className="h-2.5 w-2.5 ml-1 text-amber-300" aria-hidden="true" />
                                )}
                              </Badge>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Commissioner lock */}
            {isCommissioner && (
              <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3">
                <div className="text-xs text-white/55 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-pastel-orange" aria-hidden="true" />
                  Locking finalizes every team&apos;s keepers for next season&apos;s draft.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={locking || designations.length === 0 || anyLocked}
                  onClick={handleLock}
                  data-testid="keeper-lock-btn"
                >
                  {locking ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                      Locking…
                    </>
                  ) : anyLocked ? (
                    'Keepers locked'
                  ) : (
                    'Lock all keepers'
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default KeeperPanel;
