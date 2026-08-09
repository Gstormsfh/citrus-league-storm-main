// Phase 4.5 chunk 11g.5b — connection banner consuming chunk-11g.5a's
// state machine.
//
// Renders a state-aware banner driven by `useDraftConnectionState()`.
// State-by-state visual treatment:
//
//   - idle: nothing (unmounted or pre-connect).
//   - fetching_token / connecting: subtle inline "Connecting…"
//     indicator (no full-width banner — initial connect should not
//     dominate the UI).
//   - connected: nothing (steady state).
//   - resyncing / snapshot_required: subtle "Catching up…" indicator.
//   - reconnecting: full-width destructive banner with countdown
//     ("Reconnecting in 3s") and a "Retry now" button. Countdown
//     ticks every 250ms via `setInterval`.
//   - fatal (auth_failure): destructive banner — "You're no longer
//     authorized to access this draft" + return-to-dashboard link.
//   - fatal (invalid_lobby): default-variant banner — "This draft
//     is no longer available" + back-to-league link.
//   - fatal (permanent_server_error): destructive banner with
//     technical-details accordion.
//
// Accessibility:
//   - role="alert" for error states (fatal / reconnecting).
//   - aria-live="polite" for transient states (connecting / resyncing).
//   - Keyboard-accessible Retry button on reconnecting state.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useDraftConnectionState } from '@/stores/draftClientStore';
import type { DraftClientState } from '@/lib/draftClient/types';

interface ConnectionBannerProps {
  /**
   * Caller passes a function that triggers the runner's manual
   * retry — wraps `runner.connect()` (after disconnecting if
   * needed). Lets the banner stay decoupled from the runner
   * instance.
   */
  onRetryNow?: () => void;
}

export function ConnectionBanner({ onRetryNow }: ConnectionBannerProps) {
  const state = useDraftConnectionState();

  switch (state.kind) {
    case 'idle':
    case 'connected':
      return null;
    case 'fetching_token':
    case 'connecting':
      return (
        <InlineIndicator
          ariaLive="polite"
          message="Connecting to draft…"
        />
      );
    case 'resyncing':
    case 'snapshot_required':
      return (
        <InlineIndicator
          ariaLive="polite"
          message="Catching up…"
        />
      );
    case 'reconnecting':
      return (
        <ReconnectingBanner state={state} onRetryNow={onRetryNow} />
      );
    case 'fatal':
      return <FatalBanner state={state} onRetryNow={onRetryNow} />;
  }
}

// ── Inline indicator (transient states) ────────────────────────────

interface InlineIndicatorProps {
  ariaLive: 'polite' | 'assertive';
  message: string;
}

function InlineIndicator({ ariaLive, message }: InlineIndicatorProps) {
  return (
    <div
      aria-live={ariaLive}
      className="text-sm text-muted-foreground italic px-4 py-2"
      data-banner-kind="transient"
    >
      {message}
    </div>
  );
}

// ── Reconnecting banner with countdown ─────────────────────────────

interface ReconnectingBannerProps {
  state: Extract<DraftClientState, { kind: 'reconnecting' }>;
  onRetryNow?: () => void;
}

