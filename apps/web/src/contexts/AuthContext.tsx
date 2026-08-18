import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session, AuthError, AuthResponse } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { analyticsService } from '@/services/AnalyticsService';
import { setSentryUser } from '@/integrations/sentry/config';
import { logger } from '@/utils/logger';
import { PROFILE_QUERY_KEY } from '@/hooks/useProfile';
import {
  isNativeShell,
  beginNativeOAuth,
  registerNativeAuthListener,
} from '@/lib/nativeAuth';
import { registerForPush, unregisterDeviceToken } from '@/lib/pushNotifications';

/** Returns true if JWT is expired or within 30s of expiry. */
function isTokenExpired(token: string | undefined): boolean {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp !== 'number' || Date.now() >= payload.exp * 1000 - 30_000;
  } catch {
    return true;
  }
}

/**
 * Reads the auth-session identity from a JWT so AUTH_LOGIN can be emitted
 * exactly once per session. Falls back to sub:iat if the provider ever stops
 * issuing session_id — an occasional duplicate is far cheaper than a hole.
 */
function sessionKeyOf(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (typeof payload.session_id === 'string') return payload.session_id;
    if (payload.sub && payload.iat) return `${payload.sub}:${payload.iat}`;
    return null;
  } catch {
    return null;
  }
}

const LOGIN_AUDIT_KEY = 'citrus.audit.lastLoginSessionId';

/**
 * SOC 2 CC7.2 — emit AUTH_LOGIN once per auth session.
 *
 * This used to live in signIn(), which only covers the password form. Server
 * side signup calls setSession() directly ("no client-side signIn call") and
 * OAuth returns through a redirect, so both minted a real session with no audit
 * row. Measured against the identity provider's own log, capture was 13.9%
 * (38 AUTH_LOGIN rows against 274 real logins, Apr-Aug 2026), and three logins
 * after 2026-06-23 produced nothing at all.
 *
 * Emitting from onAuthStateChange catches every path that mints a session.
 * Dedupe on the session key so INITIAL_SESSION restores, tab focus and a second
 * tab do not re-log a session that was already recorded.
 */
