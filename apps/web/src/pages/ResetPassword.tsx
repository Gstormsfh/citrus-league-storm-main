import { userMessage } from '@/lib/userMessage';
import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Lock, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { DarkLayout } from '@/components/citrus2';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { updatePassword } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [checking, setChecking] = useState(true);

  /*
   * WHAT A RECOVERY LINK ACTUALLY DELIVERS (fixed 2026-08-26)
   *
   * The client is configured with `flowType: 'pkce'` and
   * `detectSessionInUrl: true` (integrations/supabase/client.ts). Under PKCE,
   * Supabase's recovery mail lands here with **`?code=`**, and supabase-js
   * exchanges it automatically on load and then STRIPS it from the URL.
   *
   * This effect used to look for two things that PKCE never produces:
   *   • `#access_token` + `type=recovery` — the implicit flow, dead since PKCE
   *   • `?token=`                         — the older verify style, also dead
   *
   * So `hasToken` stayed false for everybody, the form below was gated behind
   * it, and every single user who clicked a reset link was told the link was
   * invalid — including the ones whose session had just been established
   * successfully a few milliseconds earlier. Requesting a fresh link produced
   * the identical dead end. There was no path through.
   *
   * AuthCallback.tsx, the sibling page, already had this right and says so in
   * its header comment. This is the same approach: watch for the SESSION,
   * which is the thing that actually proves the link was good, rather than for
   * a URL parameter whose shape depends on the flow.
   *
   * Ordering matters. The listener is registered BEFORE getSession() because
   * detectSessionInUrl's exchange can complete while we are awaiting, and the
   * event would be missed by a listener attached afterwards.
   */
  useEffect(() => {
    let accepted = false;

    const accept = () => {
      accepted = true;
      setHasToken(true);
      setChecking(false);
      setError(null);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (!!session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION'))) {
        accept();
      }
    });

    // Legacy link shapes. Kept because an email sent before PKCE was enabled
    // may still be sitting in somebody's inbox, and honouring it costs nothing.
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get('access_token') && hashParams.get('type') === 'recovery') {
      accept();
    } else if (searchParams.get('token')) {
      accept();
    }

    // A session may already exist — either the exchange finished before this
    // ran, or the user is signed in and came here to change their password
    // deliberately, which is a legitimate way to reach this page.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session) accept();
      })
      .catch(() => {
        /* fall through to the timeout below */
      });

    // Give the exchange room to finish before calling the link bad. accept()
    // is still live after this fires, so a slow exchange corrects the message
    // rather than being locked out by it.
    const timer = setTimeout(() => {
      if (accepted) return;
      setChecking(false);
      setError('Invalid or expired reset link. Please request a new password reset.');
    }, 6000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const { error } = await updatePassword(password);

      if (error) {
        setError(error.message || 'Failed to update password. The link may have expired.');
      } else {
        setSuccess(true);
        setTimeout(() => {
          navigate('/auth');
        }, 2000);
      }
    } catch (err: unknown) {
      const errorMessage = userMessage(err, 'An unexpected error occurred.');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      // S-1 Entry 21 P-c conformance fix (2026-08-09): success branch
      // previously rendered `bg-gradient-to-b from-background to-muted/20`
      // — a light-theme gradient — causing a jarring flash of light UI
      // between password submit and /auth redirect. All other branches
      // of this file (and every auth page) use DarkLayout. Now unified.
      <DarkLayout>
        <Navbar />
        <main className="relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)]">
          <Card className="w-full max-w-md bg-[#1A2A20] border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-pastel-cream">
                <CheckCircle2 className="h-5 w-5 text-pastel-sage" aria-hidden="true" />
                Password Reset Successful
              </CardTitle>
              <CardDescription className="text-white/60">Your password has been updated successfully.</CardDescription>
            </CardHeader>
            <CardContent>
              <Alert className="bg-pastel-sage/15 ring-1 ring-pastel-sage/40 border-0 text-pastel-sage-soft">
                <AlertDescription>Redirecting to sign in…</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </main>
      </DarkLayout>
    );
  }

  if (checking && !hasToken) {
    // The PKCE exchange is asynchronous. Rendering the failure card while it is
    // still running is how a working link gets reported as broken.
    return (
      <DarkLayout>
        <Navbar />
        <main className="relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)]">
          <Card className="w-full max-w-md bg-pastel-surface-tile border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
            <CardContent className="flex items-center gap-3 py-8">
              <Loader2 className="h-5 w-5 animate-spin text-pastel-orange" aria-hidden="true" />
              <span className="text-pastel-cream">Checking your reset link…</span>
            </CardContent>
          </Card>
        </main>
      </DarkLayout>
    );
  }

  if (!hasToken) {
    return (
      <DarkLayout>
        <Navbar />
        <main className="relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)]">
          <Card className="w-full max-w-md bg-pastel-surface-tile border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-pastel-cream">
                <XCircle className="h-5 w-5 text-pastel-orange" aria-hidden="true" />
                Invalid Reset Link
              </CardTitle>
              <CardDescription className="text-white/60">{error || 'This password reset link is invalid or has expired.'}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate('/auth')} className="w-full bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft">
                Return to Sign In
              </Button>
            </CardContent>
          </Card>
        </main>
      </DarkLayout>
    );
  }

  return (
    <DarkLayout>
      <Navbar />
      <main className="relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)]">
        <Card className="w-full max-w-md bg-pastel-surface-tile border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-pastel-cream">Reset Your Password</CardTitle>
            <CardDescription className="text-white/60">Enter your new password below</CardDescription>
          </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                  minLength={8}
                />
              </div>
              {password && <PasswordStrength password={password} />}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Updating password…
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
      </main>
    </DarkLayout>
  );
};

export default ResetPassword;
