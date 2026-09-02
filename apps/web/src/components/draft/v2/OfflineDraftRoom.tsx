// Offline draft results room (2026-08-24 launch build).
//
// Rendered by DraftRoomV2 INSTEAD of the live draft room when
// settings.draftType === 'offline'. Offline leagues draft in person —
// there is no engine lobby, no WebSocket, no clock. The commissioner
// enters the results here; POST /api/draft/v2/league/:id/offline-import
// writes a real v2 event stream (draft_started → picks →
// draft_completed) in one transaction and the existing DB triggers
// project picks, build rosters, and finalize the league.
//
// Entry model: one slot per pick (teams × rounds), pre-assigned to
// teams in snake order from the league's team list. The commissioner
// works through the slots with the player search; any slot's team can
// be corrected inline (in-person orders drift). Slots must be filled
// as a contiguous prefix — the import RPC renumbers nothing.
//
// Draft-in-progress entries survive a tab close via a best-effort
// localStorage draft (per league), cleared on successful import.

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ClipboardList, Search, CheckCircle2, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useMyTeamId } from '@/stores/draftClientStore';
import type { Player } from '@/services/PlayerService';
import type { FetchedTeam } from '@/lib/draftClient/v1Adapters';

interface OfflineDraftRoomProps {
  leagueId: string;
  teams: FetchedTeam[];
  teamsError: string | null;
  onRetryTeams: () => void;
  playersById: ReadonlyMap<string, Player>;
  playersLoading: boolean;
  playersError: string | null;
  onRetryPlayers: () => void;
  commissionerId: string;
  draftRounds: number;
  initialDraftStatus: string;
}

interface ImportedPickRow {
  pickNumber: number;
  round: number;
  teamId: string;
  playerId: string;
}

const draftKey = (leagueId: string) => `citrus:offline-draft-entry:${leagueId}`;

