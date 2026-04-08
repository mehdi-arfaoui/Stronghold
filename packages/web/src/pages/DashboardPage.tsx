import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { listExpiringEvidence } from '@/api/evidence';
import { getValidationSummary } from '@/api/reports';
import { listScans } from '@/api/scans';
import { listScenarios } from '@/api/scenarios';
import { listServices } from '@/api/services';
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
    const [summary, scenarios, services, evidence] = latestCompletedScan
      ? await Promise.all([
          getValidationSummary(latestCompletedScan.id),
          listScenarios().catch(() => null),
          listServices().catch(() => null),
          listExpiringEvidence().catch(() => null),
        ])
      : [null, null, null, null];
    return {
      scans: scansResult.scans,
      latestCompletedScan,
      summary,
      scenarios,
      services,
      evidence,
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
          scenarioSummary={data.scenarios?.summary ?? null}
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
                onClick={() => navigate('/scenarios')}
                className="btn-secondary text-left"
              >
                Scenario Analysis
              </button>
            </div>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">The dashboard now combines score, evidence, and scenario coverage so the most important recovery gaps stay visible at a glance.</p>
        </div>
      </div>
      <section className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Scenario alerts</p>
            <h3 className="mt-2 text-2xl font-semibold text-foreground">Top uncovered scenarios</h3>
          </div>
          <button type="button" onClick={() => navigate('/scenarios')} className="btn-secondary">
            Open Scenarios
          </button>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {(data.scenarios?.scenarios ?? [])
            .filter((scenario) => scenario.coverage?.verdict === 'uncovered' || scenario.coverage?.verdict === 'degraded')
            .slice(0, 3)
            .map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                onClick={() => navigate('/scenarios')}
                className="rounded-2xl border border-rose-500/20 bg-rose-500/8 p-4 text-left transition-colors duration-150 hover:border-rose-500/35"
              >
                <p className="text-xs uppercase tracking-[0.16em] text-rose-200">
                  {String(scenario.coverage?.verdict ?? 'unknown').replace('_', ' ')}
                </p>
                <div className="mt-2 text-lg font-semibold text-foreground">{scenario.name}</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {scenario.coverage?.summary ?? 'No recovery path is available for this disruption impact.'}
                </p>
              </button>
            ))}
          {!(data.scenarios?.scenarios ?? []).some((scenario) => scenario.coverage?.verdict === 'uncovered' || scenario.coverage?.verdict === 'degraded') ? (
            <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground lg:col-span-3">
              No uncovered or degraded scenarios on the latest completed scan.
            </div>
          ) : null}
        </div>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <CategoryBreakdown categories={data.summary?.categories ?? null} />
        <TopFailures failures={data.summary?.topFailures ?? []} />
      </div>
      <section className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Evidence alerts</p>
            <h3 className="mt-2 text-2xl font-semibold text-foreground">Re-test signals</h3>
          </div>
          <div className="rounded-full border border-border bg-card/70 px-4 py-2 text-sm text-muted-foreground">
            {data.evidence?.evidence.length ?? 0} alert{(data.evidence?.evidence.length ?? 0) === 1 ? '' : 's'}
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {data.evidence?.evidence.length ? (
            data.evidence.evidence.slice(0, 3).map((entry) => {
              const isExpired = entry.type === 'expired';
              return (
                <article
                  key={entry.id}
                  className={`rounded-2xl border p-4 ${
                    isExpired
                      ? 'border-red-500/30 bg-red-500/8'
                      : 'border-amber-500/30 bg-amber-500/8'
                  }`}
                >
                  <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">
                    {isExpired ? 'Expired evidence' : 'Expiring soon'}
                  </p>
                  <div className="mt-2 text-sm font-medium text-foreground">
                    {entry.subject.serviceId ?? 'unassigned'} / {entry.subject.nodeId}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {entry.source.origin === 'test'
                      ? `${entry.source.testType} ${entry.testResult?.status ?? entry.observation.value}`
                      : `${entry.observation.key} = ${String(entry.observation.value)}`}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.14em] text-subtle-foreground">
                    {entry.expiresAt ? `Expires ${entry.expiresAt.slice(0, 10)}` : 'No expiration date'}
                  </p>
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground lg:col-span-3">
              No expiring or expired evidence on the latest completed scan.
            </div>
          )}
        </div>
      </section>
      <section className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Service overview</p>
            <h3 className="mt-2 text-2xl font-semibold text-foreground">Worst services first</h3>
          </div>
          <button type="button" onClick={() => navigate('/services')} className="btn-secondary">
            Open Services
          </button>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {(data.services?.services ?? [])
            .slice()
            .sort((left, right) => left.score.score - right.score.score)
            .slice(0, 3)
            .map((service) => (
            <button
              key={service.service.id}
              type="button"
              onClick={() => navigate('/services')}
              className="rounded-2xl border border-border bg-card/70 p-4 text-left transition-colors duration-150 hover:border-accent/40"
            >
              <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">{service.score.criticality}</p>
              <div className="mt-2 text-lg font-semibold text-foreground">{service.service.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {service.score.score}/100 • Grade {service.score.grade}
              </div>
            </button>
          ))}
          {!(data.services?.services.length) ? (
            <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No persisted services snapshot yet. Run a completed scan to populate this section.
            </div>
          ) : null}
        </div>
      </section>
      <RecentScans scans={data.scans} />
    </div>
  );
}
