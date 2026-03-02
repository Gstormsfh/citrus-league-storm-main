import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DraftBoard } from './DraftBoard';
import { Calendar, Trophy } from 'lucide-react';
import { format } from 'date-fns';

interface DraftSnapshotViewProps {
  isOpen: boolean;
  onClose: () => void;
  snapshotData: {
    teams: Array<{
      id: string;
      name: string;
      owner: string;
      color: string;
    }>;
    picks: Array<{
      id: string;
      teamId: string;
      teamName: string;
      playerId: string;
      playerName: string;
      position: string;
      round: number;
      pick: number;
      timestamp: number;
    }>;
    leagueSettings: {
      rounds: number;
      draftOrder: string;
      completedAt: string;
    };
  } | null;
  createdAt?: string;
}

export const DraftSnapshotView = ({ 
  isOpen, 
  onClose, 
  snapshotData,
  createdAt 
}: DraftSnapshotViewProps) => {
  if (!snapshotData) {
    return null;
  }

  const { teams, picks, leagueSettings } = snapshotData;
  const totalPicks = teams.length * leagueSettings.rounds;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Draft Results Snapshot
          </DialogTitle>
          <DialogDescription className="flex items-center gap-4 flex-wrap">
            {createdAt && (
              <span className="flex items-center gap-1 text-sm">
                <Calendar className="h-4 w-4" />
                Saved: {format(new Date(createdAt), 'PPpp')}
              </span>
            )}
            <span className="text-sm">
              {picks.length} of {totalPicks} picks completed
            </span>
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto min-h-0">
          <DraftBoard
            teams={teams}
            draftHistory={picks}
            currentPick={picks.length}
            currentRound={leagueSettings.rounds}
            totalRounds={leagueSettings.rounds}
            onPlayerClick={() => {}} // Read-only view, no player clicks
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

