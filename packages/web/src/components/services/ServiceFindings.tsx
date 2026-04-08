import type { ContextualFinding, Evidence } from '@stronghold-dr/core';

import { RiskAcceptanceBadge } from '@/components/governance/RiskAcceptanceBadge';
import { cn } from '@/lib/utils';

function severityTone(severity: ContextualFinding['severity']): string {
  if (severity === 'critical') return 'border-red-500/35 bg-red-500/8';
  if (severity === 'high') return 'border-orange-500/35 bg-orange-500/8';
  if (severity === 'medium') return 'border-amber-500/35 bg-amber-500/8';
  return 'border-border bg-card/60';
}

function evidenceTone(type: string): string {
  if (type === 'tested') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
  if (type === 'expired') return 'border-red-500/30 bg-red-500/10 text-red-100';
  if (type === 'declared') return 'border-sky-500/30 bg-sky-500/10 text-sky-100';
  if (type === 'inferred') return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
  return 'border-border bg-card/70 text-muted-foreground';
}

function formatEvidenceLine(entry: Evidence): string {
  if (entry.source.origin === 'test') {
    const duration = entry.testResult?.duration ? ` (${entry.testResult.duration})` : '';
    return `${entry.source.testType} ${entry.testResult?.status ?? entry.observation.value}${duration}`;
  }
  return `${entry.observation.key} = ${String(entry.observation.value ?? 'null')}`;
}

function policyTone(severity: ContextualFinding['severity']): string {
  if (severity === 'critical') return 'border-red-500/30 bg-red-500/10 text-red-100';
  if (severity === 'high') return 'border-orange-500/30 bg-orange-500/10 text-orange-100';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
}

function PolicyViolationBadge({
  finding,
}: {
  readonly finding: ContextualFinding;
}): JSX.Element | null {
  if (!finding.policyViolations?.length) {
    return null;
  }

  const highestSeverity = finding.policyViolations.some((entry) => entry.severity === 'critical')
    ? 'critical'
    : finding.policyViolations.some((entry) => entry.severity === 'high')
      ? 'high'
      : 'medium';

  return (
    <details className="group">
      <summary
        className={cn(
          'list-none cursor-pointer rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em]',
          policyTone(highestSeverity),
        )}
      >
        policy violation
      </summary>
      <div className="mt-3 max-w-sm space-y-2 rounded-2xl border border-border bg-card/95 p-4 shadow-lg shadow-black/10">
        {finding.policyViolations.map((violation) => (
          <div key={`${violation.policyId}:${violation.findingKey}`} className="rounded-xl bg-card/70 p-3">
            <p className="text-sm font-medium text-foreground">{violation.policyName}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-subtle-foreground">
              {violation.policyId} / {violation.severity}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{violation.message}</p>
          </div>
        ))}
      </div>
    </details>
  );
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
      {findings.map((finding) => {
        const strongestEvidence = finding.evidenceSummary?.strongestType ?? 'observed';
        const hasExpiredEvidence = finding.evidence?.some((entry) => entry.type === 'expired') ?? false;
        const isAccepted = finding.riskAccepted === true;

        return (
          <article
            key={`${finding.nodeId}:${finding.ruleId}`}
            className={cn(
              'rounded-2xl border p-4',
              isAccepted
                ? 'border-emerald-500/25 bg-emerald-500/8'
                : severityTone(finding.severity),
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">
                  {isAccepted ? 'accepted risk' : finding.severity}
                </p>
                <h4 className="mt-1 text-base font-semibold text-foreground">{finding.nodeName}</h4>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground">
                  {finding.resourceRole}
                </div>
                <div className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] ${evidenceTone(strongestEvidence)}`}>
                  {strongestEvidence}
                </div>
                {hasExpiredEvidence ? (
                  <div className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-red-100">
                    expired
                  </div>
                ) : null}
                {finding.riskAcceptance ? (
                  <RiskAcceptanceBadge acceptance={finding.riskAcceptance} />
                ) : null}
                <PolicyViolationBadge finding={finding} />
              </div>
            </div>
            {finding.riskAcceptance && !isAccepted ? (
              <p className="mt-3 text-sm text-muted-foreground">
                This acceptance is no longer suppressing the finding because it is
                {' '}
                {finding.riskAcceptance.status}.
              </p>
            ) : null}
            <p className="mt-3 text-sm font-medium text-foreground">{finding.drImpact.summary}</p>
            <p className="mt-2 text-sm text-muted-foreground">{finding.drImpact.recoveryImplication}</p>
            <div className="mt-3 grid gap-3 xl:grid-cols-3">
              <div className="rounded-xl bg-card/70 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Technical impact</p>
                <p className="mt-2 text-sm text-foreground">{finding.technicalImpact.observation}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {finding.technicalImpact.metadataKey}: {String(finding.technicalImpact.metadataValue ?? 'unknown')} (expected {finding.technicalImpact.expectedValue})
                </p>
              </div>
              <div className="rounded-xl bg-card/70 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Evidence</p>
                {finding.evidence?.length ? (
                  <div className="mt-2 space-y-2">
                    {finding.evidence.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-border/70 bg-card/60 p-2">
                        <p className="text-sm text-foreground">{formatEvidenceLine(entry)}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {entry.type} - {entry.timestamp.slice(0, 10)}
                          {entry.expiresAt ? ` - expires ${entry.expiresAt.slice(0, 10)}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No explicit evidence attached yet.</p>
                )}
              </div>
              <div className="rounded-xl bg-card/70 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Remediation</p>
                {finding.remediation?.actions[0] ? (
                  <>
                    <p className="mt-2 text-sm text-foreground">{finding.remediation.actions[0].title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Risk: {finding.remediation.risk} / Score delta: +{finding.remediation.estimatedScoreDelta}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No mapped remediation available yet.</p>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
