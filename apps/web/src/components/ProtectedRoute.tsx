import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireProfile?: boolean;
}

export const ProtectedRoute = ({ children, requireProfile = false }: ProtectedRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  const { data: profile, isPending: profilePending, isError, isFetching, status, fetchStatus, refetch } = useProfile();
  const location = useLocation();

  // ═══════════════════════════════════════════════════════════════════════
  // DEBUG: Log every render decision — remove after diagnosing the redirect
  // ═══════════════════════════════════════════════════════════════════════
  console.log('[ProtectedRoute]', location.pathname, {
    authLoading,
    user: user ? `✓ ${user.id.slice(0, 8)}…` : '✗ null',
    requireProfile,
    profileQuery: { status, fetchStatus, isPending: profilePending, isFetching, isError },
    profile: profile ? `✓ username="${profile.username}"` : `✗ ${profile}`,
  });

  if (authLoading) {
    console.log('[ProtectedRoute] → SPINNER (auth still loading)');
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    console.log('[ProtectedRoute] → REDIRECT to /auth (user is null, authLoading is false)');
    return <Navigate to="/auth" replace />;
  }

  if (requireProfile) {
    // Still loading — show spinner
    if (profilePending) {
      console.log('[ProtectedRoute] → SPINNER (profile query pending)');
      return (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      );
    }

    // Query errored (API down, network issue, etc.) — do NOT redirect to
    // profile-setup. The profile may exist; the fetch just failed.
    if (isError) {
      console.log('[ProtectedRoute] → RETRY PROMPT (profile query errored)');
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-muted-foreground">Unable to load your profile. Please try again.</p>
          <Button onClick={() => refetch()} variant="outline">
            Retry
          </Button>
        </div>
      );
    }

    // Query succeeded — check if profile is complete
    if (!profile || !profile.username || profile.username.startsWith('user_')) {
      console.log('[ProtectedRoute] → REDIRECT to /profile-setup', {
        reason: !profile ? 'profile is null/undefined' : !profile.username ? 'username is empty' : `username starts with user_: "${profile.username}"`,
      });
      return <Navigate to="/profile-setup" replace />;
    }

    console.log('[ProtectedRoute] → PASS (profile complete)');
  }

  return <>{children}</>;
};