function loadSavedEntries(leagueId: string): Record<number, string> {
  try {
    const raw = window.localStorage.getItem(draftKey(leagueId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { players?: Record<number, string> };
    return parsed.players ?? {};
  } catch {
    return {};
  }
}

function saveEntries(leagueId: string, players: Record<number, string>): void {
  try {
    window.localStorage.setItem(draftKey(leagueId), JSON.stringify({ players }));
  } catch {
    // Best-effort only.
  }
}

function clearSavedEntries(leagueId: string): void {
  try {
    window.localStorage.removeItem(draftKey(leagueId));
  } catch {
    // Best-effort only.
  }
}

export function OfflineDraftRoom({
  leagueId,
  teams,
  teamsError,
  onRetryTeams,
  playersById,
  playersLoading,
  playersError,
  onRetryPlayers,
  commissionerId,
  draftRounds,
  initialDraftStatus,
}: OfflineDraftRoomProps) {
  const { toast } = useToast();
  const myTeamId = useMyTeamId();

  const [imported, setImported] = useState(initialDraftStatus === 'completed');
  const [importedPicks, setImportedPicks] = useState<ImportedPickRow[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  /** slot index (0-based) → playerId (string key into playersById). */
  const [entries, setEntries] = useState<Record<number, string>>(() =>
    typeof window === 'undefined' ? {} : loadSavedEntries(leagueId),
  );
  /** slot index → teamId override (defaults come from snake order). */
  const [teamOverrides, setTeamOverrides] = useState<Record<number, string>>({});
  const [allowPartial, setAllowPartial] = useState(false);

  const myUserId = teams.find((t) => t.id === myTeamId)?.owner_id ?? null;
  const isCommissioner = !!myUserId && myUserId === commissionerId;

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.team_name);
    return m;
  }, [teams]);

  const slotCount = teams.length * draftRounds;

  /** Snake-order default team per slot (round 1 = team list order). */
  const slotDefaults = useMemo(() => {
    const out: string[] = [];
    if (teams.length === 0) return out;
    for (let r = 0; r < draftRounds; r++) {
      const order = r % 2 === 0 ? teams : [...teams].reverse();
      for (const t of order) out.push(t.id);
    }
    return out;
  }, [teams, draftRounds]);

  const slotTeam = (i: number): string | null =>
    teamOverrides[i] ?? slotDefaults[i] ?? null;

  // Persist the entry draft.
  useEffect(() => {
    if (imported) return;
    saveEntries(leagueId, entries);
  }, [leagueId, entries, imported]);

  const chosenPlayerIds = useMemo(() => new Set(Object.values(entries)), [entries]);

  const filledCount = useMemo(() => {
    let n = 0;
    for (let i = 0; i < slotCount; i++) if (entries[i]) n++;
    return n;
  }, [entries, slotCount]);

  /** First unfilled slot (the natural target for the next entry). */
  const nextEmptySlot = useMemo(() => {
    for (let i = 0; i < slotCount; i++) if (!entries[i]) return i;
    return null;
  }, [entries, slotCount]);

  const activeSlot = selectedSlot ?? nextEmptySlot;

  /** Filled slots must form a contiguous prefix 1..K. */
  const firstGap = useMemo(() => {
    let seenEmpty = -1;
    for (let i = 0; i < slotCount; i++) {
      if (!entries[i]) {
        if (seenEmpty === -1) seenEmpty = i;
      } else if (seenEmpty !== -1) {
        return seenEmpty;
      }
    }
    return null;
  }, [entries, slotCount]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [] as Player[];
    const out: Player[] = [];
    for (const p of playersById.values()) {
      if (chosenPlayerIds.has(String(p.id))) continue;
      if (p.full_name.toLowerCase().includes(q)) {
        out.push(p);
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [search, playersById, chosenPlayerIds]);

  const assignPlayer = (player: Player) => {
    if (activeSlot === null) return;
    setEntries((prev) => ({ ...prev, [activeSlot]: String(player.id) }));
    setSearch('');
    setSelectedSlot(null); // fall back to next-empty targeting
  };

  const clearSlot = (i: number) => {
    setEntries((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
    setSelectedSlot(i);
  };

  const handleImport = async () => {
    if (submitting) return;
    if (firstGap !== null) {
      toast({
        title: 'Fill picks in order',
        description: `Pick ${firstGap + 1} is empty but later picks are filled. Results import as a contiguous list.`,
        variant: 'destructive',
      });
      return;
    }
    if (filledCount === 0) {
      toast({ title: 'No picks entered yet', variant: 'destructive' });
      return;
    }
    const partial = filledCount < slotCount;
    if (partial && !allowPartial) {
      toast({
        title: `${slotCount - filledCount} slot(s) still empty`,
        description:
          'Fill every pick, or check "Import a shorter draft" to finalize with fewer picks.',
        variant: 'destructive',
      });
      return;
    }
    const picks: Array<{ pick_number: number; team_id: string; player_id: number }> = [];
    for (let i = 0; i < filledCount; i++) {
      const teamId = slotTeam(i);
      const playerKey = entries[i];
      const playerNum = Number(playerKey);
      if (!teamId || !playerKey || !Number.isFinite(playerNum)) {
        toast({
          title: `Pick ${i + 1} is incomplete`,
          description: 'Assign a team and a player to every filled pick.',
          variant: 'destructive',
        });
        return;
      }
      picks.push({ pick_number: i + 1, team_id: teamId, player_id: playerNum });
    }

    setSubmitting(true);
    try {
      const { apiClient } = await import('@/api/client');
      const response = await apiClient.post<{
        success?: boolean;
        total_picks?: number;
        draft_status?: string;
      }>(
        `/api/draft/v2/league/${encodeURIComponent(leagueId)}/offline-import`,
        { picks, allow_partial: partial },
        {
          headers: { 'X-Idempotency-Key': crypto.randomUUID() },
          timeoutMs: 30_000,
        },
      );
      const data = (response.data ?? response) as { total_picks?: number };
      clearSavedEntries(leagueId);
      setImportedPicks(
        picks.map((p, idx) => ({
          pickNumber: p.pick_number,
          round: Math.floor(idx / Math.max(1, teams.length)) + 1,
          teamId: p.team_id,
          playerId: String(p.player_id),
        })),
      );
      setImported(true);
      toast({
        title: 'Draft results imported',
        description: `${data.total_picks ?? picks.length} picks are in. Rosters are live.`,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const friendly = raw.includes('already_imported')
        ? 'This draft was already imported.'
        : raw.includes('duplicate_player')
        ? 'The same player appears twice. Fix the duplicate and retry.'
        : raw.includes('not_rectangular')
        ? 'Every team needs the same number of picks (or check "Import a shorter draft").'
        : raw;
      toast({ title: 'Import failed', description: friendly, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  // Completed view: load the imported results if we don't already have
  // them from this session's own submit.
  useEffect(() => {
    if (!imported || importedPicks !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const { apiClient } = await import('@/api/client');
        const response = await apiClient.get<{
          events?: Array<{ event_type: string; payload: Record<string, unknown> }>;
        }>(
          `/api/draft/v2/league/${encodeURIComponent(leagueId)}/events?since_seq=0&limit=500`,
        );
        if (cancelled) return;
        const payload =
          response.data ??
          (response as unknown as {
            events?: Array<{ event_type: string; payload: Record<string, unknown> }>;
          });
        const rows: ImportedPickRow[] = (payload?.events ?? [])
          .filter((e) => e.event_type === 'pick')
          .map((e) => ({
            pickNumber: Number(e.payload.pick_number ?? 0),
            round: Number(e.payload.round ?? 0),
            teamId: String(e.payload.team_id ?? ''),
            playerId: String(e.payload.player_id ?? ''),
          }))
          .sort((a, b) => a.pickNumber - b.pickNumber);
        setImportedPicks(rows);
      } catch {
        if (!cancelled) setImportedPicks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imported, importedPicks, leagueId]);

  const playerName = (playerId: string) =>
    playersById.get(playerId)?.full_name ?? `#${playerId}`;

  // ── Render ─────────────────────────────────────────────────────────

  const header = (
    <Card className="mb-4 border-0 bg-pastel-surface-tile ring-1 ring-white/10">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white/10 p-2">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-bold">Offline draft</div>
            <div className="text-sm text-muted-foreground">
              {imported
                ? 'Results are in: rosters are built from the imported picks.'
                : isCommissioner
                ? 'Run your draft in person, then enter the results below. Rosters build the moment you import.'
                : 'This league drafts in person. The commissioner enters the results here when the draft is done.'}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (teamsError) {
    return (
      <div data-testid="offline-draft-room">
        {header}
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm">
            {teamsError}{' '}
            <Button variant="outline" size="sm" onClick={onRetryTeams} className="ml-2">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (imported) {
    return (
      <div data-testid="offline-draft-room">
        {header}
        <Card className="border-0 bg-pastel-surface-tile ring-1 ring-white/10">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-5 w-5 text-green-400" />
              <span className="font-semibold">Draft complete</span>
              {importedPicks !== null && (
                <Badge variant="secondary">{importedPicks.length} picks</Badge>
              )}
            </div>
            {importedPicks === null ? (
              <div className="text-sm text-muted-foreground">Loading results…</div>
            ) : importedPicks.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Results were imported. See team rosters on the league page.
              </div>
            ) : (
              <div className="max-h-[28rem] overflow-y-auto rounded-lg ring-1 ring-white/10 divide-y divide-white/5">
                {importedPicks.map((p) => (
                  <div
                    key={p.pickNumber}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                    data-testid={`offline-result-${p.pickNumber}`}
                  >
                    <span className="w-10 shrink-0 text-muted-foreground tabular-nums">
                      {p.pickNumber}.
                    </span>
                    <span className="font-medium flex-1">{playerName(p.playerId)}</span>
                    <span className="text-muted-foreground">
                      {teamNameById.get(p.teamId) ?? 'Unknown team'}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      R{p.round}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isCommissioner) {
    return (
      <div data-testid="offline-draft-room">
        {header}
        <Card className="border-0 bg-pastel-surface-tile ring-1 ring-white/10">
          <CardContent className="p-5 text-sm text-muted-foreground flex items-center gap-3">
            <Users className="h-5 w-5" />
            Waiting on the commissioner to enter the draft results. You&apos;ll see
            rosters on the league page as soon as they&apos;re in.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="offline-draft-room">
      {header}

      {playersError && (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="p-4 text-sm">
            {playersError}{' '}
            <Button variant="outline" size="sm" onClick={onRetryPlayers} className="ml-2">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Search / assignment side */}
        <Card className="border-0 bg-pastel-surface-tile ring-1 ring-white/10 self-start lg:sticky lg:top-4">
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold">
              {activeSlot !== null ? (
                <>
                  Entering pick{' '}
                  <span className="text-primary">#{activeSlot + 1}</span>
                  {' · '}
                  {teamNameById.get(slotTeam(activeSlot) ?? '') ?? '…'}
                </>
              ) : (
                'All picks entered'
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  playersLoading ? 'Loading players…' : 'Search player name…'
                }
                disabled={playersLoading || activeSlot === null}
                className="pl-8"
                data-testid="offline-search"
              />
            </div>
            {matches.length > 0 && (
              <div className="rounded-lg ring-1 ring-white/10 divide-y divide-white/5 overflow-hidden">
                {matches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                    onClick={() => assignPlayer(p)}
                    data-testid={`offline-match-${p.id}`}
                  >
                    <span className="font-semibold">{p.full_name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {p.position} · {p.team}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-white/10 space-y-2">
              <div className="text-xs text-muted-foreground">
                {filledCount} of {slotCount} picks entered
                {firstGap !== null && (
                  <span className="text-destructive">
                    {' '}
                    · pick {firstGap + 1} skipped: fill it before importing
                  </span>
                )}
              </div>
              {filledCount < slotCount && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowPartial}
                    onChange={(e) => setAllowPartial(e.target.checked)}
                    data-testid="offline-allow-partial"
                  />
                  Import a shorter draft ({filledCount} picks: remaining slots stay
                  empty; rosters fill from waivers)
                </label>
              )}
              <Button
                className="w-full"
                disabled={
                  submitting ||
                  filledCount === 0 ||
                  firstGap !== null ||
                  (filledCount < slotCount && !allowPartial)
                }
                onClick={handleImport}
                data-testid="offline-import-submit"
              >
                {submitting
                  ? 'Importing…'
                  : `Import ${filledCount} pick${filledCount === 1 ? '' : 's'} & finalize`}
              </Button>
              <div className="text-[11px] text-muted-foreground">
                Importing finalizes the draft and builds every roster. It can&apos;t be
                un-done from this screen.
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Slot board side */}
        <Card className="border-0 bg-pastel-surface-tile ring-1 ring-white/10">
          <CardContent className="p-2 sm:p-3">
            <div className="max-h-[36rem] overflow-y-auto divide-y divide-white/5">
              {Array.from({ length: slotCount }, (_, i) => {
                const teamId = slotTeam(i);
                const playerKey = entries[i];
                const isActive = activeSlot === i;
                const round = Math.floor(i / Math.max(1, teams.length)) + 1;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded ${
                      isActive ? 'bg-primary/10 ring-1 ring-primary/40' : ''
                    }`}
                    data-testid={`offline-slot-${i + 1}`}
                  >
                    <span className="w-9 shrink-0 text-muted-foreground tabular-nums text-xs">
                      {i + 1}.
                    </span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      R{round}
                    </Badge>
                    <select
                      className="bg-transparent text-xs text-muted-foreground max-w-[9rem] truncate outline-none cursor-pointer"
                      value={teamId ?? ''}
                      onChange={(e) =>
                        setTeamOverrides((prev) => ({ ...prev, [i]: e.target.value }))
                      }
                      aria-label={`Team for pick ${i + 1}`}
                    >
                      {teams.map((t) => (
                        <option key={t.id} value={t.id} className="bg-neutral-900">
                          {t.team_name}
                        </option>
                      ))}
                    </select>
                    <span className="flex-1 truncate font-medium">
                      {playerKey ? (
                        playerName(playerKey)
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                          onClick={() => setSelectedSlot(i)}
                        >
                          {isActive ? 'searching…' : 'enter player'}
                        </button>
                      )}
                    </span>
                    {playerKey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground"
                        onClick={() => clearSlot(i)}
                      >
                        clear
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
