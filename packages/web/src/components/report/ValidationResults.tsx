import type { WeightedValidationResult } from '@stronghold-dr/core';

import { EmptyState } from '@/components/common/EmptyState';

import { FailureCard } from './FailureCard';

export function ValidationResults({
  results,
}: {
  readonly results: readonly WeightedValidationResult[];
}): JSX.Element {
  if (results.length === 0) {
    return (
      <EmptyState
        title="No matching results"
        description="Adjust the current filters to inspect more validation outcomes."
      />
    );
  }

  return (
    <div className="space-y-4">
      {results.map((result) => (
        <FailureCard key={`${result.ruleId}-${result.nodeId}`} result={result} />
      ))}
    </div>
  );
}
