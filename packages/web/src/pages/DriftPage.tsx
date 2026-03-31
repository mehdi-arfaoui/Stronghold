import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { checkDrift, listDriftEvents } from '@/api/drift';
import { listScans } from '@/api/scans';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { CardSkeleton } from '@/components/common/Skeleton';
import { DriftTimeline } from '@/components/drift/DriftTimeline';
import { useAsync } from '@/hooks/use-async';
import { useAppStore } from '@/store/app-store';

export default function DriftPage(): JSX.Element {
  const navigate = useNavigate();
  const setCurrentScanId = useAppStore((state) => state.setCurrentScanId);

  const fetchDrift = useCallback(async () => {
    const scansResult = await listScans({ limit: 5 });
    const completedScans = scansResult.scans.filter((scan) => scan.status === 'COMPLETED');
    const currentScan = completedScans[0] ?? null;
    const baselineScan = completedScans[1] ?? null;
    if (!currentScan || !baselineScan) {
      return {
        currentScan,
        baselineScan,
        events: [],
      };
    }
    let eventsResponse = await listDriftEvents(currentScan.id);
    if (eventsResponse.events.length === 0) {
      await checkDrift({
        currentScanId: currentScan.id,
        baselineScanId: baselineScan.id,
      });
      eventsResponse = await listDriftEvents(currentScan.id);
    }

    return {
      currentScan,
      baselineScan,
      events: eventsResponse.events,
    };
  }, []);

  const { data, error, isLoading, retry } = useAsync(fetchDrift);

  useEffect(() => {
    setCurrentScanId(data?.currentScan?.id ?? null);
  }, [data?.currentScan?.id, setCurrentScanId]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error.message} onRetry={retry} />;
  }

  if (!data?.currentScan || !data.baselineScan) {
    return (
      <EmptyState
        title="No drift events"
        description="Run at least two completed scans to detect infrastructure changes."
      />
    );
  }

  const drpStale = data.events.some((event) => event.drpStale);

  return (
    <div className="space-y-6">
      {drpStale ? (
        <section className="rounded-2xl border border-warning/25 bg-warning-soft p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-warning-foreground">The latest drift event indicates that the DRP may be stale.</p>
            <button
              type="button"
              onClick={() => navigate(`/drp/${data.currentScan?.id ?? ''}`)}
              className="rounded-xl bg-warning px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-warning/90"
            >
              Regenerate DRP
            </button>
          </div>
        </section>
      ) : null}
      {data.events.length === 0 ? (
        <EmptyState
          title="No drift events"
          description="No changes have been recorded for the current scan pair."
        />
      ) : (
        <DriftTimeline events={data.events} />
      )}
    </div>
  );
}
