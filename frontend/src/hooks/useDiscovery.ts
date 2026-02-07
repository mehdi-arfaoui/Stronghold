import { useQuery } from '@tanstack/react-query';
import { useDiscoveryStore } from '@/stores/discovery.store';
import { discoveryApi } from '@/api/discovery.api';
import { useEffect } from 'react';

export function useDiscovery(jobId?: string) {
  const { currentJob, setCurrentJob, setIsScanning } = useDiscoveryStore();

  const jobQuery = useQuery({
    queryKey: ['scan-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const { data } = await discoveryApi.getScanJob(jobId);
      setCurrentJob(data);
      setIsScanning(data.status === 'running' || data.status === 'pending');
      return data;
    },
    enabled: !!jobId,
    refetchInterval: currentJob?.status === 'running' || currentJob?.status === 'pending' ? 2000 : false,
  });

  useEffect(() => {
    if (jobQuery.data?.status === 'completed' || jobQuery.data?.status === 'failed') {
      setIsScanning(false);
    }
  }, [jobQuery.data?.status, setIsScanning]);

  return {
    ...jobQuery,
    job: currentJob,
    isScanning: currentJob?.status === 'running' || currentJob?.status === 'pending',
  };
}
