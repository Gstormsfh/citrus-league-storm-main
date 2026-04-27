import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { UserAccountService } from '@/services/UserAccountService';
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
  CitrusLogo,
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
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const signInSafetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (signInSafetyTimeoutRef.current) clearTimeout(signInSafetyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      if (redirect && redirect.startsWith('/')) {
        sessionStorage.setItem('citrus:postAuthRedirect', redirect);
      }
    } catch { /* storage disabled */ }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      navigate(redirect && redirect.startsWith('/') ? redirect : '/', { replace: true });
    }
  }, [user, authLoading, navigate]);

  const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const getBetterErrorMessage = (errorMessage: string): string => {
    const lower = errorMessage.toLowerCase();
    if (lower.includes('invalid login') || lower.includes('invalid credentials')) return 'Invalid email or password. Please check and try again.';
    if (lower.includes('already registered') || lower.includes('already exists') || lower.includes('already in use')) return 'This email already has an account. Please sign in instead.';
    if (lower.includes('email not confirmed') || lower.includes('email not verified')) return 'Please verify your email address. Check your inbox for the verification link.';
    if (lower.includes('rate limit') || lower.includes('too many requests')) return 'Too many attempts. Please wait a few minutes before trying again.';
    if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) return 'This sign-in method is not available yet. Please use email and password to sign in.';
    if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) return 'Sign-ups are temporarily disabled. Please try again later or contact support.';
    if (lower.includes('validation_failed') || lower.includes('validation failed')) return 'Sign-up could not be completed. Please try again.';
    if (lower.includes('password')) return errorMessage;
    if (lower.includes('invalid email') || lower.includes('email format') || lower.includes('malformed email')) return 'Invalid email address. Please check and try again.';
    return errorMessage;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateEmail(email)) { setError('Please enter a valid email address'); return; }
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) {
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
            if (oauthProviders.includes('google')) { setError("This email was registered with Google. Click 'Sign in with Google' above to continue."); setLoading(false); return; }
            if (oauthProviders.length > 0) { setError(`This email was registered with ${oauthProviders[0]}. Use that option above to sign in.`); setLoading(false); return; }
          }
        } catch { /* fall through */ }
      }
      setError(getBetterErrorMessage(error.message));
      setLoading(false);
      return;
    }
    signInSafetyTimeoutRef.current = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const params = new URLSearchParams(window.location.search);
          const redirect = params.get('redirect');
          navigate(redirect && redirect.startsWith('/') ? redirect : '/', { replace: true });
        } else {
          setError('Sign-in succeeded but session is taking longer than expected. Try refreshing.');
          setLoading(false);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unexpected error establishing session.';
        setError(msg);
        setLoading(false);
      }
    }, 3000);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateEmail(email)) { setError('Please enter a valid email address'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (!tosAccepted) { setError('Please accept the Terms of Service to continue'); return; }
    setLoading(true);
    try {
      const { data, error } = await signUp(email, password);
      if (error) { setError(getBetterErrorMessage(error.message)); setLoading(false); return; }
      // Record consent for ToS and Privacy Policy (best-effort)
      if (data?.session || data?.user) {
        UserAccountService.recordConsent('terms_of_service', '2026-01-13');
        UserAccountService.recordConsent('privacy_policy', '2026-01-13');
      }
      // If email confirmation is required (no session), navigate to verify page
      if (data?.user && !data?.session) {
        navigate('/verify-email', { state: { email }, replace: true });
      } else if (data?.session) {
        // Session already set; force-refresh + redirect home
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        setTimeout(() => {
          const params = new URLSearchParams(window.location.search);
          const redirect = params.get('redirect');
          navigate(redirect && redirect.startsWith('/') ? redirect : '/', { replace: true });
        }, 50);
      } else {
        navigate('/verify-email', { state: { email }, replace: true });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: 'google') => {
    setError(null);
    setOauthLoading(provider);
    try {
      const { error } = await signInWithOAuth(provider);
      if (error) { setError(error.message || `Failed to sign in with ${provider}.`); setOauthLoading(null); }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
      setOauthLoading(null);
    }
  };

  const handleForgotPassword = async () => {
    if (!validateEmail(resetEmail)) { setError('Please enter a valid email address'); return; }
    setError(null);
    setResetLoading(true);
    try {
      const { error } = await resetPassword(resetEmail);
      if (error) setError(error.message || 'Failed to send reset email.');
      else setResetSuccess(true);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
    } finally { setResetLoading(false); }
  };

  const darkInputClass = 'bg-[#0F1F15] border-white/10 text-pastel-cream placeholder:text-white/35 focus-visible:ring-pastel-orange/40 focus-visible:border-pastel-orange/50 h-11';

  return (
    <DarkLayout>
      <Navbar />
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(ellipse 50% 40% at 80% 15%, rgba(255,107,26,0.08) 0%, transparent 60%)' }}
      />
      <main className="relative z-10 flex items-center justify-center px-4 py-12 lg:py-20 min-h-[calc(100vh-92px)]">
        <div className="w-full max-w-[440px]">
          <div className="flex flex-col items-center mb-6">
            <CitrusLogo className="w-10 h-10 mb-3" variant="on-dark" />
            <h1 className="font-sans font-black text-[1.75rem] tracking-[-0.025em] text-pastel-cream leading-none">
              {activeTab === 'signin' ? 'Welcome back' : 'Join Citrus'}
            </h1>
            <p className="text-[13px] text-white/55 mt-2">
              {activeTab === 'signin' ? (
                <>New to Citrus?{' '}
                  <button type="button" onClick={() => { setActiveTab('signup'); setError(null); }} className="text-pastel-orange-soft hover:text-pastel-orange font-bold underline-offset-4 hover:underline transition-colors">
                    Create an account
                  </button>
                </>
              ) : (
                <>Already have an account?{' '}
                  <button type="button" onClick={() => { setActiveTab('signin'); setError(null); }} className="text-pastel-orange-soft hover:text-pastel-orange font-bold underline-offset-4 hover:underline transition-colors">
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>

          <CitrusCard padding="spacious" accent="orange">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'signin' | 'signup')} className="w-full">
              <TabsList className="sr-only">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="space-y-4 mt-0">
                <CitrusButton type="button" variant="secondary" size="lg" fullWidth onClick={() => handleOAuthSignIn('google')} disabled={loading || oauthLoading !== null} loading={oauthLoading === 'google'}>
                  {oauthLoading !== 'google' && <Chrome className="w-4 h-4" />}
                  Continue with Google
                </CitrusButton>

                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center"><div className="w-full h-px bg-white/10" /></div>
                  <div className="relative flex justify-center"><span className="bg-[#1A2A20] px-3 font-jbmono text-[10px] uppercase tracking-[0.22em] text-white/45">or with email</span></div>
                </div>

                <form onSubmit={handleSignIn} className="space-y-3">
                  {error && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 ring-1 ring-red-500/30 text-red-200">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                      <span className="text-[13px] font-medium leading-snug">{error}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="signin-email" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                      <Input id="signin-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="signin-password" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">Password</Label>
                      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                        <DialogTrigger asChild>
                          <button type="button" className="text-[11px] text-pastel-orange-soft hover:text-pastel-orange transition-colors flex items-center gap-1 font-bold" onClick={() => { setResetEmail(email); setResetSuccess(false); setError(null); }}>
                            <HelpCircle className="h-3 w-3" strokeWidth={2.5} />
                            Forgot password?
                          </button>
                        </DialogTrigger>
                        <DialogContent className="bg-[#1A2A20] border-white/10 text-pastel-cream">
                          <DialogHeader>
                            <DialogTitle className="font-sans font-black text-[1.5rem] tracking-[-0.02em] text-pastel-cream">Reset <span className="text-pastel-orange">password</span></DialogTitle>
                            <DialogDescription className="text-white/65">Enter your email and we will send you a link to reset your password.</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-2">
                            {resetSuccess ? (
                              <div className="flex items-start gap-2 px-3 py-3 rounded-md bg-pastel-sage/15 ring-1 ring-pastel-sage/40 text-pastel-sage-soft">
                                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                                <span className="text-[13px] font-medium leading-snug">Reset email sent. Check your inbox.</span>
                              </div>
                            ) : (
                              <>
                                <div className="space-y-1.5">
                                  <Label htmlFor="reset-email" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">Email</Label>
                                  <Input id="reset-email" type="email" placeholder="you@example.com" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} className={darkInputClass} required />
                                </div>
                                {error && (
                                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 ring-1 ring-red-500/30 text-red-200">
                                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                                    <span className="text-[13px] font-medium leading-snug">{error}</span>
                                  </div>
                                )}
                                <CitrusButton type="button" variant="primary" size="lg" fullWidth onClick={handleForgotPassword} loading={resetLoading}>
                                  {resetLoading ? 'Sending...' : 'Send reset link'}
                                </CitrusButton>
                              </>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                      <Input id="signin-password" type="password" placeholder="••••••••" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required />
                    </div>
                  </div>

                  <CitrusButton type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={oauthLoading !== null} className="mt-2">
                    {loading ? 'Signing in...' : 'Sign in'}
                  </CitrusButton>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4 mt-0">
                <CitrusButton type="button" variant="secondary" size="lg" fullWidth onClick={() => handleOAuthSignIn('google')} disabled={loading || oauthLoading !== null} loading={oauthLoading === 'google'}>
                  {oauthLoading !== 'google' && <Chrome className="w-4 h-4" />}
                  Continue with Google
                </CitrusButton>

                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center"><div className="w-full h-px bg-white/10" /></div>
                  <div className="relative flex justify-center"><span className="bg-[#1A2A20] px-3 font-jbmono text-[10px] uppercase tracking-[0.22em] text-white/45">or with email</span></div>
                </div>

                <form onSubmit={handleSignUp} className="space-y-3">
                  {error && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 ring-1 ring-red-500/30 text-red-200">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                      <span className="text-[13px] font-medium leading-snug">{error}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                      <Input id="signup-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                      <Input id="signup-password" type="password" placeholder="••••••••" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required minLength={8} />
                    </div>
                    {password && <PasswordStrength password={password} />}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-password" className="text-[12px] font-bold text-white/65 uppercase tracking-wider">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2.5} />
                      <Input id="confirm-password" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required />
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 pt-1">
                    <Checkbox id="tos-accept" checked={tosAccepted} onCheckedChange={(checked) => setTosAccepted(checked as boolean)} className="mt-0.5 border-white/30 data-[state=checked]:bg-pastel-orange data-[state=checked]:border-pastel-orange data-[state=checked]:text-white" />
                    <Label htmlFor="tos-accept" className="text-[12px] font-normal cursor-pointer leading-snug text-white/65">
                      I agree to the{' '}
                      <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" className="text-pastel-orange-soft hover:text-pastel-orange font-bold underline-offset-4 hover:underline">Terms</a>{' '}
                      and{' '}
                      <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-pastel-orange-soft hover:text-pastel-orange font-bold underline-offset-4 hover:underline">Privacy Policy</a>
                    </Label>
                  </div>

                  <CitrusButton type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={oauthLoading !== null || !tosAccepted} className="mt-2">
                    {loading ? 'Creating account...' : 'Create account'}
                  </CitrusButton>
                </form>
              </TabsContent>
            </Tabs>
          </CitrusCard>

          <p className="text-center text-[10px] font-jbmono uppercase tracking-[0.32em] text-white/35 mt-6">
            Free during launch · Founders pricing locked in
          </p>
        </div>
      </main>
    </DarkLayout>
  );
};

export default Auth;
