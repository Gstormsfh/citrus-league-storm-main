import { userMessage } from '@/lib/userMessage';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { useAuth } from '@/contexts/AuthContext';
import { interceptExternal } from '@/lib/openExternal';
import { rememberSignupConsent, SIGNUP_POLICY_VERSION } from '@/lib/consent';
import { supabase } from '@/integrations/supabase/client';
import { UserAccountService } from '@/services/UserAccountService';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Mail, Lock, HelpCircle, Chrome, Apple, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import Navbar from '@/components/Navbar';
import {
  DarkLayout,
  CitrusCard,
  CitrusButton,
  CitrusLogo,
} from '@/components/citrus2';

/**
 * THIRD-PARTY SIGN-IN, off for v1 (2026-09-04, the night before submission).
 *
 * App Store Review Guideline 4.8 is a package deal: an app that offers a
 * third-party login MUST also offer Sign in with Apple. Both buttons are
 * built and the web flow works. What was never proven is the Apple provider
 * on the Supabase side -- `auth.identities` held 41 Google identities and
 * ZERO Apple ones, ever -- so "Continue with Apple" was on screen and could
 * not complete. Reviewers tap it first, and a button that fails is a
 * rejection.
 *
 * So both go, together. Hiding only Apple is the arrangement 4.8 forbids;
 * hiding only Google leaves the button that does not work.
 *
 * Cost, measured on production the same day: 37 accounts are Google-only,
 * but only 2 of them signed in during the last 30 days. Those two set a
 * password through Forgot password, which is why the "you signed up with
 * Google" branch below now points there instead of at a button that is no
 * longer on screen.
 *
 * TURNED BACK ON the same night, once Apple actually worked rather than
 * looked configured. The Apple provider was enabled in Supabase, the client
 * secret minted from the .p8 (see scripts/ops/generate-apple-client-secret.mjs
 * -- it EXPIRES 2027-03-05), and a real sign-in completed. Proof is a row in
 * the database, not a screen that looked right: `auth.identities` gained its
 * first-ever apple row at 2026-09-04 08:14:08Z, and Supabase linked it to the
 * existing google identity for the same verified email rather than forking a
 * second account.
 *
 * If Apple ever stops working -- the six-month secret lapsing is the way that
 * happens -- set this back to false rather than hiding Apple alone. Google
 * without Apple is the arrangement 4.8 forbids.
 */
