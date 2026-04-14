import dagre from 'dagre';

import { gradeForScore } from '../validation/index.js';
import { buildReasoningChain } from '../reasoning/reasoning-engine.js';
import type { ReasoningScanResult } from '../reasoning/reasoning-types.js';
import { calculateProofOfRecovery } from '../scoring/proof-of-recovery.js';
import { calculateRealityGap } from '../scoring/reality-gap.js';
import { classifyResourceRole, normalizeEdgeType } from '../services/service-utils.js';
import type { InfraNodeAttrs, Severity, ScanResult } from '../types/infrastructure.js';
import type { ValidationStatus, WeightedValidationResult } from '../validation/validation-types.js';
import type {
  GraphVisualData,
  GraphVisualSource,
  VisualNode,
  VisualNodeFinding,
  VisualScenario,
  VisualService,
} from './graph-visual-types.js';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 68;
const SERVICE_SIDE_PADDING = 20;
const SERVICE_VERTICAL_PADDING = 20;
const SERVICE_LABEL_PADDING_TOP = 28;
const SERVICE_TOP_PADDING = SERVICE_VERTICAL_PADDING + SERVICE_LABEL_PADDING_TOP;
const SERVICE_BOTTOM_PADDING = SERVICE_VERTICAL_PADDING;
const SERVICE_LANE_GAP = 18;
const DEFAULT_SCAN_DATE = '1970-01-01T00:00:00.000Z';
const EXCLUDED_VISUAL_EDGE_TYPES = new Set(['contains', 'member_of', 'secured_by']);

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const FINDING_STATUSES = new Set<ValidationStatus>(['fail', 'warn', 'error']);

const SOURCE_TYPE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['cloudwatch_alarm', 'cloudwatch'],
  ['route53_hosted_zone', 'route53'],
  ['route53_record', 'route53'],
  ['backup_plan', 'backup'],
  ['aurora_cluster', 'aurora'],
  ['aurora_instance', 'aurora'],
  ['elasticache', 'elasticache'],
  ['replicationgroup', 'elasticache'],
  ['lambda', 'lambda'],
  ['s3_bucket', 's3'],
  ['dynamodb', 'dynamodb'],
  ['efs_mount_target', 'efs'],
  ['efs_filesystem', 'efs'],
  ['efs', 'efs'],
  ['elb', 'elb'],
  ['loadbalancer', 'elb'],
  ['rds', 'rds'],
  ['ec2', 'ec2'],
  ['asg', 'asg'],
  ['sqs', 'sqs'],
  ['sns', 'sns'],
  ['subnet', 'subnet'],
  ['vpc', 'vpc'],
  ['dns', 'dns'],
];

