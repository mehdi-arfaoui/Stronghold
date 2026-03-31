import { Link } from 'react-router-dom';

import { ErrorState } from '@/components/common/ErrorState';
import { CardSkeleton } from '@/components/common/Skeleton';
import { useScan } from '@/hooks/use-scan';
import { getStatusColor, themeColor } from '@/lib/utils';

function progressValue(status: string): number {
  if (status === 'PENDING') {
    return 20;
  }
  if (status === 'RUNNING') {
    return 72;
  }
  return 100;
}

export function ScanProgress({
  scanId,
}: {
  readonly scanId: string | null;
}): JSX.Element {
  const { scan, error, isLoading, isPending, retry } = useScan(scanId);

  if (!scanId) {
    return (
      <section className="panel p-6">
        <p className="text-sm text-muted-foreground">Submit a scan to track progress here.</p>
      </section>
    );
  }

  if (isLoading) {
    return <CardSkeleton />;
  }

  if (error) {
    return <ErrorState message={error.message} onRetry={retry} />;
  }

  if (!scan) {
    return (
      <section className="panel p-6">
        <p className="text-sm text-muted-foreground">Scan status is not available yet.</p>
      </section>
    );
  }

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Current scan</p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">{scan.status}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isPending ? 'Stronghold is polling the server with a progressive backoff.' : 'Polling stopped.'}
          </p>
        </div>
        {scan.status === 'COMPLETED' ? (
          <Link
            to={`/report/${scan.id}`}
            className="rounded-xl bg-success px-4 py-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-success/90"
          >
            View Report
          </Link>
        ) : null}
      </div>
      <div className="mt-6 h-3 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-150"
          style={{
            width: `${progressValue(scan.status)}%`,
            backgroundColor: scan.status === 'FAILED' ? getStatusColor('fail') : themeColor('accent'),
          }}
        />
      </div>
      {scan.status === 'FAILED' && scan.errorMessage ? (
        <p className="mt-4 text-sm text-danger-foreground">{scan.errorMessage}</p>
      ) : null}
    </section>
  );
}
