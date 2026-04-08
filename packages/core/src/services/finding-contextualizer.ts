import { getMetadata } from '../graph/analysis-helpers.js';
import type { Recommendation } from '../recommendations/recommendation-types.js';
import { allValidationRules, type InfraNode, type WeightedValidationResult } from '../validation/index.js';
import {
  resolveStrongestEvidenceConfidence,
  resolveStrongestEvidenceType,
  type Evidence,
} from '../evidence/index.js';
import { buildServiceIndex, classifyResourceRole } from './service-utils.js';
import type { ContextualFinding, RemediationAction } from './finding-types.js';
import { humanizeRuleId, resolveImpactTemplate } from './impact-templates.js';
import type { Service } from './service-types.js';
import type { Scenario } from '../scenarios/scenario-types.js';

interface TechnicalImpactHint {
  readonly metadataKey: string;
  readonly expectedValue: string;
  readonly detailKeys: readonly string[];
  readonly metadataKeys: readonly string[];
}

const TECHNICAL_IMPACT_HINTS: Readonly<Record<string, TechnicalImpactHint>> = {
  backup_configured: {
    metadataKey: 'backupRetentionPeriod',
    expectedValue: '> 0',
    detailKeys: ['retentionDays'],
    metadataKeys: ['backupRetentionPeriod', 'backupRetentionDays'],
  },
  multi_az: {
    metadataKey: 'multiAZ',
    expectedValue: 'enabled or >= 2 AZs',
    detailKeys: ['multiAZ', 'availabilityZones'],
    metadataKeys: ['multiAZ', 'multiAz', 'multi_az', 'isMultiAZ', 'availabilityZones'],
  },
  replication_configured: {
    metadataKey: 'replication',
    expectedValue: 'configured',
    detailKeys: ['replicaIds', 'replicaCount', 'replicas'],
    metadataKeys: ['readReplicaDBInstanceIdentifiers', 'replicationRules', 'replicationConfigurations', 'replicas'],
  },
  failover_dns: {
    metadataKey: 'routingPolicy',
    expectedValue: 'PRIMARY/SECONDARY failover routing',
    detailKeys: ['ttl'],
    metadataKeys: ['routingPolicy', 'ttl'],
  },
  monitoring_configured: {
    metadataKey: 'alarmActions',
    expectedValue: 'at least one alarm with a notification target',
    detailKeys: ['actionsEnabled', 'alarmActions'],
    metadataKeys: ['actionsEnabled', 'alarmActions'],
  },
  encryption_at_rest: {
    metadataKey: 'encryptionAtRest',
    expectedValue: 'enabled',
    detailKeys: ['encryptionAtRest'],
    metadataKeys: ['encryptionAtRest', 'storageEncrypted', 'kmsKeyId'],
  },
  point_in_time_recovery: {
    metadataKey: 'pointInTimeRecovery',
    expectedValue: 'enabled',
    detailKeys: ['pointInTimeRecovery', 'pitrEnabled'],
    metadataKeys: ['pointInTimeRecovery', 'pointInTimeRecoveryEnabled', 'pitrEnabled'],
  },
  auto_scaling: {
    metadataKey: 'autoScalingGroupName',
    expectedValue: 'attached to an Auto Scaling Group',
    detailKeys: ['autoScalingGroupName'],
    metadataKeys: ['autoScalingGroupName', 'asgName'],
  },
  health_check: {
    metadataKey: 'healthCheck',
    expectedValue: 'configured',
    detailKeys: ['healthCheck', 'healthyThreshold'],
    metadataKeys: ['healthCheck', 'healthCheckPath'],
  },
  dead_letter_queue: {
    metadataKey: 'deadLetterTargetArn',
    expectedValue: 'configured',
    detailKeys: ['targetArn', 'deadLetterTargetArn'],
    metadataKeys: ['deadLetterTargetArn', 'deadLetterQueueArn', 'redrivePolicy'],
  },
};

const RULE_NAME_BY_ID = new Map(allValidationRules.map((rule) => [rule.id, rule.name] as const));