export function buildGraphVisualData(scanResult: ScanResult | GraphVisualSource): GraphVisualData {
  const input = scanResult as GraphVisualSource;
  const visualEdges = filterVisualEdges(input.edges);
  const proof =
    input.proofOfRecovery ??
    (input.validationReport
      ? calculateProofOfRecovery({
          validationReport: input.validationReport,
          servicePosture: input.servicePosture,
        })
      : null);
  const realityGap =
    input.realityGap ??
    (input.validationReport
      ? calculateRealityGap({
          nodes: input.nodes,
          validationReport: input.validationReport,
          servicePosture: input.servicePosture,
          scenarioAnalysis: input.scenarioAnalysis,
          drpPlan: input.drpPlan,
        })
      : {
          claimedProtection: 0,
          provenRecoverability: null,
          realityGap: null,
          perService: [],
        });
  const nodeFindings = buildNodeFindings(input);
  const nodeRecommendations = buildNodeRecommendations(input);
  const serviceEntries = input.servicePosture?.services ?? [];
  const nodeToService = new Map(
    serviceEntries.flatMap((entry) =>
      entry.service.resources.map((resource) => [resource.nodeId, entry] as const),
    ),
  );
  const layout = packServiceLanes(buildLayout(input.nodes, visualEdges), serviceEntries);

  const nodes = input.nodes
    .map((node) => {
      const position = layout.get(node.id);
      const serviceEntry = nodeToService.get(node.id);
      const findings = nodeFindings.get(node.id) ?? [];

      return {
        id: node.id,
        label: resolveNodeLabel(node),
        type: resolveNodeType(node),
        serviceId: serviceEntry?.service.id ?? null,
        serviceName: serviceEntry?.service.name ?? null,
        criticality: resolveNodeCriticality(node, serviceEntry?.service.criticality ?? null),
        drScore: calculateNodeScore(input.validationReport?.results, node.id),
        role: classifyResourceRole(node),
        region: node.region ?? 'global',
        az: node.availabilityZone ?? null,
        x: position?.x ?? 0,
        y: position?.y ?? 0,
        findingCount: findings.length,
        worstSeverity: resolveWorstSeverity(findings.map((finding) => finding.severity)),
        findings,
        recommendations: nodeRecommendations.get(node.id) ?? [],
      } satisfies VisualNode;
    })
    .sort(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    );

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));

  const services = serviceEntries
    .flatMap((entry) => {
      const nodeIds = entry.service.resources
        .map((resource) => resource.nodeId)
        .filter((nodeId) => nodeById.has(nodeId))
        .sort((left, right) => left.localeCompare(right));
      if (nodeIds.length === 0) {
        return [];
      }

      const bounds = calculateServiceBounds(nodeIds, nodeById);
      const serviceRealityGap =
        realityGap.perService.find((detail) => detail.serviceId === entry.service.id) ?? null;
      const chain =
        input.validationReport && input.servicePosture
          ? buildReasoningChain(
              entry.service.id,
              toReasoningScanResult(input),
              input.previousScanResult ?? null,
              input.findingLifecycles ?? null,
              realityGap,
            )
          : null;
      return [
        {
          id: entry.service.id,
          name: entry.service.name,
          score: entry.score.score,
          grade: entry.score.grade,
          criticality: entry.service.criticality,
          claimedProtection: serviceRealityGap?.claimedProtection ?? 0,
          provenRecoverability: serviceRealityGap?.provenRecoverability ?? 0,
          realityGap: serviceRealityGap?.realityGap ?? 0,
          findingCount: countFindings(entry.score.findingsCount),
          worstSeverity: resolveWorstSeverityFromCounts(entry.score.findingsCount),
          nodeIds,
          reasoning: chain ? condenseChain(chain, 4) : [],
          insights: chain ? chain.insights.map((insight) => insight.summary) : [],
          conclusion: chain?.conclusion ?? '',
          nextAction: chain?.nextAction ?? null,
          ...bounds,
        } satisfies VisualService,
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  const edges = visualEdges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    label: normalizeEdgeType(edge.type),
    provenance: edge.provenance ?? 'aws-api',
  }));

  const globalScore =
    input.governance?.score.withAcceptances.score ??
    input.validationReport?.scoreBreakdown.overall ??
    0;
  const globalGrade =
    input.governance?.score.withAcceptances.grade ??
    input.validationReport?.scoreBreakdown.grade ??
    gradeForScore(globalScore);

  return {
    nodes,
    edges,
    services,
    globalScore,
    globalGrade,
    claimedProtection: realityGap.claimedProtection,
    provenRecoverability: realityGap.provenRecoverability,
    realityGap: realityGap.realityGap,
    proofOfRecovery: proof?.proofOfRecovery ?? null,
    observedCoverage: proof?.observedCoverage ?? 0,
    scanDate: resolveScanDate(input),
    scenarios: buildVisualScenarios(input),
  };
}

function buildLayout(
  nodes: readonly InfraNodeAttrs[],
  edges: ReadonlyArray<{ readonly source: string; readonly target: string }>,
): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    ranksep: 90,
    nodesep: 35,
    marginx: 30,
    marginy: 30,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });
  edges.forEach((edge) => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  });
  dagre.layout(graph);

  return new Map(
    nodes.map((node) => {
      const position = graph.node(node.id) as
        | { readonly x: number; readonly y: number }
        | undefined;
      return [
        node.id,
        {
          x: position?.x ?? 0,
          y: position?.y ?? 0,
        },
      ] as const;
    }),
  );
}

