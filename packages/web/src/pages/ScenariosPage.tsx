import type { ApiServiceSummary } from '@stronghold-dr/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listScenarios, getScenarioDetail } from '@/api/scenarios';
import { listServices } from '@/api/services';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { CardSkeleton } from '@/components/common/Skeleton';
import { ScenarioCard } from '@/components/scenarios/ScenarioCard';
import { ScenarioDetail } from '@/components/scenarios/ScenarioDetail';
import { useAsync } from '@/hooks/use-async';

export default function ScenariosPage(): JSX.Element {
  const navigate = useNavigate();
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);

  const scenariosState = useAsync(
    useCallback(async () => {
      const [scenarios, services] = await Promise.all([
        listScenarios(),
        listServices().catch(() => null),
      ]);
      return {
        scenarios,
        services,
      };
    }, []),
  );

  const detailState = useAsync(
    useCallback(async () => {
      if (!selectedScenarioId) {
        return null;
      }
      return getScenarioDetail(selectedScenarioId);
    }, [selectedScenarioId]),
  );

  useEffect(() => {
    if (!scenariosState.data?.scenarios.scenarios.length) {
      return;
    }
    if (!selectedScenarioId) {
      setSelectedScenarioId(scenariosState.data.scenarios.scenarios[0]?.id ?? null);
    }
  }, [scenariosState.data?.scenarios.scenarios, selectedScenarioId]);

  const servicesById = useMemo(
    () =>
      new Map(
        (scenariosState.data?.services?.services ?? []).map(
          (service: ApiServiceSummary) => [service.service.id, service] as const,
        ),
      ),
    [scenariosState.data?.services?.services],
  );

  if (scenariosState.isLoading) {
    return (
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (scenariosState.error) {
    return <ErrorState message={scenariosState.error.message} onRetry={scenariosState.retry} />;
  }

  if (!scenariosState.data || scenariosState.data.scenarios.scenarios.length === 0) {
    return (
      <EmptyState
        title="No scenarios available"
        description="Run a completed scan to generate scenario coverage analysis."
        actionLabel="Go to Scan"
        onAction={() => navigate('/scan')}
      />
    );
  }

  const scenarioSummary = scenariosState.data.scenarios.summary;

  return (
    <div className="space-y-6">
      <section className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Scenario coverage analysis</p>
            <h2 className="mt-2 text-3xl font-semibold text-foreground">
              {scenarioSummary.covered}/{scenarioSummary.total} scenarios covered
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {scenarioSummary.partiallyCovered} partial, {scenarioSummary.uncovered} uncovered, {scenarioSummary.degraded} degraded.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/graph')}
          >
            Open graph
          </button>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-3">
          {scenariosState.data.scenarios.scenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              selected={scenario.id === selectedScenarioId}
              onClick={() => setSelectedScenarioId(scenario.id)}
            />
          ))}
        </div>

        {detailState.isLoading ? (
          <CardSkeleton />
        ) : detailState.error ? (
          <ErrorState message={detailState.error.message} onRetry={detailState.retry} />
        ) : (
          <ScenarioDetail
            scenario={detailState.data?.scenario ?? null}
            servicesById={servicesById}
            onOpenGraph={(scenarioId) => navigate(`/graph?scenario=${scenarioId}`)}
            onOpenServices={() => navigate('/services')}
          />
        )}
      </div>
    </div>
  );
}
