import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session, AuthError, AuthResponse } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { accountApi } from '@/api/account';
import { analyticsService } from '@/services/AnalyticsService';
import { setSentryUser } from '@/integrations/sentry/config';
import { logger } from '@/utils/logger';

interface Profile {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  location: string | null;
  bio: string | null;
  default_team_name: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<AuthResponse>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
  signInWithOAuth: (provider: 'google' | 'apple') => Promise<{ error: AuthError | null }>;
  resendVerificationEmail: (email: string) => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (_userId: string) => {
    try {
      const response = await accountApi.getProfile();
      setProfile(response.data || null);
    } catch (error) {
      logger.error('Error fetching profile:', error);
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

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

    // Track whether profile fetch succeeded so TOKEN_REFRESHED can retry
    let profileFetchSucceeded = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (session?.user) {
          initialSessionHandled = true;
          clearTimeout(timeout);
          analyticsService.setUserId(session.user.id);
          setSentryUser({ id: session.user.id, email: session.user.email });
          fetchProfile(session.user.id).then(() => {
            profileFetchSucceeded = true;
          }).catch(() => {
            profileFetchSucceeded = false;
          }).finally(() => {
            if (mounted) setLoading(false);
          });
        }
      } else if (event === 'TOKEN_REFRESHED') {
        // Supabase finished refreshing the token — retry profile if it failed earlier
        if (session?.user && !profileFetchSucceeded) {
          logger.info('[Auth] Token refreshed, retrying profile fetch');
          fetchProfile(session.user.id).then(() => {
            profileFetchSucceeded = true;
          }).catch(() => {});
        }
      } else if (event === 'SIGNED_OUT') {
        analyticsService.setUserId(null);
        setSentryUser(null);
        setProfile(null);
        profileFetchSucceeded = false;
        setLoading(false);
      }
    });

    // Now get the initial session — if the listener already handled it
    // (e.g., OAuth SIGNED_IN fired), skip duplicate work
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted || initialSessionHandled) return;
      clearTimeout(timeout);
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        analyticsService.setUserId(session.user.id);
        fetchProfile(session.user.id).finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        analyticsService.setUserId(null);
        setLoading(false);
      }
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
  }, []);

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

  const signUp = async (email: string, password: string) => {
    // Get the current origin for redirect URL
    const redirectUrl = `${window.location.origin}/auth/callback`;
    
    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    return result;
  };

  const signOut = async () => {
    // SOC 2 CC7.2: Audit log logout (fire-and-forget, before clearing session)
    import('@/services/AuditService').then(({ AuditService }) => AuditService.logLogout()).catch(() => {});
    await supabase.auth.signOut();
    setProfile(null);
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
        profile,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
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

