import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountApi } from '@/api/account';
import { useAuth } from '@/contexts/AuthContext';

// ============================================================================
// Profile types
// ============================================================================

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  location: string | null;
  bio: string | null;
  default_team_name: string | null;
  timezone: string | null;
  avatar_url: string | null;
  /** The on-the-clock APNs opt-in (profiles.push_notifications). Defaults true. */
  push_notifications?: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfileUpdateFields = {
  username?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  location?: string;
  bio?: string;
  default_team_name?: string;
  timezone?: string;
  avatar_url?: string;
  push_notifications?: boolean;
};

// ============================================================================
// Query key
// ============================================================================

export const PROFILE_QUERY_KEY = ['profile'] as const;

// ============================================================================
// useProfile — single source of truth for profile data
// ============================================================================

export function useProfile() {
  const { user } = useAuth();

  return useQuery<Profile | null>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: async () => {
      const response = await accountApi.getProfile();
      return response.data ?? null;
    },
    enabled: !!user,
  });
}

// ============================================================================
// useUpdateProfile — mutation with optimistic updates + automatic rollback
// ============================================================================

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fields: ProfileUpdateFields) => accountApi.updateProfile(fields),

    onMutate: async (fields) => {
      // Cancel in-flight profile fetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: PROFILE_QUERY_KEY });

      // Snapshot current value for rollback
      const previous = queryClient.getQueryData<Profile | null>(PROFILE_QUERY_KEY);

      // Optimistically merge the new fields into the cached profile
      queryClient.setQueryData<Profile | null>(PROFILE_QUERY_KEY, (old) =>
        old ? { ...old, ...fields } : old,
      );

      return { previous };
    },

    onError: (_err, _fields, context) => {
      // Rollback to the snapshot on failure
      if (context?.previous !== undefined) {
        queryClient.setQueryData(PROFILE_QUERY_KEY, context.previous);
      }
    },

    onSettled: () => {
      // Always refetch after mutation to ensure server state is synced
      queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}
