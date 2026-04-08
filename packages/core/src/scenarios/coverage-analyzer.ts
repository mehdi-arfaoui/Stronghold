import { generateRunbook } from '../drp/runbook/runbook-generator.js';
import type { ComponentRunbook, DRPRunbook } from '../drp/runbook/runbook-types.js';
import type { DRPlan } from '../drp/drp-types.js';
import type { Evidence, EvidenceType } from '../evidence/index.js';
import type { InfraNodeAttrs } from '../types/infrastructure.js';
import type { Service } from '../services/service-types.js';
import { getAvailabilityZone } from '../graph/analysis-helpers.js';
import type {
  CoverageDetail,
  CoverageVerdict,
  Scenario,
  ScenarioCoverage,
} from './scenario-types.js';
import { validateRunbookLiveness } from './runbook-validator.js';

export function analyzeCoverage(
  scenario: Scenario,
  drp: DRPlan | null,
  evidence: readonly Evidence[],
  services: readonly Service[],
  nodes: readonly InfraNodeAttrs[] = [],
  runbook?: DRPRunbook | null,
): ScenarioCoverage {
  const impactedServices = resolveImpactedServices(scenario, services);
  if (!drp) {
    return {
      verdict: impactedServices.length === 0 ? 'covered' : 'uncovered',
      details: impactedServices.map((service) => ({
        serviceId: service.id,
        serviceName: service.name,
        verdict: 'uncovered',
        reason: "No DRP generated. Run 'stronghold plan generate'.",
        missingCapabilities: ['Generate a DRP for this service.'],
        evidenceLevel: 'inferred',
      })),
      summary:
        impactedServices.length === 0
          ? 'No services are affected by this scenario.'
          : "No DRP generated. Run 'stronghold plan generate' to evaluate coverage.",
    };
  }

  const effectiveRunbook = runbook ?? (nodes.length > 0 ? generateRunbook(drp, nodes) : null);
  const componentToPlanService = new Map(
    drp.services.flatMap((service) =>
      service.components.map((component) => [component.resourceId, service.name] as const),
    ),
  );
  const runbookByComponentId = new Map(
    (effectiveRunbook?.componentRunbooks ?? []).map((component) => [component.componentId, component] as const),
  );

  const details = impactedServices.map((service) => {
    const impactedNodeIds = new Set(
      service.resources
        .map((resource) => resource.nodeId)
        .filter((nodeId) => isNodeAffectedByScenario(scenario, nodeId)),
    );
    const drpComponents = drp.services
      .flatMap((planService) => planService.components)
      .filter((component) => service.resources.some((resource) => resource.nodeId === component.resourceId));
    const componentRunbooks = drpComponents
      .map((component) => runbookByComponentId.get(component.resourceId))
      .filter((component): component is ComponentRunbook => component != null);

    if (drpComponents.length === 0) {
      return createCoverageDetail(service, 'uncovered', 'Service not covered in DRP.', [
        'Add this service to the DRP.',
      ]);
    }

    if (effectiveRunbook && componentRunbooks.length > 0) {
      const validation = validateRunbookLiveness(
        {
          ...effectiveRunbook,
          componentRunbooks,
        },
        nodes,
      );
      if (!validation.isAlive) {
        const staleList = validation.staleReferences
          .map((reference) => reference.referencedResourceId)
          .join(', ');
        return createCoverageDetail(
          service,
          'degraded',
          `Runbook references stale resources: ${staleList}`,
          ['Refresh the runbook against the latest infrastructure state.'],
        );
      }
    }

    const recoveryAssessment = assessRecoveryPath(
      scenario,
      service,
      impactedNodeIds,
      drpComponents,
      nodes,
      componentToPlanService,
    );
    if (!recoveryAssessment.exists) {
      return createCoverageDetail(
        service,
        'uncovered',
        recoveryAssessment.reason,
        recoveryAssessment.missingCapabilities,
      );
    }

    const relevantEvidence = evidence
      .filter(
        (entry) =>
          entry.subject.serviceId === service.id ||
          impactedNodeIds.has(entry.subject.nodeId) ||
          service.resources.some((resource) => resource.nodeId === entry.subject.nodeId),
      )
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    const maturity = resolveCoverageFromEvidence(relevantEvidence);

    return {
      serviceId: service.id,
      serviceName: service.name,
      verdict: maturity.verdict,
      reason: maturity.reason,
      recoveryPath: recoveryAssessment.recoveryPath,
      missingCapabilities: [],
      evidenceLevel: maturity.evidenceLevel,
      ...(maturity.lastTested ? { lastTested: maturity.lastTested } : {}),
    } satisfies CoverageDetail;
  });

  return {
    verdict: summarizeCoverageVerdict(details),
    details,
    summary: summarizeCoverage(details),
  };
}

