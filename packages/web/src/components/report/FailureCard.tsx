import type { WeightedValidationResult } from '@stronghold-dr/core';

import { getStatusColor, humanBlastRadius } from '@/lib/utils';

function describeConsequence(result: WeightedValidationResult): string {
  const consequences: Record<string, string> = {
    backup: 'Recovery will rely on stale or missing recovery points.',
    redundancy: 'A single component failure can interrupt service availability.',
    failover: 'Automatic failover is unlikely to meet the expected recovery target.',
    detection: 'An outage may remain invisible long enough to extend downtime.',
    recovery: 'Manual intervention and sequencing risk will increase during restore.',
    replication: 'Cross-region or secondary capacity may not have the required data.',
  };

  return consequences[result.category] ?? 'Recovery confidence is degraded for this resource chain.';
}

export function FailureCard({
  result,
}: {
  readonly result: WeightedValidationResult;
}): JSX.Element {
  const impactCount = result.weightBreakdown.directDependentCount;

  return (
    <article className="panel-elevated p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-foreground">{result.nodeName}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{result.message}</p>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white"
          style={{ backgroundColor: getStatusColor(result.status) }}
        >
          {result.status}
        </span>
      </div>
      <p className="mt-3 text-sm text-subtle-foreground">Impact: {humanBlastRadius(impactCount)}</p>
      <p className="mt-2 text-sm text-muted-foreground">{describeConsequence(result)}</p>
      <p className="mt-2 text-sm text-accent-soft-foreground">-&gt; {result.remediation ?? 'Review this control and confirm the restore path.'}</p>
    </article>
  );
}
