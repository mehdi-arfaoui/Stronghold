import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/api/auth.api';

export const setupStatusQueryKey = ['auth-setup-status'] as const;

export function useSetupStatus(enabled = true) {
  const query = useQuery({
    queryKey: setupStatusQueryKey,
    queryFn: async () => (await authApi.getSetupStatus()).data,
    enabled,
    retry: 1,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  return {
    query,
    needsSetup: query.data?.needsSetup ?? false,
    isLoading: enabled ? query.isLoading : false,
  };
}
