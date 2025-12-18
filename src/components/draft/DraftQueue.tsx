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

interface DraftQueueProps {
  queue: string[]; // Array of player IDs
  players: Player[];
  draftedPlayers: string[];
  onQueueChange: (newQueue: string[]) => void;
  onDraftFromQueue: (playerId: string) => void;
  isDraftActive: boolean;
  isYourTurn: boolean;
  leagueId?: string;
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

  const posColor = positionColors[player.position as keyof typeof positionColors] || 'bg-gray-200/40 text-gray-700 border-gray-300/40';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-2 rounded-lg border bg-white transition-all',
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
          index === 0 && isYourTurn && !isDrafted ? "text-fantasy-primary font-bold" : "text-muted-foreground"
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
  currentPick,
  totalPicks
}: DraftQueueProps) => {
  const { toast } = useToast();
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

  // Load queue from localStorage on mount
  useEffect(() => {
    if (leagueId) {
      const savedQueue = localStorage.getItem(`draft-queue-${leagueId}`);
      if (savedQueue) {
        try {
          const parsed = JSON.parse(savedQueue);
          if (Array.isArray(parsed) && parsed.length > 0) {
            onQueueChange(parsed);
            toast({
              title: "Queue Restored",
              description: `Loaded ${parsed.length} players from your saved queue`,
            });
          }
        } catch (e) {
          console.error('Error loading queue from localStorage:', e);
        }
      }
    }
  }, [leagueId]);

  // Save queue to localStorage whenever it changes
  useEffect(() => {
    if (leagueId && queue.length > 0) {
      localStorage.setItem(`draft-queue-${leagueId}`, JSON.stringify(queue));
    }
  }, [queue, leagueId]);

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

