/**
 * Yahoo sends the browser back here with a code and the state Citrus
 * minted. The page hands both to the API under the user's own session,
 * which is what makes a code redeemable only by the person who started the
 * sign-in, then returns to the import page. Nothing from Yahoo is kept in
 * the browser.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { importApi } from '@/api/imports';
import Navbar from '@/components/Navbar';
import { PressBoxAppHeader } from '@/components/pressbox/AppHeader';
import { EmptyState, HistoryButton } from '@/components/history/ui';

export default function ImportYahooCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const code = params.get('code');
  const state = params.get('state');
  const denied = params.get('error');

  useEffect(() => {
    if (loading || started.current) return;
    if (denied) { setError('Yahoo did not grant access. Nothing was connected.'); return; }
    if (!code || !state) { setError('That link is missing what Yahoo should have sent. Start the sign-in again.'); return; }
    if (!user) return; // ProtectedRoute sends a signed-out visitor to /auth and back here
    started.current = true;
    importApi.yahooCallback(code, state)
      .then(() => navigate('/import?yahoo=connected', { replace: true }))
      .catch((e: Error) => setError(e.message || 'Yahoo did not accept the sign-in.'));
  }, [code, state, denied, user, loading, navigate]);

  return (
    <div className="min-h-screen bg-pressbox-surface text-pressbox-text flex flex-col">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden pt-[var(--safe-area-inset-top,env(safe-area-inset-top))]">
        <PressBoxAppHeader title="Yahoo" logoSrc="/favicon.svg" />
      </div>
      <main className="pb-app-chrome lg:pt-app-header">
        <div className="pb-type mx-auto w-full max-w-md px-3.5 pt-8 lg:px-6">
          {error ? (
            <EmptyState
              kicker="Not connected"
              primary="Yahoo sign-in didn't finish."
              context={error}
              action={<Link to="/import"><HistoryButton>Back to import</HistoryButton></Link>}
            />
          ) : (
            <EmptyState kicker="Yahoo" primary="Connecting your account…" context="One moment." />
          )}
        </div>
      </main>
    </div>
  );
}
