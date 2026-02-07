import { useQuery } from '@tanstack/react-query';
import { analysisApi } from '@/api/analysis.api';

export function useResilienceScore() {
  return useQuery({
    queryKey: ['resilience-score'],
    queryFn: async () => {
      const { data } = await analysisApi.getResilienceScore();
      return data;
    },
  });
}
