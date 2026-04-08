import type { ApiServiceSummary } from '@stronghold-dr/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getServiceHistory } from '@/api/history';
import { getServiceDetail, listServices, redetectServices } from '@/api/services';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { CardSkeleton } from '@/components/common/Skeleton';
import { ServiceCard } from '@/components/services/ServiceCard';
import { ServiceDetail } from '@/components/services/ServiceDetail';
import { useAsync } from '@/hooks/use-async';

function sortServices(left: ApiServiceSummary, right: ApiServiceSummary): number {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return (
    rank[left.score.criticality] - rank[right.score.criticality] ||
    left.score.score - right.score.score ||
    left.service.name.localeCompare(right.service.name)
  );
}

export default function ServicesPage(): JSX.Element {
  const navigate = useNavigate();
  const [criticalityFilter, setCriticalityFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  const servicesState = useAsync(listServices);
  const detailState = useAsync(
    useCallback(async () => {
      if (!selectedServiceId) {
        return null;
      }
      return getServiceDetail(selectedServiceId);
    }, [selectedServiceId]),
  );
  const historyState = useAsync(
    useCallback(async () => {
      if (!selectedServiceId) {
        return null;
      }
      return getServiceHistory(selectedServiceId).catch(() => null);
    }, [selectedServiceId]),
  );

  useEffect(() => {
    if (!servicesState.data?.services.length) {
      return;
    }
    if (!selectedServiceId) {
      setSelectedServiceId(servicesState.data.services[0]?.service.id ?? null);
    }
  }, [selectedServiceId, servicesState.data?.services]);

  const visibleServices = useMemo(
    () =>
      (servicesState.data?.services ?? [])
        .filter((service) =>
          criticalityFilter === 'all' ? true : service.score.criticality === criticalityFilter,
        )
        .slice()
        .sort(sortServices),
    [criticalityFilter, servicesState.data?.services],
  );

  if (servicesState.isLoading) {
    return (
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (servicesState.error) {
    return <ErrorState message={servicesState.error.message} onRetry={servicesState.retry} />;
  }

  if (!servicesState.data || servicesState.data.services.length === 0) {
    return (
      <EmptyState
        title="No services detected"
        description="Run a scan or detect services from the latest scan to unlock the service-centric view."
        actionLabel="Go to Scan"
        onAction={() => navigate('/scan')}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Services</p>
            <h2 className="mt-2 text-3xl font-semibold text-foreground">{servicesState.data.services.length} detected services</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Unassigned resources: {servicesState.data.unassigned.resourceCount}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              value={criticalityFilter}
              onChange={(event) => setCriticalityFilter(event.target.value as typeof criticalityFilter)}
              className="input-field"
            >
              <option value="all">All criticalities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                void redetectServices()
                  .then(() => {
                    servicesState.retry();
                    detailState.retry();
                    historyState.retry();
                  })
                  .catch(() => undefined);
              }}
            >
              Re-detect
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-3">
          {visibleServices.map((service) => (
            <ServiceCard
              key={service.service.id}
              service={service}
              selected={service.service.id === selectedServiceId}
              onClick={() => setSelectedServiceId(service.service.id)}
            />
          ))}
        </div>
        {detailState.isLoading || historyState.isLoading ? (
          <CardSkeleton />
        ) : detailState.error ? (
          <ErrorState message={detailState.error.message} onRetry={detailState.retry} />
        ) : (
          <ServiceDetail
            detail={detailState.data?.service ?? null}
            history={historyState.data}
            onOpenGraph={(serviceId) => navigate(`/graph?service=${serviceId}`)}
          />
        )}
      </div>
    </div>
  );
}
