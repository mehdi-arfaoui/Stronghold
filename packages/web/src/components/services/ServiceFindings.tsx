import type { ContextualFinding } from '@stronghold-dr/core';

function severityTone(severity: ContextualFinding['severity']): string {
  if (severity === 'critical') return 'border-red-500/35 bg-red-500/8';
  if (severity === 'high') return 'border-orange-500/35 bg-orange-500/8';
  if (severity === 'medium') return 'border-amber-500/35 bg-amber-500/8';
  return 'border-border bg-card/60';
}

export function ServiceFindings({
  findings,
}: {
  readonly findings: readonly ContextualFinding[];
}): JSX.Element {
  if (findings.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        No open contextual findings for this service.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {findings.map((finding) => (
        <article
          key={`${finding.nodeId}:${finding.ruleId}`}
          className={`rounded-2xl border p-4 ${severityTone(finding.severity)}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">{finding.severity}</p>
              <h4 className="mt-1 text-base font-semibold text-foreground">{finding.nodeName}</h4>
            </div>
            <div className="rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground">
              {finding.resourceRole}
            </div>
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">{finding.drImpact.summary}</p>
          <p className="mt-2 text-sm text-muted-foreground">{finding.drImpact.recoveryImplication}</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl bg-card/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Technical impact</p>
              <p className="mt-2 text-sm text-foreground">{finding.technicalImpact.observation}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {finding.technicalImpact.metadataKey}: {String(finding.technicalImpact.metadataValue ?? 'unknown')} (expected {finding.technicalImpact.expectedValue})
              </p>
            </div>
            <div className="rounded-xl bg-card/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Remediation</p>
              {finding.remediation?.actions[0] ? (
                <>
                  <p className="mt-2 text-sm text-foreground">{finding.remediation.actions[0].title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Risk: {finding.remediation.risk} • Score delta: +{finding.remediation.estimatedScoreDelta}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No mapped remediation available yet.</p>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
