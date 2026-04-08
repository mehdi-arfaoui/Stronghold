import type { AuditAction, AuditEntry, AuditIdentity } from '../audit/audit-types.js';
import type { AuditLogger } from '../audit/audit-logger.js';
import type { ServicePosture } from '../services/service-posture-types.js';
import type { GovernanceState, RiskAcceptance } from './risk-acceptance.js';
import type { PolicyViolation } from './policy-types.js';

const STRONGHOLD_AUDIT_VERSION = '1.0.0';

export type GovernanceAuditAction = Extract<
  AuditAction,
  | 'risk_accept'
  | 'risk_expire'
  | 'risk_supersede'
  | 'ownership_confirm'
  | 'ownership_review_due'
  | 'policy_violation'
  | 'governance_edit'
>;

export interface GovernanceAuditEvent {
  readonly action: GovernanceAuditAction;
  readonly parameters: AuditEntry['parameters'];
}

export interface GovernanceAuditedScan {
  readonly timestamp: string;
  readonly servicePosture?: Pick<ServicePosture, 'services' | 'contextualFindings'> | null;
  readonly governance?: GovernanceState | null;
}

export function collectGovernanceAuditEvents(
  current: GovernanceAuditedScan,
  previous: GovernanceAuditedScan | null,
): readonly GovernanceAuditEvent[] {
  const events: GovernanceAuditEvent[] = [];
  const previousAcceptances = new Map(
    (previous?.governance?.riskAcceptances ?? []).map((acceptance) => [acceptance.id, acceptance] as const),
  );
  const currentSeverityByFindingKey = new Map(
    (current.servicePosture?.contextualFindings ?? []).map((finding) => [
      buildFindingKey(finding.ruleId, finding.nodeId),
      finding.severity,
    ] as const),
  );

  for (const acceptance of current.governance?.riskAcceptances ?? []) {
    const previousAcceptance = previousAcceptances.get(acceptance.id);
    if (acceptance.status === 'expired' && previousAcceptance?.status !== 'expired') {
      events.push({
        action: 'risk_expire',
        parameters: {
          acceptanceId: acceptance.id,
          findingKey: acceptance.findingKey,
          acceptedBy: acceptance.acceptedBy,
          expiresAt: acceptance.expiresAt,
        },
      });
    }

    if (
      acceptance.status === 'superseded' &&
      previousAcceptance?.status !== 'superseded'
    ) {
      events.push({
        action: 'risk_supersede',
        parameters: {
          acceptanceId: acceptance.id,
          findingKey: acceptance.findingKey,
          acceptedBy: acceptance.acceptedBy,
          severity:
            currentSeverityByFindingKey.get(acceptance.findingKey) ??
            acceptance.severityAtAcceptance,
          note: `Accepted as ${acceptance.severityAtAcceptance}.`,
        },
      });
    }
  }

  const previousServices = new Map(
    (previous?.servicePosture?.services ?? []).map((service) => [
      service.service.id,
      service.service,
    ] as const),
  );

  for (const serviceEntry of current.servicePosture?.services ?? []) {
    const currentGovernance = serviceEntry.service.governance;
    const owner = currentGovernance?.owner ?? serviceEntry.service.owner;
    const previousGovernance = previousServices.get(serviceEntry.service.id)?.governance;

    if (
      owner &&
      currentGovernance?.ownerStatus === 'confirmed' &&
      previousGovernance?.ownerStatus !== 'confirmed'
    ) {
      events.push({
        action: 'ownership_confirm',
        parameters: {
          serviceId: serviceEntry.service.id,
          owner,
          confirmedAt: currentGovernance.confirmedAt,
        },
      });
    }

    if (
      owner &&
      currentGovernance?.ownerStatus === 'review_due' &&
      previousGovernance?.ownerStatus !== 'review_due'
    ) {
      events.push({
        action: 'ownership_review_due',
        parameters: {
          serviceId: serviceEntry.service.id,
          owner,
          confirmedAt: currentGovernance.confirmedAt,
          nextReviewAt: currentGovernance.nextReviewAt,
        },
      });
    }
  }

  const previousViolationKeys = new Set(
    (previous?.governance?.policyViolations ?? []).map(buildPolicyViolationKey),
  );
  for (const violation of current.governance?.policyViolations ?? []) {
    if (previousViolationKeys.has(buildPolicyViolationKey(violation))) {
      continue;
    }

    events.push({
      action: 'policy_violation',
      parameters: {
        policyId: violation.policyId,
        policyName: violation.policyName,
        findingKey: violation.findingKey,
        ...(violation.serviceId ? { serviceId: violation.serviceId } : {}),
      },
    });
  }

  return events;
}

export function createRiskAcceptanceAuditEvent(
  acceptance: Pick<
    RiskAcceptance,
    'id' | 'findingKey' | 'acceptedBy' | 'justification' | 'expiresAt'
  >,
): GovernanceAuditEvent {
  return {
    action: 'risk_accept',
    parameters: {
      acceptanceId: acceptance.id,
      findingKey: acceptance.findingKey,
      acceptedBy: acceptance.acceptedBy,
      justification: acceptance.justification,
      expiresAt: acceptance.expiresAt,
    },
  };
}

export function createGovernanceEditAuditEvent(
  governancePath: string,
  note: string,
): GovernanceAuditEvent {
  return {
    action: 'governance_edit',
    parameters: {
      governancePath,
      note,
    },
  };
}

export async function logGovernanceAuditEvent(
  auditLogger: AuditLogger,
  event: GovernanceAuditEvent,
  options: {
    readonly timestamp?: string;
    readonly identity?: AuditIdentity;
    readonly result?: Omit<AuditEntry['result'], 'duration_ms'>;
  } = {},
): Promise<void> {
  await auditLogger.log({
    timestamp: options.timestamp ?? new Date().toISOString(),
    version: STRONGHOLD_AUDIT_VERSION,
    action: event.action,
    ...(options.identity ? { identity: options.identity } : {}),
    parameters: event.parameters,
    result: {
      status: options.result?.status ?? 'success',
      duration_ms: 0,
      ...(options.result?.resourceCount !== undefined
        ? { resourceCount: options.result.resourceCount }
        : {}),
      ...(options.result?.errorMessage ? { errorMessage: options.result.errorMessage } : {}),
    },
  });
}

export async function logGovernanceAuditEvents(
  auditLogger: AuditLogger,
  events: readonly GovernanceAuditEvent[],
  options: {
    readonly timestamp?: string;
    readonly identity?: AuditIdentity;
  } = {},
): Promise<void> {
  for (const event of events) {
    await logGovernanceAuditEvent(auditLogger, event, options);
  }
}

function buildFindingKey(ruleId: string, nodeId: string): string {
  return `${ruleId}::${nodeId}`;
}

function buildPolicyViolationKey(violation: PolicyViolation): string {
  return `${violation.policyId}::${violation.findingKey}`;
}
