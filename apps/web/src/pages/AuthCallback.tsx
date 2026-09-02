import { userMessage } from '@/lib/userMessage';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DarkLayout, MascotAvatar } from '@/components/citrus2';

/**
 * Auth Callback Page
 * Handles email verification and OAuth callbacks from Supabase.
 *
 * The Supabase client is configured with `detectSessionInUrl: true` and
 * `flowType: 'pkce'`, so it automatically exchanges PKCE codes and
 * implicit-flow tokens from the URL. This component does NOT manually
 * call `exchangeCodeForSession` — doing so would race with the
 * auto-detect and cause "code verifier not found" errors.
 *
 * Instead we:
 *   1. Check for error params in the URL (OAuth denied, expired link, etc.)
 *   2. Listen for `onAuthStateChange` SIGNED_IN (registered BEFORE getSession
 *      to avoid missing events during the PKCE exchange)
 *   3. Check if a session already exists (auto-detect may have finished)
 *   4. Time out after 10 s if nothing happens
 *
 * Redirects use window.location.replace() rather than React Router's
 * navigate() to avoid races with effect cleanup / component re-renders
 * that can swallow the navigation.
 */
const AuthCallback = () => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing sign-in...');
  const handled = useRef(false);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const succeed = (msg: string) => {
      if (!mounted || handled.current) return;
      handled.current = true;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
      setStatus('success');
      setMessage(msg);
      // Pull the redirect that was stashed BEFORE the OAuth handoff —
      // Google strips query params from the callback URL, so we can't
      // read ?redirect= here. sessionStorage survives the round trip.
      let destination = '/';
      try {
        const stashed = sessionStorage.getItem('citrus:postAuthRedirect');
        if (stashed && stashed.startsWith('/')) {
          destination = stashed;
          sessionStorage.removeItem('citrus:postAuthRedirect');
        }
      } catch { /* storage disabled — default to home */ }
      // Hard redirect — immune to React lifecycle / effect cleanup races.
      // AuthContext will pick up the session from localStorage on reload.
      setTimeout(() => window.location.replace(destination), 1500);
    };

    const fail = (msg: string) => {
      if (!mounted || handled.current) return;
      handled.current = true;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
      setStatus('error');
      setMessage(msg);
      setTimeout(() => window.location.replace('/auth'), 3000);
    };

    const handleAuthCallback = async () => {
      try {
        // ----- Check for errors first (both hash and query params) -----
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const hashError = hashParams.get('error');
        const hashErrorDescription = hashParams.get('error_description');

        if (hashError) {
          fail(hashErrorDescription || hashError || "Sign-in didn't finish. Head back and try again.");
          return;
        }

        const queryParams = new URLSearchParams(window.location.search);
        const queryError = queryParams.get('error');
        const queryErrorDescription = queryParams.get('error_description');
        if (queryError) {
          fail(queryErrorDescription || "Sign-in didn't finish. Head back and try again.");
          return;
        }

        // ----- Register listener BEFORE getSession to avoid race -----
        // detectSessionInUrl may fire SIGNED_IN while getSession() is
        // in-flight; subscribing first guarantees we never miss it.
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session) {
            succeed('Signed in! Redirecting...');
          }
        });
        subscription = data.subscription;

        // ----- Check if detectSessionInUrl already established a session -----
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          succeed('Signed in! Redirecting...');
          return;
        }

        // ----- Timeout after 10 seconds -----
        timeoutId = setTimeout(() => {
          fail("Sign-in took too long. Head back and try again.");
        }, 10000);
      } catch (err: unknown) {
        const errorMessage = userMessage(err, "Sign-in hit a snag. Head back and try again.");
        fail(errorMessage);
      }
    };

    handleAuthCallback();

    return () => {
      mounted = false;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  return (
    <DarkLayout>
      <main className="min-h-screen flex items-center justify-center p-4 relative">
        <Card className="w-full max-w-md bg-pastel-surface-tile border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-3">
              <MascotAvatar id="stormy" size="lg" />
            </div>
            <CardTitle className="flex items-center justify-center gap-2 text-pastel-cream">
              {status === 'loading' && <Loader2 className="h-5 w-5 animate-spin text-pastel-orange-soft" aria-hidden="true" />}
              {status === 'success' && <CheckCircle2 className="h-5 w-5 text-pastel-sage" aria-hidden="true" />}
              {status === 'error' && <XCircle className="h-5 w-5 text-pastel-orange" aria-hidden="true" />}
              {status === 'loading' && 'Signing you in'}
              {status === 'success' && 'Welcome to Citrus'}
              {status === 'error' && "Sign-In Snag"}
            </CardTitle>
            <CardDescription className="text-white/60">{message}</CardDescription>
          </CardHeader>
          <CardContent>
            {status === 'loading' && (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-pastel-orange-soft" />
                <p className="text-sm text-white/55">Stormy is checking you in...</p>
              </div>
            )}
            {status === 'error' && (
              <div className="flex flex-col items-center gap-4">
                <p className="text-sm text-white/55">You will be redirected to the sign-in page.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </DarkLayout>
  );
};

export default AuthCallback;