function ReconnectingBanner({ state, onRetryNow }: ReconnectingBannerProps) {
  const secondsRemaining = useCountdown(state.nextAttemptAt);
  // Chunk 11g.10 client-liveness watchdog — distinct title when this
  // reconnect was triggered by the CLIENT's watchdog noticing missed
  // application-level pongs, rather than by a server-observed close.
  // The countdown copy "Reconnecting in Xs" is preserved verbatim for
  // both paths so existing regression tests (and muscle-memory reading
  // of the banner) keep working; the distinction lives in the title +
  // the data-stale-triggered attribute (queryable in tests + e2e).
  const title = state.staleTriggered
    ? 'Connection appears stale'
    : 'Connection lost';

  return (
    <Alert
      variant="destructive"
      role="alert"
      data-banner-kind="reconnecting"
      data-stale-triggered={state.staleTriggered ? 'true' : undefined}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>
          Reconnecting in {Math.max(0, secondsRemaining)}s
          {state.lastError ? ` — ${state.lastError}` : ''}
        </span>
        {onRetryNow && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetryNow}
          >
            Retry now
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Tick every 250ms to refresh the displayed countdown. Granularity
 * is intentionally coarse-ish (250ms vs 100ms / 16ms) to avoid
 * unnecessary re-renders for a UI element that updates at human-
 * perception cadence.
 */
function useCountdown(targetAt: number): number {
  const [remaining, setRemaining] = useState(() =>
    Math.ceil((targetAt - Date.now()) / 1000),
  );

  useEffect(() => {
    const tick = () => {
      setRemaining(Math.ceil((targetAt - Date.now()) / 1000));
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [targetAt]);

  return remaining;
}

// ── Fatal banner ───────────────────────────────────────────────────

interface FatalBannerProps {
  state: Extract<DraftClientState, { kind: 'fatal' }>;
  onRetryNow?: () => void;
}

function FatalBanner({ state, onRetryNow }: FatalBannerProps) {
  if (state.reason === 'auth_failure') {
    return (
      <Alert variant="destructive" role="alert" data-banner-kind="fatal-auth">
        <AlertTitle>You’re no longer authorized to access this draft</AlertTitle>
        <AlertDescription>
          {state.errorMessage}
          {' '}
          {/* T11a link fix (2026-08-09): `/dashboard` route does not
              exist. auth_failure users need to sign back in — link to
              /auth directly (was silently 404'ing to NotFound). */}
          <Link to="/auth" className="underline font-medium">
            Sign in again
          </Link>
        </AlertDescription>
      </Alert>
    );
  }
  if (state.reason === 'invalid_lobby') {
    return (
      <Alert role="alert" data-banner-kind="fatal-lobby">
        <AlertTitle>This draft is no longer available</AlertTitle>
        <AlertDescription>
          {state.errorMessage}
          {' '}
          {/* T11a link fix (2026-08-09): `/dashboard` route does not
              exist. invalid_lobby users are authenticated — link to
              /gm-office (the closest existing "dashboard" route; if
              unauth'd via ProtectedRoute it redirects to /auth). */}
          <Link to="/gm-office" className="underline font-medium">
            Back to GM Office
          </Link>
        </AlertDescription>
      </Alert>
    );
  }
  // DR-4 (2026-07-30) — 4400 waiting-room disposition. Server returns
  // this when the draft schedule is up but the draft_order hasn't been
  // configured yet (commissioner still setting up). Toast copy already
  // reads "This draft hasn't been set up yet"; the banner now matches
  // instead of silently falling through to the generic-server case.
  // Auto-retry stays OFF (per DR-2 disposition ruling); user clicks
  // Retry when the commissioner signals they're done.
  if (state.reason === 'draft_not_initialized') {
    return (
      <Alert role="alert" data-banner-kind="fatal-not-initialized">
        <AlertTitle>Waiting on your commissioner</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>
            This draft hasn’t been set up yet — your commissioner still
            needs to set the draft order. Check back shortly.
          </span>
          {onRetryNow && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetryNow}
            >
              Retry now
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  // DR-4 (2026-07-30) — permanent_server_error rewrite per architect
  // ruling: never write copy that promises behavior the code doesn't
  // perform (invariant I2 generalizes beyond the clock). This
  // disposition does NOT auto-retry, so the copy must not say "we'll
  // keep trying". Retry is manual; technical details collapsed and
  // opt-in.
  return (
    <Alert variant="destructive" role="alert" data-banner-kind="fatal-server">
      <AlertTitle>Can’t reach the draft server</AlertTitle>
      <AlertDescription className="space-y-2">
        <div>
          The draft server isn’t reachable right now. Tap Retry to try
          again — your picks are safe.
        </div>
        <div className="flex items-center gap-2">
          {onRetryNow && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetryNow}
            >
              Retry now
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Reload page
          </Button>
        </div>
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Technical details
          </summary>
          <pre className="text-xs mt-2 whitespace-pre-wrap text-muted-foreground">
            {state.errorMessage}
          </pre>
        </details>
      </AlertDescription>
    </Alert>
  );
}
