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
          initialSessionHandled = true;
          clearTimeout(timeout);
          analyticsService.setUserId(session.user.id);
          setSentryUser({ id: session.user.id, email: session.user.email });
          queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
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
    // SOC 2 CC7.2: Audit log auth events (fire-and-forget)
    if (!error) {
      import('@/services/AuditService').then(({ AuditService }) => AuditService.logLogin()).catch(() => {});
    } else {
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
