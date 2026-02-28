import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Auth Callback Page
 * Handles email verification and OAuth callbacks from Supabase.
 *
 * Two auth flows land here:
 *   1. **PKCE OAuth** (Google / Apple) — Supabase redirects with `?code=…`
 *      We call `exchangeCodeForSession(code)` to complete the handshake.
 *   2. **Email verification / Implicit flow** — Supabase redirects with
 *      tokens in the URL hash (`#access_token=…&refresh_token=…`).
 */
const AuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshProfile } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing sign-in...');

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // ----- Check for errors first (both hash and query params) -----
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const hashError = hashParams.get('error');
        const hashErrorDescription = hashParams.get('error_description');

        if (hashError) {
          setStatus('error');
          setMessage(hashErrorDescription || hashError || 'Authentication failed. Please try again.');
          setTimeout(() => navigate('/auth'), 3000);
          return;
        }

        const queryError = searchParams.get('error');
        const queryErrorDescription = searchParams.get('error_description');
        if (queryError) {
          setStatus('error');
          setMessage(queryErrorDescription || 'Authentication failed. Please try again.');
          setTimeout(() => navigate('/auth'), 3000);
          return;
        }

        // ----- Flow 1: PKCE OAuth code exchange -----
        const code = searchParams.get('code');
        if (code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

          if (exchangeError) {
            setStatus('error');
            setMessage(exchangeError.message || 'Failed to complete sign-in. Please try again.');
            setTimeout(() => navigate('/auth'), 3000);
            return;
          }

          if (data?.session) {
            setStatus('success');
            setMessage('Signed in! Redirecting...');
            if (data.user) {
              await refreshProfile();
            }
            setTimeout(() => navigate('/profile-setup'), 1500);
            return;
          }

          // Code was present but no session came back
          setStatus('error');
          setMessage('Sign-in completed but session not created. Please try again.');
          setTimeout(() => navigate('/auth'), 3000);
          return;
        }

        // ----- Flow 2: Implicit / email verification (tokens in hash) -----
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');

        if (accessToken && refreshToken) {
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionError) {
            setStatus('error');
            setMessage(sessionError.message || 'Failed to verify email. Please try again.');
            setTimeout(() => navigate('/auth'), 3000);
            return;
          }

          if (data?.session) {
            setStatus('success');
            setMessage('Email verified! Redirecting...');
            if (data.user) {
              await refreshProfile();
            }
            setTimeout(() => navigate('/profile-setup'), 1500);
          } else {
            setStatus('error');
            setMessage('Verification completed but session not created. Please sign in.');
            setTimeout(() => navigate('/auth'), 3000);
          }
          return;
        }

        // ----- Flow 2b: Email verification type without tokens -----
        if (type === 'signup' || type === 'email') {
          const { data: { session } } = await supabase.auth.getSession();

          if (session) {
            setStatus('success');
            setMessage('Email verified! Redirecting...');
            await refreshProfile();
            setTimeout(() => navigate('/profile-setup'), 1500);
          } else {
            setStatus('error');
            setMessage('Please sign in to complete verification.');
            setTimeout(() => navigate('/auth'), 3000);
          }
          return;
        }

        // ----- Fallback: detectSessionInUrl may have already handled it -----
        // Give Supabase client a moment to process the URL automatically
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setStatus('success');
          setMessage('Signed in! Redirecting...');
          await refreshProfile();
          setTimeout(() => navigate('/profile-setup'), 1500);
          return;
        }

        // Nothing worked — bad link or direct navigation
        setStatus('error');
        setMessage('Invalid or expired link. Please try signing in again.');
        setTimeout(() => navigate('/auth'), 3000);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'An error occurred during authentication.';
        setStatus('error');
        setMessage(errorMessage);
        setTimeout(() => navigate('/auth'), 3000);
      }
    };

    handleAuthCallback();
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
