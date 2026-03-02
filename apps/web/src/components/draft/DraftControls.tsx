import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Settings
} from 'lucide-react';

interface DraftControlsProps {
  isDraftActive: boolean;
  onToggleDraft?: () => void;
  onPause?: () => void;
  onContinue?: () => void;
  onUndoLastPick?: () => void;
  canPause?: boolean;
  canContinue?: boolean;
  canUndo?: boolean;
  pickTimeLimit?: number;
}

export const DraftControls = ({
  isDraftActive,
  onToggleDraft,
  onPause,
  onContinue,
  onUndoLastPick,
  canPause = true,
  canContinue = true,
  canUndo = false,
  pickTimeLimit = 90
}: DraftControlsProps) => {
  const handlePause = onPause || onToggleDraft;
  const handleContinue = onContinue || onToggleDraft;

  return (
    <Card className="p-6">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <Settings className="h-4 w-4" />
        Draft Controls
      </h3>

      <div className="space-y-4">
        {/* Main Controls */}
        <div className="space-y-2">
          {isDraftActive ? (
            <Button
              onClick={handlePause}
              className="w-full"
              variant="destructive"
              disabled={!canPause}
            >
              <Pause className="h-4 w-4 mr-2" />
              Pause Draft
            </Button>
          ) : (
            <Button
              onClick={handleContinue}
              className="w-full"
              variant="default"
              disabled={!canContinue}
            >
              <Play className="h-4 w-4 mr-2" />
              Continue Draft
            </Button>
          )}

          <Button variant="outline" className="w-full" disabled={!isDraftActive}>
            <SkipForward className="h-4 w-4 mr-2" />
            Skip Pick
          </Button>
        </div>

        {/* Draft Actions */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">Actions</div>

          <Button
            variant="ghost"
            className="w-full justify-start text-sm h-8"
            disabled={!canUndo}
            onClick={onUndoLastPick}
          >
            <RotateCcw className="h-3 w-3 mr-2" />
            Undo Last Pick
          </Button>
        </div>

        {/* Draft Status */}
        <div className="pt-4 border-t space-y-2">
          <div className="text-sm font-medium text-muted-foreground">Status</div>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Draft Mode</span>
              <Badge variant={isDraftActive ? "default" : "secondary"} className="text-xs">
                {isDraftActive ? "Active" : "Paused"}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Auto-Draft</span>
              <Badge variant="outline" className="text-xs">
                Enabled
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Pick Timer</span>
              <Badge variant="outline" className="text-xs">
                {pickTimeLimit}s
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
