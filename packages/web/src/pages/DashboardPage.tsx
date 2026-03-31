import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { getValidationSummary } from '@/api/reports';
import { listScans } from '@/api/scans';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { CardSkeleton } from '@/components/common/Skeleton';
import { CategoryBreakdown } from '@/components/dashboard/CategoryBreakdown';
import { RecentScans } from '@/components/dashboard/RecentScans';
import { ScoreCard } from '@/components/dashboard/ScoreCard';
import { TopFailures } from '@/components/dashboard/TopFailures';
import { useAsync } from '@/hooks/use-async';
import { useAppStore } from '@/store/app-store';

export default function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const setCurrentScanId = useAppStore((state) => state.setCurrentScanId);

  const fetchDashboard = useCallback(async () => {
    const scansResult = await listScans({ limit: 5 });
    const latestCompletedScan = scansResult.scans.find((scan) => scan.status === 'COMPLETED') ?? null;
    const summary = latestCompletedScan ? await getValidationSummary(latestCompletedScan.id) : null;
    return {
      scans: scansResult.scans,
      latestCompletedScan,
      summary,
    };
  }, []);

  const { data, error, isLoading, retry } = useAsync(fetchDashboard);

  useEffect(() => {
    setCurrentScanId(data?.latestCompletedScan?.id ?? null);
  }, [data?.latestCompletedScan?.id, setCurrentScanId]);

  if (isLoading) {
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error.message} onRetry={retry} />;
  }

  if (!data || data.scans.length === 0) {
    return (
      <EmptyState
        title="No scans yet"
        description="Run your first infrastructure scan to get a DR posture snapshot."
        actionLabel="Run your first scan"
        onAction={() => navigate('/scan')}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <ScoreCard
          score={data.summary?.score ?? data.latestCompletedScan?.score ?? null}
          grade={data.summary?.grade ?? data.latestCompletedScan?.grade ?? null}
          createdAt={data.latestCompletedScan?.createdAt}
        />
        <div className="panel flex flex-col justify-between p-6">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Quick actions</p>
            <div className="mt-4 grid gap-3">
              <button type="button" onClick={() => navigate('/scan')} className="btn-primary text-left">
                New Scan
              </button>
              <button
                type="button"
                onClick={() => navigate(data.latestCompletedScan ? `/report/${data.latestCompletedScan.id}` : '/report')}
                className="btn-secondary text-left"
              >
                View Report
              </button>
              <button
                type="button"
                onClick={() => navigate(data.latestCompletedScan ? `/drp/${data.latestCompletedScan.id}` : '/drp')}
                className="btn-secondary text-left"
              >
                Export DRP
              </button>
            </div>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">The dashboard surfaces the latest completed scan so recovery posture is visible at a glance.</p>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <CategoryBreakdown categories={data.summary?.categories ?? null} />
        <TopFailures failures={data.summary?.topFailures ?? []} />
      </div>
      <RecentScans scans={data.scans} />
    </div>
  );
}