function filterVisualEdges<T extends { readonly type: string }>(
  edges: readonly T[],
): readonly T[] {
  return edges.filter((edge) => !EXCLUDED_VISUAL_EDGE_TYPES.has(normalizeEdgeType(edge.type)));
}

function buildNodeFindings(
  input: GraphVisualSource,
): ReadonlyMap<string, readonly VisualNodeFinding[]> {
  const findings = new Map<string, VisualNodeFinding[]>();
  input.validationReport?.results.forEach((result) => {
    if (!FINDING_STATUSES.has(result.status)) {
      return;
    }

    const current = findings.get(result.nodeId) ?? [];
    current.push({
      ruleId: result.ruleId,
      severity: result.severity,
      status: result.status,
      message: result.message,
      remediation: result.remediation ?? null,
    });
    findings.set(result.nodeId, current);
  });

  findings.forEach((items, nodeId) => {
    findings.set(
      nodeId,
      items
        .slice()
        .sort(
          (left, right) =>
            SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
            left.ruleId.localeCompare(right.ruleId),
        ),
    );
  });

  return findings;
}

function buildNodeRecommendations(
  input: GraphVisualSource,
): ReadonlyMap<string, readonly string[]> {
  const recommendations = input.servicePosture?.recommendations ?? [];
  const grouped = new Map<string, string[]>();

  recommendations.forEach((recommendation) => {
    const current = grouped.get(recommendation.targetNode) ?? [];
    if (!current.includes(recommendation.title)) {
      current.push(recommendation.title);
      grouped.set(recommendation.targetNode, current);
    }
  });

  return grouped;
}

function calculateServiceBounds(
  nodeIds: readonly string[],
  nodeById: ReadonlyMap<string, VisualNode>,
): Pick<VisualService, 'x' | 'y' | 'width' | 'height'> {
  return calculateBoundsForNodeIds(
    nodeIds,
    (nodeId) => {
      const node = nodeById.get(nodeId);
      return node ? { x: node.x, y: node.y } : null;
    },
  );
}

function calculateBoundsForNodeIds(
  nodeIds: readonly string[],
  getPosition: (nodeId: string) => { readonly x: number; readonly y: number } | null,
): Pick<VisualService, 'x' | 'y' | 'width' | 'height'> {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  nodeIds.forEach((nodeId) => {
    const position = getPosition(nodeId);
    if (!position) {
      return;
    }

    minX = Math.min(minX, position.x - NODE_WIDTH / 2);
    minY = Math.min(minY, position.y - NODE_HEIGHT / 2);
    maxX = Math.max(maxX, position.x + NODE_WIDTH / 2);
    maxY = Math.max(maxY, position.y + NODE_HEIGHT / 2);
  });

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;

  return {
    x: minX - SERVICE_SIDE_PADDING,
    y: minY - SERVICE_TOP_PADDING,
    width: Math.max(contentWidth + SERVICE_SIDE_PADDING * 2, NODE_WIDTH + SERVICE_SIDE_PADDING * 2),
    height: Math.max(
      contentHeight + SERVICE_TOP_PADDING + SERVICE_BOTTOM_PADDING,
      NODE_HEIGHT + SERVICE_TOP_PADDING + SERVICE_BOTTOM_PADDING,
    ),
  };
}

