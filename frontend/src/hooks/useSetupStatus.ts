import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/api/auth.api';
import { isInternalDemoContext } from '@/lib/demoContext';

export const setupStatusQueryKey = ['auth-setup-status'] as const;

export function useSetupStatus(enabled = true) {
  const demoBypass = isInternalDemoContext();
  const queryEnabled = enabled && !demoBypass;

  const query = useQuery({
    queryKey: setupStatusQueryKey,
    queryFn: async () => (await authApi.getSetupStatus()).data,
    enabled: queryEnabled,
    retry: 1,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  return {
    query,
    needsSetup: demoBypass ? false : query.data?.needsSetup ?? false,
    isLoading: queryEnabled ? query.isLoading : false,
  };
}
