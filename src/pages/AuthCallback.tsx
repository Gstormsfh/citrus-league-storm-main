import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
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
 *   2. Check if a session already exists (auto-detect may have finished)
 *   3. Listen for `onAuthStateChange` SIGNED_IN in case it hasn't yet
 *   4. Time out after 10 s if nothing happens
 */
const AuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshProfile } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing sign-in...');
  const handled = useRef(false);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const succeed = async (msg: string) => {
      if (!mounted || handled.current) return;
      handled.current = true;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
      setStatus('success');
      setMessage(msg);
      await refreshProfile();
      if (mounted) setTimeout(() => navigate('/profile-setup'), 1500);
    };

    const fail = (msg: string) => {
      if (!mounted || handled.current) return;
      handled.current = true;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
      setStatus('error');
      setMessage(msg);
      setTimeout(() => navigate('/auth'), 3000);
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

        // ----- Check if detectSessionInUrl already established a session -----
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await succeed('Signed in! Redirecting...');
          return;
        }

        // ----- Listen for session to be established -----
        // detectSessionInUrl may still be processing the PKCE code or hash tokens
        const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session) {
            await succeed('Signed in! Redirecting...');
          }
        });
        subscription = data.subscription;

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
  }, [navigate, searchParams, refreshProfile]);

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