function packServiceLanes(
  layout: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  serviceEntries: NonNullable<GraphVisualSource['servicePosture']>['services'],
): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
  const services = serviceEntries
    .flatMap((entry) => {
      const nodeIds = entry.service.resources
        .map((resource) => resource.nodeId)
        .filter((nodeId) => layout.has(nodeId));
      if (nodeIds.length === 0) {
        return [];
      }

      return [
        {
          id: entry.service.id,
          nodeIds,
          bounds: calculateBoundsForNodeIds(nodeIds, (nodeId) => layout.get(nodeId) ?? null),
        },
      ];
    })
    .sort(
      (left, right) =>
        left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y || left.id.localeCompare(right.id),
    );

  if (services.length === 0) {
    return layout;
  }

  const adjusted = new Map(layout);
  const placed: Array<{ readonly bounds: Pick<VisualService, 'x' | 'y' | 'width' | 'height'> }> = [];

  services.forEach((service) => {
    let shiftedBounds = service.bounds;
    let didShift = true;

    while (didShift) {
      didShift = false;

      for (const previous of placed) {
        if (
          rangesOverlap(
            shiftedBounds.x,
            shiftedBounds.x + shiftedBounds.width,
            previous.bounds.x,
            previous.bounds.x + previous.bounds.width,
          ) &&
          rangesOverlap(
            shiftedBounds.y,
            shiftedBounds.y + shiftedBounds.height,
            previous.bounds.y,
            previous.bounds.y + previous.bounds.height,
          )
        ) {
          shiftedBounds = {
            ...shiftedBounds,
            y: previous.bounds.y + previous.bounds.height + SERVICE_LANE_GAP,
          };
          didShift = true;
        }
      }
    }

    const deltaY = shiftedBounds.y - service.bounds.y;
    if (deltaY !== 0) {
      service.nodeIds.forEach((nodeId) => {
        const position = adjusted.get(nodeId);
        if (!position) {
          return;
        }

        adjusted.set(nodeId, {
          x: position.x,
          y: position.y + deltaY,
        });
      });
    }

    placed.push({ bounds: shiftedBounds });
  });

  return normalizeLayoutOrigin(adjusted, services);
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.min(endA, endB) > Math.max(startA, startB);
}

function normalizeLayoutOrigin(
  layout: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  services: ReadonlyArray<{
    readonly nodeIds: readonly string[];
    readonly bounds: Pick<VisualService, 'x' | 'y' | 'width' | 'height'>;
  }>,
): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;

  layout.forEach((position) => {
    minX = Math.min(minX, position.x - NODE_WIDTH / 2);
    minY = Math.min(minY, position.y - NODE_HEIGHT / 2);
  });
  services.forEach((service) => {
    minX = Math.min(minX, service.bounds.x);
    minY = Math.min(minY, service.bounds.y);
  });

  const shiftX = minX < 0 ? -minX : 0;
  const shiftY = minY < 0 ? -minY : 0;
  if (shiftX === 0 && shiftY === 0) {
    return layout;
  }

  return new Map(
    Array.from(layout.entries(), ([nodeId, position]) => [
      nodeId,
      {
        x: position.x + shiftX,
        y: position.y + shiftY,
      },
    ]),
  );
}

