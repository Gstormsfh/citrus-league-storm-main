import { Check, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * THE ADD BUTTON (2026-09-14): always a green circle with a plus sign.
 *
 * Before this the Free Agents page drew the add control five different
 * ways: a 40px square with a text "+", a 32px square, a 36px square, a
 * "+ Add" pill, and an amber "W" square for players on waivers. Two tables
 * side by side had two different buttons. One component, one shape, one
 * colour. The waiver case keeps its meaning in the tooltip and the
 * aria-label ("Submit waiver claim"), not in a different glyph; a claim
 * already filed shows a check in the same circle because clicking it
 * cancels the claim, and a plus there would be a lie.
 */
export type FreeAgentAddState = 'add' | 'claim' | 'claimed';

function addButtonTitle(state: FreeAgentAddState): string {
  return state === 'claimed' ? 'Claim filed. Click to cancel' : state === 'claim' ? 'Submit waiver claim' : 'Add to roster';
}

export function FreeAgentAddButton({ state, pending = false, disabled = false, onClick, className, playerName }: {
  state: FreeAgentAddState;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  playerName?: string;
}) {
  const title = addButtonTitle(state);
  return (
    <button
      type="button"
      title={title}
      aria-label={playerName ? `${title}: ${playerName}` : title}
      aria-busy={pending || undefined}
      disabled={disabled}
      onClick={onClick}
      data-testid="fa-add-button"
      data-state={state}
      className={cn(
        'focus-citrus inline-flex h-9 w-9 flex-none items-center justify-center rounded-full border shadow-sm transition-colors touch-manipulation',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        state === 'claimed'
          ? 'border-emerald-500 bg-emerald-900 text-emerald-200 hover:bg-emerald-800'
          : 'border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700',
        className,
      )}
    >
      {pending
        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        : state === 'claimed'
          ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
          : <Plus className="h-5 w-5" strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}
