import type { DRPComponent } from '@stronghold-dr/core';
import { useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';

import { exportPlan, generatePlan } from '@/api/plans';
import { getLatestScan } from '@/api/scans';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { CardSkeleton } from '@/components/common/Skeleton';
import { DRPTimeline } from '@/components/drp/DRPTimeline';
import { useAsync } from '@/hooks/use-async';
import { downloadTextFile, kebabCase } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

function containsUnverifiedRto(components: readonly DRPComponent[]): boolean {
  return components.some((component) => component.effectiveRTO?.chainContainsUnverified);
}

export default function DRPPage(): JSX.Element {
  const { scanId } = useParams();
  const setCurrentScanId = useAppStore((state) => state.setCurrentScanId);

  const fetchPlan = useCallback(async () => {
    const latest = scanId ? null : await getLatestScan();
    const resolvedScanId = scanId ?? latest?.id ?? null;
    if (!resolvedScanId) {
      return null;
    }

    const result = await generatePlan(resolvedScanId);
    return {
      resolvedScanId,
      plan: result.plan,
      validation: result.validation,
    };
  }, [scanId]);

  const { data, error, isLoading, retry } = useAsync(fetchPlan);

  useEffect(() => {
    setCurrentScanId(data?.resolvedScanId ?? null);
  }, [data?.resolvedScanId, setCurrentScanId]);

  const handleExport = async (format: 'yaml' | 'json'): Promise<void> => {
    if (!data) {
      return;
    }

    const content = await exportPlan(data.resolvedScanId, format);
    downloadTextFile(
      content,
      `stronghold-plan-${kebabCase(data.resolvedScanId)}.${format}`,
      format === 'json' ? 'application/json' : 'text/yaml',
    );
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

  if (!data) {
    return (
      <EmptyState
        title="No DR plan"
        description="Run a completed scan to generate a recovery plan."
      />
    );
  }

  if (!data.plan) {
    return <ErrorState message="The generated DR plan payload is incomplete." onRetry={retry} />;
  }

  const unverified = data.plan.services.some((service) => containsUnverifiedRto(service.components));

  return (
    <div className="space-y-6">
      {unverified ? (
        <section className="rounded-2xl border border-warning/25 bg-warning-soft p-4 text-sm text-warning-foreground">
          Some components have unverified RTOs. Run restore tests to validate.
        </section>
      ) : null}
      <section className="panel p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">DR plan</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">Generated recovery sequence</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.plan.services.length} services | {data.plan.metadata.coveredResources} covered resources | valid {String(data.validation.isValid)}
            </p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => void handleExport('yaml')} className="btn-secondary">
              Export YAML
            </button>
            <button type="button" onClick={() => void handleExport('json')} className="btn-primary">
              Export JSON
            </button>
          </div>
        </div>
      </section>
      <DRPTimeline plan={data.plan} />
    </div>
  );
}
