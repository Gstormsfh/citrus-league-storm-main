import { userMessage } from '@/lib/userMessage';
import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowUpDown } from 'lucide-react';
import { Player, PlayerService } from '@/services/PlayerService';
import { WaiverService } from '@/services/WaiverService';
import { rosterApi } from '@/api/rosters';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import { notifyRosterChanged } from '@/utils/rosterRefresh';

export interface DropPlayerForAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Player the user wants to add */
  addPlayer: Player | null;
  leagueId: string;
  teamId: string;
  userId: string;
  /** Called after a successful atomic swap */
  onSuccess?: () => void;
}

type SortKey = 'name' | 'pos' | 'gp' | 'pts' | 'g' | 'a' | 'sog' | 'hit' | 'blk' | 'plus_minus' | 'w' | 'l' | 'gaa' | 'svp' | 'so';
type SortDir = 'asc' | 'desc';

const POS_FILTERS = ['ALL', 'F', 'D', 'G'] as const;
type PosFilter = (typeof POS_FILTERS)[number];

function isGoalie(p: Player): boolean {
  return p.position === 'G' || (p.eligible_positions || []).includes('G');
}

function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  return digits > 0 ? v.toFixed(digits) : String(v);
}

/**
 * DropPlayerForAddDialog
 *
 * Rich roster table for selecting a player to drop. Shows all relevant
 * season stats for both skaters and goalies, with a comparison row at the
 * top showing the player being added. Sortable, filterable by position.
 *
 * Performs an ATOMIC add+drop via WaiverService.addPlayer. The server-side
 * process_roster_move RPC wraps both operations in a subtransaction so a
 * failure rolls back the drop. If the target player is on waivers, the
 * client falls through to a waiver claim instead of failing.
 */