function buildVisualScenarios(input: GraphVisualSource): readonly VisualScenario[] {
  return (input.scenarioAnalysis?.scenarios ?? [])
    .map((scenario) => {
      const directNodeIds = (scenario.impact?.directlyAffected ?? [])
        .map((item) => item.nodeId)
        .sort((left, right) => left.localeCompare(right));
      const cascadeNodeIds = (scenario.impact?.cascadeAffected ?? [])
        .map((item) => item.nodeId)
        .sort((left, right) => left.localeCompare(right));
      const affectedNodeIds = Array.from(new Set([...directNodeIds, ...cascadeNodeIds])).sort(
        (left, right) => left.localeCompare(right),
      );
      const serviceImpact = scenario.impact?.serviceImpact ?? [];

      return {
        id: scenario.id,
        name: scenario.name,
        type: scenario.type,
        verdict: scenario.coverage?.verdict ?? 'unknown',
        affectedNodeIds,
        directlyAffectedNodeIds: directNodeIds,
        cascadeNodeIds,
        downServices: serviceImpact
          .filter((impact) => impact.status === 'down')
          .map((impact) => impact.serviceName)
          .sort((left, right) => left.localeCompare(right)),
        degradedServices: serviceImpact
          .filter((impact) => impact.status === 'degraded')
          .map((impact) => impact.serviceName)
          .sort((left, right) => left.localeCompare(right)),
        summary: scenario.coverage?.summary ?? null,
      } satisfies VisualScenario;
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function calculateNodeScore(
  results: readonly WeightedValidationResult[] | undefined,
  nodeId: string,
): number | null {
  const relevant = (results ?? []).filter(
    (result) => result.nodeId === nodeId && result.status !== 'skip',
  );
  if (relevant.length === 0) {
    return null;
  }

  const earned = relevant.reduce((sum, result) => {
    if (result.status === 'pass') {
      return sum + 1;
    }
    if (result.status === 'warn') {
      return sum + 0.5;
    }
    return sum;
  }, 0);

  return Math.round((earned / relevant.length) * 100);
}

function resolveNodeLabel(node: InfraNodeAttrs): string {
  return node.displayName ?? node.businessName ?? node.name;
}

function resolveNodeType(node: InfraNodeAttrs): string {
  const metadataValue =
    typeof node.metadata.sourceType === 'string'
      ? node.metadata.sourceType
      : typeof node.metadata.resourceType === 'string'
        ? node.metadata.resourceType
        : node.type;
  const normalized = metadataValue.trim().toLowerCase();

  for (const [needle, alias] of SOURCE_TYPE_ALIASES) {
    if (normalized.includes(needle)) {
      return alias;
    }
  }

  return normalized.replace(/[\s-]+/g, '_');
}

function resolveNodeCriticality(node: InfraNodeAttrs, serviceCriticality: string | null): string {
  const explicit = node.metadata.criticality;
  if (
    explicit === 'critical' ||
    explicit === 'high' ||
    explicit === 'medium' ||
    explicit === 'low'
  ) {
    return explicit;
  }

  const score =
    typeof node.criticalityScore === 'number'
      ? node.criticalityScore
      : typeof node.metadata.criticalityScore === 'number'
        ? node.metadata.criticalityScore
        : null;
  if (typeof score === 'number') {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  return serviceCriticality ?? 'low';
}

function resolveWorstSeverity(values: readonly (Severity | null | undefined)[]): Severity | null {
  const ranked = values
    .filter(
      (value): value is Severity =>
        value === 'critical' || value === 'high' || value === 'medium' || value === 'low',
    )
    .sort((left, right) => SEVERITY_RANK[right] - SEVERITY_RANK[left]);
  return ranked[0] ?? null;
}

function resolveWorstSeverityFromCounts(counts: {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}): Severity | null {
  if (counts.critical > 0) return 'critical';
  if (counts.high > 0) return 'high';
  if (counts.medium > 0) return 'medium';
  if (counts.low > 0) return 'low';
  return null;
}

function countFindings(counts: {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}): number {
  return counts.critical + counts.high + counts.medium + counts.low;
}

function condenseChain(
  chain: ReturnType<typeof buildReasoningChain>,
  maxItems: number,
): readonly string[] {
  return [
    ...chain.steps
      .filter((step) => step.type !== 'service_composition' && step.type !== 'critical_dependency')
      .map((step) => step.summary),
    ...chain.insights.map((insight) => `${insight.type.replace(/_/g, ' ').toUpperCase()}: ${insight.summary}`),
  ]
    .slice(0, maxItems);
}

function toReasoningScanResult(input: GraphVisualSource): ReasoningScanResult {
  if (!input.validationReport || !input.servicePosture) {
    throw new Error('Reasoning requires validation and service posture data.');
  }

  return {
    ...input,
    nodes: [...input.nodes],
    edges: [...input.edges],
    validationReport: input.validationReport,
    servicePosture: input.servicePosture,
    governance: null,
    scannedAt: new Date(resolveScanDate(input)),
  };
}

function resolveScanDate(input: GraphVisualSource): string {
  if (typeof input.timestamp === 'string' && input.timestamp.length > 0) {
    return input.timestamp;
  }
  if (input.scannedAt instanceof Date && Number.isFinite(input.scannedAt.getTime())) {
    return input.scannedAt.toISOString();
  }
  if (
    typeof input.validationReport?.timestamp === 'string' &&
    input.validationReport.timestamp.length > 0
  ) {
    return input.validationReport.timestamp;
  }
  return DEFAULT_SCAN_DATE;
}
