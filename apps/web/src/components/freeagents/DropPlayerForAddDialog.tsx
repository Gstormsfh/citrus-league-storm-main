import { useState, useEffect } from 'react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { Player, PlayerService } from '@/services/PlayerService';
import { WaiverService } from '@/services/WaiverService';
import { rosterApi } from '@/api/rosters';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';

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

interface RosterEntry {
  id: string;
  full_name: string;
  position: string;
  team: string;
}

/**
 * DropPlayerForAddDialog
 *
 * Lets the user select a roster player to drop and performs an ATOMIC
 * add+drop via WaiverService.addPlayer (single RPC call). The server-side
 * process_roster_move RPC wraps both operations in a subtransaction so a
 * failure rolls back the drop.
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
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [selectedDropId, setSelectedDropId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !leagueId || !teamId) return;
    let cancelled = false;
    (async () => {
      setLoadingRoster(true);
      setSelectedDropId(null);
      try {
        const resp = await rosterApi.getTeamRoster(leagueId, teamId);
        const assignments = (resp.data as Array<{ player_id: string | number }>) || [];
        const playerIds = assignments.map((a) => String(a.player_id));
        if (playerIds.length === 0) {
          if (!cancelled) setRoster([]);
          return;
        }
        const players = await PlayerService.getPlayersByIds(playerIds);
        if (cancelled) return;
        setRoster(
          players.map((p) => ({
            id: String(p.id),
            full_name: p.full_name,
            position: p.position,
            team: p.team,
          })),
        );
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
  }, [open, leagueId, teamId, toast]);

  const handleConfirm = async () => {
    if (!addPlayer || !selectedDropId) return;
    const addPlayerId =
      typeof addPlayer.id === 'string' ? parseInt(addPlayer.id as string, 10) : (addPlayer.id as number);
    const dropPlayerId = parseInt(selectedDropId, 10);
    setSubmitting(true);
    try {
      const result = await WaiverService.addPlayer(
        leagueId,
        teamId,
        addPlayerId,
        dropPlayerId,
        userId,
      );
      if (result.success) {
        const droppedPlayer = roster.find((p) => p.id === selectedDropId);
        toast({
          title: result.isFreeAgent ? 'Swap Completed' : 'Waiver Claim Submitted',
          description: result.isFreeAgent
            ? `Added ${addPlayer.full_name}${droppedPlayer ? ` and dropped ${droppedPlayer.full_name}` : ''}.`
            : `${addPlayer.full_name} is on waivers with ${droppedPlayer?.full_name ?? 'selected player'} as the drop.`,
        });
        onOpenChange(false);
        onSuccess?.();
        // Notify Roster page (and any other listeners) to refresh
        window.dispatchEvent(new CustomEvent('citrus:roster-changed'));
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
        description: err instanceof Error ? err.message : 'Unexpected error. Your roster is unchanged.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Drop a player to add {addPlayer?.full_name ?? 'player'}</DialogTitle>
          <DialogDescription>
            Select a player to drop. The add and drop happen together — if anything fails, neither
            change is saved.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[320px] rounded-md border">
          {loadingRoster ? (
            <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading roster...
            </div>
          ) : roster.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No players on your roster to drop.
            </div>
          ) : (
            <ul className="divide-y">
              {roster.map((p) => {
                const selected = selectedDropId === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => setSelectedDropId(p.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        selected ? 'bg-primary/10' : 'hover:bg-muted'
                      }`}
                    >
                      <Badge variant="secondary" className="w-10 justify-center">
                        {p.position}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{p.full_name}</div>
                        <div className="text-xs text-muted-foreground truncate">{p.team}</div>
                      </div>
                      {selected && (
                        <span className="text-xs font-semibold text-primary">Selected</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
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

export default DropPlayerForAddDialog;