export function DropPlayerForAddDialog({
  open,
  onOpenChange,
  addPlayer,
  leagueId,
  teamId,
  userId,
  onSuccess,
}: DropPlayerForAddDialogProps) {
  const { toast } = useToast();
  const [roster, setRoster] = useState<Player[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [selectedDropId, setSelectedDropId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('pts');
  const [sortDir, setSortDir] = useState<SortDir>('asc'); // asc => worst at top by default

  const addingGoalie = addPlayer ? isGoalie(addPlayer) : false;

  useEffect(() => {
    if (!open || !leagueId || !teamId) return;
    let cancelled = false;
    (async () => {
      setLoadingRoster(true);
      setSelectedDropId(null);
      setPosFilter(addingGoalie ? 'G' : 'ALL');
      setSortKey(addingGoalie ? 'gaa' : 'pts');
      setSortDir(addingGoalie ? 'desc' : 'asc');
      try {
        const resp = await rosterApi.getTeamRoster(leagueId, teamId);
        const assignments = (resp.data as Array<{ player_id: string | number }>) || [];
        const playerIds = assignments.map((a) => String(a.player_id));
        if (playerIds.length === 0) {
          if (!cancelled) setRoster([]);
          return;
        }
        const players = await PlayerService.getPlayersByIds(playerIds);
        if (!cancelled) setRoster(players);
      } catch (err) {
        logger.error('Failed to load roster for drop dialog', err);
        if (!cancelled) {
          toast({
            title: 'Could Not Load Roster',
            description: 'Unable to load your roster. Please try again.',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, leagueId, teamId, toast, addingGoalie]);

  const filteredRoster = useMemo(() => {
    let list = roster;
    if (posFilter === 'G') list = list.filter(isGoalie);
    else if (posFilter === 'D') list = list.filter((p) => !isGoalie(p) && (p.position === 'D' || (p.eligible_positions || []).includes('D')));
    else if (posFilter === 'F') list = list.filter((p) => !isGoalie(p) && p.position !== 'D');

    const dir = sortDir === 'asc' ? 1 : -1;
    const get = (p: Player): number | string => {
      switch (sortKey) {
        case 'name': return p.full_name || '';
        case 'pos': return p.position || '';
        case 'gp': return isGoalie(p) ? (p.goalie_gp ?? 0) : (p.games_played ?? 0);
        case 'pts': return p.points ?? 0;
        case 'g': return p.goals ?? 0;
        case 'a': return p.assists ?? 0;
        case 'sog': return p.shots ?? 0;
        case 'hit': return p.hits ?? 0;
        case 'blk': return p.blocks ?? 0;
        case 'plus_minus': return p.plus_minus ?? 0;
        case 'w': return p.wins ?? 0;
        case 'l': return p.losses ?? 0;
        case 'gaa': return p.goals_against_average ?? 999;
        case 'svp': return p.save_percentage ?? 0;
        case 'so': return p.shutouts ?? 0;
      }
    };
    return [...list].sort((a, b) => {
      const av = get(a); const bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [roster, posFilter, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const handleConfirm = async () => {
    if (!addPlayer || !selectedDropId) return;
    const addPlayerId =
      typeof addPlayer.id === 'string' ? parseInt(addPlayer.id as string, 10) : (addPlayer.id as number);
    const dropPlayerId = parseInt(selectedDropId, 10);
    setSubmitting(true);
    try {
      const result = await WaiverService.addPlayer(
        leagueId, teamId, addPlayerId, dropPlayerId, userId,
      );
      if (result.success) {
        const droppedPlayer = roster.find((p) => String(p.id) === selectedDropId);
        toast({
          title: result.isFreeAgent ? 'Swap Completed' : 'Waiver Claim Submitted',
          description: result.isFreeAgent
            ? `Added ${addPlayer.full_name}${droppedPlayer ? ` and dropped ${droppedPlayer.full_name}` : ''}.`
            : `${addPlayer.full_name} is on waivers, so the claim goes in with ${droppedPlayer?.full_name ?? 'selected player'} as the conditional drop.`,
        });
        onOpenChange(false);
        onSuccess?.();
        // 2026-08-24: clear roster caches before broadcasting, or listeners
        // refetch straight into the stale in-memory copy.
        notifyRosterChanged(teamId, leagueId);
      } else {
        toast({
          title: 'Swap Failed',
          description: result.error || 'Failed to complete swap. Your roster is unchanged.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      logger.error('Atomic swap failed', err);
      toast({
        title: 'Swap Failed',
        description: userMessage(err, 'Unexpected error. Your roster is unchanged.'),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Render helpers ---------------------------------------------------------
  // Column visibility is the mobile fix, not horizontal scrolling. 34rem of
  // columns on a 393px screen means every phone user drags sideways to read a
  // stat line — and with two tables that scrolled independently, the row you
  // were comparing against slid out of alignment while you did it. The five
  // columns that decide a drop (position, name, team, games, production) fit a
  // phone with room to spare; the rest appear at sm.
  const HIDE_SM = 'hidden sm:table-cell';

  const SkaterHeader = (
    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b">
      <Th>Pos</Th>
      <Th onClick={() => toggleSort('name')} sortable active={sortKey==='name'}>Player</Th>
      <Th className={HIDE_SM}>Team</Th>
      <Th onClick={() => toggleSort('gp')} sortable active={sortKey==='gp'} className="text-right">GP</Th>
      <Th onClick={() => toggleSort('pts')} sortable active={sortKey==='pts'} className="text-right">PTS</Th>
      <Th onClick={() => toggleSort('g')} sortable active={sortKey==='g'} className={`text-right ${HIDE_SM}`}>G</Th>
      <Th onClick={() => toggleSort('a')} sortable active={sortKey==='a'} className={`text-right ${HIDE_SM}`}>A</Th>
      <Th onClick={() => toggleSort('plus_minus')} sortable active={sortKey==='plus_minus'} className={`text-right ${HIDE_SM}`}>+/-</Th>
      <Th onClick={() => toggleSort('sog')} sortable active={sortKey==='sog'} className={`text-right ${HIDE_SM}`}>SOG</Th>
      <Th onClick={() => toggleSort('hit')} sortable active={sortKey==='hit'} className={`text-right ${HIDE_SM}`}>HIT</Th>
      <Th onClick={() => toggleSort('blk')} sortable active={sortKey==='blk'} className={`text-right ${HIDE_SM}`}>BLK</Th>
    </tr>
  );

  const GoalieHeader = (
    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b">
      <Th>Pos</Th>
      <Th onClick={() => toggleSort('name')} sortable active={sortKey==='name'}>Player</Th>
      <Th className={HIDE_SM}>Team</Th>
      <Th onClick={() => toggleSort('gp')} sortable active={sortKey==='gp'} className="text-right">GP</Th>
      <Th onClick={() => toggleSort('gaa')} sortable active={sortKey==='gaa'} className="text-right">GAA</Th>
      <Th onClick={() => toggleSort('svp')} sortable active={sortKey==='svp'} className="text-right">SV%</Th>
      <Th onClick={() => toggleSort('w')} sortable active={sortKey==='w'} className={`text-right ${HIDE_SM}`}>W</Th>
      <Th onClick={() => toggleSort('l')} sortable active={sortKey==='l'} className={`text-right ${HIDE_SM}`}>L</Th>
      <Th onClick={() => toggleSort('so')} sortable active={sortKey==='so'} className={`text-right ${HIDE_SM}`}>SO</Th>
    </tr>
  );

  const rowClass = (opts: { selected?: boolean; comparison?: boolean }) =>
    `border-b text-sm transition-colors ${
      opts.comparison
        ? 'bg-emerald-500/10 font-medium cursor-default'
        : opts.selected
          ? 'bg-primary/15 cursor-pointer'
          : 'hover:bg-muted cursor-pointer'
    }`;

  const renderSkaterRow = (p: Player, opts: { selected?: boolean; comparison?: boolean } = {}) => (
    <tr
      key={`s-${p.id}`}
      onClick={opts.comparison ? undefined : () => setSelectedDropId(String(p.id))}
      className={rowClass(opts)}
    >
      <td className="px-2 py-2 sm:px-3"><Badge variant="secondary" className="w-8 justify-center">{p.position}</Badge></td>
      {/*
        * THE NAME COLUMN TAKES EVERY SPARE PIXEL, THEN ELLIPSIZES.
        *
        * This was a fixed cap: max-w-[7.5rem] on the phone, 120px, chosen so
        * `truncate` had a width to resolve against inside an auto-layout
        * table. It cut "Alexander Ovechkin" to "Alexander Ov..." with half
        * the row sitting empty next to it, because a hardcoded cap cannot
        * know how much room the visible stat columns actually left over.
        *
        * w-full + max-w-0 on the cell is the table idiom that does know:
        * w-full makes this the greedy column (it receives all width the
        * content-sized stat columns do not claim), and max-w-0 gives the
        * overflow machinery a resolvable bound so truncate still works.
        * No magic number, every viewport, and a long name can never force
        * the row wider than the dialog.
        */}
      <td className="px-2 py-2 sm:px-3 font-medium w-full max-w-0">
        <span className="block truncate">{p.full_name}</span>
      </td>
      <td className={`px-2 py-2 sm:px-3 text-muted-foreground ${HIDE_SM}`}>{p.team}</td>
      <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{num(p.games_played)}</td>
      <td className="px-2 py-2 sm:px-3 text-right tabular-nums font-semibold">{num(p.points)}</td>
      <td className={`px-2 py-2 sm:px-3 text-right tabular-nums ${HIDE_SM}`}>{num(p.goals)}</td>
      <td className={`px-2 py-2 sm:px-3 text-right tabular-nums ${HIDE_SM}`}>{num(p.assists)}</td>
      <td className={`px-2 py-2 sm:px-3 text-right tabular-nums ${HIDE_SM}`}>{num(p.plus_minus)}</td>
      <td className={`px-2 py-2 sm:px-3 text-right tabular-nums ${HIDE_SM}`}>{num(p.shots)}</td>
      <td className={`px-2 py-2 sm:px-3 text-right tabular-nums ${HIDE_SM}`}>{num(p.hits)}</td>
      <td className={`px-2 py-2 sm:px-3 text-right tabular-nums ${HIDE_SM}`}>{num(p.blocks)}</td>
    </tr>
  );

  const renderGoalieRow = (p: Player, opts: { selected?: boolean; comparison?: boolean } = {}) => (
    <tr
      key={`g-${p.id}`}
      onClick={opts.comparison ? undefined : () => setSelectedDropId(String(p.id))}
      className={rowClass(opts)}
    >
      <td className="px-2 py-2 sm:px-3"><Badge variant="secondary" className="w-8 justify-center">G</Badge></td>
      {/*
        * THE NAME COLUMN TAKES EVERY SPARE PIXEL, THEN ELLIPSIZES.
        *
        * This was a fixed cap: max-w-[7.5rem] on the phone, 120px, chosen so
        * `truncate` had a width to resolve against inside an auto-layout
        * table. It cut "Alexander Ovechkin" to "Alexander Ov..." with half
        * the row sitting empty next to it, because a hardcoded cap cannot
        * know how much room the visible stat columns actually left over.
        *
        * w-full + max-w-0 on the cell is the table idiom that does know:
        * w-full makes this the greedy column (it receives all width the
        * content-sized stat columns do not claim), and max-w-0 gives the
        * overflow machinery a resolvable bound so truncate still works.
        * No magic number, every viewport, and a long name can never force
        * the row wider than the dialog.
        */}
      <td className="px-2 py-2 sm:px-3 font-medium w-full max-w-0">
        <span className="block truncate">{p.full_name}</span>
      </td>
      <td className={`px-2 py-2 sm:px-3 text-muted-foreground ${HIDE_SM}`}>{p.team}</td>
      <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{num(p.goalie_gp ?? 0)}</td>
      <td className="px-2 py-2 sm:px-3 text-right tabular-nums font-semibold">{num(p.goals_against_average, 2)}</td>
      <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{num(p.save_percentage ? p.save_percentage * 100 : null, 1)}</td>
      <td className={`px-2 py-2 sm:px-3 text-right tabular-nums ${HIDE_SM}`}>{num(p.wins)}</td>
      <td className={`px-2 py-2 sm:px-3 text-right tabular-nums ${HIDE_SM}`}>{num(p.losses)}</td>
      <td className={`px-2 py-2 sm:px-3 text-right tabular-nums ${HIDE_SM}`}>{num(p.shutouts ?? 0)}</td>
    </tr>
  );

  /*
   * SKATERS AND GOALIES ARE SEPARATE TABLES, NOT ONE MIXED LIST.
   *
   * They were one table with one header, chosen by the position filter. Under
   * the default "All" filter that header was the SKATER header while goalie
   * rows still rendered goalie cells — nine cells beneath eleven columns — so
   * a goalie's wins printed under Goals and his save percentage under Assists.
   * Every goalie on the roster showed a wrong stat line, silently, because
   * nothing about a table with too few cells errors.
   *
   * Two tables inside ONE scroller: each is internally aligned, they read as
   * the two sections they actually are, and there is still only one thing on
   * the page that scrolls.
   */
  const skaters = filteredRoster.filter((p) => !isGoalie(p));
  const goalies = filteredRoster.filter(isGoalie);

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      {/*
        * HEIGHT HAS TO BE DEFINITE, NOT JUST CAPPED.
        *
        * This was `max-h-[90vh] flex flex-col` with an auto height. In a
        * column flex container whose height is indefinite, `flex-basis: 0%`
        * cannot resolve and is treated as content — so the roster box sized
        * itself to its child (a fixed 42vh scroll viewport), the dialog then
        * clamped to 90vh, and the roster box shrank to absorb the overflow
        * while the viewport inside it did NOT. Measured on an iPhone 393x852:
        * a 274px box clipping a 358px viewport. The scroller believed the
        * bottom 84px were already on screen, so it would not scroll them into
        * view and the last two players could never be reached or dropped.
        *
        * A definite height on the phone makes flex resolve once, honestly,
        * and every child below is shrink-0 except the list — so the list is
        * the only thing that can absorb a squeeze, which is what we want it
        * to do.
        */}
      <DialogContent className="sm:max-w-5xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden gap-3 p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base sm:text-lg pr-8">
            Drop a player to add <span className="text-emerald-600">{addPlayer?.full_name ?? 'player'}</span>
          </DialogTitle>
          {/*
            * Six lines of legalese cost ~180px of a 852px phone — more than
            * four roster rows — to say something the user finds out anyway by
            * pressing the button. The short form carries the one fact that
            * changes behaviour; the full explanation stays for the desktop
            * layout that has room for it.
            */}
          <DialogDescription className="text-xs sm:text-sm">
            <span className="sm:hidden">The add and the drop happen together. If either one fails, nothing is saved.</span>
            <span className="hidden sm:inline">
              Select a player from your roster to drop. The add and the drop happen together. If anything fails,
              neither change is saved. If {addPlayer?.full_name ?? 'this player'} is on waivers, a claim will
              be submitted automatically with your selected drop as the conditional drop.
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* The player being added, in the same column set as the list below it. */}
        {addPlayer && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 shrink-0 overflow-x-auto">
            <div className="px-2 sm:px-3 py-1 text-[11px] uppercase tracking-wide text-emerald-700 font-semibold">
              Adding
            </div>
            <table className="w-full">
              <thead>{addingGoalie ? GoalieHeader : SkaterHeader}</thead>
              <tbody>
                {addingGoalie
                  ? renderGoalieRow(addPlayer, { comparison: true })
                  : renderSkaterRow(addPlayer, { comparison: true })}
              </tbody>
            </table>
          </div>
        )}

        {/* Filter chips */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">Filter:</span>
          {POS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setPosFilter(f)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                posFilter === f ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted border-border'
              }`}
            >
              {f === 'F' ? 'Forwards' : f === 'D' ? 'Defense' : f === 'G' ? 'Goalies' : 'All'}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {filteredRoster.length}
          </span>
        </div>

        {/*
          * ONE SCROLLER. The viewport and the box that clips it are the same
          * element, so they cannot disagree about how far there is to scroll —
          * which is the entire bug above. It also replaces two nested
          * scrollers (a Radix ScrollArea owning the vertical axis wrapped
          * around a div owning the horizontal one); on a touch screen a drag
          * that is a few degrees off vertical gets captured by the wrong one
          * of those and the list appears to refuse to move.
          *
          * overscroll-contain stops a flick that reaches the end of the list
          * from chaining into the locked page behind the dialog and rubber-
          * banding back.
          */}
        <div data-testid="roster-list" className="rounded-md border flex-1 min-h-0 overflow-auto overscroll-contain">
          {loadingRoster ? (
            <div className="flex h-full min-h-[8rem] items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading roster...
            </div>
          ) : filteredRoster.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No matching players on your roster.
            </div>
          ) : (
            <>
              {skaters.length > 0 && (
                <table className="w-full">
                  <thead className="sticky top-0 bg-background z-sticky-base">{SkaterHeader}</thead>
                  <tbody>
                    {skaters.map((p) => renderSkaterRow(p, { selected: selectedDropId === String(p.id) }))}
                  </tbody>
                </table>
              )}
              {goalies.length > 0 && (
                <table className="w-full">
                  <thead className="sticky top-0 bg-background z-sticky-base">{GoalieHeader}</thead>
                  <tbody>
                    {goalies.map((p) => renderGoalieRow(p, { selected: selectedDropId === String(p.id) }))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-row justify-end gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedDropId || submitting || loadingRoster}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Swapping...
              </>
            ) : (
              'Confirm Swap'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({
  children,
  className = '',
  onClick,
  sortable,
  active,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  sortable?: boolean;
  active?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-2 py-2 sm:px-3 text-left font-semibold ${className} ${
        sortable ? 'cursor-pointer select-none hover:text-foreground' : ''
      } ${active ? 'text-foreground' : ''}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && <ArrowUpDown className="h-3 w-3 opacity-50" />}
      </span>
    </th>
  );
}

export default DropPlayerForAddDialog;
