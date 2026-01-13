import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Auth Callback Page
 * Handles email verification and OAuth callbacks from Supabase
 */
const AuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshProfile } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your email...');

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Get the hash fragment from URL (Supabase sends tokens in hash)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');
        const error = hashParams.get('error');
        const errorDescription = hashParams.get('error_description');

        // Check for error in hash
        if (error) {
          console.error('Auth callback error:', error, errorDescription);
          setStatus('error');
          setMessage(errorDescription || error || 'Verification failed. Please try again.');
          setTimeout(() => navigate('/auth'), 3000);
          return;
        }

        // Check for error in query params (some flows use query params)
        const queryError = searchParams.get('error');
        if (queryError) {
          console.error('Auth callback error (query):', queryError);
          setStatus('error');
          setMessage('Verification failed. Please try again.');
          setTimeout(() => navigate('/auth'), 3000);
          return;
        }

        // If we have tokens in hash, set the session
        if (accessToken && refreshToken) {
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionError) {
            console.error('Error setting session:', sessionError);
            setStatus('error');
            setMessage(sessionError.message || 'Failed to verify email. Please try again.');
            setTimeout(() => navigate('/auth'), 3000);
            return;
          }

          if (data?.session) {
            // Successfully verified and signed in
            setStatus('success');
            setMessage('Email verified! Redirecting...');
            
            // Refresh profile to ensure it's loaded
            if (data.user) {
              await refreshProfile();
            }
            
            // Redirect to profile setup or home
            setTimeout(() => {
              navigate('/profile-setup');
            }, 1500);
          } else {
            setStatus('error');
            setMessage('Verification completed but session not created. Please sign in.');
            setTimeout(() => navigate('/auth'), 3000);
          }
        } else if (type === 'signup' || type === 'email') {
          // Email verification link clicked but no tokens yet
          // Try to get the session (might already be set)
          const { data: { session } } = await supabase.auth.getSession();
          
          if (session) {
            setStatus('success');
            setMessage('Email verified! Redirecting...');
            await refreshProfile();
            setTimeout(() => navigate('/profile-setup'), 1500);
          } else {
            // No session - might need to sign in
            setStatus('error');
            setMessage('Please sign in to complete verification.');
            setTimeout(() => navigate('/auth'), 3000);
          }
        } else {
          // No tokens and no type - might be a direct navigation
          setStatus('error');
          setMessage('Invalid verification link. Please check your email and try again.');
          setTimeout(() => navigate('/auth'), 3000);
        }
      } catch (err: unknown) {
        console.error('Auth callback error:', err);
        setStatus('error');
        const errorMessage = err instanceof Error ? err.message : 'An error occurred during verification.';
        setMessage(errorMessage);
        setTimeout(() => navigate('/auth'), 3000);
      }
    };

    handleAuthCallback();
  }, [navigate, searchParams, refreshProfile]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === 'loading' && <Loader2 className="h-5 w-5 animate-spin" />}
            {status === 'success' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
            {status === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
            {status === 'loading' && 'Verifying Email'}
            {status === 'success' && 'Email Verified'}
            {status === 'error' && 'Verification Failed'}
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