function resolveImpactedServices(
  scenario: Scenario,
  services: readonly Service[],
): readonly Service[] {
  const impactedServiceIds = new Set(
    scenario.impact?.serviceImpact
      .filter((impact) => impact.status !== 'unaffected')
      .map((impact) => impact.serviceId) ?? [],
  );
  return services.filter((service) => impactedServiceIds.has(service.id));
}

function createCoverageDetail(
  service: Service,
  verdict: CoverageVerdict,
  reason: string,
  missingCapabilities: readonly string[],
): CoverageDetail {
  return {
    serviceId: service.id,
    serviceName: service.name,
    verdict,
    reason,
    missingCapabilities,
    evidenceLevel: 'inferred',
  };
}

function isNodeAffectedByScenario(scenario: Scenario, nodeId: string): boolean {
  return (
    scenario.impact?.directlyAffected.some((node) => node.nodeId === nodeId) === true ||
    scenario.impact?.cascadeAffected.some((node) => node.nodeId === nodeId) === true
  );
}

function assessRecoveryPath(
  scenario: Scenario,
  service: Service,
  impactedNodeIds: ReadonlySet<string>,
  drpComponents: readonly DRPlan['services'][number]['components'][number][],
  nodes: readonly InfraNodeAttrs[],
  componentToPlanService: ReadonlyMap<string, string>,
): {
  readonly exists: boolean;
  readonly reason: string;
  readonly recoveryPath?: string;
  readonly missingCapabilities: readonly string[];
} {
  const serviceNodes = service.resources
    .map((resource) => nodes.find((node) => node.id === resource.nodeId))
    .filter((node): node is InfraNodeAttrs => node != null);
  const drpComponentIds = drpComponents.map((component) => component.resourceId);
  const remainingCriticalNodes = serviceNodes.filter(
    (node) =>
      !impactedNodeIds.has(node.id) &&
      ['compute', 'datastore'].includes(
        service.resources.find((resource) => resource.nodeId === node.id)?.role ?? 'other',
      ),
  );

  switch (scenario.type) {
    case 'az_failure': {
      const disruptedZones = new Set(
        serviceNodes
          .filter((node) => impactedNodeIds.has(node.id))
          .map((node) => getAvailabilityZone(node))
          .filter((zone): zone is string => zone !== null),
      );
      const alternateZoneExists = remainingCriticalNodes.some((node) => {
        const zone = getAvailabilityZone(node);
        return zone !== null && !disruptedZones.has(zone);
      });
      const failoverPath = drpComponents.some((component) =>
        ['failover', 'aurora_failover', 'aurora_global_failover', 'auto_scaling', 'dns_failover'].includes(
          component.recoveryStrategy,
        ),
      );
      return alternateZoneExists && failoverPath
        ? {
            exists: true,
            reason: 'Recovery path exists.',
            recoveryPath: `Fail over ${service.name} using the DRP components mapped to ${componentToPlanService.get(drpComponentIds[0] ?? '') ?? service.name}.`,
            missingCapabilities: [],
          }
        : {
            exists: false,
            reason: alternateZoneExists
              ? 'Service has capacity in another AZ but the DRP does not describe the failover path.'
              : 'Service does not have critical resources in another AZ.',
            missingCapabilities: alternateZoneExists
              ? ['Add an explicit failover procedure to the DRP.']
              : ['Deploy critical resources in another availability zone.', 'Add a failover procedure to the DRP.'],
          };
    }
    case 'data_corruption':
      return drpComponents.some((component) => component.recoveryStrategy === 'restore_from_backup')
        ? {
            exists: true,
            reason: 'Recovery path exists.',
            recoveryPath: `Restore ${service.name} from the DRP recovery components.`,
            missingCapabilities: [],
          }
        : {
            exists: false,
            reason: 'Recovery requires a backup or PITR path that is not present in the DRP.',
            missingCapabilities: ['Enable backups or point-in-time recovery.', 'Add a restore path to the DRP.'],
          };
    case 'node_failure':
      return drpComponentIds.length > 0
        ? {
            exists: true,
            reason: 'Recovery path exists.',
            recoveryPath: `Recover or replace the failed node with the mapped DRP component.`,
            missingCapabilities: [],
          }
        : {
            exists: false,
            reason: 'The SPOF is not covered by a recoverable DRP component.',
            missingCapabilities: ['Add a recovery or replacement step for the SPOF.'],
          };
    case 'region_failure':
      return remainingCriticalNodes.length > 0 && drpComponentIds.length > 0
        ? {
            exists: true,
            reason: 'Recovery path exists.',
            recoveryPath: `Recover ${service.name} in the surviving region with the DRP failover sequence.`,
            missingCapabilities: [],
          }
        : {
            exists: false,
            reason: 'The service has no surviving critical capacity in another region.',
            missingCapabilities: ['Deploy regional redundancy.', 'Add a regional failover path to the DRP.'],
          };
    case 'service_outage':
    case 'custom':
    default:
      return drpComponentIds.length > 0
        ? {
            exists: true,
            reason: 'Recovery path exists.',
            recoveryPath: `Use the mapped DRP components to restore ${service.name}.`,
            missingCapabilities: [],
          }
        : {
            exists: false,
            reason: 'No recovery path exists for the affected service resources.',
            missingCapabilities: ['Add a DRP section for the affected resources.'],
          };
  }
}

