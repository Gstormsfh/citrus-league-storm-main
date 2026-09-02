import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useLeague } from '@/contexts/LeagueContext';

/**
 * LeagueLoadErrorBanner (2026-08-18 launch audit).
 *
 * LeagueContext has always exposed an `error`, and has always set it when
 * the league load fails — but NO component anywhere consumed it. The
 * user-visible consequence was severe and completely silent: on a failed
 * load, `userLeagues` stays `[]`, so `userLeagueState` computes to
 * 'logged-in-no-league', and every page that branches on that state shows
 * a "Create your league to start competing" CTA.
 *
 * In other words, a transient API blip told an existing league member
 * that their leagues do not exist, and invited them to make a new one.
 * No error, no retry, no way to tell it apart from genuinely having none.
 *
 * This banner is the missing consumer. It renders app-wide (mounted in
 * App.tsx just inside LeagueProvider) so no individual page has to
 * remember to handle it, and offers the retry that `refreshLeagues`
 * already implemented.
 *
 * Deliberately NOT a full-page takeover: the rest of the app still works
 * during the failure, and a member who is mid-task should not lose their
 * screen. It just has to be impossible to miss and impossible to mistake
 * for "you have no leagues".
 */
export function LeagueLoadErrorBanner() {
  const { error, refreshLeagues } = useLeague();
  const [retrying, setRetrying] = useState(false);

  if (!error) return null;

  const onRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await refreshLeagues();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      data-testid="league-load-error-banner"
      className="sticky top-0 z-app-nav flex items-center justify-center gap-3 border-b border-destructive/40 bg-destructive/15 px-4 py-2.5 text-sm backdrop-blur"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-destructive" aria-hidden="true" />
      <span className="text-destructive">
        We couldn&apos;t load your leagues just now. This is a connection problem, not a
        sign that your leagues are gone.
      </span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        data-testid="league-load-error-retry"
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-60"
      >
        <RefreshCw className={`h-3 w-3 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

export default LeagueLoadErrorBanner;