export function contextualizeFindings(
  findings: readonly WeightedValidationResult[],
  nodes: readonly InfraNode[],
  services: readonly Service[],
  recommendations: readonly Recommendation[] = [],
): readonly ContextualFinding[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const serviceByNode = buildServiceIndex(services);
  const recommendationByFinding = new Map<string, Recommendation>();

  for (const recommendation of recommendations) {
    for (const affectedRule of recommendation.impact.affectedRules) {
      recommendationByFinding.set(`${recommendation.targetNode}:${affectedRule}`, recommendation);
    }
  }

  return findings.map((finding) => {
    const node = nodeById.get(finding.nodeId);
    if (!node) {
      throw new Error(`Unable to contextualize finding for unknown node "${finding.nodeId}".`);
    }

    const service = serviceByNode.get(finding.nodeId) ?? null;
    const resourceRole =
      service?.resources.find((resource) => resource.nodeId === finding.nodeId)?.role ??
      classifyResourceRole(node);
    const ruleName = RULE_NAME_BY_ID.get(finding.ruleId) ?? humanizeRuleId(finding.ruleId);
    const technicalImpact = buildTechnicalImpact(finding, node);
    const evidence = extractFindingEvidence(finding);
    const impactTemplate = resolveImpactTemplate(
      finding.ruleId,
      resourceRole,
      ruleName,
      finding.category,
    );
    const recommendation =
      recommendationByFinding.get(`${finding.nodeId}:${finding.ruleId}`) ??
      Array.from(recommendationByFinding.entries()).find(
        ([key]) => key.startsWith(`${finding.nodeId}:`) && key.endsWith(`:${finding.ruleId}`),
      )?.[1] ??
      null;

    return {
      ruleId: finding.ruleId,
      nodeId: finding.nodeId,
      nodeName: finding.nodeName,
      severity: finding.severity,
      category: finding.category,
      passed: finding.status === 'pass',
      serviceId: service?.id ?? null,
      serviceName: service?.name ?? null,
      resourceRole,
      technicalImpact,
      ...(evidence.length > 0
        ? {
            evidence,
            evidenceSummary: {
              strongestType: resolveStrongestEvidenceType(evidence),
              confidence: resolveStrongestEvidenceConfidence(evidence),
            },
          }
        : {}),
      drImpact: impactTemplate,
      scenarioImpact: null,
      remediation: recommendation
        ? {
            actions: [toRemediationAction(recommendation)],
            estimatedScoreDelta: recommendation.impact.scoreDelta,
            risk: recommendation.risk,
          }
        : null,
    };
  });
}

export function populateScenarioImpact(
  findings: readonly ContextualFinding[],
  scenarios: readonly Scenario[],
): readonly ContextualFinding[] {
  return findings.map((finding) => {
    const affectedScenarios = scenarios.filter((scenario) =>
      isNodeAffectedInScenario(scenario, finding.nodeId),
    );
    if (affectedScenarios.length === 0) {
      return {
        ...finding,
        scenarioImpact: null,
      };
    }

    const worstScenario = selectWorstScenario(affectedScenarios, finding.serviceId);
    return {
      ...finding,
      scenarioImpact: {
        affectedScenarios: affectedScenarios.map((scenario) => scenario.id),
        worstCaseOutcome: renderWorstCaseOutcome(worstScenario, finding.serviceId),
      },
    };
  });
}

function extractFindingEvidence(finding: WeightedValidationResult): readonly Evidence[] {
  return 'evidence' in finding && Array.isArray(finding.evidence) ? finding.evidence : [];
}

function buildTechnicalImpact(
  finding: WeightedValidationResult,
  node: InfraNode,
): ContextualFinding['technicalImpact'] {
  const metadata = getMetadata(node);
  const hint = TECHNICAL_IMPACT_HINTS[canonicalRuleId(finding.ruleId)];
  const metadataKey = hint?.metadataKey ?? 'configuration';
  const metadataValue =
    resolveHintValue(finding.details, hint?.detailKeys ?? []) ??
    resolveHintValue(metadata, hint?.metadataKeys ?? []) ??
    resolveFirstValue(finding.details);

  return {
    observation: finding.message,
    metadataKey,
    metadataValue,
    expectedValue: hint?.expectedValue ?? 'Configuration should satisfy the rule requirement.',
  };
}

function resolveHintValue(
  value: Record<string, unknown> | undefined,
  keys: readonly string[],
): unknown {
  if (!value) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return value[key];
    }
  }
  return undefined;
}

function resolveFirstValue(value: Record<string, unknown> | undefined): unknown {
  if (!value) {
    return undefined;
  }
  const firstKey = Object.keys(value)[0];
  return firstKey ? value[firstKey] : undefined;
}

