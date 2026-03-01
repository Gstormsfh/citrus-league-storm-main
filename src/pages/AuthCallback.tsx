import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
 */
const AuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing sign-in...');
  const handled = useRef(false);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // AuthContext's own onAuthStateChange listener already calls
    // fetchProfile() on SIGNED_IN, so we only need to navigate here.
    const succeed = (msg: string) => {
      if (!mounted || handled.current) return;
      handled.current = true;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
      setStatus('success');
      setMessage(msg);
      setTimeout(() => {
        if (mounted) navigate('/profile-setup');
      }, 1500);
    };

    const fail = (msg: string) => {
      if (!mounted || handled.current) return;
      handled.current = true;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
      setStatus('error');
      setMessage(msg);
      setTimeout(() => {
        if (mounted) navigate('/auth');
      }, 3000);
    };

    const handleAuthCallback = async () => {
      try {
        // ----- Check for errors first (both hash and query params) -----
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const hashError = hashParams.get('error');
        const hashErrorDescription = hashParams.get('error_description');

        if (hashError) {
          fail(hashErrorDescription || hashError || 'Authentication failed. Please try again.');
          return;
        }

        const queryError = searchParams.get('error');
        const queryErrorDescription = searchParams.get('error_description');
        if (queryError) {
          fail(queryErrorDescription || 'Authentication failed. Please try again.');
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
          fail('Sign-in timed out. Please try again.');
        }, 10000);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'An error occurred during authentication.';
        fail(errorMessage);
      }
    };

    handleAuthCallback();

    return () => {
      mounted = false;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
    // Note: navigate and searchParams are stable refs from React Router.
    // refreshProfile was intentionally removed — AuthContext's own
    // onAuthStateChange handler fetches the profile on SIGNED_IN.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#D4E8B8] p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === 'loading' && <Loader2 className="h-5 w-5 animate-spin" />}
            {status === 'success' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
            {status === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
            {status === 'loading' && 'Signing In'}
            {status === 'success' && 'Success'}
            {status === 'error' && 'Sign-In Failed'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Please wait...</p>
            </div>
          )}
          {status === 'error' && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-muted-foreground">You will be redirected to the sign-in page.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AuthCallback;