function resolveCoverageFromEvidence(
  evidence: readonly Evidence[],
): {
  readonly verdict: CoverageVerdict;
  readonly reason: string;
  readonly evidenceLevel: EvidenceType;
  readonly lastTested?: string;
} {
  const bestTest = evidence.find((entry) => entry.type === 'tested');
  if (bestTest) {
    return {
      verdict: 'covered',
      reason: 'Recovery path exists and has recent tested evidence.',
      evidenceLevel: 'tested',
      lastTested: bestTest.timestamp,
    };
  }

  const expiredTest = evidence.find((entry) => entry.type === 'expired');
  if (expiredTest) {
    return {
      verdict: 'partially_covered',
      reason: `Recovery path exists but last test is expired (${expiredTest.timestamp.slice(0, 10)}).`,
      evidenceLevel: 'expired',
      lastTested: expiredTest.timestamp,
    };
  }

  return {
    verdict: 'partially_covered',
    reason: 'Recovery path exists but has not been tested.',
    evidenceLevel: evidence[0]?.type ?? 'observed',
  };
}

function summarizeCoverageVerdict(details: readonly CoverageDetail[]): CoverageVerdict {
  if (details.every((detail) => detail.verdict === 'covered')) {
    return 'covered';
  }
  if (details.some((detail) => detail.verdict === 'uncovered')) {
    return 'uncovered';
  }
  if (details.some((detail) => detail.verdict === 'degraded')) {
    return 'degraded';
  }
  return 'partially_covered';
}

function summarizeCoverage(details: readonly CoverageDetail[]): string {
  if (details.length === 0) {
    return 'No services are affected by this scenario.';
  }

  const covered = details.filter((detail) => detail.verdict === 'covered').length;
  const partial = details.filter((detail) => detail.verdict === 'partially_covered').length;
  const degraded = details.filter((detail) => detail.verdict === 'degraded').length;
  const uncovered = details.filter((detail) => detail.verdict === 'uncovered').length;
  return `${covered} covered, ${partial} partially covered, ${degraded} degraded, ${uncovered} uncovered across ${details.length} affected service${details.length === 1 ? '' : 's'}.`;
}
