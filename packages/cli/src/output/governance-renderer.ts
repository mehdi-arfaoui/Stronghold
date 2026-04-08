import {
  materializeRiskAcceptances,
  type GovernanceConfig,
  type RiskAcceptance,
} from '@stronghold-dr/core';

import type { ScanResults } from '../storage/file-store.js';
import { sortServiceEntries } from './service-helpers.js';

export interface GovernanceValidationItem {
  readonly status: 'ok' | 'warn' | 'error';
  readonly label: string;
  readonly message: string;
}

export interface GovernanceValidationResult {
  readonly ownership: readonly GovernanceValidationItem[];
  readonly riskAcceptances: readonly GovernanceValidationItem[];
  readonly policies: readonly GovernanceValidationItem[];
  readonly valid: boolean;
}

export function renderGovernanceOverview(
  governance: GovernanceConfig,
  scan: ScanResults | null,
  asOf = new Date(),
): string {
  const lines = [`DR Governance - ${asOf.toISOString().slice(0, 10)}`, ''];
  const scanServices = scan?.servicePosture?.services ?? [];
  const acceptances =
    scan?.governance?.riskAcceptances ??
    materializeRiskAcceptances(governance.riskAcceptances).map((acceptance) => ({
      ...acceptance,
      status: Date.parse(acceptance.expiresAt) <= asOf.getTime() ? 'expired' : 'active',
    }));
  const policyViolations = scan?.governance?.policyViolations ?? [];
  const violationCountByPolicyId = new Map<string, number>();

  policyViolations.forEach((violation: NonNullable<NonNullable<ScanResults['governance']>['policyViolations']>[number]) => {
    violationCountByPolicyId.set(
      violation.policyId,
      (violationCountByPolicyId.get(violation.policyId) ?? 0) + 1,
    );
  });

  lines.push('  Ownership:');
  if (scanServices.length > 0) {
    for (const service of sortServiceEntries(scanServices)) {
      lines.push(
        `    ${ownerPrefix(service.service.governance?.ownerStatus ?? 'none')} ${service.service.id.padEnd(12)} ${formatOwnerLabel(service.service)}`,
      );
    }
  } else {
    const ownershipEntries = Object.entries(governance.ownership);
    if (ownershipEntries.length === 0) {
      lines.push('    No ownership entries declared.');
    } else {
      ownershipEntries
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([serviceId, entry]) => {
          lines.push(
            `    ${entry.confirmed ? 'OK' : 'WARN'} ${serviceId.padEnd(12)} ${entry.owner}${entry.confirmed ? ' confirmed' : ' unconfirmed'}`,
          );
        });
    }
  }

  lines.push('');
  lines.push('  Risk Acceptances:');
  if (acceptances.length === 0) {
    lines.push('    No risk acceptances declared.');
  } else {
    acceptances.forEach((acceptance: RiskAcceptance) => {
      lines.push(
        `    ${acceptancePrefix(acceptance.status)} ${acceptance.id.padEnd(7)} ${acceptance.findingKey.padEnd(40)} ${formatAcceptanceStatus(acceptance, asOf)}`,
      );
    });
  }

  lines.push('');
  lines.push('  Policies:');
  if (governance.policies.length === 0) {
    lines.push('    No custom policies declared.');
  } else {
    governance.policies.forEach((policy) => {
      lines.push(
        `    ${policy.id.padEnd(8)} "${policy.name}"  ${violationCountByPolicyId.get(policy.id) ?? 0} violation${(violationCountByPolicyId.get(policy.id) ?? 0) === 1 ? '' : 's'}`,
      );
    });
  }

  lines.push('');
  lines.push('  Summary:');
  if (scanServices.length > 0) {
    const assignedOwners = scanServices.filter(
      (service: NonNullable<NonNullable<ScanResults['servicePosture']>['services']>[number]) =>
        service.service.governance?.ownerStatus !== 'none' || service.service.owner,
    ).length;
    const unconfirmedOwners = scanServices.filter(
      (service: NonNullable<NonNullable<ScanResults['servicePosture']>['services']>[number]) =>
        service.service.governance?.ownerStatus === 'unconfirmed',
    ).length;
    lines.push(
      `    ${assignedOwners}/${scanServices.length} services have owners (${unconfirmedOwners} unconfirmed)`,
    );
  } else {
    lines.push(
      `    ${Object.keys(governance.ownership).length} ownership entr${Object.keys(governance.ownership).length === 1 ? 'y' : 'ies'} declared`,
    );
  }
  const activeAcceptances = acceptances.filter(
    (acceptance: RiskAcceptance) => acceptance.status === 'active',
  ).length;
  const expiredAcceptances = acceptances.filter(
    (acceptance: RiskAcceptance) => acceptance.status === 'expired',
  ).length;
  lines.push(
    `    ${activeAcceptances} active risk acceptance${activeAcceptances === 1 ? '' : 's'}, ${expiredAcceptances} expired`,
  );
  lines.push(
    `    ${policyViolations.length} policy violation${policyViolations.length === 1 ? '' : 's'} across ${governance.policies.length} polic${governance.policies.length === 1 ? 'y' : 'ies'}`,
  );

  if (!scan) {
    lines.push(`    Run 'stronghold scan' to evaluate governance against the latest posture.`);
  }

  return lines.join('\n');
}

