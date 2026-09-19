import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { StormyLoading } from '@/components/citrus2';
import { Button } from '@/components/ui/button';
import { browserHandoffHash } from '@/lib/browserHandoff';
import { isNativeShell } from '@/lib/nativeAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireProfile?: boolean;
}

export const ProtectedRoute = ({ children, requireProfile = false }: ProtectedRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  const { data: profile, isPending: profilePending, isError, refetch } = useProfile();
  const location = useLocation();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F1F15]">
        <StormyLoading message="Checking you in…" />
      </div>
    );
  }

  if (!user) {
    // Entry 41 P0 (2026-08-10, Garrett-approved live 06:33Z): preserve the
    // intended destination — path AND query — through the auth wall.
    // Before this fix, `<Navigate to="/auth" replace />` dropped everything:
    // a signed-out invitee tapping a share link like
    //   /create-league?code=ABC123
    // signed in and landed on "/" with the join code gone — the exact
    // onboarding corridor THE TWELVE walk on Aug 20. Auth.tsx already
    // consumes ?redirect= and validates it with startsWith('/') (open-
    // redirect safe); encodeURIComponent makes the nested query round-trip.
    // Worst case (malformed param) degrades to today's behavior: home.
    const handoff = import.meta.env.VITE_NATIVE !== '1' && !isNativeShell()
      ? browserHandoffHash(location.pathname, location.hash) : '';
    const dest = encodeURIComponent(location.pathname + location.search + handoff);
    return <Navigate to={`/auth?redirect=${dest}`} replace />;
  }

  if (requireProfile) {
    if (profilePending) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0F1F15]">
          <StormyLoading message="Loading your profile…" />
        </div>
      );
    }

    if (isError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center bg-[#0F1F15]">
          <p className="text-pastel-cream">We couldn't load your profile. Give it another try.</p>
          <Button onClick={() => refetch()} variant="outline">
            Retry
          </Button>
        </div>
      );
    }

    if (!profile || !profile.username || profile.username.startsWith('user_')) {
      return <Navigate to="/profile-setup" replace />;
    }
  }

  return <>{children}</>;
};
