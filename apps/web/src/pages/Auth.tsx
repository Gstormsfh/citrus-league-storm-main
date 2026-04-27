import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { UserAccountService } from '@/services/UserAccountService';
import { logger } from '@citrus/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Mail, Lock, HelpCircle, Chrome, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import Navbar from '@/components/Navbar';
import {
  DarkLayout,
  CitrusCard,
  CitrusButton,
  StormyWelcomeScene,
} from '@/components/citrus2';

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

  // Shared input styling for the dark theme — applied via className so the
  // shadcn Input keeps its forwardRef + hookform wiring intact.
  const darkInputClass =
    'bg-[#0F1F15] border-white/10 text-pastel-cream placeholder:text-white/35 focus-visible:ring-pastel-orange/40 focus-visible:border-pastel-orange/50 h-11';

  return (
    <DarkLayout>
      <Navbar />
      <main className="relative w-full max-w-[1280px] mx-auto px-4 sm:px-6 pt-24 pb-16 lg:py-16 min-h-[calc(100vh-92px)]">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-6 lg:gap-10 items-stretch">
          {/* LEFT — Stormy welcome scene (full hero, not a corner peek) */}
          <div className="order-1 lg:order-1">
            <StormyWelcomeScene size="xl" className="h-full" />
          </div>

          {/* RIGHT — sign in / sign up form */}
          <div className="order-2 lg:order-2 flex items-center">
            <div className="w-full">
              <div className="mb-6">
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold">
                  Get on the ice
                </div>
                <h1 className="font-sans font-black text-[2rem] md:text-[2.5rem] tracking-[-0.025em] text-pastel-cream leading-[1.05]">
                  Welcome to <span className="text-pastel-orange">Citrus</span>.
                </h1>
                <p className="text-[14px] text-white/55 mt-2 leading-relaxed">
                  Sign in or create an account · Lock in founders pricing
                </p>
              </div>

              <CitrusCard padding="spacious" accent="orange">
                <Tabs defaultValue="signin" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 bg-[#0F1F15] h-11 ring-1 ring-white/10 mb-6">
                    <TabsTrigger
                      value="signin"
                      className="text-[13px] font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-white text-white/55"
                    >
                      Sign In
                    </TabsTrigger>
                    <TabsTrigger
                      value="signup"
                      className="text-[13px] font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-white text-white/55"
                    >
                      Sign Up
                    </TabsTrigger>
                  </TabsList>

                  {/* ── SIGN IN ─────────────────────────────────────── */}
                  <TabsContent value="signin" className="space-y-4 mt-0">
                    <CitrusButton
                      type="button"
                      variant="secondary"
                      size="lg"
                      fullWidth
                      onClick={() => handleOAuthSignIn('google')}
                      disabled={loading || oauthLoading !== null}
                      loading={oauthLoading === 'google'}
                    >
                      {oauthLoading !== 'google' && <Chrome className="w-4 h-4" />}
                      Sign in with Google
                    </CitrusButton>

                    <div className="relative py-2">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full h-px bg-white/10" />
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-[#1A2A20] px-3 font-jbmono text-[10px] uppercase tracking-[0.22em] text-white/45">
                          or continue with email
                        </span>
                      </div>
                    </div>

                    <form onSubmit={handleSignIn} className="space-y-4">
                      {error && (
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 ring-1 ring-red-500/30 text-red-200">
                          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                          <span className="text-[13px] font-medium leading-snug">{error}</span>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="signin-email" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">
                          Email
                        </Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                          <Input
                            id="signin-email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => {
                              setEmail(e.target.value);
                              setError(null);
                            }}
                            className={`${darkInputClass} pl-10`}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="signin-password" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">
                            Password
                          </Label>
                          <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                            <DialogTrigger asChild>
                              <button
                                type="button"
                                className="text-[11px] text-pastel-orange-soft hover:text-pastel-orange transition-colors flex items-center gap-1 font-bold"
                                onClick={() => {
                                  setResetEmail(email);
                                  setResetSuccess(false);
                                  setError(null);
                                }}
                              >
                                <HelpCircle className="h-3 w-3" strokeWidth={2.5} />
                                Forgot password?
                              </button>
                            </DialogTrigger>
                            <DialogContent className="bg-[#1A2A20] border-white/10 text-pastel-cream">
                              <DialogHeader>
                                <DialogTitle className="font-sans font-black text-[1.5rem] tracking-[-0.02em] text-pastel-cream">
                                  Reset <span className="text-pastel-orange">password</span>
                                </DialogTitle>
                                <DialogDescription className="text-white/65">
                                  Enter your email address and we'll send you a link to reset your password.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-2">
                                {resetSuccess ? (
                                  <div className="flex items-start gap-2 px-3 py-3 rounded-md bg-pastel-sage/15 ring-1 ring-pastel-sage/40 text-pastel-sage-soft">
                                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                                    <span className="text-[13px] font-medium leading-snug">
                                      Password reset email sent. Check your inbox and click the link to reset.
                                    </span>
                                  </div>
                                ) : (
                                  <>
                                    <div className="space-y-1.5">
                                      <Label htmlFor="reset-email" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">
                                        Email
                                      </Label>
                                      <Input
                                        id="reset-email"
                                        type="email"
                                        placeholder="you@example.com"
                                        value={resetEmail}
                                        onChange={(e) => setResetEmail(e.target.value)}
                                        className={darkInputClass}
                                        required
                                      />
                                    </div>
                                    {error && (
                                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 ring-1 ring-red-500/30 text-red-200">
                                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                                        <span className="text-[13px] font-medium leading-snug">{error}</span>
                                      </div>
                                    )}
                                    <CitrusButton
                                      type="button"
                                      variant="primary"
                                      size="lg"
                                      fullWidth
                                      onClick={handleForgotPassword}
                                      loading={resetLoading}
                                    >
                                      {resetLoading ? 'Sending...' : 'Send Reset Link'}
                                    </CitrusButton>
                                  </>
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                          <Input
                            id="signin-password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => {
                              setPassword(e.target.value);
                              setError(null);
                            }}
                            className={`${darkInputClass} pl-10`}
                            required
                          />
                        </div>
                      </div>

                      <CitrusButton
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={loading}
                        disabled={oauthLoading !== null}
                        arrow={!loading}
                      >
                        {loading ? 'Signing in...' : 'Sign In'}
                      </CitrusButton>
                    </form>
                  </TabsContent>

                  {/* ── SIGN UP ─────────────────────────────────────── */}
                  <TabsContent value="signup" className="space-y-4 mt-0">
                    <CitrusButton
                      type="button"
                      variant="secondary"
                      size="lg"
                      fullWidth
                      onClick={() => handleOAuthSignIn('google')}
                      disabled={loading || oauthLoading !== null}
                      loading={oauthLoading === 'google'}
                    >
                      {oauthLoading !== 'google' && <Chrome className="w-4 h-4" />}
                      Sign up with Google
                    </CitrusButton>

                    <div className="relative py-2">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full h-px bg-white/10" />
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-[#1A2A20] px-3 font-jbmono text-[10px] uppercase tracking-[0.22em] text-white/45">
                          or continue with email
                        </span>
                      </div>
                    </div>

                    <form onSubmit={handleSignUp} className="space-y-4">
                      {error && (
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 ring-1 ring-red-500/30 text-red-200">
                          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                          <span className="text-[13px] font-medium leading-snug">{error}</span>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="signup-email" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">
                          Email
                        </Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                          <Input
                            id="signup-email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => {
                              setEmail(e.target.value);
                              setError(null);
                            }}
                            className={`${darkInputClass} pl-10`}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="signup-password" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">
                          Password
                        </Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                          <Input
                            id="signup-password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => {
                              setPassword(e.target.value);
                              setError(null);
                            }}
                            className={`${darkInputClass} pl-10`}
                            required
                            minLength={8}
                          />
                        </div>
                        {password && <PasswordStrength password={password} />}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="confirm-password" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">
                          Confirm Password
                        </Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                          <Input
                            id="confirm-password"
                            type="password"
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={(e) => {
                              setConfirmPassword(e.target.value);
                              setError(null);
                            }}
                            className={`${darkInputClass} pl-10`}
                            required
                          />
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5 pt-1">
                        <Checkbox
                          id="tos-accept"
                          checked={tosAccepted}
                          onCheckedChange={(checked) => setTosAccepted(checked as boolean)}
                          className="mt-0.5 border-white/30 data-[state=checked]:bg-pastel-orange data-[state=checked]:border-pastel-orange data-[state=checked]:text-white"
                        />
                        <Label htmlFor="tos-accept" className="text-[12px] font-normal cursor-pointer leading-snug text-white/65">
                          I agree to the{' '}
                          <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" className="text-pastel-orange-soft hover:text-pastel-orange font-bold underline-offset-4 hover:underline">
                            Terms of Service
                          </a>{' '}
                          and{' '}
                          <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-pastel-orange-soft hover:text-pastel-orange font-bold underline-offset-4 hover:underline">
                            Privacy Policy
                          </a>
                        </Label>
                      </div>

                      <CitrusButton
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={loading}
                        disabled={oauthLoading !== null || !tosAccepted}
                        arrow={!loading}
                      >
                        {loading ? 'Creating account...' : 'Sign Up'}
                      </CitrusButton>
                    </form>
                  </TabsContent>
                </Tabs>
              </CitrusCard>

              {/* Trust line under the form */}
              <p className="text-center text-[11px] font-jbmono uppercase tracking-[0.22em] text-white/35 mt-5">
                Free during launch · Founders pricing locked in
              </p>
            </div>
          </div>
        </div>
      </main>
    </DarkLayout>
  );
};

export default Auth;
