import { Navigate } from 'react-router-dom';
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
  const { data: profile, isPending: profilePending, isError, refetch } = useProfile();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (requireProfile) {
    // Still loading — show spinner
    if (profilePending) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      );
    }

    // Query errored (API down, network issue, etc.) — do NOT redirect to
    // profile-setup. The profile may exist; the fetch just failed. Show a
    // retry prompt instead.
    if (isError) {
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
      return <Navigate to="/profile-setup" replace />;
    }
  }

  return <>{children}</>;
};
