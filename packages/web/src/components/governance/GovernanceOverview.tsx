import type { ApiGovernanceResponse } from '@stronghold-dr/core';

import { cn } from '@/lib/utils';

import { describeAcceptanceWindow } from './governance-utils';

function summaryCardTone(hasWarning: boolean): string {
  return hasWarning
    ? 'border-amber-500/30 bg-amber-500/8'
    : 'border-border bg-card/70';
}

export function GovernanceOverview({
  governance,
  onOpenServices,
}: {
  readonly governance: ApiGovernanceResponse | null;
  readonly onOpenServices: () => void;
}): JSX.Element {
  const ownership = governance?.ownership ?? [];
  const confirmedOwners = ownership.filter((entry) => entry.ownerStatus === 'confirmed').length;
  const assignedOwners = ownership.filter((entry) => entry.ownerStatus !== 'none').length;
  const unconfirmedOwners = ownership.filter((entry) => entry.ownerStatus === 'unconfirmed').length;
  const reviewDueOwners = ownership.filter((entry) => entry.ownerStatus === 'review_due').length;
  const activeAcceptances = governance?.riskAcceptances.filter((entry) => entry.status === 'active') ?? [];
  const expiredAcceptances = governance?.riskAcceptances.filter((entry) => entry.status === 'expired').length ?? 0;
  const supersededAcceptances =
    governance?.riskAcceptances.filter((entry) => entry.status === 'superseded').length ?? 0;
  const policies = governance?.policies ?? [];
  const policyViolations = governance?.violations.length ?? 0;
  const hasGovernanceSignals =
    (governance?.riskAcceptances.length ?? 0) > 0 ||
    policies.length > 0 ||
    policyViolations > 0 ||
    ownership.some(
      (entry) =>
        entry.ownerStatus === 'confirmed' ||
        entry.ownerStatus === 'unconfirmed' ||
        entry.ownerStatus === 'review_due',
    );
  const nextAcceptanceExpiry = activeAcceptances
    .slice()
    .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))[0];
  const warnings = [
    reviewDueOwners > 0 ? `${reviewDueOwners} ownership review due` : null,
    unconfirmedOwners > 0 ? `${unconfirmedOwners} owner confirmation pending` : null,
    expiredAcceptances > 0
      ? `${expiredAcceptances} expired risk acceptance${expiredAcceptances === 1 ? '' : 's'}`
      : null,
    supersededAcceptances > 0
      ? `${supersededAcceptances} superseded risk acceptance${supersededAcceptances === 1 ? '' : 's'}`
      : null,
    policyViolations > 0
      ? `${policyViolations} policy violation${policyViolations === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean) as string[];

  return (
    <section className="panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Governance</p>
          <h3 className="mt-2 text-2xl font-semibold text-foreground">
            Ownership, acceptances, and policy pressure
          </h3>
        </div>
        <button type="button" onClick={onOpenServices} className="btn-secondary">
          Open Services
        </button>
      </div>

      {!hasGovernanceSignals ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No governance controls are recorded on the latest scan yet. Add a
          {' '}
          <span className="font-medium text-foreground">`.stronghold/governance.yml`</span>
          {' '}
          file to confirm owners, define policies, and track risk acceptances.
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <article className={cn('rounded-2xl border p-4', summaryCardTone(unconfirmedOwners > 0 || reviewDueOwners > 0))}>
              <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Owner coverage</p>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {confirmedOwners}/{ownership.length || 0}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Confirmed owners
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                {assignedOwners}/{ownership.length || 0} assigned,
                {' '}
                {unconfirmedOwners} unconfirmed,
                {' '}
                {reviewDueOwners} review due
              </p>
            </article>
            <article className={cn('rounded-2xl border p-4', summaryCardTone(expiredAcceptances > 0 || supersededAcceptances > 0))}>
              <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Risk acceptances</p>
              <div className="mt-2 text-2xl font-semibold text-foreground">{activeAcceptances.length}</div>
              <p className="mt-1 text-sm text-muted-foreground">Active acceptances</p>
              <p className="mt-3 text-sm text-muted-foreground">
                {expiredAcceptances} expired,
                {' '}
                {supersededAcceptances} superseded
              </p>
              {nextAcceptanceExpiry ? (
                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-subtle-foreground">
                  {describeAcceptanceWindow(nextAcceptanceExpiry)}
                </p>
              ) : null}
            </article>
            <article className={cn('rounded-2xl border p-4', summaryCardTone(policyViolations > 0))}>
              <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Policies</p>
              <div className="mt-2 text-2xl font-semibold text-foreground">{policies.length}</div>
              <p className="mt-1 text-sm text-muted-foreground">Custom DR policies</p>
              <p className="mt-3 text-sm text-muted-foreground">
                {policyViolations} active violation{policyViolations === 1 ? '' : 's'}
              </p>
            </article>
            <article className="rounded-2xl border border-border bg-card/70 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Score context</p>
              {governance?.score ? (
                <>
                  <div className="mt-2 text-2xl font-semibold text-foreground">
                    {governance.score.withAcceptances.score}/100
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    With acceptances, versus
                    {' '}
                    {governance.score.withoutAcceptances.score}/100 without
                  </p>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {governance.score.excludedFindings} finding{governance.score.excludedFindings === 1 ? '' : 's'} excluded from the adjusted score
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Governance-adjusted score details will appear after a governed scan is available.
                </p>
              )}
            </article>
          </div>

          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Warnings</p>
              <div className="rounded-full border border-border bg-card/70 px-3 py-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {warnings.length} signal{warnings.length === 1 ? '' : 's'}
              </div>
            </div>
            {warnings.length > 0 ? (
              warnings.map((warning) => (
                <div
                  key={warning}
                  className="rounded-2xl border border-amber-500/30 bg-amber-500/8 p-4 text-sm text-amber-100"
                >
                  {warning}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No governance warnings on the latest completed scan.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