const OAUTH_SIGN_IN_ENABLED = true;

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

  // OAUTH RESUME (2026-09-03), found on device, submission-blocking.
  // handleOAuthSignIn sets oauthLoading on tap and cleared it only when
  // signInWithOAuth returned an error or threw. In the iOS shell that call
  // succeeds the moment the system browser sheet is up (nativeAuth.ts,
  // beginNativeOAuth), and the only thing that ever fired afterwards was the
  // citrussports://auth-callback deep link. Cancel the sheet, or fail inside
  // it, and nothing fires: oauthLoading stays 'google' or 'apple', every
  // button on this screen is disabled on it (the email form's submit
  // included), and only a force-quit clears it. Two symptoms, one cause:
  // after a Google attempt the email form is dead, and a cancelled Apple or
  // Google attempt freezes the screen.
  //
  // The fix treats "the app came back with no session" as a first-class
  // path: any signal that the user is looking at this screen again clears
  // the flag. Clearing is harmless on the success path, where the deep-link
  // handler mints the session and the user effect above navigates away.
  //   - browserFinished: the user closed the sheet. The iOS Browser plugin
  //     fires it from safariViewControllerDidFinish and
  //     presentationControllerDidDismiss (tap Done, or swipe the sheet
  //     away), and not from the programmatic Browser.close() the callback
  //     path uses.
  //   - appUrlOpen: the callback itself arrived, with a code or with
  //     ?error=. nativeAuth.ts closes the sheet programmatically on this
  //     path, so browserFinished never fires for a provider-side failure.
  //   - appStateChange (isActive): the app regained focus. Android Custom
  //     Tabs cover the activity, so this is the resume signal there, and it
  //     covers a user who left for another app mid-flow and came back.
  //   - visibilitychange / pageshow: the web analogue. Back from the
  //     provider page restores this document from bfcache with the flag
  //     still set.
  // Locked by __tests__/Auth.oauthCancel.test.tsx.
  useEffect(() => {
    const clearStuckOAuth = () => setOauthLoading(null);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') clearStuckOAuth();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', clearStuckOAuth);

    // The plugins are dynamic imports, as in nativeAuth.ts, so registration
    // is asynchronous. `removed` covers an unmount that lands before it
    // resolves, which is how StrictMode's double mount would otherwise leak
    // a listener.
    let removed = false;
    const handles: PluginListenerHandle[] = [];
    if (Capacitor.isNativePlatform()) {
      (async () => {
        const [{ App }, { Browser }] = await Promise.all([
          import('@capacitor/app'),
          import('@capacitor/browser'),
        ]);
        const registered = await Promise.all([
          Browser.addListener('browserFinished', clearStuckOAuth),
          App.addListener('appUrlOpen', clearStuckOAuth),
          App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) clearStuckOAuth();
          }),
        ]);
        for (const handle of registered) {
          if (removed) handle.remove();
          else handles.push(handle);
        }
      })().catch(() => {
        /* plugin unavailable: the document listeners above still apply */
      });
    }

    return () => {
      removed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', clearStuckOAuth);
      for (const handle of handles) handle.remove();
    };
  }, []);

  const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const getBetterErrorMessage = (errorMessage: string): string => {
    // T12P-1 (Entry 39 hostile pass, 2026-08-10): warmed per COPY_VOICE
    // rule 3 ("errors own the blame") — "please" removed, doors added
    // where the fact isn't already a door. Auth-specific idioms
    // preserved verbatim where they already met the bar.
    const lower = errorMessage.toLowerCase();
    if (lower.includes('invalid login') || lower.includes('invalid credentials')) return "That email + password combo didn't match. Double-check and try again.";
    if (lower.includes('already registered') || lower.includes('already exists') || lower.includes('already in use')) return 'This email already has an account. Sign in instead.';
    if (lower.includes('email not confirmed') || lower.includes('email not verified')) return "Email not verified yet. Check your inbox for the link.";
    if (lower.includes('rate limit') || lower.includes('too many requests')) return "Too many tries in a row. Take a few minutes, then have another go.";
    if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) return "That sign-in method isn't hooked up yet. Use email and password instead.";
    if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) return "New sign-ups are paused right now. Try again later, or ping support.";
    if (lower.includes('validation_failed') || lower.includes('validation failed')) return "Sign-up didn't take. Try that again.";
    if (lower.includes('password')) return errorMessage;
    if (lower.includes('invalid email') || lower.includes('email format') || lower.includes('malformed email')) return "That email doesn't look right. Double-check it and try again.";
    return errorMessage;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateEmail(email)) { setError("That email doesn't look right. Try again."); return; }
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) {
      const isInvalidCreds = error.message?.toLowerCase().includes('invalid') || error.message?.toLowerCase().includes('credentials');
      if (isInvalidCreds) {
        try {
          const apiBase = import.meta.env.VITE_API_URL || '';
          // BOUNDED (2026-09-04). This lookup is a nicety on top of an
          // already-failed sign-in, but `loading` is still true while it
          // runs and every button on this screen is gated on it, the two
          // OAuth buttons included. A raw fetch has no deadline of its own,
          // so a slow or unreachable API left the whole login screen
          // disabled for as long as the platform took to give up (about a
          // minute in the iOS webview). Cap it: the hint is worth 5 seconds,
          // never the screen. On abort we fall through to the honest
          // credentials error below, exactly as any other failure here does.
          // Feature-detected the way api/client.ts detects it.
          const res = await fetch(`${apiBase}/api/auth/check-method`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
            signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(5000) : undefined,
          });
          const body = await res.json();
          const info = body?.data || body;
          if (info?.exists && !info.has_password) {
            const oauthProviders = (info.providers || []).filter((p: string) => p !== 'email');
            // With OAUTH_SIGN_IN_ENABLED false there is no button to point at,
            // so pointing at one is a dead end. Forgot password sets a password
            // on an account that has never had one, which is the way back in.
            if (!OAUTH_SIGN_IN_ENABLED) {
              const named = oauthProviders.includes('google') ? 'Google'
                : oauthProviders.includes('apple') ? 'Apple' : oauthProviders[0];
              setError(`This email signed up with ${named}. Use 'Forgot password' below to set a password for it.`);
              setLoading(false);
              return;
            }
            if (oauthProviders.includes('google')) { setError("This email signed up with Google. Use Continue with Google above."); setLoading(false); return; }
            if (oauthProviders.includes('apple')) { setError("This email signed up with Apple. Use Continue with Apple above."); setLoading(false); return; }
            if (oauthProviders.length > 0) { setError(`This email signed up with ${oauthProviders[0]}. Use that option above.`); setLoading(false); return; }
          }
        } catch { /* fall through */ }
      }
      setError(getBetterErrorMessage(error.message));
      setLoading(false);
      return;
    }
    // On success: explicitly verify the session and navigate.
    // Do not rely solely on the useEffect watching user — onAuthStateChange
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
    } catch { /* fall through to safety timeout */ }

    // T12P-1 (Entry 39 hostile pass, 2026-08-10): fix silent dead-end.
    // Previously this branch only re-enabled the button after 4s with zero
    // user-visible feedback — a "signed in with no session and no error"
    // path (which shouldn't happen, but the guard exists for a reason) left
    // the user staring at a re-enabled button with no explanation.
    // Now we surface an honest error so the user knows to retry / reach out.
    signInSafetyTimeoutRef.current = setTimeout(() => {
      setError("Sign-in didn't complete. Try again, or reach out if it keeps happening.");
      setLoading(false);
    }, 4000);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateEmail(email)) { setError("That email doesn't look right. Try again."); return; }
    if (password.length < 8) { setError("Passwords need at least 8 characters. Try a bit longer."); return; }
    if (password !== confirmPassword) { setError("Those passwords don't match. Try typing the second one again."); return; }
    if (!tosAccepted) { setError("Check the Terms box to keep going."); return; }
    setLoading(true);
    // The box was checked: keep which version, so the first signed-in
    // session records it (lib/consent.ts). A confirm-your-email signup has
    // no session here, and the recordConsent below has nothing to write as.
    rememberSignupConsent(SIGNUP_POLICY_VERSION);
    try {
      const { data, error } = await signUp(email, password);
      if (error) { setError(getBetterErrorMessage(error.message)); setLoading(false); return; }
      // Record consent for ToS and Privacy Policy (best-effort)
      if (data?.session) {
        UserAccountService.recordConsent('terms_of_service', SIGNUP_POLICY_VERSION);
        UserAccountService.recordConsent('privacy_policy', SIGNUP_POLICY_VERSION);
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
      const errorMessage = userMessage(err, "Sign-up hit a snag. Try again in a moment.");
      setError(errorMessage);
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
    setError(null);
    setOauthLoading(provider);
    const providerLabel = provider === 'apple' ? 'Apple' : 'Google';
    // "By continuing you agree" sits under both buttons; the first session
    // after this hand-off records that version (lib/consent.ts).
    rememberSignupConsent(SIGNUP_POLICY_VERSION);
    try {
      const { error } = await signInWithOAuth(provider);
      // No error means "the hand-off happened", not "signed in": on native
      // the sheet is up and the session arrives by deep link, on web the tab
      // is navigating away. oauthLoading is cleared here only on failure; a
      // cancelled or abandoned attempt is cleared by the OAUTH RESUME effect.
      // Route through getBetterErrorMessage so a provider that is not yet
      // enabled in Supabase degrades to warm copy ("That sign-in method
      // isn't hooked up yet…") instead of a raw API string.
      if (error) { setError(getBetterErrorMessage(error.message || `Couldn't reach ${providerLabel}. Try again in a moment.`)); setOauthLoading(null); }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? getBetterErrorMessage(err.message) : `Couldn't reach ${providerLabel}. Try again in a moment.`;
      setError(errorMessage);
      setOauthLoading(null);
    }
  };

  const handleForgotPassword = async () => {
    if (!validateEmail(resetEmail)) { setError("That email doesn't look right. Try again."); return; }
    setError(null);
    setResetLoading(true);
    try {
      const { error } = await resetPassword(resetEmail);
      if (error) setError(error.message || "Couldn't send that reset link. Try again in a moment.");
      else setResetSuccess(true);
    } catch (err: unknown) {
      const errorMessage = userMessage(err, "Couldn't send that reset link. Try again in a moment.");
      setError(errorMessage);
    } finally { setResetLoading(false); }
  };

  // Below lg the field is Press Box (PR18 paint sweep, 2026-09-05): a 48px
  // tile with the hairline border and Barlow at 15px, so the first screen a
  // manager sees on a phone is the same app as the second. The desktop keeps
  // the Citrus 2.0 field. Same element, same handlers -- classes only.
  const darkInputClass = 'bg-pastel-surface border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 focus-visible:border-pastel-orange/50 h-11 max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-tile max-lg:border-white/[0.08] max-lg:font-barlow max-lg:text-[16px] max-lg:text-pressbox-text max-lg:placeholder:text-pressbox-text/40';

  return (
    <DarkLayout>
      {/* PRESS BOX BELOW lg (PR18 paint sweep, 2026-09-05). The sign-in screen
          is the first thing every manager sees on a phone, and it wore the
          marketing site's chrome: the storefront Navbar with its hamburger,
          Poppins and Montserrat, the Citrus 2.0 card. One tree, re-skinned
          with `max-lg:` classes so every handler, id and label is the same
          element on both layers -- the desktop is untouched from lg. */}
      <div className="hidden lg:block"><Navbar /></div>
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-page-backdrop"
        style={{ background: 'radial-gradient(ellipse 50% 40% at 80% 15%, rgba(255,107,26,0.08) 0%, transparent 60%)' }}
      />
      <main className="pb-type-phone relative z-10 flex items-center justify-center px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-12 lg:pt-[calc(7rem+env(safe-area-inset-top))] lg:pb-20 min-h-[calc(100vh-92px)] max-lg:min-h-screen max-lg:bg-pressbox-surface max-lg:text-pressbox-text max-lg:px-5">
        <div className="w-full max-w-[440px]">
          <div className="flex flex-col items-center mb-6">
            <CitrusLogo className="w-14 h-14 mb-4 lg:w-10 lg:h-10 lg:mb-3" variant="on-dark" />
            <h1 className="font-sans font-black text-[1.75rem] tracking-[-0.025em] text-pastel-cream leading-none max-lg:font-condensed max-lg:font-extrabold max-lg:text-[28px] max-lg:uppercase max-lg:tracking-[0.02em] max-lg:text-pressbox-text">
              {activeTab === 'signin' ? 'Welcome back' : 'Join Citrus'}
            </h1>
            <p className="text-[13px] text-white/55 mt-2 max-lg:font-barlow max-lg:text-pressbox-text/60">
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

          <CitrusCard padding="spacious" accent="orange" className="max-lg:bg-transparent max-lg:ring-0 max-lg:p-0 max-lg:rounded-none max-lg:shadow-none">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'signin' | 'signup')} className="w-full">
              <TabsList className="sr-only">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="space-y-4 mt-0">
                {/* App Review 4.8: a third-party login (Google) requires an
                    equivalent privacy-focused option — Sign in with Apple.
                    Apple's HIG: never render its button less prominently
                    than other providers, hence first + brand-white style. */}
                {OAUTH_SIGN_IN_ENABLED && (
                  <>
                <CitrusButton type="button" variant="secondary" size="lg" fullWidth onClick={() => handleOAuthSignIn('apple')} disabled={loading || oauthLoading !== null} loading={oauthLoading === 'apple'} className="bg-white text-[#111111] ring-white/80 hover:bg-white/90 hover:text-black hover:ring-white max-lg:h-12 max-lg:rounded-[12px] max-lg:ring-0 max-lg:font-plex max-lg:font-semibold max-lg:text-[12px] max-lg:tracking-[0.06em]">
                  {oauthLoading !== 'apple' && <Apple className="w-4 h-4 fill-current" />}
                  Continue with Apple
                </CitrusButton>

                <CitrusButton type="button" variant="secondary" size="lg" fullWidth onClick={() => handleOAuthSignIn('google')} disabled={loading || oauthLoading !== null} loading={oauthLoading === 'google'} className="max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-tile max-lg:ring-white/[0.08] max-lg:font-plex max-lg:font-semibold max-lg:text-[12px] max-lg:tracking-[0.06em]">
                  {oauthLoading !== 'google' && <Chrome className="w-4 h-4" />}
                  Continue with Google
                </CitrusButton>

                <p className="text-[11px] leading-snug text-center text-white/55 px-2 max-lg:font-barlow max-lg:text-[12px] max-lg:text-pressbox-text/55" data-testid="oauth-consent-line">
                  By continuing you agree to the{' '}
                  <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" onClick={(e) => { if (interceptExternal('/terms-of-service.html')) e.preventDefault(); }} className="text-pastel-orange-soft font-semibold underline-offset-4 hover:underline max-lg:text-pressbox-orange-soft">Terms of Service</a>{' '}
                  and{' '}
                  <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" onClick={(e) => { if (interceptExternal('/privacy-policy.html')) e.preventDefault(); }} className="text-pastel-orange-soft font-semibold underline-offset-4 hover:underline max-lg:text-pressbox-orange-soft">Privacy Policy</a>.
                </p>

                {/* HIDE MY EMAIL (2026-09-04). Supabase links a new identity to an
                    existing user by VERIFIED EMAIL. Apple lets a user hand over
                    a @privaterelay.appleid.com address instead of their own, and
                    that address matches nothing, so the same person signing in
                    with Apple once and Google once ends up with two accounts and
                    finds their team missing from the second. Nothing in code can
                    prevent it, Apple gives the choice to the user, so the only
                    lever is saying so before they choose.

                    text-white/55, not /45: darkThemeContrastGuard measures white
                    alpha against #0F1F15 and /45 is 4.43:1. No em dash either,
                    aiVoiceGuard bans them in user-facing copy. */}
                <p className="text-[11px] leading-snug text-center text-white/55 px-2 max-lg:font-barlow max-lg:text-[12px] max-lg:text-pressbox-text/55">
                  Use the same email for both. Apple&apos;s Hide My Email creates a
                  separate account with none of your leagues.
                </p>

                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center"><div className="w-full h-px bg-white/10" /></div>
                  <div className="relative flex justify-center"><span className="bg-pastel-surface-tile px-3 font-jbmono text-[10px] uppercase tracking-[0.22em] text-white/55 max-lg:bg-pressbox-surface max-lg:font-plex max-lg:font-medium max-lg:text-[9px] max-lg:tracking-[0.12em] max-lg:text-pressbox-text/45">or with email</span></div>
                </div>
                  </>
                )}

                <form onSubmit={handleSignIn} className="space-y-3">
                  {error && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 ring-1 ring-red-500/30 text-red-200 max-lg:rounded-[10px] max-lg:bg-pressbox-grapefruit/10 max-lg:ring-pressbox-grapefruit/30 max-lg:text-pressbox-grapefruit-text max-lg:font-barlow">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} aria-hidden="true" />
                      <span className="text-[13px] font-medium leading-snug">{error}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="signin-email" className="text-[12px] font-bold text-white/65 uppercase tracking-wider max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:text-pressbox-text/55">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55" strokeWidth={2.5} aria-hidden="true" />
                      <Input id="signin-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="signin-password" className="text-[12px] font-bold text-white/65 uppercase tracking-wider max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:text-pressbox-text/55">Password</Label>
                      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                        <DialogTrigger asChild>
                          <button type="button" className="text-[11px] text-pastel-orange-soft hover:text-pastel-orange transition-colors flex items-center gap-1 font-bold" onClick={() => { setResetEmail(email); setResetSuccess(false); setError(null); }}>
                            <HelpCircle className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                            Forgot password?
                          </button>
                        </DialogTrigger>
                        <DialogContent className="pb-type-phone bg-pastel-surface-tile border-white/10 text-pastel-cream max-lg:bg-pressbox-tile max-lg:border-white/[0.08] max-lg:text-pressbox-text max-lg:font-barlow">
                          <DialogHeader>
                            <DialogTitle className="font-sans font-black text-[1.5rem] tracking-[-0.02em] text-pastel-cream max-lg:font-condensed max-lg:font-extrabold max-lg:text-[24px] max-lg:uppercase max-lg:tracking-[0.02em] max-lg:text-pressbox-text">Reset <span className="text-pastel-orange">password</span></DialogTitle>
                            <DialogDescription className="text-white/65 max-lg:text-[13px] max-lg:text-pressbox-text/60">Enter your email and we will send you a link to reset your password.</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-2">
                            {resetSuccess ? (
                              <div className="flex items-start gap-2 px-3 py-3 rounded-md bg-pastel-sage/15 ring-1 ring-pastel-sage/40 text-pastel-sage-soft">
                                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} aria-hidden="true" />
                                <span className="text-[13px] font-medium leading-snug">Reset email sent. Check your inbox.</span>
                              </div>
                            ) : (
                              <>
                                <div className="space-y-1.5">
                                  <Label htmlFor="reset-email" className="text-[12px] font-bold text-white/65 uppercase tracking-wider max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:text-pressbox-text/55">Email</Label>
                                  <Input id="reset-email" type="email" placeholder="you@example.com" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} className={darkInputClass} required />
                                </div>
                                {error && (
                                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 ring-1 ring-red-500/30 text-red-200 max-lg:rounded-[10px] max-lg:bg-pressbox-grapefruit/10 max-lg:ring-pressbox-grapefruit/30 max-lg:text-pressbox-grapefruit-text max-lg:font-barlow">
                                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} aria-hidden="true" />
                                    <span className="text-[13px] font-medium leading-snug">{error}</span>
                                  </div>
                                )}
                                <CitrusButton type="button" variant="primary" size="lg" fullWidth onClick={handleForgotPassword} loading={resetLoading} className="max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-orange max-lg:text-pressbox-orange-ink max-lg:font-plex max-lg:font-semibold max-lg:text-[12px] max-lg:tracking-[0.08em] max-lg:uppercase">
                                  {resetLoading ? 'Sending...' : 'Send reset link'}
                                </CitrusButton>
                              </>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55" strokeWidth={2.5} aria-hidden="true" />
                      <Input id="signin-password" type="password" placeholder="••••••••" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required />
                    </div>
                  </div>

                  <CitrusButton type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={oauthLoading !== null} className="mt-2 max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-orange max-lg:text-pressbox-orange-ink max-lg:font-plex max-lg:font-semibold max-lg:text-[12px] max-lg:tracking-[0.08em] max-lg:uppercase">
                    {loading ? 'Signing in...' : 'Sign in'}
                  </CitrusButton>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4 mt-0">
                {OAUTH_SIGN_IN_ENABLED && (
                  <>
                <CitrusButton type="button" variant="secondary" size="lg" fullWidth onClick={() => handleOAuthSignIn('apple')} disabled={loading || oauthLoading !== null} loading={oauthLoading === 'apple'} className="bg-white text-[#111111] ring-white/80 hover:bg-white/90 hover:text-black hover:ring-white max-lg:h-12 max-lg:rounded-[12px] max-lg:ring-0 max-lg:font-plex max-lg:font-semibold max-lg:text-[12px] max-lg:tracking-[0.06em]">
                  {oauthLoading !== 'apple' && <Apple className="w-4 h-4 fill-current" />}
                  Continue with Apple
                </CitrusButton>

                <CitrusButton type="button" variant="secondary" size="lg" fullWidth onClick={() => handleOAuthSignIn('google')} disabled={loading || oauthLoading !== null} loading={oauthLoading === 'google'} className="max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-tile max-lg:ring-white/[0.08] max-lg:font-plex max-lg:font-semibold max-lg:text-[12px] max-lg:tracking-[0.06em]">
                  {oauthLoading !== 'google' && <Chrome className="w-4 h-4" />}
                  Continue with Google
                </CitrusButton>

                <p className="text-[11px] leading-snug text-center text-white/55 px-2 max-lg:font-barlow max-lg:text-[12px] max-lg:text-pressbox-text/55" data-testid="oauth-consent-line">
                  By continuing you agree to the{' '}
                  <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" onClick={(e) => { if (interceptExternal('/terms-of-service.html')) e.preventDefault(); }} className="text-pastel-orange-soft font-semibold underline-offset-4 hover:underline max-lg:text-pressbox-orange-soft">Terms of Service</a>{' '}
                  and{' '}
                  <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" onClick={(e) => { if (interceptExternal('/privacy-policy.html')) e.preventDefault(); }} className="text-pastel-orange-soft font-semibold underline-offset-4 hover:underline max-lg:text-pressbox-orange-soft">Privacy Policy</a>.
                </p>

                {/* HIDE MY EMAIL (2026-09-04). Supabase links a new identity to an
                    existing user by VERIFIED EMAIL. Apple lets a user hand over
                    a @privaterelay.appleid.com address instead of their own, and
                    that address matches nothing, so the same person signing in
                    with Apple once and Google once ends up with two accounts and
                    finds their team missing from the second. Nothing in code can
                    prevent it, Apple gives the choice to the user, so the only
                    lever is saying so before they choose.

                    text-white/55, not /45: darkThemeContrastGuard measures white
                    alpha against #0F1F15 and /45 is 4.43:1. No em dash either,
                    aiVoiceGuard bans them in user-facing copy. */}
                <p className="text-[11px] leading-snug text-center text-white/55 px-2 max-lg:font-barlow max-lg:text-[12px] max-lg:text-pressbox-text/55">
                  Use the same email for both. Apple&apos;s Hide My Email creates a
                  separate account with none of your leagues.
                </p>

                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center"><div className="w-full h-px bg-white/10" /></div>
                  <div className="relative flex justify-center"><span className="bg-pastel-surface-tile px-3 font-jbmono text-[10px] uppercase tracking-[0.22em] text-white/55 max-lg:bg-pressbox-surface max-lg:font-plex max-lg:font-medium max-lg:text-[9px] max-lg:tracking-[0.12em] max-lg:text-pressbox-text/45">or with email</span></div>
                </div>
                  </>
                )}

                <form onSubmit={handleSignUp} className="space-y-3">
                  {error && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 ring-1 ring-red-500/30 text-red-200 max-lg:rounded-[10px] max-lg:bg-pressbox-grapefruit/10 max-lg:ring-pressbox-grapefruit/30 max-lg:text-pressbox-grapefruit-text max-lg:font-barlow">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} aria-hidden="true" />
                      <span className="text-[13px] font-medium leading-snug">{error}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email" className="text-[12px] font-bold text-white/65 uppercase tracking-wider max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:text-pressbox-text/55">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55" strokeWidth={2.5} aria-hidden="true" />
                      <Input id="signup-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password" className="text-[12px] font-bold text-white/65 uppercase tracking-wider max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:text-pressbox-text/55">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55" strokeWidth={2.5} aria-hidden="true" />
                      <Input id="signup-password" type="password" placeholder="••••••••" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required minLength={8} />
                    </div>
                    {password && <PasswordStrength password={password} />}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-password" className="text-[12px] font-bold text-white/65 uppercase tracking-wider max-lg:font-plex max-lg:font-medium max-lg:text-[10px] max-lg:tracking-[0.06em] max-lg:text-pressbox-text/55">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55" strokeWidth={2.5} aria-hidden="true" />
                      <Input id="confirm-password" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }} className={`${darkInputClass} pl-10`} required />
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 pt-1">
                    <Checkbox id="tos-accept" checked={tosAccepted} onCheckedChange={(checked) => setTosAccepted(checked as boolean)} className="mt-0.5 border-white/30 data-[state=checked]:bg-pastel-orange data-[state=checked]:border-pastel-orange data-[state=checked]:text-white" />
                    <Label htmlFor="tos-accept" className="text-[12px] font-normal cursor-pointer leading-snug text-white/65">
                      I agree to the{' '}
                      <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" onClick={(e) => { if (interceptExternal('/terms-of-service.html')) e.preventDefault(); }} className="text-pastel-orange-soft hover:text-pastel-orange font-bold underline-offset-4 hover:underline">Terms</a>{' '}
                      and{' '}
                      <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" onClick={(e) => { if (interceptExternal('/privacy-policy.html')) e.preventDefault(); }} className="text-pastel-orange-soft hover:text-pastel-orange font-bold underline-offset-4 hover:underline">Privacy Policy</a>
                    </Label>
                  </div>

                  <CitrusButton type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={oauthLoading !== null || !tosAccepted} className="mt-2 max-lg:h-12 max-lg:rounded-[12px] max-lg:bg-pressbox-orange max-lg:text-pressbox-orange-ink max-lg:font-plex max-lg:font-semibold max-lg:text-[12px] max-lg:tracking-[0.08em] max-lg:uppercase">
                    {loading ? 'Creating account...' : 'Create account'}
                  </CitrusButton>
                </form>
              </TabsContent>
            </Tabs>
          </CitrusCard>

          <p className="text-center text-[10px] font-jbmono uppercase tracking-[0.32em] text-white/55 mt-6 max-lg:font-plex max-lg:font-medium max-lg:text-[9px] max-lg:tracking-[0.2em] max-lg:text-pressbox-text/45">
            Fantasy hockey · Built by hockey heads
          </p>
        </div>
      </main>
    </DarkLayout>
  );
};

export default Auth;
