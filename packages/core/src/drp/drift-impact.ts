import type { DriftChange, DriftReport } from '../drift/drift-types.js';
import { determineRecoveryStrategy } from './recovery-strategies.js';
import { buildRTOEstimateInput, estimateRecovery } from './rto-estimator.js';
import type {
  AnalyzeDrpImpactOptions,
  DriftImpact,
  DriftImpactAnalysis,
  DriftImpactContext,
  RtoEvidence,
} from './drift-impact-types.js';
import type { DRPComponent, DRPlan, InfrastructureNode, RTOEstimate } from './drp-types.js';

const BACKUP_RESTORE_GUIDANCE_URL =
  'https://docs.aws.amazon.com/prescriptive-guidance/latest/strategy-database-disaster-recovery/defining.html';

const IMPACT_ORDER: Record<DriftImpact['impact'], number> = {
  invalidated: 3,
  degraded: 2,
  informational: 1,
};

const FALLBACK_AFTER_RTO_BY_DRIFT: Record<string, RtoEvidence | undefined> = {
  multi_az_disabled: {
    value: 'less than 24 hours',
    source: BACKUP_RESTORE_GUIDANCE_URL,
    confidence: 'documented',
  },
};

export function analyzeDrpImpact(
  report: DriftReport,
  options: AnalyzeDrpImpactOptions = {},
): DriftImpactAnalysis {
  const drpPlan = options.drpPlan ?? null;
  if (!drpPlan) {
    return {
      impacts: [],
      status: 'missing_drp',
      affectedSections: [],
      message: "No DRP found. Run 'stronghold plan generate' first.",
    };
  }

  if (report.changes.length === 0) {
    return {
      impacts: [],
      status: 'current',
      affectedSections: [],
      message: 'DRP status: CURRENT - no sections affected by drift.',
    };
  }

  const context: DriftImpactContext = {
    report,
    baselineNodes: new Map((options.baselineNodes ?? []).map((node) => [node.id, node])),
    currentNodes: new Map((options.currentNodes ?? []).map((node) => [node.id, node])),
    drpPlan,
  };

  const impacts = report.changes
    .map((change) => buildImpact(change, context))
    .sort(compareImpacts);
  const affectedSections = Array.from(
    new Set(
      impacts.flatMap((impact) =>
        impact.impact === 'informational' ? [] : impact.drpSections,
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return {
    impacts,
    status: affectedSections.length > 0 ? 'stale' : 'current',
    affectedSections,
    message:
      affectedSections.length > 0
        ? `DRP status: STALE - ${affectedSections.length} section${affectedSections.length === 1 ? '' : 's'} affected by drift.`
        : 'DRP status: CURRENT - no existing recovery sections were affected by drift.',
  };
}

function buildImpact(change: DriftChange, context: DriftImpactContext): DriftImpact {
  const matches = findSectionMatches(change.resourceId, context.drpPlan);
  const sections = Array.from(new Set(matches.map((match) => match.serviceName))).sort((left, right) =>
    left.localeCompare(right),
  );
  const primaryComponent = selectPrimaryComponent(matches);
  const impact = classifyImpact(change, sections);
  const nodeName = resolveNodeName(change, context);

  return {
    nodeId: change.resourceId,
    nodeName,
    driftType: readDriftType(change.id),
    drpSections: sections,
    impact,
    message: buildImpactMessage(change, impact, sections, nodeName),
    ...(shouldIncludeRtoChange(change)
      ? {
          estimatedRtoChange: buildRtoChange(change, primaryComponent, context),
        }
      : {}),
  };
}

function buildRtoChange(
  change: DriftChange,
  component: DRPComponent | null,
  context: DriftImpactContext,
): DriftImpact['estimatedRtoChange'] {
  const driftType = readDriftType(change.id);
  const beforeEvidence = resolveBeforeRto(component);
  const currentNode = context.currentNodes.get(change.resourceId);
  const afterEvidence =
    resolveAfterRtoFromCurrentNode(currentNode) ?? FALLBACK_AFTER_RTO_BY_DRIFT[driftType] ?? null;

  if (afterEvidence?.value) {
    return {
      before: beforeEvidence.value,
      after: afterEvidence.value,
      source: afterEvidence.source,
      confidence: afterEvidence.confidence,
      reason: describeAfterReason(driftType, afterEvidence.value),
    };
  }

  if (beforeEvidence.value === null) {
    return {
      before: null,
      after: null,
      source: null,
      confidence: 'unverified',
      reason: 'RTO unknown - was already unverified. Drift makes recovery less reliable.',
    };
  }

  return {
    before: beforeEvidence.value,
    after: null,
    source: null,
    confidence: 'unverified',
    reason: describeMissingAfterReason(driftType),
  };
}

function resolveBeforeRto(component: DRPComponent | null): RtoEvidence {
  const estimate = component?.rtoEstimate;
  if (!estimate) {
    return { value: null, source: null, confidence: 'unverified' };
  }

  if (estimate.rtoMinMinutes === null || estimate.rtoMaxMinutes === null) {
    return { value: null, source: null, confidence: 'unverified' };
  }

  return {
    value: formatMinuteRange(estimate.rtoMinMinutes, estimate.rtoMaxMinutes),
    source: resolveEstimateSource(estimate),
    confidence: estimate.confidence,
  };
}

function resolveAfterRtoFromCurrentNode(node: InfrastructureNode | undefined): RtoEvidence | null {
  if (!node) {
    return null;
  }

  const strategy = determineRecoveryStrategy(node);
  const estimate = estimateRecovery(buildRTOEstimateInput(node, strategy));
  const source = resolveEstimateSource(estimate);
  if (!source || estimate.rtoMinMinutes === null || estimate.rtoMaxMinutes === null) {
    return null;
  }

  return {
    value: formatMinuteRange(estimate.rtoMinMinutes, estimate.rtoMaxMinutes),
    source,
    confidence: estimate.confidence,
  };
}

function resolveEstimateSource(estimate: RTOEstimate): string | null {
  for (const factor of estimate.factors) {
    if (factor.source.type === 'aws_documentation' || factor.source.type === 'aws_sla') {
      return factor.source.url;
    }
  }
  return null;
}

function classifyImpact(
  change: DriftChange,
  sections: readonly string[],
): DriftImpact['impact'] {
  if (sections.length === 0) {
    return 'informational';
  }

  const driftType = readDriftType(change.id);
  if (driftType === 'backup_disabled' || driftType === 'resource_removed') {
    return 'invalidated';
  }

  return change.severity === 'info' ? 'informational' : 'degraded';
}

function buildImpactMessage(
  change: DriftChange,
  impact: DriftImpact['impact'],
  sections: readonly string[],
  nodeName: string,
): string {
  if (sections.length === 0) {
    return `${change.description} No existing DRP section references ${nodeName}.`;
  }

  const sectionLabel = sections.length === 1 ? `section "${sections[0]}"` : `${sections.length} DRP sections`;
  const driftType = readDriftType(change.id);

  if (impact === 'invalidated') {
    if (driftType === 'backup_disabled') {
      return `${nodeName} no longer has the backup protection assumed by ${sectionLabel}. Recovery steps that depend on restore points are no longer viable.`;
    }
    if (driftType === 'resource_removed') {
      return `${nodeName} is still referenced by ${sectionLabel}, but the resource no longer exists in the current scan.`;
    }
  }

  if (driftType === 'multi_az_disabled') {
    return `${nodeName} lost Multi-AZ redundancy. ${sectionLabel} can still recover, but the failover path is slower and should be revalidated.`;
  }

  return `${change.description} ${sectionLabel} should be reviewed because the recovery assumptions have changed.`;
}

function shouldIncludeRtoChange(change: DriftChange): boolean {
  return new Set(['multi_az_disabled', 'backup_disabled', 'resource_removed', 'replica_removed', 'cross_az_lost']).has(
    readDriftType(change.id),
  );
}

function describeAfterReason(driftType: string, value: string): string {
  if (driftType === 'multi_az_disabled') {
    return `Without Multi-AZ failover, recovery may fall back to backup-and-restore procedures with an RTO around ${value}.`;
  }
  return `The current recovery path now implies an estimated RTO of ${value}.`;
}

function describeMissingAfterReason(driftType: string): string {
  if (driftType === 'backup_disabled') {
    return 'Backup-based recovery is no longer available, so Stronghold cannot justify a new RTO from AWS documentation.';
  }
  if (driftType === 'resource_removed') {
    return 'The referenced recovery target is gone, so the DRP no longer has a documented recovery path.';
  }
  return 'The current recovery path has no documented AWS RTO. Test it before updating the DRP.';
}

function findSectionMatches(
  resourceId: string,
  drpPlan: DRPlan,
): ReadonlyArray<{ readonly serviceName: string; readonly component: DRPComponent; readonly exact: boolean }> {
  const matches: Array<{ readonly serviceName: string; readonly component: DRPComponent; readonly exact: boolean }> = [];

  for (const service of drpPlan.services) {
    for (const component of service.components) {
      if (component.resourceId === resourceId) {
        matches.push({ serviceName: service.name, component, exact: true });
        continue;
      }
      if (component.dependencies.includes(resourceId)) {
        matches.push({ serviceName: service.name, component, exact: false });
      }
    }
  }

  return matches;
}

function selectPrimaryComponent(
  matches: ReadonlyArray<{ readonly serviceName: string; readonly component: DRPComponent; readonly exact: boolean }>,
): DRPComponent | null {
  const exact = matches.find((match) => match.exact);
  return exact?.component ?? matches[0]?.component ?? null;
}

function resolveNodeName(change: DriftChange, context: DriftImpactContext): string {
  return (
    context.currentNodes.get(change.resourceId)?.name ??
    context.baselineNodes.get(change.resourceId)?.name ??
    change.resourceId
  );
}

function readDriftType(changeId: string): string {
  return changeId.split(':', 1)[0] ?? changeId;
}

function compareImpacts(left: DriftImpact, right: DriftImpact): number {
  return (
    IMPACT_ORDER[right.impact] - IMPACT_ORDER[left.impact] ||
    left.nodeName.localeCompare(right.nodeName) ||
    left.nodeId.localeCompare(right.nodeId)
  );
}

function formatMinuteRange(minMinutes: number, maxMinutes: number): string {
  if (minMinutes === maxMinutes) {
    return formatMinutes(minMinutes);
  }
  return `${formatMinutes(minMinutes)}-${formatMinutes(maxMinutes)}`;
}

function formatMinutes(value: number): string {
  if (value < 1) {
    return `${Math.round(value * 60)} seconds`;
  }
  if (value % 60 === 0 && value >= 60) {
    const hours = value / 60;
    return `${trimTrailingZero(hours)} hour${hours === 1 ? '' : 's'}`;
  }
  return `${trimTrailingZero(value)} minute${value === 1 ? '' : 's'}`;
}

function trimTrailingZero(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}
