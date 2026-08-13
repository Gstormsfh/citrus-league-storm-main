import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, Play, Trash2, AlertCircle, Info, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Player } from '@/services/PlayerService';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import { supabase } from '@/integrations/supabase/client';

/** A row of `draft_queues`. `position` is 1-based queue order. */
interface QueueRow {
  player_id: number;
  position: number;
}

/**
 * QUEUE (2026-08-12) — narrowly-typed view of the Supabase client.
 *
 * `draft_queues` and `set_draft_queue` are both absent from the
 * generated types (`types.ts` declares `Functions: { [_ in never]:
 * never }` and predates the v2 tables). Rather than widen the whole
 * client to `any`, this describes exactly the two calls we make — same
 * approach as the `player_season_stats` accessor in
 * `usePreloadedPlayers`. Regenerating types would remove the need for
 * it; that is a separate chore and not one to do days before a freeze.
 */
const queueClient = supabase as unknown as {
  from: (table: 'draft_queues') => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => Promise<{
          data: QueueRow[] | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
  rpc: (
    fn: 'set_draft_queue',
    args: { p_team_id: string; p_player_ids: number[] },
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

/** Debounce before persisting — a drag reorder fires many changes. */
const QUEUE_SAVE_DEBOUNCE_MS = 600;

interface DraftQueueProps {
  queue: string[]; // Array of player IDs
  players: Player[];
  draftedPlayers: string[];
  onQueueChange: (newQueue: string[]) => void;
  onDraftFromQueue: (playerId: string) => void;
  isDraftActive: boolean;
  isYourTurn: boolean;
  leagueId?: string;
  /**
   * QUEUE (2026-08-12) — the manager's own team.
   *
   * OPTIONAL on purpose. `draft_queues` is keyed by team, and its RLS
   * policy is `teams.owner_id = auth.uid()`, so server persistence is
   * only possible when we know which team the viewer owns. When this is
   * absent — the v1 draft room, or a spectator — the component keeps
   * exactly its previous localStorage-only behaviour rather than
   * degrading. That keeps v1 untouched by this change.
   */
  teamId?: string | null;
  currentPick?: number;
  totalPicks?: number;
}

const positionColors = {
  'C': 'bg-fantasy-primary/20 text-fantasy-primary border-fantasy-primary/30',
  'LW': 'bg-fantasy-secondary/20 text-fantasy-secondary border-fantasy-secondary/30',
  'RW': 'bg-fantasy-tertiary/20 text-fantasy-tertiary border-fantasy-tertiary/30',
  'D': 'bg-blue-200/40 text-blue-700 border-blue-300/40',
  'G': 'bg-purple-200/40 text-purple-700 border-purple-300/40',
};

interface SortableQueueItemProps {
  player: Player;
  index: number;
  isDrafted: boolean;
  onRemove: () => void;
  onDraft: () => void;
  isYourTurn: boolean;
  estimatedPick?: number;
  totalPicks?: number;
}

function SortableQueueItem({ 
  player, 
  index, 
  isDrafted, 
  onRemove, 
  onDraft,
  isYourTurn
}: SortableQueueItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: player.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const posColor = positionColors[player.position as keyof typeof positionColors] || 'bg-citrus-sage/20 text-citrus-forest border-citrus-sage/40';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-2 rounded-lg border bg-[#E8EED9]/50 backdrop-blur-sm transition-all',
        isDrafted && 'opacity-50 bg-muted/50',
        isDragging && 'shadow-lg scale-105 z-50',
        index === 0 && isYourTurn && !isDrafted && 'ring-2 ring-fantasy-primary bg-fantasy-primary/5'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </div>
      
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className={cn(
          "text-sm font-medium w-6 text-center",
          index === 0 && isYourTurn && !isDrafted ? "text-citrus-orange font-bold" : "text-muted-foreground"
        )}>
          #{index + 1}
        </div>
        {/* REMOVED AVATAR */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{player.full_name}</span>
            <Badge className={cn('text-xs border', posColor)}>
              {player.position}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            <span>{player.team} • {player.points} PTS</span>
            {/* REMOVED "picks away" text */}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {isDrafted ? (
          <Badge variant="outline" className="text-xs bg-muted">
            Drafted
          </Badge>
        ) : isYourTurn && index === 0 ? (
          <Button
            size="sm"
            onClick={onDraft}
            className="h-7 text-xs bg-fantasy-primary hover:bg-fantasy-primary/90 shadow-sm"
          >
            <Play className="h-3 w-3 mr-1" />
            Draft Now
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive transition-colors"
          title="Remove from queue"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export const DraftQueue = ({
  queue,
  players,
  draftedPlayers,
  onQueueChange,
  onDraftFromQueue,
  isDraftActive,
  isYourTurn,
  leagueId,
  teamId,
  currentPick,
  totalPicks
}: DraftQueueProps) => {
  const { toast } = useToast();

  /**
   * Has the initial restore finished?
   *
   * THIS GUARD IS LOAD-BEARING. `queue` starts as `[]`, so without it
   * the save effect below fires on first render and calls
   * `set_draft_queue(teamId, [])` — which DELETES the queue the manager
   * built before the draft, roughly 600ms after they open the room. The
   * feature would have destroyed the very data it exists to protect.
   */
  const [hydrated, setHydrated] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ── QUEUE (2026-08-12) — restore: server first, localStorage second.
  //
  // Order matters. The server copy is the one the autopick engine reads,
  // so it is authoritative. localStorage is now two things only: a
  // MIGRATION source for managers who built a queue before this shipped,
  // and a same-device cache if the server read fails. A manager who
  // queues on their laptop now sees that queue on their phone.
  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    const restore = async () => {
      if (teamId) {
        try {
          const { data, error } = await queueClient
            .from('draft_queues')
            .select('player_id, position')
            .eq('team_id', teamId)
            .order('position', { ascending: true });

          if (cancelled) return;

          if (error) {
            logger.error(
              '[DraftQueue] server queue read failed, falling back to local:',
              new Error(error.message ?? 'unknown'),
            );
          } else if (data && data.length > 0) {
            onQueueChange(data.map((r) => String(r.player_id)));
            toast({
              title: 'Queue Restored',
              description: `Loaded ${data.length} players from your saved queue`,
            });
            setHydrated(true);
            return;
          }
          // No server rows: fall through so a pre-existing local queue
          // gets migrated up on the next save.
        } catch (e) {
          if (cancelled) return;
          logger.error('[DraftQueue] server queue read threw:', e);
        }
      }

      const savedQueue = localStorage.getItem(`draft-queue-${leagueId}`);
      if (savedQueue) {
        try {
          const parsed = JSON.parse(savedQueue);
          if (Array.isArray(parsed) && parsed.length > 0 && !cancelled) {
            onQueueChange(parsed);
            toast({
              title: 'Queue Restored',
              description: `Loaded ${parsed.length} players from your saved queue`,
            });
          }
        } catch (e) {
          logger.error('Error loading queue from localStorage:', e);
        }
      }
      if (!cancelled) setHydrated(true);
    };

    void restore();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time restore per (league, team); toast/onQueueChange are stable
  }, [leagueId, teamId]);

  // ── QUEUE (2026-08-12) — persist.
  //
  // localStorage stays as a synchronous same-device cache (it survives a
  // tab crash inside the debounce window). The server write is what the
  // autopick engine actually consults.
  useEffect(() => {
    if (!leagueId) return;

    if (queue.length > 0) {
      localStorage.setItem(`draft-queue-${leagueId}`, JSON.stringify(queue));
    }

    // See `hydrated` above — writing before the restore lands would
    // erase the manager's queue with the empty initial state.
    if (!teamId || !hydrated) return;

    // `draft_queues.player_id` is INTEGER while the client carries ids as
    // strings, and demo leagues use UUID player ids (KI-042). Anything
    // non-numeric is dropped rather than sent — a bad cast here would
    // either error the whole save or, worse, truncate a UUID to a valid-
    // looking integer for the WRONG player.
    const numeric: number[] = [];
    for (const raw of queue) {
      const n = Number(raw);
      if (Number.isInteger(n) && n > 0) numeric.push(n);
    }
    if (numeric.length !== queue.length) {
      logger.warn(
        `[DraftQueue] dropped ${queue.length - numeric.length} non-numeric player id(s) from the server queue write`,
      );
    }

    const handle = setTimeout(() => {
      void (async () => {
        try {
          const { error } = await queueClient.rpc('set_draft_queue', {
            p_team_id: teamId,
            p_player_ids: numeric,
          });
          if (error) {
            logger.error(
              '[DraftQueue] queue save failed — autopick will fall back to projections:',
              new Error(error.message ?? 'unknown'),
            );
          }
        } catch (e) {
          logger.error('[DraftQueue] queue save threw:', e);
        }
      })();
    }, QUEUE_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [queue, leagueId, teamId, hydrated]);

  const queuePlayers = queue
    .map(id => players.find(p => p.id === id))
    .filter((p): p is Player => p !== undefined);

  const availableQueuePlayers = queuePlayers.filter(p => !draftedPlayers.includes(p.id));
  const draftedInQueue = queuePlayers.filter(p => draftedPlayers.includes(p.id));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = availableQueuePlayers.findIndex(p => p.id === active.id);
      const newIndex = availableQueuePlayers.findIndex(p => p.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newQueue = arrayMove(availableQueuePlayers, oldIndex, newIndex)
          .map(p => p.id);
        onQueueChange(newQueue);
        toast({
          title: "Queue Updated",
          description: "Player order updated",
        });
      }
    }
  };

  const handleRemove = (playerId: string) => {
    const player = players.find(p => p.id === playerId);
    onQueueChange(queue.filter(id => id !== playerId));
    toast({
      title: "Removed from Queue",
      description: player ? `${player.full_name} removed` : "Player removed",
    });
  };

  const handleClearAll = () => {
    if (availableQueuePlayers.length === 0) return;
    onQueueChange([]);
    if (leagueId) {
      localStorage.removeItem(`draft-queue-${leagueId}`);
    }
    toast({
      title: "Queue Cleared",
      description: "All players removed from queue",
    });
  };

  // Auto-draft from queue when it's your turn (optional - can be enabled)
  useEffect(() => {
    if (isDraftActive && isYourTurn && availableQueuePlayers.length > 0) {
      // Uncomment to enable auto-draft after 2 seconds:
      // const timer = setTimeout(() => {
      //   onDraftFromQueue(availableQueuePlayers[0].id);
      // }, 2000);
      // return () => clearTimeout(timer);
    }
  }, [isDraftActive, isYourTurn, availableQueuePlayers.length]);

  return (
    <Card className="border-fantasy-border bg-fantasy-surface">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg font-semibold text-fantasy-dark">
              Draft Queue
            </CardTitle>
            {isYourTurn && availableQueuePlayers.length > 0 && (
              <Badge className="bg-fantasy-primary text-white animate-pulse">
                <Zap className="h-3 w-3 mr-1" />
                Your Turn
              </Badge>
            )}
          </div>
          {availableQueuePlayers.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              className="h-7 text-xs"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
        {/* REMOVED drafted count display */}
      </CardHeader>
      <CardContent className="pt-0">
        {availableQueuePlayers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">Your queue is empty</p>
              <p className="text-xs">Click the star icon on players to add them to your queue</p>
              <div className="mt-2 p-2 bg-fantasy-light/30 rounded text-xs flex items-center gap-2">
                <Info className="h-3 w-3" />
                <span>Drag to reorder • Top player auto-drafts when it's your turn</span>
              </div>
            </div>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={availableQueuePlayers.map(p => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {availableQueuePlayers.map((player, index) => (
                  <SortableQueueItem
                    key={player.id}
                    player={player}
                    index={index}
                    isDrafted={false}
                    onRemove={() => handleRemove(player.id)}
                    onDraft={() => onDraftFromQueue(player.id)}
                    isYourTurn={isYourTurn}
                    estimatedPick={currentPick}
                    totalPicks={totalPicks}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {draftedInQueue.length > 0 && (
          <div className="mt-4 pt-4 border-t border-fantasy-border">
            <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
              <span>
                {draftedInQueue.length} player{draftedInQueue.length !== 1 ? 's' : ''} already drafted
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const newQueue = queue.filter(id => !draftedPlayers.includes(id));
                  onQueueChange(newQueue);
                }}
                className="h-6 text-xs"
              >
                Remove All
              </Button>
            </div>
            <div className="space-y-1">
              {draftedInQueue.slice(0, 3).map(player => (
                <div key={player.id} className="text-xs text-muted-foreground line-through opacity-60">
                  {player.full_name} ({player.position})
                </div>
              ))}
              {draftedInQueue.length > 3 && (
                <div className="text-xs text-muted-foreground">
                  +{draftedInQueue.length - 3} more...
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

