import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LeagueService } from '@/services/LeagueService';
import { useToast } from '@/hooks/use-toast';
import { userMessage } from '@/lib/userMessage';

/**
 * THE MOCK DRAFT IS A REAL DRAFT (2026-09-14).
 *
 * One hook for every "Run a mock draft" button: create the practice league,
 * land in the live V2 room. From a league page pass `fromLeagueId` and the
 * mock inherits that league's size, rounds, roster slots and scoring; from
 * the home page pass the seat count. The room gets `?mock=1` so it can
 * decline to claim the practice league as the user's active league before
 * the league row has even loaded.
 */
export interface StartMockDraftOptions {
  fromLeagueId?: string;
  teamsCount?: number;
  draftRounds?: number;
  pickTimeLimitSeconds?: number;
}

export function useStartMockDraft() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [starting, setStarting] = useState(false);

  const start = useCallback(async (options: StartMockDraftOptions = {}) => {
    if (starting) return;
    setStarting(true);
    try {
      const { leagueId, aiSeats, error } = await LeagueService.createPracticeDraft(options);
      if (error || !leagueId) {
        toast({
          title: "Couldn't start the mock draft",
          description: userMessage(error, 'Please try again.'),
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Mock draft ready',
        description: `${aiSeats} AI teams are seated. Press Start when you're ready. Nothing here counts.`,
      });
      navigate(`/draft-v2/${leagueId}?mock=1`);
    } finally {
      setStarting(false);
    }
  }, [navigate, starting, toast]);

  return { start, starting };
}
