import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireProfile?: boolean;
}

export const ProtectedRoute = ({ children, requireProfile = false }: ProtectedRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  // isPending = true until the query has successfully returned data at least once.
  // isLoading (isPending && isFetching) is false when the query is enabled but
  // hasn't started fetching yet, which caused a false redirect to /profile-setup.
  const { data: profile, isPending: profilePending } = useProfile();

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

  // If this route requires a complete profile, wait for the profile query
  if (requireProfile) {
    if (profilePending) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      );
    }
    if (!profile || !profile.username || profile.username.startsWith('user_')) {
      return <Navigate to="/profile-setup" replace />;
    }
  }

  return <>{children}</>;
};