function recordLoginOnce(session: Session | null): void {
  const key = sessionKeyOf(session?.access_token);
  if (!key) return;
  try {
    if (window.localStorage.getItem(LOGIN_AUDIT_KEY) === key) return;
    window.localStorage.setItem(LOGIN_AUDIT_KEY, key);
  } catch {
    // storage blocked (private mode) — fall through and log anyway
  }
  import('@/services/AuditService')
    .then(({ AuditService }) => AuditService.logLogin())
    .catch((err) => logger.warn('[Auth] AUTH_LOGIN audit emit failed', err));
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  /** True until the Supabase auth session is resolved (user or guest). */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<AuthResponse>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
  signInWithOAuth: (provider: 'google' | 'apple') => Promise<{ error: AuthError | null }>;
  resendVerificationEmail: (email: string) => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;
    const timeout = setTimeout(() => {
      if (mounted) {
        logger.warn("⚠️ Auth initialization taking longer than expected, setting loading to false");
        setLoading(false);
      }
    }, 5000); // 5 second timeout

    // Register auth listener FIRST so we don't miss SIGNED_IN events
    // that fire during the getSession() call (e.g., OAuth callback redirect)
    let initialSessionHandled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      setSession(session);

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (session?.user) {
          if (isTokenExpired(session.access_token)) {
            logger.info('[Auth] Stale token on', event, '— deferring until TOKEN_REFRESHED');
            initialSessionHandled = true;
            return;
          }
          setUser(session.user);
          recordLoginOnce(session);
          initialSessionHandled = true;
          clearTimeout(timeout);
          analyticsService.setUserId(session.user.id);
          setSentryUser({ id: session.user.id, email: session.user.email });
          queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
          // PUSH (2026-08-18) — register this device for draft-turn alerts.
          // No-op in every browser (isNativePlatform() is false) and safe to
          // repeat: device_tokens upserts on the token, so a returning device
          // refreshes its row instead of accumulating duplicates. Deliberately
          // not awaited — the permission prompt must not delay sign-in.
          void registerForPush(supabase, session.user.id, (msg) =>
            logger.warn('[Auth] push registration: ' + msg),
          );
          if (mounted) setLoading(false);
        } else if (event === 'INITIAL_SESSION') {
          clearTimeout(timeout);
          if (mounted) setLoading(false);
        }
      } else if (event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          setUser(session.user);
          clearTimeout(timeout);
          analyticsService.setUserId(session.user.id);
          setSentryUser({ id: session.user.id, email: session.user.email });
          queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
          if (mounted) setLoading(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        analyticsService.setUserId(null);
        setSentryUser(null);
        // Clear profile from React Query cache on sign-out
        queryClient.removeQueries({ queryKey: PROFILE_QUERY_KEY });
        setLoading(false);
      }
    });

    // Now get the initial session — if the listener already handled it
    // (e.g., OAuth SIGNED_IN fired), skip duplicate work
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted || initialSessionHandled) return;
      setSession(session);
      if (session?.user && isTokenExpired(session.access_token)) {
        logger.info('[Auth] Stale token in getSession fallback — deferring');
        initialSessionHandled = true;
        return;
      }
      clearTimeout(timeout);
      setUser(session?.user ?? null);
      if (session?.user) {
        analyticsService.setUserId(session.user.id);
      } else {
        analyticsService.setUserId(null);
      }
      if (mounted) setLoading(false);
    }).catch((error) => {
      if (!mounted || initialSessionHandled) return;
      clearTimeout(timeout);
      logger.error("Error getting session:", error);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [queryClient]);

  // APPLE-WRAP (2026-08-15) — completes the PKCE exchange when iOS
  // re-enters the app via citrussports://auth-callback. In every
  // browser registerNativeAuthListener returns a no-op immediately
  // (isNativePlatform() is false), so the web app's behaviour is
  // untouched. The returned unsubscriber is the effect cleanup, which
  // keeps StrictMode double-mounts from stacking duplicate listeners.
  useEffect(
    () =>
      registerNativeAuthListener(supabase, (msg) => {
        logger.error('[Auth] native OAuth callback failed: ' + msg);
      }),
    [],
  );

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    // SOC 2 CC7.2. AUTH_LOGIN is emitted by recordLoginOnce() from
    // onAuthStateChange, which sees every path that mints a session, not just
    // this form. AUTH_FAILED has to stay here: no session is created on a
    // failed attempt, so no auth state change fires.
    if (error) {
      import('@/services/AuditService').then(({ AuditService }) =>
        AuditService.log('AUTH_FAILED', null, { email, error: error.message }, 'WARN')
      ).catch(() => {});
    }
    return { error };
  };

  const signUp = async (email: string, password: string): Promise<AuthResponse> => {
    // Server-side signup: creates user + signs in via admin API (bypasses
    // Supabase's IP-level rate limiter that was blocking users).
    const apiBase = import.meta.env.VITE_API_URL || '';
    try {
      const res = await fetch(`${apiBase}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error?.message || 'Signup failed';
        return { data: { user: null, session: null }, error: new AuthError(msg) };
      }
      // Server returns session tokens — set them directly, no client-side signIn call
      const serverSession = json?.data?.session;
      if (serverSession?.access_token && serverSession?.refresh_token) {
        const { data, error } = await supabase.auth.setSession({
          access_token: serverSession.access_token,
          refresh_token: serverSession.refresh_token,
        });
        return { data: { user: data.user, session: data.session }, error: error || null };
      }
      // Fallback: server created user but didn't return session — sign in client-side
      return await supabase.auth.signInWithPassword({ email, password });
    } catch {
      // Fallback: use Supabase client signup (requires email verification)
      const redirectUrl = `${window.location.origin}/auth/callback`;
      return supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl },
      });
    }
  };

  const signOut = async () => {
    // SOC 2 CC7.2: Audit log logout (fire-and-forget, before clearing session)
    import('@/services/AuditService').then(({ AuditService }) => AuditService.logLogout()).catch(() => {});
    // PUSH (2026-08-18) — drop this device's token BEFORE the session goes, or
    // RLS no longer matches the rows and they are orphaned. Without this the
    // next person to sign in on a shared phone keeps receiving draft alerts for
    // the previous user's leagues. No-op in a browser.
    const departingUserId = user?.id;
    if (departingUserId) {
      await unregisterDeviceToken(supabase, departingUserId, (msg) =>
        logger.warn('[Auth] push cleanup: ' + msg),
      );
    }
    await supabase.auth.signOut();
    // Clear user ID from analytics
    analyticsService.setUserId(null);
  };

  const resetPassword = async (email: string) => {
    const redirectUrl = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });
    return { error };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    return { error };
  };

  const signInWithOAuth = async (provider: 'google' | 'apple') => {
    const redirectUrl = `${window.location.origin}/auth/callback`;

    // Provider-specific scopes and query params for a complete profile
    const providerOptions: Record<string, { scopes?: string; queryParams?: Record<string, string> }> = {
      google: {
        scopes: 'email profile',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
      apple: {
        scopes: 'email name',
      },
    };

    const opts = providerOptions[provider] || {};

    /*
     * APPLE-WRAP (2026-08-15) — inside the iOS shell the auth leg must
     * run in the SYSTEM browser and redirect back via a custom scheme:
     * Google refuses OAuth in embedded webviews outright, and the web
     * redirect would strand the session in Safari instead of the app.
     * Mechanics + the one Supabase-dashboard step: src/lib/nativeAuth.ts.
     * In any browser isNativeShell() is false and this branch is dead
     * code — the path below is byte-for-byte the pre-existing web flow.
     */
    if (isNativeShell()) {
      return beginNativeOAuth(supabase, provider, opts);
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl,
        scopes: opts.scopes,
        queryParams: opts.queryParams,
      },
    });
    return { error };
  };

  const resendVerificationEmail = async (email: string) => {
    const redirectUrl = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    return { error };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
        signInWithOAuth,
        resendVerificationEmail,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