export function renderGovernanceValidation(
  result: GovernanceValidationResult,
): string {
  const lines = ['Governance Validation:', ''];
  appendValidationSection(lines, 'Ownership', result.ownership, 'No ownership entries declared.');
  lines.push('');
  appendValidationSection(
    lines,
    'Risk Acceptances',
    result.riskAcceptances,
    'No risk acceptances declared.',
  );
  lines.push('');
  appendValidationSection(lines, 'Policies', result.policies, 'No policies declared.');

  return lines.join('\n');
}

export function renderGovernanceTip(): string {
  return `Tip: Create governance policies with 'stronghold governance init'`;
}

function appendValidationSection(
  lines: string[],
  title: string,
  items: readonly GovernanceValidationItem[],
  emptyMessage: string,
): void {
  lines.push(`  ${title}:`);
  if (items.length === 0) {
    lines.push(`    ${emptyMessage}`);
    return;
  }

  items.forEach((item) => {
    lines.push(`    ${statusPrefix(item.status)} ${item.label} - ${item.message}`);
  });
}

function statusPrefix(status: GovernanceValidationItem['status']): string {
  if (status === 'ok') {
    return 'OK';
  }
  if (status === 'warn') {
    return 'WARN';
  }
  return 'ERR';
}

function ownerPrefix(status: 'confirmed' | 'unconfirmed' | 'review_due' | 'none'): string {
  if (status === 'confirmed') {
    return 'OK';
  }
  if (status === 'none') {
    return '--';
  }
  return 'WARN';
}

function formatOwnerLabel(
  service: NonNullable<NonNullable<ScanResults['servicePosture']>['services'][number]>['service'],
): string {
  const governance = service.governance;
  const owner = governance?.owner ?? service.owner;
  if (!governance) {
    return owner ? `${owner} (declared)` : 'not assigned';
  }
  if (!owner || governance.ownerStatus === 'none') {
    return 'not assigned';
  }
  if (governance.ownerStatus === 'confirmed') {
    return `${owner} confirmed`;
  }
  if (governance.ownerStatus === 'review_due') {
    return `${owner} review due`;
  }
  return `${owner} unconfirmed`;
}

function acceptancePrefix(status: RiskAcceptance['status']): string {
  if (status === 'active') {
    return 'OK';
  }
  return 'ERR';
}

function formatAcceptanceStatus(acceptance: RiskAcceptance, asOf: Date): string {
  const days = signedDiffDays(asOf, new Date(acceptance.expiresAt));
  if (acceptance.status === 'expired') {
    return `EXPIRED (${Math.abs(days)} days ago)`;
  }
  if (acceptance.status === 'superseded') {
    return 'SUPERSEDED';
  }
  return `active (${days} days remaining)`;
}

function signedDiffDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
