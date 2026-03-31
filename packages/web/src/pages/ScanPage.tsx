import { useState } from 'react';

import { createScan } from '@/api/scans';
import { ErrorState } from '@/components/common/ErrorState';
import { CardSkeleton } from '@/components/common/Skeleton';
import { ScanForm } from '@/components/scan/ScanForm';
import { ScanHistory } from '@/components/scan/ScanHistory';
import { ScanProgress } from '@/components/scan/ScanProgress';
import { useScans } from '@/hooks/use-scans';
import { useAppStore } from '@/store/app-store';

export default function ScanPage(): JSX.Element {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentScanId = useAppStore((state) => state.currentScanId);
  const setCurrentScanId = useAppStore((state) => state.setCurrentScanId);
  const { data, error, isLoading, retry } = useScans({ limit: 10 });

  const handleSubmit = async (input: {
    readonly provider: 'aws';
    readonly regions: readonly string[];
    readonly services?: readonly string[];
  }): Promise<void> => {
    setIsSubmitting(true);
    try {
      const result = await createScan(input);
      setCurrentScanId(result.scanId);
      retry();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error.message} onRetry={retry} />;
  }

  return (
    <div className="space-y-6">
      <ScanForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      <ScanProgress scanId={currentScanId} />
      <ScanHistory scans={data?.scans ?? []} />
    </div>
  );
}
