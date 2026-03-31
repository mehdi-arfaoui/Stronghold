import type { DRCategory, ValidationSeverity, WeightedValidationResult } from '@stronghold-dr/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { getValidationReportMarkdown } from '@/api/reports';
import { getLatestScan } from '@/api/scans';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { InfraDisclaimer } from '@/components/common/InfraDisclaimer';
import { CardSkeleton, TableSkeleton } from '@/components/common/Skeleton';
import { ScoreBreakdown } from '@/components/report/ScoreBreakdown';
import { ValidationResults } from '@/components/report/ValidationResults';
import { useReport } from '@/hooks/use-report';
import { useAsync } from '@/hooks/use-async';
import { downloadTextFile, kebabCase } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

const SEVERITY_OPTIONS: readonly ValidationSeverity[] = ['critical', 'high', 'medium', 'low'];
const CATEGORY_OPTIONS: readonly DRCategory[] = ['backup', 'redundancy', 'failover', 'detection', 'recovery', 'replication'];

function byWeightDesc(left: WeightedValidationResult, right: WeightedValidationResult): number {
  return right.weight - left.weight;
}

export default function ReportPage(): JSX.Element {
  const { scanId } = useParams();
  const [searchParams] = useSearchParams();
  const [categoryFilter, setCategoryFilter] = useState<DRCategory | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<ValidationSeverity | 'all'>('all');
  const setCurrentScanId = useAppStore((state) => state.setCurrentScanId);
  const nodeFilter = searchParams.get('node');

  const fetchFallbackScan = useCallback(async () => getLatestScan(), []);
  const latestScanState = useAsync(fetchFallbackScan);
  const resolvedScanId = scanId ?? latestScanState.data?.id ?? null;
  const reportState = useReport(resolvedScanId);

  useEffect(() => {
    setCurrentScanId(resolvedScanId);
  }, [resolvedScanId, setCurrentScanId]);

  const filteredResults = useMemo(() => {
    const baseResults = reportState.data?.results ?? [];
    return baseResults
      .filter((result) => (categoryFilter === 'all' ? true : result.category === categoryFilter))
      .filter((result) => (severityFilter === 'all' ? true : result.severity === severityFilter))
      .filter((result) => (nodeFilter ? result.nodeId === nodeFilter : true))
      .sort(byWeightDesc);
  }, [categoryFilter, nodeFilter, reportState.data?.results, severityFilter]);

  const handleJsonExport = (): void => {
    if (!reportState.data || !resolvedScanId) {
      return;
    }

    downloadTextFile(
      JSON.stringify(
        {
          ...reportState.data,
          results: filteredResults,
        },
        null,
        2,
      ),
      `stronghold-report-${kebabCase(resolvedScanId)}.json`,
      'application/json',
    );
  };

  const handleMarkdownExport = async (): Promise<void> => {
    if (!resolvedScanId) {
      return;
    }

    const markdown = await getValidationReportMarkdown(resolvedScanId, {
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      severity: severityFilter === 'all' ? undefined : severityFilter,
    });
    downloadTextFile(markdown, `stronghold-report-${kebabCase(resolvedScanId)}.md`, 'text/markdown');
  };

  if (!scanId && latestScanState.isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (!scanId && latestScanState.error) {
    return <ErrorState message={latestScanState.error.message} onRetry={latestScanState.retry} />;
  }

  if (!resolvedScanId) {
    return (
      <EmptyState
        title="No report"
        description="Run a scan first to generate a validation report."
      />
    );
  }

  if (reportState.isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (reportState.error) {
    return <ErrorState message={reportState.error.message} onRetry={reportState.retry} />;
  }

  if (!reportState.data) {
    return (
      <EmptyState
        title="No report"
        description="Run a completed scan to populate this page."
      />
    );
  }

  return (
    <div className="space-y-6">
      <ScoreBreakdown report={reportState.data} filteredCount={filteredResults.length} />
      <section className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value as DRCategory | 'all')}
              className="input-field"
            >
              <option value="all">All categories</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSeverityFilter('all')}
                className={severityFilter === 'all' ? 'rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground' : 'btn-secondary-tight'}
              >
                All severities
              </button>
              {SEVERITY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSeverityFilter(option)}
                  className={severityFilter === option ? 'rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground' : 'btn-secondary-tight'}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => void handleMarkdownExport()} className="btn-secondary">
              Export Markdown
            </button>
            <button type="button" onClick={handleJsonExport} className="btn-primary">
              Export JSON
            </button>
          </div>
        </div>
        {nodeFilter ? (
          <p className="mt-4 text-sm text-accent-soft-foreground">Filtered to node {nodeFilter}</p>
        ) : null}
      </section>
      <ValidationResults results={filteredResults} />
      <InfraDisclaimer />
    </div>
  );
}