function toRemediationAction(recommendation: Recommendation): RemediationAction {
  return {
    title: recommendation.title,
    description: recommendation.description,
    command: recommendation.remediation.command,
    requiresDowntime: recommendation.remediation.requiresDowntime,
    requiresMaintenanceWindow: recommendation.remediation.requiresMaintenanceWindow,
    estimatedDuration: recommendation.remediation.estimatedDuration,
    prerequisites: recommendation.remediation.prerequisites,
    ...(recommendation.remediation.rollbackCommand
      ? { rollbackCommand: recommendation.remediation.rollbackCommand }
      : {}),
  };
}

function canonicalRuleId(ruleId: string): string {
  if (ruleId.includes('backup')) return 'backup_configured';
  if (ruleId.includes('multi_az') || ruleId.includes('multi-az')) return 'multi_az';
  if (
    ruleId.includes('replica') ||
    ruleId.includes('replication') ||
    ruleId.includes('global_table') ||
    ruleId.includes('cross_region')
  ) {
    return 'replication_configured';
  }
  if (ruleId.includes('failover') || ruleId.includes('ttl')) return 'failover_dns';
  if (ruleId.includes('alarm') || ruleId.includes('monitor')) return 'monitoring_configured';
  if (ruleId.includes('pitr') || ruleId.includes('point_in_time')) return 'point_in_time_recovery';
  if (ruleId.includes('asg') || ruleId.includes('auto_scaling')) return 'auto_scaling';
  if (ruleId.includes('health_check')) return 'health_check';
  if (ruleId.includes('dlq') || ruleId.includes('dead_letter')) return 'dead_letter_queue';
  if (ruleId.includes('encryption')) return 'encryption_at_rest';
  return ruleId;
}

function isNodeAffectedInScenario(scenario: Scenario, nodeId: string): boolean {
  return (
    scenario.impact?.directlyAffected.some((affected) => affected.nodeId === nodeId) === true ||
    scenario.impact?.cascadeAffected.some((affected) => affected.nodeId === nodeId) === true
  );
}

function selectWorstScenario(
  scenarios: readonly Scenario[],
  serviceId: string | null,
): Scenario {
  return scenarios
    .slice()
    .sort((left, right) => compareScenarioSeverity(left, right, serviceId))[0] ?? scenarios[0]!;
}

function compareScenarioSeverity(
  left: Scenario,
  right: Scenario,
  serviceId: string | null,
): number {
  return (
    serviceImpactRank(resolveServiceScenarioStatus(right, serviceId)) -
      serviceImpactRank(resolveServiceScenarioStatus(left, serviceId)) ||
    scenarioTypeRank(right.type) - scenarioTypeRank(left.type) ||
    left.id.localeCompare(right.id)
  );
}

function resolveServiceScenarioStatus(
  scenario: Scenario,
  serviceId: string | null,
): 'down' | 'degraded' | 'unaffected' {
  if (!serviceId) {
    return scenario.impact && scenario.impact.totalAffectedNodes > 0 ? 'degraded' : 'unaffected';
  }
  return (
    scenario.impact?.serviceImpact.find((impact) => impact.serviceId === serviceId)?.status ??
    'unaffected'
  );
}

function serviceImpactRank(status: 'down' | 'degraded' | 'unaffected'): number {
  switch (status) {
    case 'down':
      return 3;
    case 'degraded':
      return 2;
    case 'unaffected':
    default:
      return 1;
  }
}

function scenarioTypeRank(type: Scenario['type']): number {
  switch (type) {
    case 'data_corruption':
      return 5;
    case 'node_failure':
      return 4;
    case 'region_failure':
      return 3;
    case 'az_failure':
      return 2;
    case 'service_outage':
      return 1;
    case 'custom':
    default:
      return 0;
  }
}

function renderWorstCaseOutcome(
  scenario: Scenario,
  serviceId: string | null,
): string {
  switch (scenario.type) {
    case 'az_failure':
      return 'In an AZ failure, this resource becomes unavailable and the service has no failover path.';
    case 'data_corruption':
      return 'If data is corrupted, recovery requires a restore from backup which is not configured.';
    case 'node_failure': {
      const cascadeCount =
        scenario.impact?.cascadeAffected.filter(
          (affected) => !serviceId || affected.serviceId === serviceId,
        ).length ?? 0;
      return `If this SPOF fails, ${cascadeCount} dependent resource${cascadeCount === 1 ? '' : 's'} also ${cascadeCount === 1 ? 'fails' : 'fail'}.`;
    }
    case 'region_failure':
      return 'If the region becomes unavailable, this resource loses its primary path and the service must recover elsewhere.';
    case 'service_outage':
    case 'custom':
    default:
      return 'This disruption removes the current recovery path for the affected service.';
  }
}
