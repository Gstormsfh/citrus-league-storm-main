import { useState, useEffect, useRef } from 'react';
import Navbar from '@/components/Navbar';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { UserAccountService } from '@/services/UserAccountService';
import { logger } from '@citrus/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Mail, Lock, HelpCircle, Chrome, CheckCircle2 } from 'lucide-react';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { Separator } from '@/components/ui/separator';
import { DarkLayout, MascotAvatar } from '@/components/citrus2';

const Auth = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signIn, signUp, resetPassword, signInWithOAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const signInSafetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up safety timeout on unmount (e.g., when redirect navigates away)
  useEffect(() => {
    return () => {
      if (signInSafetyTimeoutRef.current) {
        clearTimeout(signInSafetyTimeoutRef.current);
      }
    };
  }, []);

  // CRITICAL: stash ?redirect= in sessionStorage on every Auth-page mount.
  // This preserves the destination across EVERY sign-in method, including:
  //   - Email/password (reads from window.location.search — already works)
  //   - OAuth (Google strips query params on callback)
  //   - Email signup that requires verification (user leaves /auth entirely,
  //     comes back via /auth/callback with no query params)
  // Without this stash, invite-link users who sign up (vs. sign in) land
  // on the homepage after verifying their email — infuriating UX.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      if (redirect && redirect.startsWith('/')) {
        sessionStorage.setItem('citrus:postAuthRedirect', redirect);
      }
    } catch { /* storage disabled — defaults still work for signin path */ }
  }, []);

  // Reactive redirect: once AuthContext commits user state, navigate away.
  // Honors ?redirect=<path> so share-link flows survive the auth round trip.
  useEffect(() => {
    if (!authLoading && user) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      navigate(redirect && redirect.startsWith('/') ? redirect : '/', { replace: true });
    }
  }, [user, authLoading, navigate]);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const getBetterErrorMessage = (errorMessage: string): string => {
    const lower = errorMessage.toLowerCase();

    if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
      return 'Invalid email or password. Please check and try again.';
    }
    if (lower.includes('already registered') || lower.includes('already exists') || lower.includes('already in use')) {
      return 'This email already has an account. Please sign in instead.';
    }
    if (lower.includes('email not confirmed') || lower.includes('email not verified')) {
      return 'Please verify your email address. Check your inbox for the verification link.';
    }
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return 'Too many attempts. Please wait a few minutes before trying again.';
    }
    if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
      return 'This sign-in method is not available yet. Please use email and password to sign in.';
    }
    if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) {
      return 'Sign-ups are temporarily disabled. Please try again later or contact support.';
    }
    if (lower.includes('validation_failed') || lower.includes('validation failed')) {
      return 'Sign-up could not be completed. Please try again.';
    }
    if (lower.includes('password')) {
      return errorMessage;
    }
    // Only treat as invalid email if the error specifically says the email format is bad.
    // Otherwise pass the original Supabase message through so users see the real cause
    // (previously any error containing "email" was mis-labeled as "Invalid email address").
    if (lower.includes('invalid email') || lower.includes('email format') || lower.includes('malformed email')) {
      return 'Invalid email address. Please check and try again.';
    }

    return errorMessage;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      // If "Invalid credentials", check whether the email actually exists
      // but was created via OAuth (no password). Industry standard UX.
      const isInvalidCreds = error.message?.toLowerCase().includes('invalid') || error.message?.toLowerCase().includes('credentials');
      if (isInvalidCreds) {
        try {
          const apiBase = import.meta.env.VITE_API_URL || '';
          const res = await fetch(`${apiBase}/api/auth/check-method`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          const info = (await res.json())?.data || (await res.json());
          if (info?.exists && !info.has_password) {
            const oauthProviders = (info.providers || []).filter((p: string) => p !== 'email');
            if (oauthProviders.includes('google')) {
              setError("This email was registered with Google. Click 'Sign in with Google' above to continue.");
              setLoading(false);
              return;
            }
            if (oauthProviders.length > 0) {
              setError(`This email was registered with ${oauthProviders[0]}. Use that option above to sign in.`);
              setLoading(false);
              return;
            }
          }
        } catch { /* silently fall through to generic error */ }
      }
      setError(getBetterErrorMessage(error.message));
      setLoading(false);
      return;
    }

    // On success: explicitly verify the session and navigate.
    // Don't rely solely on the useEffect watching `user` — onAuthStateChange
    // can race with the redirect, leaving users in guest mode briefly and
    // forcing them to sign in again.
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session) {
        // Re-set the session to force the listener to fire, then navigate.
        await supabase.auth.setSession({
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
        });
        setTimeout(() => {
          const params = new URLSearchParams(window.location.search);
          const redirect = params.get('redirect');
          navigate(redirect && redirect.startsWith('/') ? redirect : '/', { replace: true });
        }, 50);
        return;
      }
    } catch (sessionError) {
      logger.warn('Post-sign-in session verification failed', sessionError);
    }

    // Safety: if somehow we got here without a session, re-enable the button
    signInSafetyTimeoutRef.current = setTimeout(() => {
      setLoading(false);
    }, 4000);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (!tosAccepted) {
      setError('You must agree to the Terms of Service and Privacy Policy');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await signUp(email, password);
      
      if (error) {
        let errorMessage = getBetterErrorMessage(error.message || 'An error occurred during signup');
        
        if (error.message?.toLowerCase().includes('already registered') || 
            error.message?.toLowerCase().includes('already exists') ||
            error.message?.toLowerCase().includes('user already registered') ||
            error.message?.toLowerCase().includes('email address is already in use')) {
          errorMessage = 'This email already has an account. Please sign in instead.';
        }
        
        setError(errorMessage);
        setLoading(false);
        return;
      }
      
      // Record consent for ToS and Privacy Policy (best-effort)
      if (data?.session || data?.user) {
        UserAccountService.recordConsent('terms_of_service', '2026-01-13');
        UserAccountService.recordConsent('privacy_policy', '2026-01-13');
      }

      // If email confirmation is required (no session), navigate to verify page
      if (data?.user && !data?.session) {
        navigate('/verify-email', { state: { email }, replace: true });
      } else if (data?.session) {
        // Session is already set in the supabase client by signInWithPassword.
        // Navigate immediately — don't wait for onAuthStateChange to fire the
        // listener that sets React user state. The race was causing users to
        // see guest mode briefly, then have to sign in again.
        // Force-refresh the session once to guarantee AuthContext picks it up,
        // then navigate with replace so Back doesn't return to /auth.
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        // Let the state propagate one tick before redirecting
        setTimeout(() => {
          const params = new URLSearchParams(window.location.search);
          const redirect = params.get('redirect');
          navigate(redirect && redirect.startsWith('/') ? redirect : '/', { replace: true });
        }, 50);
      } else {
        navigate('/verify-email', { state: { email }, replace: true });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.';
      setError(errorMessage);
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!resetEmail || !validateEmail(resetEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setResetLoading(true);
    setError(null);

    try {
      const { error } = await resetPassword(resetEmail);
      
      if (error) {
        setError(getBetterErrorMessage(error.message || 'Failed to send reset email'));
      } else {
        setResetSuccess(true);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
    } finally {
      setResetLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: 'google') => {
    setOauthLoading(provider);
    setError(null);

    // Redirect is already stashed in sessionStorage on Auth-page mount.
    // AuthCallback reads it back after the OAuth round-trip.

    try {
      const { error } = await signInWithOAuth(provider);
      
      if (error) {
        setError(getBetterErrorMessage(error.message || `Failed to sign in with ${provider}`));
        setOauthLoading(null);
      }
      // OAuth redirects away, so we don't need to handle success here
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
      setOauthLoading(null);
    }
  };

  return (
    <DarkLayout>
      <Navbar />
      <main className="relative flex items-center justify-center p-4 py-12 min-h-[calc(100vh-68px)]">
        <Card className="w-full max-w-md bg-[#1A2A20] border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
          <CardHeader className="space-y-3 text-center">
            <div className="flex justify-center mb-2">
              <MascotAvatar id="stormy" size="lg" />
            </div>
            <CardTitle className="text-2xl font-black text-pastel-cream tracking-[-0.02em]">
              Welcome to <span className="text-pastel-orange">Citrus</span>
            </CardTitle>
            <CardDescription className="text-white/60">
              Sign in or create an account · Lock in founders pricing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
              
              <TabsContent value="signin" className="space-y-4">
                {/* OAuth Buttons */}
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => handleOAuthSignIn('google')}
                    disabled={loading || oauthLoading !== null}
                  >
                    {oauthLoading === 'google' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Chrome className="mr-2 h-4 w-4" />
                    )}
                    Sign in with Google
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
                  </div>
                </div>

                <form onSubmit={handleSignIn} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setError(null);
                        }}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="signin-password">Password</Label>
                      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                        <DialogTrigger asChild>
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                            onClick={() => {
                              setResetEmail(email);
                              setResetSuccess(false);
                              setError(null);
                            }}
                          >
                            <HelpCircle className="h-3 w-3" />
                            Forgot password?
                          </button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Reset Password</DialogTitle>
                            <DialogDescription>
                              Enter your email address and we'll send you a link to reset your password.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            {resetSuccess ? (
                              <Alert>
                                <AlertDescription>
                                  Password reset email sent! Check your inbox and click the link to reset your password.
                                </AlertDescription>
                              </Alert>
                            ) : (
                              <>
                                <div className="space-y-2">
                                  <Label htmlFor="reset-email">Email</Label>
                                  <Input
                                    id="reset-email"
                                    type="email"
                                    placeholder="you@example.com"
                                    value={resetEmail}
                                    onChange={(e) => setResetEmail(e.target.value)}
                                    required
                                  />
                                </div>
                                {error && (
                                  <Alert variant="destructive">
                                    <AlertDescription>{error}</AlertDescription>
                                  </Alert>
                                )}
                                <Button
                                  onClick={handleForgotPassword}
                                  disabled={resetLoading}
                                  className="w-full"
                                >
                                  {resetLoading ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      Sending...

                                  ) : (
                                    'Send Reset Link'
                                  )}
                                </Button>

                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signin-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setError(null);
                        }}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>

                  <Button type="submit" className="w-full" disabled={loading || oauthLoading !== null}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...

                    ) : (
                      'Sign In'
                    )}
                  </Button>
                </form>
              </TabsContent>
              
              <TabsContent value="signup" className="space-y-4">
                {/* OAuth Buttons */}
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => handleOAuthSignIn('google')}
                    disabled={loading || oauthLoading !== null}
                  >
                    {oauthLoading === 'google' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Chrome className="mr-2 h-4 w-4" />
                    )}
                    Sign up with Google
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
                  </div>
                </div>

                <form onSubmit={handleSignUp} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setError(null);
                        }}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setError(null);
                        }}
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
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="confirm-password"
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          setError(null);
                        }}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <Checkbox
                      id="tos-accept"
                      checked={tosAccepted}
                      onCheckedChange={(checked) => setTosAccepted(checked as boolean)}
                    />
                    <Label htmlFor="tos-accept" className="text-sm font-normal cursor-pointer leading-tight">
                      I agree to the{' '}
                      <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        Terms of Service
                      </a>{' '}
                      and{' '}
                      <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        Privacy Policy
                      </a>
                    </Label>
                  </div>

                  <Button type="submit" className="w-full" disabled={loading || oauthLoading !== null || !tosAccepted}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating account...

                    ) : (
                      'Sign Up'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </DarkLayout>
  );
};

export default Auth;
