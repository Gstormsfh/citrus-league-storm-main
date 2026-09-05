import { useState, useEffect } from 'react';
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
import { GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Player } from '@/services/PlayerService';
import { Mug } from '@/components/roster/Mug';
import { mugFromDirectory } from '@/components/roster/headshot';
import { positionChipKey } from '@/components/roster/positionChip';
// By file, never the `@/components/pressbox` barrel — it reaches LeagueContext
// and the Supabase client at module scope, and this panel has its own client.
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import { supabase } from '@/integrations/supabase/client';

/* 2026-08-19 visual audit: this panel was still on the ORIGINAL light
   theme (fantasy-surface #FFFFFF, fantasy-dark #1E293B, fantasy-light
   #FFF1DB) while the draft room around it renders on #0F1F15. It read as
   a white box pasted into a dark app. Migrated to the pastel dark
   surface tokens the rest of the room already uses. */


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

/*
 * PRESS BOX (2026-09-04). The queue is a Press Box list now — artboard 4a's
 * QUEUE tab, which the artboard names but does not draw, so it borrows the
 * pool row's grammar one column over: the grip and the order where the pool
 * keeps the star and the rank, the same 36px face, the same 15px name over a
 * 10px meta line, and the 40px action slots at the right. `DRAFT NOW` on the
 * top row when it is your turn is orange, the way every draft verb in the
 * room is; remove is the neutral slot. Every behaviour — drag to reorder,
 * remove, clear, the drafted tail, server-first restore and debounced
 * persistence — is exactly what it was.
 */

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

  const onDeck = index === 0 && isYourTurn && !isDrafted;
  const posKey = positionChipKey(player.position);

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="draft-queue-row"
      className={cn(
        PB_TYPE,
        'grid grid-cols-[22px_1fr_auto] gap-2.5 items-center min-h-[56px] px-3.5 border-t border-white/[0.06] transition-colors',
        isDrafted && 'opacity-40',
        isDragging && 'bg-pressbox-tile shadow-lg z-50',
        onDeck && 'bg-pressbox-orange/[0.06] shadow-[inset_3px_0_0_theme(colors.pressbox.orange)]',
      )}
    >
      <span className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="focus-citrus relative flex h-[18px] w-[18px] cursor-grab items-center justify-center text-pressbox-text/45 active:cursor-grabbing after:absolute after:-inset-[13px] after:content-['']"
          title="Drag to reorder"
          aria-label={`Reorder ${player.full_name}`}
        >
          <GripVertical className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </button>
        <span
          className={cn(
            'font-plex font-semibold text-[12px] tabular-nums',
            onDeck ? 'text-pressbox-orange-soft' : 'text-pressbox-text/60',
          )}
        >
          {index + 1}
        </span>
      </span>

      <span className="flex items-center gap-2.5 min-w-0">
        <Mug p={mugFromDirectory(player)} size="sm" crest />
        <span className="min-w-0">
          <span className="block font-barlow font-bold text-[15px] truncate text-pressbox-text">
            {player.full_name}
          </span>
          <span className="block mt-[3px] font-plex font-medium text-[10px] text-pressbox-text/55 truncate">
            {posKey && <b className="font-bold text-pressbox-text">{posKey}</b>}
            {posKey && player.team ? ' · ' : ''}
            {player.team}
            {player.points != null ? ` · ${player.points} PTS` : ''}
          </span>
        </span>
      </span>

      <span className="flex items-center gap-1.5">
        {isDrafted ? (
          <span className="font-plex font-semibold text-[10px] tracking-[0.06em] text-pressbox-text/45">DRAFTED</span>
        ) : onDeck ? (
          <button
            type="button"
            onClick={onDraft}
            className="focus-citrus h-10 px-3 rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold text-[10px] uppercase tracking-[0.06em] whitespace-nowrap active:scale-95 transition-transform"
          >
            Draft now
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          className="focus-citrus h-10 w-10 flex items-center justify-center rounded-[10px] border border-white/[0.12] bg-white/[0.06] text-pressbox-text/70 active:scale-95 transition-transform"
          title="Remove from queue"
          aria-label={`Remove ${player.full_name} from your queue`}
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </span>
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
    <section className={cn(PB_TYPE)} data-testid="draft-queue">
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-1.5">
        <h2 className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text truncate">
          Queue
          {availableQueuePlayers.length > 0 && (
            <span className="text-pressbox-text/45"> &middot; {availableQueuePlayers.length}</span>
          )}
        </h2>
        <span className="flex items-center gap-2 flex-none">
          {isYourTurn && availableQueuePlayers.length > 0 && (
            <span className="px-[7px] py-[3px] rounded-[4px] bg-pressbox-orange/15 font-plex font-semibold text-[10px] tracking-[0.08em] text-pressbox-orange-soft">
              YOUR TURN
            </span>
          )}
          {availableQueuePlayers.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="focus-citrus font-plex font-medium text-[11px] text-pressbox-orange-soft"
            >
              CLEAR
            </button>
          )}
        </span>
      </div>

      {availableQueuePlayers.length === 0 ? (
        <div className="px-3.5 py-8 text-center">
          <p className="font-barlow font-semibold text-[14px] text-pressbox-text">Your queue is empty</p>
          <p className="mt-1 font-barlow text-[12px] text-pressbox-text/55">
            Tap the star on any player to add him. Drag to reorder. The top player is your autopick.
          </p>
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
            <div>
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
        <div className="mt-2 px-3.5 pt-3 border-t border-white/[0.08]">
          <div className="flex items-center justify-between font-plex font-medium text-[10px] tracking-[0.06em] text-pressbox-text/45">
            <span>
              {draftedInQueue.length} ALREADY DRAFTED
            </span>
            <button
              type="button"
              onClick={() => {
                const newQueue = queue.filter(id => !draftedPlayers.includes(id));
                onQueueChange(newQueue);
              }}
              className="focus-citrus text-pressbox-orange-soft"
            >
              REMOVE ALL
            </button>
          </div>
          <div className="mt-1.5 pb-3">
            {draftedInQueue.slice(0, 3).map(player => (
              <div key={player.id} className="font-plex font-medium text-[10px] text-pressbox-text/45 line-through">
                {player.full_name} ({player.position})
              </div>
            ))}
            {draftedInQueue.length > 3 && (
              <div className="font-plex font-medium text-[10px] text-pressbox-text/45">
                +{draftedInQueue.length - 3} more
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

