/** Harness stub for @/contexts/AuthContext — no Supabase, no network. */
import type { ReactNode } from 'react';

export const AuthProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

// `?signedout=1` reviews the signed-out screens (Auth) -- a signed-in user
// is sent away from them.
const SIGNED_OUT = new URLSearchParams(location.search).get('signedout') === '1';

const AUTH = {
  user: SIGNED_OUT ? null : { id: 'harness-user', email: 'harness@example.com' },
  session: SIGNED_OUT ? null : { access_token: 'harness-token' },
  loading: false,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: async () => {},
  signInWithGoogle: async () => ({ error: null }),
  signInWithApple: async () => ({ error: null }),
  signInWithOAuth: async () => ({ error: null }),
  resetPassword: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
};

// Stable identity on purpose: pages put `user` in effect dependency arrays, so
// a fresh object per render re-fires their loaders forever.
export const useAuth = () => AUTH;
