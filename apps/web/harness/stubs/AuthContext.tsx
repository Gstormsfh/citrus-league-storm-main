/** Harness stub for @/contexts/AuthContext — no Supabase, no network. */
import type { ReactNode } from 'react';

export const AuthProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

const AUTH = {
  user: { id: 'harness-user', email: 'harness@example.com' },
  session: { access_token: 'harness-token' },
  loading: false,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: async () => {},
  signInWithGoogle: async () => ({ error: null }),
  signInWithApple: async () => ({ error: null }),
  resetPassword: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
};

// Stable identity on purpose: pages put `user` in effect dependency arrays, so
// a fresh object per render re-fires their loaders forever.
export const useAuth = () => AUTH;
